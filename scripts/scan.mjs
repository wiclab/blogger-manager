import fs from "node:fs";

const API_KEY = process.env.BLOGGER_API_KEY;

if (!API_KEY) {
  throw new Error("BLOGGER_API_KEY가 없습니다.");
}

const BLOGS = [
  {
    key: "wic",
    name: "별다알",
    url: "https://wic12.blogspot.com"
  },
  {
    key: "nobody",
    name: "Nobody Asked Data",
    url: "https://qevnaxori.blogspot.com"
  }
];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your",
  "you", "are", "was", "were", "will", "would", "could", "should", "can",
  "how", "what", "when", "where", "why", "who", "which", "about", "than",
  "then", "they", "them", "their", "there", "here", "have", "has", "had",
  "does", "did", "doing", "not", "but", "all", "any", "our", "out", "one",
  "two", "more", "most", "really", "actually", "just", "every", "without",
  "after", "before", "over", "under", "between", "through", "per", "much",
  "many", "long", "take", "make", "get", "got", "like",

  "그리고", "하지만", "그러면", "그래서", "이렇게", "저렇게", "이런", "저런",
  "대한", "위한", "하는", "되는", "있다", "없다", "있는", "없는", "하면", "해도",
  "부터", "까지", "에서", "으로", "보다", "정도", "정말", "진짜", "과연",
  "경우", "때문", "때문에", "방법", "이유", "알아보자", "알아보기"
]);

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}\n${text}`);
  }

  return response.json();
}

async function getBlogId(blogUrl) {
  const url =
    `https://www.googleapis.com/blogger/v3/blogs/byurl` +
    `?url=${encodeURIComponent(blogUrl)}` +
    `&key=${encodeURIComponent(API_KEY)}`;

  const data = await fetchJson(url);

  return {
    id: data.id,
    name: data.name,
    totalPosts: Number(data.posts?.totalItems || 0)
  };
}

async function getAllPosts(blogId) {
  const posts = [];
  let pageToken = null;

  do {
    const params = new URLSearchParams({
      key: API_KEY,
      maxResults: "50",
      fetchBodies: "true"
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const url =
      `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts?${params}`;

    const data = await fetchJson(url);

    posts.push(...(data.items || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return posts;
}

function decodeHtmlEntities(html = "") {
  return html
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(html = "") {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function countMatches(text, regex) {
  return [...text.matchAll(regex)].length;
}

function normalizeUrl(value, blogUrl) {
  try {
    const base = new URL(blogUrl);
    const url = new URL(value, `${blogUrl}/`);

    if (url.hostname !== base.hostname) {
      return null;
    }

    let pathname = url.pathname.replace(/\/+$/, "");
    if (!pathname) pathname = "/";

    return `https://${base.hostname}${pathname}`;
  } catch {
    return null;
  }
}

function tokenize(text = "") {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ");

  return normalized
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean)
    .filter(token => !/^\d+$/.test(token))
    .filter(token => {
      const len = [...token].length;
      return /[가-힣]/.test(token) ? len >= 2 : len >= 3;
    })
    .filter(token => !STOPWORDS.has(token));
}

function analyzePost(post, blogUrl) {
  const html = post.content || "";
  const text = stripHtml(html);

  const links = [
    ...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)
  ].map(match => match[1]);

  const host = new URL(blogUrl).hostname;
  const outgoingInternalUrls = new Set();

  let internalLinks = 0;
  let externalLinks = 0;

  for (const href of links) {
    try {
      const url = new URL(href, blogUrl);

      if (url.hostname === host) {
        internalLinks++;

        const normalized = normalizeUrl(href, blogUrl);

        if (normalized) {
          outgoingInternalUrls.add(normalized);
        }
      } else if (
        url.protocol === "http:" ||
        url.protocol === "https:"
      ) {
        externalLinks++;
      }
    } catch {
      // 잘못된 URL 무시
    }
  }

  const warnings = [];

  if (internalLinks === 0) warnings.push("내부링크 없음");
  if (text.length < 1000) warnings.push("본문 짧음");
  if (countMatches(html, /<h2\b/gi) === 0) warnings.push("H2 없음");
  if (!post.labels || post.labels.length === 0) warnings.push("라벨 없음");

  const title = post.title || "";
  const labels = post.labels || [];

  const recommendationText = [
    title,
    title,
    labels.join(" "),
    labels.join(" "),
    text.slice(0, 6000)
  ].join(" ");

  return {
    id: post.id,
    title,
    url: post.url,
    normalizedUrl: normalizeUrl(post.url, blogUrl),
    published: post.published,
    updated: post.updated,
    labels,
    textLength: text.length,
    internalLinks,
    externalLinks,
    images: countMatches(html, /<img\b/gi),
    h2: countMatches(html, /<h2\b/gi),
    h3: countMatches(html, /<h3\b/gi),

    incomingLinks: 0,
    incomingFrom: [],
    recommendations: [],

    warnings,

    _outgoingInternalUrls: [...outgoingInternalUrls],
    _tokens: tokenize(recommendationText)
  };
}

function addIncomingLinkData(posts) {
  const byUrl = new Map(
    posts
      .filter(post => post.normalizedUrl)
      .map(post => [post.normalizedUrl, post])
  );

  for (const source of posts) {
    const uniqueTargets =
      new Set(source._outgoingInternalUrls || []);

    for (const targetUrl of uniqueTargets) {
      const target = byUrl.get(targetUrl);

      if (!target || target.id === source.id) {
        continue;
      }

      target.incomingFrom.push({
        title: source.title,
        url: source.url
      });
    }
  }

  for (const post of posts) {
    post.incomingLinks = post.incomingFrom.length;

    if (
      post.incomingLinks === 0 &&
      !post.warnings.includes("고립 글")
    ) {
      post.warnings.push("고립 글");
    }
  }
}

function buildTfidfVectors(posts) {
  const documentFrequency = new Map();

  for (const post of posts) {
    const uniqueTokens = new Set(post._tokens || []);

    for (const token of uniqueTokens) {
      documentFrequency.set(
        token,
        (documentFrequency.get(token) || 0) + 1
      );
    }
  }

  const totalDocs = posts.length;

  return posts.map(post => {
    const counts = new Map();

    for (const token of post._tokens || []) {
      counts.set(
        token,
        (counts.get(token) || 0) + 1
      );
    }

    const vector = new Map();
    let magnitudeSquared = 0;

    for (const [token, count] of counts) {
      const df =
        documentFrequency.get(token) || 1;

      const idf =
        Math.log(
          (totalDocs + 1) / (df + 1)
        ) + 1;

      const tf =
        1 + Math.log(count);

      const weight =
        tf * idf;

      vector.set(token, weight);
      magnitudeSquared += weight * weight;
    }

    return {
      id: post.id,
      vector,
      magnitude:
        Math.sqrt(magnitudeSquared)
    };
  });
}

function cosineSimilarity(a, b) {
  if (!a.magnitude || !b.magnitude) {
    return 0;
  }

  const [small, large] =
    a.vector.size <= b.vector.size
      ? [a.vector, b.vector]
      : [b.vector, a.vector];

  let dot = 0;

  for (const [token, weight] of small) {
    const other =
      large.get(token);

    if (other) {
      dot += weight * other;
    }
  }

  return dot /
    (a.magnitude * b.magnitude);
}

function addRecommendations(posts) {
  const vectors =
    buildTfidfVectors(posts);

  const vectorById =
    new Map(
      vectors.map(item => [
        item.id,
        item
      ])
    );

  for (const source of posts) {
    const sourceVector =
      vectorById.get(source.id);

    const alreadyLinked =
      new Set(
        source._outgoingInternalUrls || []
      );

    const sourceLabels =
      new Set(
        (source.labels || []).map(
          label => label.toLowerCase()
        )
      );

    const candidates = [];

    for (const target of posts) {
      if (target.id === source.id) {
        continue;
      }

      if (
        target.normalizedUrl &&
        alreadyLinked.has(
          target.normalizedUrl
        )
      ) {
        continue;
      }

      let score =
        cosineSimilarity(
          sourceVector,
          vectorById.get(target.id)
        );

      const targetLabels =
        (target.labels || []).map(
          label => label.toLowerCase()
        );

      const sharedLabels =
        targetLabels.filter(
          label =>
            sourceLabels.has(label)
        ).length;

      score += sharedLabels * 0.12;

      if (score >= 0.10) {
        candidates.push({
          title: target.title,
          url: target.url,
          score:
            Number(score.toFixed(3))
        });
      }
    }

    source.recommendations =
      candidates
        .sort(
          (a, b) =>
            b.score - a.score
        )
        .slice(0, 3);
  }
}

function cleanForReport(post) {
  const {
    _outgoingInternalUrls,
    _tokens,
    normalizedUrl,
    ...publicPost
  } = post;

  return publicPost;
}

async function scanBlog(config) {
  console.log(
    `\n🔎 ${config.name} 검사 시작`
  );

  const blog =
    await getBlogId(config.url);

  console.log(
    `Blog ID: ${blog.id}`
  );

  console.log(
    `API 게시글 수: ${blog.totalPosts}`
  );

  const rawPosts =
    await getAllPosts(blog.id);

  console.log(
    `실제 가져온 글: ${rawPosts.length}`
  );

  const posts =
    rawPosts.map(post =>
      analyzePost(
        post,
        config.url
      )
    );

  addIncomingLinkData(posts);
  addRecommendations(posts);

  const publicPosts =
    posts.map(cleanForReport);

  const warningPosts =
    publicPosts.filter(
      post =>
        post.warnings.length > 0
    );

  const isolatedPosts =
    publicPosts.filter(
      post =>
        post.incomingLinks === 0
    );

  const recommendationPosts =
    publicPosts.filter(
      post =>
        post.recommendations.length > 0
    );

  console.log(
    `⚠️ 경고가 있는 글: ${warningPosts.length}`
  );

  console.log(
    `🏝️ 고립 글: ${isolatedPosts.length}`
  );

  console.log(
    `🔗 추천이 있는 글: ${recommendationPosts.length}`
  );

  return {
    key: config.key,
    name: config.name,
    url: config.url,
    blogId: blog.id,

    totalPosts:
      publicPosts.length,

    warningPosts:
      warningPosts.length,

    isolatedPosts:
      isolatedPosts.length,

    recommendationPosts:
      recommendationPosts.length,

    posts: publicPosts
  };
}

async function main() {
  const results = [];

  for (const blog of BLOGS) {
    results.push(
      await scanBlog(blog)
    );
  }

  const report = {
    generatedAt:
      new Date().toISOString(),

    recommendationMethod:
      "같은 블로그 안에서 제목·라벨·본문 단어의 TF-IDF 유사도를 비교한 자동 추천입니다.",

    blogs: results
  };

  fs.mkdirSync(
    "data",
    { recursive: true }
  );

  fs.writeFileSync(
    "data/report.json",
    JSON.stringify(
      report,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    "\n✅ data/report.json 생성 완료"
  );
}

main().catch(error => {
  console.error(
    "\n❌ 검사 실패"
  );

  console.error(error);
  process.exit(1);
});
