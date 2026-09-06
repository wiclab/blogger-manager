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

/*
 * 추천 계산에서 의미가 거의 없는 공통 단어들
 */
const STOPWORDS = new Set([
  // English
  "the", "and", "for", "with", "that", "this", "from", "into", "your",
  "you", "are", "was", "were", "will", "would", "could", "should", "can",
  "how", "what", "when", "where", "why", "who", "which", "about", "than",
  "then", "they", "them", "their", "there", "here", "have", "has", "had",
  "does", "did", "doing", "not", "but", "all", "any", "our", "out", "one",
  "two", "more", "most", "really", "actually", "just", "every", "without",
  "after", "before", "over", "under", "between", "through", "per", "much",
  "many", "long", "take", "make", "get", "got", "like",

  // Nobody 공통 시리즈명
  "nobody", "asked", "data", "lab",

  // Korean
  "그리고", "하지만", "그러면", "그래서", "이렇게", "저렇게",
  "이런", "저런", "대한", "위한", "하는", "되는", "있다", "없다",
  "있는", "없는", "하면", "해도", "부터", "까지", "에서", "으로",
  "보다", "정도", "정말", "진짜", "과연", "경우", "때문", "때문에",
  "방법", "이유", "알아보자", "알아보기",

  // 별다알 공통 표현
  "생활실험", "별다알", "테스트", "실험"
]);

/*
 * JSON 요청
 */
async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `${response.status} ${response.statusText}\n${text}`
    );
  }

  return response.json();
}

/*
 * 블로그 URL → blogId
 */
async function getBlogId(blogUrl) {
  const url =
    "https://www.googleapis.com/blogger/v3/blogs/byurl" +
    `?url=${encodeURIComponent(blogUrl)}` +
    `&key=${encodeURIComponent(API_KEY)}`;

  const data = await fetchJson(url);

  return {
    id: data.id,
    name: data.name,
    totalPosts: Number(
      data.posts?.totalItems || 0
    )
  };
}

/*
 * 모든 게시글 가져오기
 */
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
      params.set(
        "pageToken",
        pageToken
      );
    }

    const url =
      `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts?${params}`;

    const data =
      await fetchJson(url);

    posts.push(
      ...(data.items || [])
    );

    pageToken =
      data.nextPageToken || null;

  } while (pageToken);

  return posts;
}

/*
 * 기본 HTML Entity 처리
 */
function decodeHtmlEntities(html = "") {
  return html
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/*
 * HTML → 일반 텍스트
 */
function stripHtml(html = "") {
  return decodeHtmlEntities(
    html
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        " "
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
  )
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * 정규식 개수 세기
 */
function countMatches(text, regex) {
  return [
    ...text.matchAll(regex)
  ].length;
}

/*
 * 내부링크 비교용 URL 정규화
 *
 * ?m=1 같은 query는 제거
 * #anchor도 제거
 */
function normalizeUrl(value, blogUrl) {
  try {
    const base =
      new URL(blogUrl);

    const url =
      new URL(
        value,
        `${blogUrl}/`
      );

    if (
      url.hostname !==
      base.hostname
    ) {
      return null;
    }

    let pathname =
      url.pathname
        .replace(/\/+$/, "");

    if (!pathname) {
      pathname = "/";
    }

    return (
      `https://${base.hostname}` +
      pathname
    );

  } catch {
    return null;
  }
}

/*
 * 추천 분석용 단어 분해
 */
function tokenize(text = "") {
  const normalized =
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(
        /https?:\/\/\S+/g,
        " "
      )
      .replace(
        /[^\p{L}\p{N}]+/gu,
        " "
      );

  return normalized
    .split(/\s+/)
    .map(
      token => token.trim()
    )
    .filter(Boolean)

    // 숫자만 있는 토큰 제거
    .filter(
      token =>
        !/^\d+$/.test(token)
    )

    // 너무 짧은 단어 제거
    .filter(token => {
      const len =
        [...token].length;

      if (
        /[가-힣]/.test(token)
      ) {
        return len >= 2;
      }

      return len >= 3;
    })

    // 불용어 제거
    .filter(
      token =>
        !STOPWORDS.has(token)
    );
}

/*
 * 게시글 1개 기본 분석
 */
function analyzePost(
  post,
  blogUrl
) {
  const html =
    post.content || "";

  const text =
    stripHtml(html);

  const title =
    post.title || "";

  const labels =
    post.labels || [];

  /*
   * 모든 a 태그 href 추출
   */
  const links = [
    ...html.matchAll(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi
    )
  ].map(
    match => match[1]
  );

  const host =
    new URL(blogUrl).hostname;

  /*
   * 실제 게시글끼리 연결 여부 확인용
   */
  const outgoingInternalUrls =
    new Set();

  let internalLinks = 0;
  let externalLinks = 0;

  for (const href of links) {
    try {
      const url =
        new URL(
          href,
          blogUrl
        );

      if (
        url.hostname === host
      ) {
        internalLinks++;

        const normalized =
          normalizeUrl(
            href,
            blogUrl
          );

        if (normalized) {
          outgoingInternalUrls.add(
            normalized
          );
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

  /*
   * 기본 경고
   */
  const warnings = [];

  if (!title.trim()) {
    warnings.push(
      "제목 없음"
    );
  }

  if (internalLinks === 0) {
    warnings.push(
      "내부링크 없음"
    );
  }

  if (text.length < 1000) {
    warnings.push(
      "본문 짧음"
    );
  }

  if (
    countMatches(
      html,
      /<h2\b/gi
    ) === 0
  ) {
    warnings.push(
      "H2 없음"
    );
  }

  if (labels.length === 0) {
    warnings.push(
      "라벨 없음"
    );
  }

  /*
   * 추천 계산용 텍스트
   *
   * 제목과 라벨은 본문보다
   * 중요도가 높도록 중복 삽입
   */
  const recommendationText = [
    title,
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

    normalizedUrl:
      normalizeUrl(
        post.url,
        blogUrl
      ),

    published:
      post.published,

    updated:
      post.updated,

    labels,

    textLength:
      text.length,

    internalLinks,

    externalLinks,

    images:
      countMatches(
        html,
        /<img\b/gi
      ),

    h2:
      countMatches(
        html,
        /<h2\b/gi
      ),

    h3:
      countMatches(
        html,
        /<h3\b/gi
      ),

    /*
     * 다른 글에서 이 글로
     * 들어오는 내부링크
     */
    incomingLinks: 0,

    incomingFrom: [],

    /*
     * 자동 추천 결과
     */
    recommendations: [],

    warnings,

    /*
     * report.json에서는 제거할
     * 내부 계산용 데이터
     */
    _outgoingInternalUrls: [
      ...outgoingInternalUrls
    ],

    _tokens:
      tokenize(
        recommendationText
      )
  };
}

/*
 * 받는 내부링크 계산
 *
 * A → B 링크가 있다면
 * B.incomingLinks +1
 */
function addIncomingLinkData(posts) {
  const byUrl =
    new Map(
      posts
        .filter(
          post =>
            post.normalizedUrl
        )
        .map(
          post => [
            post.normalizedUrl,
            post
          ]
        )
    );

  for (const source of posts) {
    /*
     * 한 글에서 같은 글을 여러 번
     * 링크해도 1회만 인정
     */
    const uniqueTargets =
      new Set(
        source
          ._outgoingInternalUrls ||
        []
      );

    for (
      const targetUrl
      of uniqueTargets
    ) {
      const target =
        byUrl.get(
          targetUrl
        );

      if (!target) {
        continue;
      }

      /*
       * 자기 자신 링크 제외
       */
      if (
        target.id ===
        source.id
      ) {
        continue;
      }

      target
        .incomingFrom
        .push({
          title:
            source.title,

          url:
            source.url
        });
    }
  }

  for (const post of posts) {
    post.incomingLinks =
      post.incomingFrom.length;

    /*
     * 다른 어떤 글에서도
     * 링크를 못 받은 글
     */
    if (
      post.incomingLinks === 0 &&
      !post.warnings.includes(
        "고립 글"
      )
    ) {
      post.warnings.push(
        "고립 글"
      );
    }
  }
}

/*
 * TF-IDF Vector 생성
 */
function buildTfidfVectors(posts) {
  const documentFrequency =
    new Map();

  /*
   * 문서별 등장 여부 계산
   */
  for (const post of posts) {
    const uniqueTokens =
      new Set(
        post._tokens || []
      );

    for (
      const token
      of uniqueTokens
    ) {
      documentFrequency.set(
        token,
        (
          documentFrequency
            .get(token) || 0
        ) + 1
      );
    }
  }

  const totalDocs =
    posts.length;

  return posts.map(post => {
    const counts =
      new Map();

    /*
     * TF 계산
     */
    for (
      const token
      of post._tokens || []
    ) {
      counts.set(
        token,
        (
          counts.get(token) || 0
        ) + 1
      );
    }

    const vector =
      new Map();

    let magnitudeSquared = 0;

    for (
      const [token, count]
      of counts
    ) {
      const df =
        documentFrequency
          .get(token) || 1;

      /*
       * IDF
       */
      const idf =
        Math.log(
          (totalDocs + 1) /
          (df + 1)
        ) + 1;

      /*
       * 로그 TF
       */
      const tf =
        1 + Math.log(count);

      const weight =
        tf * idf;

      vector.set(
        token,
        weight
      );

      magnitudeSquared +=
        weight * weight;
    }

    return {
      id: post.id,

      vector,

      magnitude:
        Math.sqrt(
          magnitudeSquared
        )
    };
  });
}

/*
 * cosine similarity
 */
function cosineSimilarity(
  a,
  b
) {
  if (
    !a ||
    !b ||
    !a.magnitude ||
    !b.magnitude
  ) {
    return 0;
  }

  const [small, large] =
    a.vector.size <=
    b.vector.size
      ? [
          a.vector,
          b.vector
        ]
      : [
          b.vector,
          a.vector
        ];

  let dot = 0;

  for (
    const [token, weight]
    of small
  ) {
    const other =
      large.get(token);

    if (other) {
      dot +=
        weight * other;
    }
  }

  return (
    dot /
    (
      a.magnitude *
      b.magnitude
    )
  );
}

/*
 * 내부링크 추천 계산
 */
function addRecommendations(posts) {
  const vectors =
    buildTfidfVectors(posts);

  const vectorById =
    new Map(
      vectors.map(
        item => [
          item.id,
          item
        ]
      )
    );

  for (const source of posts) {
    const sourceVector =
      vectorById.get(
        source.id
      );

    /*
     * 이미 링크한 글은
     * 추천에서 제외
     */
    const alreadyLinked =
      new Set(
        source
          ._outgoingInternalUrls ||
        []
      );

    const sourceLabels =
      new Set(
        (source.labels || [])
          .map(
            label =>
              label
                .toLowerCase()
                .trim()
          )
          .filter(Boolean)
      );

    const sourceTitleTokens =
      new Set(
        tokenize(
          source.title || ""
        )
      );

    const candidates = [];

    for (const target of posts) {
      /*
       * 자기 자신 제외
       */
      if (
        target.id ===
        source.id
      ) {
        continue;
      }

      /*
       * 이미 링크된 글 제외
       */
      if (
        target.normalizedUrl &&
        alreadyLinked.has(
          target.normalizedUrl
        )
      ) {
        continue;
      }

      const targetVector =
        vectorById.get(
          target.id
        );

      /*
       * 기본 TF-IDF 유사도
       */
      let score =
        cosineSimilarity(
          sourceVector,
          targetVector
        );

      /*
       * 제목 핵심 단어 비교
       */
      const targetTitleTokens =
        new Set(
          tokenize(
            target.title || ""
          )
        );

      let sharedTitleWords = 0;

      for (
        const token
        of sourceTitleTokens
      ) {
        if (
          targetTitleTokens.has(
            token
          )
        ) {
          sharedTitleWords++;
        }
      }

      /*
       * 제목 단어 일치 가산점
       */
      if (
        sharedTitleWords > 0
      ) {
        score +=
          Math.min(
            sharedTitleWords *
              0.10,
            0.30
          );
      }

      /*
       * 라벨 비교
       */
      const targetLabels =
        (target.labels || [])
          .map(
            label =>
              label
                .toLowerCase()
                .trim()
          )
          .filter(Boolean);

      let sharedLabels = 0;

      for (
        const label
        of targetLabels
      ) {
        if (
          sourceLabels.has(
            label
          )
        ) {
          sharedLabels++;
        }
      }

      /*
       * 같은 라벨은 강한 가산점
       */
      if (
        sharedLabels > 0
      ) {
        score +=
          Math.min(
            sharedLabels *
              0.18,
            0.36
          );
      }

      /*
       * 제목과 라벨이 모두 안 겹치면
       * 본문 단어만 비슷한 경우이므로 감점
       */
      if (
        sharedTitleWords === 0 &&
        sharedLabels === 0
      ) {
        score -= 0.08;
      }

      /*
       * 매우 짧은 글은
       * 유사도 신뢰도가 낮으므로 감점
       */
      if (
        source.textLength <
        700
      ) {
        score -= 0.03;
      }

      if (
        target.textLength <
        700
      ) {
        score -= 0.03;
      }

      /*
       * 최종 컷
       *
       * 22% 미만은 추천하지 않음
       */
      if (score >= 0.22) {
        candidates.push({
          title:
            target.title,

          url:
            target.url,

          score:
            Number(
              score.toFixed(3)
            ),

          sharedTitleWords,

          sharedLabels
        });
      }
    }

    /*
     * 최대 3개
     */
    source.recommendations =
      candidates
        .sort(
          (a, b) =>
            b.score -
            a.score
        )
        .slice(0, 3);
  }
}

/*
 * report.json 저장 전
 * 계산용 private 데이터 제거
 */
function cleanForReport(post) {
  const {
    _outgoingInternalUrls,
    _tokens,
    normalizedUrl,
    ...publicPost
  } = post;

  return publicPost;
}

/*
 * 블로그 하나 전체 검사
 */
async function scanBlog(config) {
  console.log(
    `\n🔎 ${config.name} 검사 시작`
  );

  const blog =
    await getBlogId(
      config.url
    );

  console.log(
    `Blog ID: ${blog.id}`
  );

  console.log(
    `API 게시글 수: ${blog.totalPosts}`
  );

  const rawPosts =
    await getAllPosts(
      blog.id
    );

  console.log(
    `실제 가져온 글: ${rawPosts.length}`
  );

  /*
   * 기본 분석
   */
  const posts =
    rawPosts.map(
      post =>
        analyzePost(
          post,
          config.url
        )
    );

  /*
   * 받는 링크 계산
   */
  addIncomingLinkData(
    posts
  );

  /*
   * 추천 계산
   */
  addRecommendations(
    posts
  );

  /*
   * report용 정리
   */
  const publicPosts =
    posts.map(
      cleanForReport
    );

  const warningPosts =
    publicPosts.filter(
      post =>
        post.warnings.length >
        0
    );

  const isolatedPosts =
    publicPosts.filter(
      post =>
        post.incomingLinks ===
        0
    );

  const recommendationPosts =
    publicPosts.filter(
      post =>
        post
          .recommendations
          .length > 0
    );

  console.log(
    `⚠️ 경고 글: ${warningPosts.length}`
  );

  console.log(
    `🏝️ 고립 글: ${isolatedPosts.length}`
  );

  console.log(
    `🔗 추천 가능: ${recommendationPosts.length}`
  );

  return {
    key:
      config.key,

    name:
      config.name,

    url:
      config.url,

    blogId:
      blog.id,

    totalPosts:
      publicPosts.length,

    warningPosts:
      warningPosts.length,

    isolatedPosts:
      isolatedPosts.length,

    recommendationPosts:
      recommendationPosts.length,

    posts:
      publicPosts
  };
}

/*
 * 전체 실행
 */
async function main() {
  const results = [];

  for (
    const blog
    of BLOGS
  ) {
    results.push(
      await scanBlog(blog)
    );
  }

  const report = {
    generatedAt:
      new Date()
        .toISOString(),

    recommendationMethod:
      "같은 블로그 안에서 제목·라벨·본문 TF-IDF 유사도를 비교하고, 제목·라벨 일치에 가산점을 적용한 자동 추천입니다. 관련성이 낮은 추천은 표시하지 않습니다.",

    blogs:
      results
  };

  /*
   * data 폴더 없으면 생성
   */
  fs.mkdirSync(
    "data",
    {
      recursive: true
    }
  );

  /*
   * report.json 저장
   */
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

/*
 * 실행
 */
main().catch(error => {
  console.error(
    "\n❌ 검사 실패"
  );

  console.error(
    error
  );

  process.exit(1);
});
