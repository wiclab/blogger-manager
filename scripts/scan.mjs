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

function analyzePost(post, blogUrl) {
  const html = post.content || "";
  const text = stripHtml(html);

  const links = [
    ...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)
  ].map(match => match[1]);

  const host = new URL(blogUrl).hostname;

  let internalLinks = 0;
  let externalLinks = 0;

  for (const href of links) {
    try {
      const url = new URL(href, blogUrl);

      if (url.hostname === host) {
        internalLinks++;
      } else if (url.protocol === "http:" || url.protocol === "https:") {
        externalLinks++;
      }
    } catch {
      // 잘못된 URL은 일단 무시
    }
  }

  const warnings = [];

  if (internalLinks === 0) warnings.push("내부링크 없음");
  if (text.length < 1000) warnings.push("본문 짧음");
  if (countMatches(html, /<h2\b/gi) === 0) warnings.push("H2 없음");
  if (!post.labels || post.labels.length === 0) warnings.push("라벨 없음");

  return {
    id: post.id,
    title: post.title,
    url: post.url,
    published: post.published,
    updated: post.updated,
    labels: post.labels || [],
    textLength: text.length,
    internalLinks,
    externalLinks,
    images: countMatches(html, /<img\b/gi),
    h2: countMatches(html, /<h2\b/gi),
    h3: countMatches(html, /<h3\b/gi),
    warnings
  };
}

async function scanBlog(config) {
  console.log(`\n🔎 ${config.name} 검사 시작`);

  const blog = await getBlogId(config.url);

  console.log(`Blog ID: ${blog.id}`);
  console.log(`API 게시글 수: ${blog.totalPosts}`);

  const posts = await getAllPosts(blog.id);

  console.log(`실제 가져온 글: ${posts.length}`);

  const analyzedPosts = posts.map(post =>
    analyzePost(post, config.url)
  );

  const warningPosts = analyzedPosts.filter(
    post => post.warnings.length > 0
  );

  console.log(`⚠️ 경고가 있는 글: ${warningPosts.length}`);

  return {
    key: config.key,
    name: config.name,
    url: config.url,
    blogId: blog.id,
    totalPosts: posts.length,
    warningPosts: warningPosts.length,
    posts: analyzedPosts
  };
}

async function main() {
  const results = [];

  for (const blog of BLOGS) {
    results.push(await scanBlog(blog));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    blogs: results
  };

  fs.mkdirSync("data", { recursive: true });

  fs.writeFileSync(
    "data/report.json",
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log("\n✅ data/report.json 생성 완료");
}

main().catch(error => {
  console.error("\n❌ 검사 실패");
  console.error(error);
  process.exit(1);
});
