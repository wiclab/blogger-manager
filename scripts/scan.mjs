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

  // 브랜드 / 시리즈 공통어
  "nobody", "asked", "data", "lab",

  // Korean
  "그리고", "하지만", "그러면", "그래서", "이렇게", "저렇게",
  "이런", "저런", "대한", "위한", "하는", "되는", "있다",
  "없다", "있는", "없는", "하면", "해도", "부터", "까지",
  "에서", "으로", "보다", "정도", "정말", "진짜", "과연",
  "경우", "때문", "때문에", "방법", "이유", "알아보자",
  "알아보기",

  // 별다알 공통어
  "별다알", "생활실험", "테스트", "실험"
]);

/* =========================================================
   기본
========================================================= */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  if (!values.length) return 0;

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
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

async function getBlogInfo(blogUrl) {
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

    pageToken =
      data.nextPageToken || null;

  } while (pageToken);

  return posts;
}

/* =========================================================
   HTML / URL
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

    let pathname =
      url.pathname.replace(/\/+$/, "");

    if (!pathname) {
      pathname = "/";
    }

    return `https://${base.hostname}${pathname}`;

  } catch {
    return null;
  }
}

/* =========================================================
   텍스트
========================================================= */

function tokenize(text = "") {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
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
   시리즈 자동 감지
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
   게시글 분석
========================================================= */

function analyzePost(post, blogUrl) {
  const html = post.content || "";
  const text = stripHtml(html);

  const title = post.title || "";
  const labels = post.labels || [];

  const host =
    new URL(blogUrl).hostname;

  const links = [
    ...html.matchAll(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi
    )
  ].map(match => match[1]);

  let externalLinks = 0;

  const outgoingInternalUrls =
    new Set();

  for (const href of links) {
    try {
      const url = new URL(href, blogUrl);

      if (url.hostname === host) {
        const normalized =
          normalizeUrl(href, blogUrl);

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
      // 무시
    }
  }

  const h2 =
    countMatches(html, /<h2\b/gi);

  const h3 =
    countMatches(html, /<h3\b/gi);

  const images =
    countMatches(html, /<img\b/gi);

  const warnings = [];

  if (!title.trim()) {
    warnings.push("제목 없음");
  }

  if (text.length < 1000) {
    warnings.push("본문 짧음");
  }

  if (h2 === 0) {
    warnings.push("H2 없음");
  }

  if (!labels.length) {
    warnings.push("라벨 없음");
  }

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

    internalLinks: 0,
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
   실제 게시글 → 게시글 링크만 인정
========================================================= */

function finalizePostLinks(posts) {
  const byUrl = new Map(
    posts
      .filter(post => post.normalizedUrl)
      .map(post => [
        post.normalizedUrl,
        post
      ])
  );

  for (const post of posts) {
    const actualTargets =
      new Set();

    for (
      const targetUrl
      of post._outgoingInternalUrls
    ) {
      const target =
        byUrl.get(targetUrl);

      if (
        !target ||
        target.id === post.id
      ) {
        continue;
      }

      actualTargets.add(targetUrl);
    }

    post._outgoingInternalUrls =
      [...actualTargets];

    post.internalLinks =
      actualTargets.size;

    post.warnings =
      post.warnings.filter(
        warning =>
          warning !== "내부링크 없음"
      );

    if (post.internalLinks === 0) {
      post.warnings.push(
        "내부링크 없음"
      );
    }
  }
}

/* =========================================================
   받는 링크 / 고립 글
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
    for (
      const targetUrl
      of new Set(
        source._outgoingInternalUrls || []
      )
    ) {
      const target =
        byUrl.get(targetUrl);

      if (
        !target ||
        target.id === source.id
      ) {
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

  return (
    dot /
    (a.magnitude * b.magnitude)
  );
}

function overlapCoefficient(aTokens, bTokens) {
  const a =
    new Set(aTokens || []);

  const b =
    new Set(bTokens || []);

  if (!a.size || !b.size) {
    return 0;
  }

  let shared = 0;

  for (const token of a) {
    if (b.has(token)) {
      shared++;
    }
  }

  return (
    shared /
    Math.min(a.size, b.size)
  );
}

/* =========================================================
   라벨 희귀도
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
    const labels =
      new Set(
        (post.labels || [])
          .map(normalizeLabel)
          .filter(Boolean)
      );

    for (const label of labels) {
      counts.set(
        label,
        (counts.get(label) || 0) + 1
      );
    }
  }

  const weights =
    new Map();

  for (const [label, count] of counts) {
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
      .filter(
        ([, count]) =>
          count >= Math.max(
            3,
            Math.ceil(
              totalPosts * 0.25
            )
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
            (
              count /
              totalPosts
            ).toFixed(3)
          )
      }));

  return {
    counts,
    weights,
    commonLabels
  };
}

/* =========================================================
   두 게시물 관계 계산
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

  let score =
    semantic * 0.62;

  score +=
    titleOverlap * 0.28;

  score +=
    labelStrength;

  if (seriesMatch) {
    score += 0.26;
  }

  const structuralEvidence =
    titleOverlap >= 0.10 ||
    labelStrength >= 0.04 ||
    seriesMatch;

  if (!structuralEvidence) {
    score -= 0.06;
  }

  if (source.textLength < 700) {
    score *= 0.94;
  }

  if (target.textLength < 700) {
    score *= 0.94;
  }

  return {
    score:
      clamp(score, 0, 1),

    semantic,
    titleOverlap,
    labelStrength,
    sharedLabels,
    seriesMatch,
    structuralEvidence
  };
}

/* =========================================================
   기존 실제 내부링크
========================================================= */

function collectExistingLinkedPairs(posts) {
  const byUrl = new Map(
    posts
      .filter(post => post.normalizedUrl)
      .map(post => [
        post.normalizedUrl,
        post
      ])
  );

  const pairs = [];

  for (const source of posts) {
    for (
      const targetUrl
      of new Set(
        source._outgoingInternalUrls || []
      )
    ) {
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
   자동 학습

   핵심 변경점:
   기존 링크를 전부 정답으로 사용하지 않음.
========================================================= */

function learnRecommendationThreshold(
  posts,
  vectorById,
  labelStats
) {
  const existingPairs =
    collectExistingLinkedPairs(posts);

  const linkedKeys =
    new Set(
      existingPairs.map(
        ({ source, target }) =>
          `${source.id}:${target.id}`
      )
    );

  /*
   * 아직 링크되지 않은 후보들의 분포
   */
  const candidateFeatures = [];

  for (const source of posts) {
    for (const target of posts) {
      if (source.id === target.id) {
        continue;
      }

      if (
        linkedKeys.has(
          `${source.id}:${target.id}`
        )
      ) {
        continue;
      }

      candidateFeatures.push(
        calculatePairFeatures(
          source,
          target,
          vectorById,
          labelStats
        )
      );
    }
  }

  const candidateScores =
    candidateFeatures.map(
      item => item.score
    );

  const candidateSemantics =
    candidateFeatures.map(
      item => item.semantic
    );

  const candidateP75 =
    quantile(candidateScores, 0.75);

  const candidateP85 =
    quantile(candidateScores, 0.85);

  const candidateP90 =
    quantile(candidateScores, 0.90);

  const candidateP95 =
    quantile(candidateScores, 0.95);

  const candidateP97 =
    quantile(candidateScores, 0.97);

  const semanticP85 =
    quantile(candidateSemantics, 0.85);

  const semanticP92 =
    quantile(candidateSemantics, 0.92);

  /*
   * 기존 내부링크 평가
   */
  const rawPositiveFeatures =
    existingPairs.map(
      ({ source, target }) => ({
        ...calculatePairFeatures(
          source,
          target,
          vectorById,
          labelStats
        ),

        sourceTitle:
          source.title,

        targetTitle:
          target.title
      })
    );

  /*
   * "믿을 수 있는 기존 링크"만 학습에 사용
   *
   * 1. 같은 시리즈
   * 2. 제목 관계 충분
   * 3. 구체적 라벨 관계
   * 4. 본문 유사도가 블로그 상위권
   *
   * 중 하나 이상이어야 함.
   */
  const trustedPositiveFeatures =
    rawPositiveFeatures.filter(item => {

      if (item.seriesMatch) {
        return true;
      }

      if (item.titleOverlap >= 0.18) {
        return true;
      }

      if (item.labelStrength >= 0.065) {
        return true;
      }

      if (
        item.semantic >= semanticP85 &&
        item.score >= candidateP75
      ) {
        return true;
      }

      return false;
    });

  const trustedPositiveScores =
    trustedPositiveFeatures.map(
      item => item.score
    );

  /*
   * 신뢰 학습 데이터가 충분하면
   * 그것을 중심으로 추천 기준 계산.
   */
  let threshold;

  if (trustedPositiveScores.length >= 5) {
    const trustedQ20 =
      quantile(
        trustedPositiveScores,
        0.20
      );

    const trustedQ35 =
      quantile(
        trustedPositiveScores,
        0.35
      );

    threshold =
      (
        trustedQ20 * 0.55 +
        trustedQ35 * 0.25 +
        candidateP90 * 0.20
      );

    /*
     * 일반 후보 상위 10%보다
     * 지나치게 느슨해지지 않게 함.
     */
    threshold =
      Math.max(
        threshold,
        candidateP90
      );

  } else {
    /*
     * 좋은 학습 샘플이 부족하면
     * 블로그 전체 후보 분포 사용.
     */
    threshold =
      candidateP95;
  }

  /*
   * 안전장치.
   * 14~15% 같은 지나치게 약한 추천이
   * 자동 학습 때문에 살아나는 것을 방지.
   */
  threshold =
    clamp(
      threshold,
      0.18,
      0.68
    );

  /*
   * 제목/구체 라벨/시리즈 증거가 없는 경우
   * 훨씬 까다롭게.
   */
  const weakEvidenceThreshold =
    clamp(
      Math.max(
        threshold + 0.08,
        candidateP97,
        semanticP92 * 0.75
      ),
      0.24,
      0.78
    );

  /*
   * 같은 시리즈끼리는 조금 완화.
   */
  const seriesThreshold =
    clamp(
      threshold * 0.78,
      0.16,
      threshold
    );

  return {
    threshold,
    weakEvidenceThreshold,
    seriesThreshold,

    rawPositiveSamples:
      rawPositiveFeatures.length,

    trustedPositiveSamples:
      trustedPositiveFeatures.length,

    rejectedPositiveSamples:
      rawPositiveFeatures.length -
      trustedPositiveFeatures.length,

    candidateSamples:
      candidateFeatures.length,

    trustedPositiveMedian:
      median(trustedPositiveScores),

    trustedPositiveAverage:
      average(trustedPositiveScores),

    candidateP85,
    candidateP90,
    candidateP95,
    candidateP97,

    semanticP85
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
        requiredThreshold =
          tuning.seriesThreshold;

      } else if (
        features.structuralEvidence
      ) {
        requiredThreshold =
          tuning.threshold;

      } else {
        requiredThreshold =
          tuning.weakEvidenceThreshold;
      }

      if (
        features.score <
        requiredThreshold
      ) {
        continue;
      }

      const reasons = [];

      if (features.seriesMatch) {
        reasons.push("같은 시리즈");
      }

      if (features.titleOverlap >= 0.18) {
        reasons.push("제목 연관");
      }

      if (features.sharedLabels.length) {
        reasons.push(
          `공통 라벨: ${features.sharedLabels.join(", ")}`
        );
      }

      if (
        features.semantic >=
        tuning.semanticP85
      ) {
        reasons.push("본문 연관");
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

        reasons,

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
     * 최고 후보와 비교해 너무 약한 후보 제거.
     */
    const bestScore =
      candidates[0].score;

    const relativeFloor =
      Math.max(
        tuning.threshold,
        bestScore * 0.75
      );

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
   report 정리
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
   블로그 검사
========================================================= */

async function scanBlog(config) {
  console.log(
    `\n🔎 ${config.name} 검사 시작`
  );

  const blog =
    await getBlogInfo(config.url);

  console.log(
    `Blog ID: ${blog.id}`
  );

  const rawPosts =
    await getAllPosts(blog.id);

  console.log(
    `게시글 ${rawPosts.length}개 수집`
  );

  const posts =
    rawPosts.map(post =>
      analyzePost(
        post,
        config.url
      )
    );

  finalizePostLinks(posts);

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

  const t =
    recommendationAnalysis.tuning;

  console.log(
    `⚠️ 경고: ${warningPosts.length}`
  );

  console.log(
    `🏝️ 고립: ${isolatedPosts.length}`
  );

  console.log(
    `🔗 추천 가능: ${recommendationPosts.length}`
  );

  console.log(
    `🎯 자동 기준: ${(t.threshold * 100).toFixed(1)}%`
  );

  console.log(
    `🧠 학습 샘플: ${t.trustedPositiveSamples}/${t.rawPositiveSamples}`
  );

  console.log(
    `🗑️ 제외된 기존 링크: ${t.rejectedPositiveSamples}`
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

    tuning: {
      threshold:
        Number(
          t.threshold.toFixed(3)
        ),

      weakEvidenceThreshold:
        Number(
          t.weakEvidenceThreshold.toFixed(3)
        ),

      seriesThreshold:
        Number(
          t.seriesThreshold.toFixed(3)
        ),

      rawPositiveSamples:
        t.rawPositiveSamples,

      trustedPositiveSamples:
        t.trustedPositiveSamples,

      rejectedPositiveSamples:
        t.rejectedPositiveSamples,

      candidateSamples:
        t.candidateSamples,

      trustedPositiveMedian:
        Number(
          t.trustedPositiveMedian.toFixed(3)
        ),

      trustedPositiveAverage:
        Number(
          t.trustedPositiveAverage.toFixed(3)
        ),

      candidateP85:
        Number(
          t.candidateP85.toFixed(3)
        ),

      candidateP90:
        Number(
          t.candidateP90.toFixed(3)
        ),

      candidateP95:
        Number(
          t.candidateP95.toFixed(3)
        ),

      candidateP97:
        Number(
          t.candidateP97.toFixed(3)
        )
    },

    commonLabels:
      recommendationAnalysis.commonLabels,

    posts:
      publicPosts
  };
}

/* =========================================================
   실행
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
      "기존 내부링크를 모두 정답으로 사용하지 않고, 제목·구체 라벨·본문 유사도·시리즈 관계가 확인되는 기존 링크만 신뢰 학습 샘플로 사용합니다. 추천 기준은 각 블로그의 신뢰 학습 샘플과 전체 후보 분포를 이용해 매 실행마다 자동 계산됩니다.",

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
