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
  // English
  "the", "and", "for", "with", "that", "this", "from", "into",
  "your", "you", "are", "was", "were", "will", "would", "could",
  "should", "can", "how", "what", "when", "where", "why", "who",
  "which", "about", "than", "then", "they", "them", "their",
  "there", "here", "have", "has", "had", "does", "did", "doing",
  "not", "but", "all", "any", "our", "out", "one", "two",
  "more", "most", "really", "actually", "just", "every",
  "without", "after", "before", "over", "under", "between",
  "through", "per", "much", "many", "long", "take", "make",
  "get", "got", "like",

  // 공통 브랜드/시리즈 단어
  "nobody", "asked", "data", "lab",

  // Korean
  "그리고", "하지만", "그러면", "그래서", "이렇게", "저렇게",
  "이런", "저런", "대한", "위한", "하는", "되는", "있다",
  "없다", "있는", "없는", "하면", "해도", "부터", "까지",
  "에서", "으로", "보다", "정도", "정말", "진짜", "과연",
  "경우", "때문", "때문에", "방법", "이유", "알아보자",
  "알아보기", "별다알", "생활실험", "테스트", "실험"
]);

/* =========================================================
   기본 유틸
========================================================= */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  if (!values.length) return 0;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values, q) {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);

  if (sorted.length === 1) {
    return sorted[0];
  }

  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = position - lower;

  return (
    sorted[lower] * (1 - weight) +
    sorted[upper] * weight
  );
}

function median(values) {
  return quantile(values, 0.5);
}

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

/* =========================================================
   Blogger API
========================================================= */

async function getBlogId(blogUrl) {
  const url =
    "https://www.googleapis.com/blogger/v3/blogs/byurl" +
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

/* =========================================================
   HTML / URL 처리
========================================================= */

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

    if (!pathname) {
      pathname = "/";
    }

    // query (?m=1 등), hash 제거
    return `https://${base.hostname}${pathname}`;

  } catch {
    return null;
  }
}

/* =========================================================
   토큰 분석
========================================================= */

function tokenize(text = "") {
  return text
    .normalize("NFKC")
    .toLowerCase()

    .replace(/https?:\/\/\S+/g, " ")

    .replace(
      /[^\p{L}\p{N}]+/gu,
      " "
    )

    .split(/\s+/)

    .map(token => token.trim())

    .filter(Boolean)

    .filter(token => !/^\d+$/.test(token))

    .filter(token => {
      const length = [...token].length;

      if (/[가-힣]/.test(token)) {
        return length >= 2;
      }

      return length >= 3;
    })

    .filter(token => !STOPWORDS.has(token));
}

/* =========================================================
   시리즈 탐지

   Nobody Lab 003
   Nobody Lab #003
   생활실험 #001
========================================================= */

function inferSeriesKey(title = "") {
  const normalized = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  const match = normalized.match(
    /^(.{2,60}?)\s*(?:#|no\.?\s*|part\s*|ep\.?\s*)?\d{1,4}\b/i
  );

  if (!match) {
    return null;
  }

  const prefix = match[1]
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if ([...prefix].length < 2) {
    return null;
  }

  return prefix;
}

function validateSeriesKeys(posts) {
  const counts = new Map();

  for (const post of posts) {
    if (!post._seriesKey) continue;

    counts.set(
      post._seriesKey,
      (counts.get(post._seriesKey) || 0) + 1
    );
  }

  for (const post of posts) {
    if (!post._seriesKey) continue;

    if ((counts.get(post._seriesKey) || 0) < 2) {
      post._seriesKey = null;
    }
  }
}

/* =========================================================
   게시글 기본 분석
========================================================= */

function analyzePost(post, blogUrl) {
  const html = post.content || "";
  const text = stripHtml(html);
  const title = post.title || "";
  const labels = post.labels || [];

  const host = new URL(blogUrl).hostname;

  const links = [
    ...html.matchAll(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi
    )
  ].map(match => match[1]);

  let internalLinks = 0;
  let externalLinks = 0;

  const outgoingInternalUrls = new Set();

  for (const href of links) {
    try {
      const url = new URL(href, blogUrl);

      if (url.hostname === host) {
        internalLinks++;

        const normalized = normalizeUrl(
          href,
          blogUrl
        );

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

  const h2 = countMatches(html, /<h2\b/gi);
  const h3 = countMatches(html, /<h3\b/gi);
  const images = countMatches(html, /<img\b/gi);

  const warnings = [];

  if (!title.trim()) {
    warnings.push("제목 없음");
  }

  if (internalLinks === 0) {
    warnings.push("내부링크 없음");
  }

  if (text.length < 1000) {
    warnings.push("본문 짧음");
  }

  if (h2 === 0) {
    warnings.push("H2 없음");
  }

  if (labels.length === 0) {
    warnings.push("라벨 없음");
  }

  /*
   * 제목/라벨에 본문보다 조금 더 높은 영향
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

    published: post.published,
    updated: post.updated,

    labels,

    textLength: text.length,

    internalLinks,
    externalLinks,

    images,
    h2,
    h3,

    incomingLinks: 0,
    incomingFrom: [],

    recommendations: [],

    warnings,

    _outgoingInternalUrls:
      [...outgoingInternalUrls],

    _tokens:
      tokenize(recommendationText),

    _titleTokens:
      tokenize(title),

    _seriesKey:
      inferSeriesKey(title)
  };
}

/* =========================================================
   받는 내부링크 계산
========================================================= */

function addIncomingLinkData(posts) {
  const byUrl = new Map(
    posts
      .filter(post => post.normalizedUrl)
      .map(post => [
        post.normalizedUrl,
        post
      ])
  );

  for (const source of posts) {
    const targets = new Set(
      source._outgoingInternalUrls || []
    );

    for (const targetUrl of targets) {
      const target = byUrl.get(targetUrl);

      if (!target) continue;

      if (target.id === source.id) {
        continue;
      }

      target.incomingFrom.push({
        title: source.title,
        url: source.url
      });
    }
  }

  for (const post of posts) {
    post.incomingLinks =
      post.incomingFrom.length;

    if (
      post.incomingLinks === 0 &&
      !post.warnings.includes("고립 글")
    ) {
      post.warnings.push("고립 글");
    }
  }
}

/* =========================================================
   TF-IDF
========================================================= */

function buildTfidfVectors(posts) {
  const documentFrequency =
    new Map();

  for (const post of posts) {
    const unique =
      new Set(post._tokens || []);

    for (const token of unique) {
      documentFrequency.set(
        token,
        (documentFrequency.get(token) || 0) + 1
      );
    }
  }

  const totalDocuments =
    posts.length;

  return posts.map(post => {
    const counts =
      new Map();

    for (const token of post._tokens || []) {
      counts.set(
        token,
        (counts.get(token) || 0) + 1
      );
    }

    const vector =
      new Map();

    let magnitudeSquared = 0;

    for (const [token, count] of counts) {
      const documentCount =
        documentFrequency.get(token) || 1;

      const idf =
        Math.log(
          (totalDocuments + 1) /
          (documentCount + 1)
        ) + 1;

      const tf =
        1 + Math.log(count);

      const weight =
        tf * idf;

      vector.set(token, weight);

      magnitudeSquared +=
        weight * weight;
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
  if (
    !a ||
    !b ||
    !a.magnitude ||
    !b.magnitude
  ) {
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

/* =========================================================
   제목 단어 겹침
========================================================= */

function overlapCoefficient(tokensA, tokensB) {
  const a =
    new Set(tokensA || []);

  const b =
    new Set(tokensB || []);

  if (
    a.size === 0 ||
    b.size === 0
  ) {
    return 0;
  }

  let shared = 0;

  for (const token of a) {
    if (b.has(token)) {
      shared++;
    }
  }

  return shared /
    Math.min(a.size, b.size);
}

/* =========================================================
   라벨 자동 희귀도 계산

   많이 쓰는 라벨 = 약한 증거
   드문 라벨 = 강한 증거
========================================================= */

function normalizeLabel(label) {
  return String(label)
    .normalize("NFKC")
    .toLowerCase()
    .trim();
}

function buildLabelStats(posts) {
  const counts =
    new Map();

  const totalPosts =
    posts.length;

  for (const post of posts) {
    const uniqueLabels =
      new Set(
        (post.labels || [])
          .map(normalizeLabel)
          .filter(Boolean)
      );

    for (const label of uniqueLabels) {
      counts.set(
        label,
        (counts.get(label) || 0) + 1
      );
    }
  }

  const weights =
    new Map();

  for (const [label, count] of counts) {
    /*
     * 흔할수록 0에 가까움
     * 희귀할수록 1에 가까움
     */
    const rarity =
      Math.log(
        (totalPosts + 1) /
        (count + 1)
      ) /
      Math.log(totalPosts + 1);

    weights.set(
      label,
      clamp(rarity, 0, 1)
    );
  }

  const commonLabels =
    [...counts.entries()]

      .filter(([, count]) =>
        count >= Math.max(
          3,
          Math.ceil(totalPosts * 0.25)
        )
      )

      .sort(
        (a, b) =>
          b[1] - a[1]
      )

      .map(([label, count]) => ({
        label,
        count,

        ratio:
          Number(
            (count / totalPosts)
              .toFixed(3)
          )
      }));

  return {
    counts,
    weights,
    commonLabels
  };
}

/* =========================================================
   글 2개의 관계 점수 계산
========================================================= */

function calculatePairFeatures(
  source,
  target,
  vectorById,
  labelStats
) {
  const semantic =
    cosineSimilarity(
      vectorById.get(source.id),
      vectorById.get(target.id)
    );

  const titleOverlap =
    overlapCoefficient(
      source._titleTokens,
      target._titleTokens
    );

  const sourceLabels =
    new Set(
      (source.labels || [])
        .map(normalizeLabel)
        .filter(Boolean)
    );

  const targetLabels =
    new Set(
      (target.labels || [])
        .map(normalizeLabel)
        .filter(Boolean)
    );

  const sharedLabels = [];

  let labelStrength = 0;

  for (const label of sourceLabels) {
    if (!targetLabels.has(label)) {
      continue;
    }

    sharedLabels.push(label);

    const rarity =
      labelStats.weights.get(label) || 0;

    labelStrength +=
      rarity * 0.18;
  }

  labelStrength =
    clamp(
      labelStrength,
      0,
      0.32
    );

  const seriesMatch =
    Boolean(
      source._seriesKey &&
      target._seriesKey &&
      source._seriesKey ===
        target._seriesKey
    );

  /*
   * 최종 점수
   */
  let score =
    semantic * 0.62;

  score +=
    titleOverlap * 0.28;

  score +=
    labelStrength;

  if (seriesMatch) {
    score += 0.26;
  }

  /*
   * 제목/라벨/시리즈 관계가 아무것도 없으면
   * 단순 본문 단어 우연 일치 가능성이 있으므로 감점
   */
  const structuralEvidence =
    titleOverlap > 0 ||
    labelStrength > 0.025 ||
    seriesMatch;

  if (!structuralEvidence) {
    score -= 0.06;
  }

  /*
   * 너무 짧은 글끼리는 분석 신뢰도 약간 하락
   */
  if (source.textLength < 700) {
    score *= 0.94;
  }

  if (target.textLength < 700) {
    score *= 0.94;
  }

  score =
    clamp(score, 0, 1);

  return {
    score,
    semantic,
    titleOverlap,
    labelStrength,
    sharedLabels,
    seriesMatch,
    structuralEvidence
  };
}

/* =========================================================
   기존 사람이 만든 내부링크를
   학습 샘플로 가져오기
========================================================= */

function collectExistingLinkedPairs(posts) {
  const byUrl =
    new Map(
      posts
        .filter(post => post.normalizedUrl)
        .map(post => [
          post.normalizedUrl,
          post
        ])
    );

  const pairs = [];

  for (const source of posts) {
    const targets =
      new Set(
        source._outgoingInternalUrls || []
      );

    for (const targetUrl of targets) {
      const target =
        byUrl.get(targetUrl);

      if (
        !target ||
        target.id === source.id
      ) {
        continue;
      }

      pairs.push({
        source,
        target
      });
    }
  }

  return pairs;
}

/* =========================================================
   추천 기준 자동 학습
========================================================= */

function learnRecommendationThreshold(
  posts,
  vectorById,
  labelStats
) {
  /*
   * 실제 존재하는 내부링크
   */
  const positivePairs =
    collectExistingLinkedPairs(posts);

  const positiveScores =
    positivePairs.map(
      ({ source, target }) =>
        calculatePairFeatures(
          source,
          target,
          vectorById,
          labelStats
        ).score
    );

  /*
   * 아직 링크되지 않은 전체 조합
   */
  const candidateScores = [];

  const linkedPairs =
    new Set(
      positivePairs.map(
        ({ source, target }) =>
          `${source.id}:${target.id}`
      )
    );

  for (const source of posts) {
    for (const target of posts) {
      if (source.id === target.id) {
        continue;
      }

      if (
        linkedPairs.has(
          `${source.id}:${target.id}`
        )
      ) {
        continue;
      }

      const features =
        calculatePairFeatures(
          source,
          target,
          vectorById,
          labelStats
        );

      candidateScores.push(
        features.score
      );
    }
  }

  const positiveMedian =
    median(positiveScores);

  const positiveQ25 =
    quantile(
      positiveScores,
      0.25
    );

  const candidateP85 =
    quantile(
      candidateScores,
      0.85
    );

  const candidateP92 =
    quantile(
      candidateScores,
      0.92
    );

  const candidateP97 =
    quantile(
      candidateScores,
      0.97
    );

  let threshold;

  /*
   * 실제 내부링크 샘플이 충분한 경우
   */
  if (positiveScores.length >= 5) {
    threshold =
      positiveQ25 * 0.65 +
      candidateP85 * 0.35;

  } else {
    /*
     * 기존 내부링크가 별로 없는 새 블로그라면
     * 전체 후보 상위 15% 기준 사용
     */
    threshold =
      candidateP85;
  }

  /*
   * 아래 min/max는 추천 기준 자체가 아니라
   * 비정상적으로 0%나 100%로 튀는 것만 막는 안전장치
   */
  threshold =
    clamp(
      threshold,
      0.14,
      0.60
    );

  /*
   * 제목/라벨/시리즈 증거가 전혀 없는 후보는
   * 훨씬 높은 점수가 있어야 통과
   */
  const weakEvidenceThreshold =
    clamp(
      Math.max(
        threshold + 0.08,
        candidateP92
      ),
      0.20,
      0.72
    );

  /*
   * 매우 약한 후보 자체를 막는 별도 안전 기준
   */
  const noiseThreshold =
    clamp(
      candidateP97,
      0.22,
      0.80
    );

  return {
    threshold,
    weakEvidenceThreshold,
    noiseThreshold,

    positiveSamples:
      positiveScores.length,

    candidateSamples:
      candidateScores.length,

    positiveMedian,

    positiveQ25,

    positiveAverage:
      average(positiveScores),

    candidateP85,
    candidateP92,
    candidateP97
  };
}

/* =========================================================
   추천 생성
========================================================= */

function addRecommendations(posts) {
  validateSeriesKeys(posts);

  const vectors =
    buildTfidfVectors(posts);

  const vectorById =
    new Map(
      vectors.map(item => [
        item.id,
        item
      ])
    );

  const labelStats =
    buildLabelStats(posts);

  const tuning =
    learnRecommendationThreshold(
      posts,
      vectorById,
      labelStats
    );

  for (const source of posts) {
    const alreadyLinked =
      new Set(
        source._outgoingInternalUrls || []
      );

    const candidates = [];

    for (const target of posts) {
      if (source.id === target.id) {
        continue;
      }

      /*
       * 이미 링크 중인 글은 추천 제외
       */
      if (
        target.normalizedUrl &&
        alreadyLinked.has(
          target.normalizedUrl
        )
      ) {
        continue;
      }

      const features =
        calculatePairFeatures(
          source,
          target,
          vectorById,
          labelStats
        );

      let requiredThreshold;

      if (features.seriesMatch) {
        /*
         * 같은 시리즈는 조금 유연하게
         */
        requiredThreshold =
          tuning.threshold * 0.85;

      } else if (
        features.structuralEvidence
      ) {
        requiredThreshold =
          tuning.threshold;

      } else {
        /*
         * 본문 유사도밖에 증거가 없는 경우
         */
        requiredThreshold =
          Math.max(
            tuning.weakEvidenceThreshold,
            tuning.noiseThreshold
          );
      }

      if (
        features.score <
        requiredThreshold
      ) {
        continue;
      }

      candidates.push({
        title:
          target.title,

        url:
          target.url,

        score:
          Number(
            features.score
              .toFixed(3)
          ),

        semantic:
          Number(
            features.semantic
              .toFixed(3)
          ),

        titleOverlap:
          Number(
            features.titleOverlap
              .toFixed(3)
          ),

        sharedLabels:
          features.sharedLabels,

        seriesMatch:
          features.seriesMatch
      });
    }

    candidates.sort(
      (a, b) =>
        b.score - a.score
    );

    if (!candidates.length) {
      source.recommendations = [];
      continue;
    }

    /*
     * 1위가 50점인데
     * 2/3위가 20점 수준인 걸 억지로 표시하지 않도록
     * 최고 점수 대비 상대 컷 적용
     */
    const bestScore =
      candidates[0].score;

    const relativeFloor =
      bestScore * 0.72;

    source.recommendations =
      candidates
        .filter(candidate =>
          candidate.score >=
          relativeFloor
        )
        .slice(0, 3);
  }

  return {
    tuning,
    commonLabels:
      labelStats.commonLabels
  };
}

/* =========================================================
   report.json 저장용 정리
========================================================= */

function cleanForReport(post) {
  const {
    _outgoingInternalUrls,
    _tokens,
    _titleTokens,
    _seriesKey,
    normalizedUrl,
    ...publicPost
  } = post;

  return publicPost;
}

/* =========================================================
   블로그 하나 검사
========================================================= */

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

  const posts =
    rawPosts.map(post =>
      analyzePost(
        post,
        config.url
      )
    );

  addIncomingLinkData(posts);

  const recommendationAnalysis =
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

  const tuning =
    recommendationAnalysis.tuning;

  console.log(
    `⚠️ 경고 글: ${warningPosts.length}`
  );

  console.log(
    `🏝️ 고립 글: ${isolatedPosts.length}`
  );

  console.log(
    `🔗 추천 가능: ${recommendationPosts.length}`
  );

  console.log(
    `🎯 자동 추천 기준: ${(tuning.threshold * 100).toFixed(1)}%`
  );

  console.log(
    `🧠 기존 내부링크 학습 샘플: ${tuning.positiveSamples}개`
  );

  console.log(
    `🧹 약한 관계 기준: ${(tuning.weakEvidenceThreshold * 100).toFixed(1)}%`
  );

  if (
    recommendationAnalysis
      .commonLabels
      .length
  ) {
    console.log(
      "🏷️ 흔한 라벨:",
      recommendationAnalysis
        .commonLabels
        .map(item =>
          `${item.label}(${item.count})`
        )
        .join(", ")
    );
  }

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

    tuning: {
      threshold:
        Number(
          tuning.threshold.toFixed(3)
        ),

      weakEvidenceThreshold:
        Number(
          tuning
            .weakEvidenceThreshold
            .toFixed(3)
        ),

      noiseThreshold:
        Number(
          tuning
            .noiseThreshold
            .toFixed(3)
        ),

      positiveSamples:
        tuning.positiveSamples,

      candidateSamples:
        tuning.candidateSamples,

      positiveMedian:
        Number(
          tuning
            .positiveMedian
            .toFixed(3)
        ),

      positiveAverage:
        Number(
          tuning
            .positiveAverage
            .toFixed(3)
        ),

      candidateP85:
        Number(
          tuning
            .candidateP85
            .toFixed(3)
        ),

      candidateP92:
        Number(
          tuning
            .candidateP92
            .toFixed(3)
        ),

      candidateP97:
        Number(
          tuning
            .candidateP97
            .toFixed(3)
        )
    },

    commonLabels:
      recommendationAnalysis
        .commonLabels,

    posts:
      publicPosts
  };
}

/* =========================================================
   전체 실행
========================================================= */

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
      "고정 퍼센트 대신 각 블로그의 기존 내부링크와 전체 게시글 관계 분포를 이용해 추천 기준을 매 실행마다 자동 계산합니다. 제목, TF-IDF 본문 유사도, 라벨 희귀도, 시리즈 관계를 함께 분석하며 흔한 라벨은 자동으로 영향력이 감소합니다.",

    blogs:
      results
  };

  fs.mkdirSync(
    "data",
    {
      recursive: true
    }
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
