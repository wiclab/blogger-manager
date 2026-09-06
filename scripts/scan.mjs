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
 * 추천 계산에서 의미가 약한 일반 단어.
 *
 * 추천 컷 자체는 자동 계산하며,
 * 이 목록은 언어상 의미가 거의 없는 단어를
 * TF-IDF에서 제외하기 위한 용도다.
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
  "nobody", "asked", "data", "lab",

  // Korean
  "그리고", "하지만", "그러면", "그래서", "이렇게", "저렇게",
  "이런", "저런", "대한", "위한", "하는", "되는", "있다", "없다",
  "있는", "없는", "하면", "해도", "부터", "까지", "에서", "으로",
  "보다", "정도", "정말", "진짜", "과연", "경우", "때문", "때문에",
  "방법", "이유", "알아보자", "알아보기",
  "별다알", "생활실험", "테스트", "실험"
]);

/*
 * --------------------------------------------------
 * 공통 유틸
 * --------------------------------------------------
 */

function clamp(value, min, max) {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length
  );
}

function median(values) {
  return quantile(values, 0.5);
}

function quantile(values, q) {
  if (!values.length) {
    return 0;
  }

  const sorted = [
    ...values
  ].sort((a, b) => a - b);

  if (sorted.length === 1) {
    return sorted[0];
  }

  const position =
    (sorted.length - 1) * q;

  const lower =
    Math.floor(position);

  const upper =
    Math.ceil(position);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight =
    position - lower;

  return (
    sorted[lower] *
      (1 - weight) +
    sorted[upper] *
      weight
  );
}

async function fetchJson(url) {
  const response =
    await fetch(url);

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `${response.status} ${response.statusText}\n${text}`
    );
  }

  return response.json();
}

/*
 * --------------------------------------------------
 * Blogger API
 * --------------------------------------------------
 */

async function getBlogId(blogUrl) {
  const url =
    "https://www.googleapis.com/blogger/v3/blogs/byurl" +
    `?url=${encodeURIComponent(blogUrl)}` +
    `&key=${encodeURIComponent(API_KEY)}`;

  const data =
    await fetchJson(url);

  return {
    id: data.id,

    name: data.name,

    totalPosts:
      Number(
        data.posts?.totalItems || 0
      )
  };
}

async function getAllPosts(blogId) {
  const posts = [];

  let pageToken = null;

  do {
    const params =
      new URLSearchParams({
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
 * --------------------------------------------------
 * HTML 처리
 * --------------------------------------------------
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

function countMatches(text, regex) {
  return [
    ...text.matchAll(regex)
  ].length;
}

/*
 * --------------------------------------------------
 * URL 처리
 * --------------------------------------------------
 */

function normalizeUrl(
  value,
  blogUrl
) {
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

    /*
     * ?m=1 / query / hash 제거
     */
    return (
      `https://${base.hostname}` +
      pathname
    );

  } catch {
    return null;
  }
}

/*
 * --------------------------------------------------
 * 텍스트 분석
 * --------------------------------------------------
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
      token =>
        token.trim()
    )

    .filter(Boolean)

    /*
     * 숫자만 있는 토큰 제거
     */
    .filter(
      token =>
        !/^\d+$/.test(token)
    )

    /*
     * 지나치게 짧은 토큰 제거
     */
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

    .filter(
      token =>
        !STOPWORDS.has(token)
    );
}

/*
 * --------------------------------------------------
 * 시리즈 자동 감지
 * --------------------------------------------------
 *
 * 예:
 *
 * Nobody Lab #006
 * Nobody Lab 003
 * 생활실험 #001
 *
 * 숫자 앞의 반복 prefix를
 * 자동으로 시리즈 키로 사용한다.
 */

function inferSeriesKey(title = "") {
  const normalized =
    title
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  if (!normalized) {
    return null;
  }

  const match =
    normalized.match(
      /^(.{2,50}?)\s*(?:#|no\.?|part\s*|ep\.?\s*)?\d{1,4}\b/i
    );

  if (!match) {
    return null;
  }

  const prefix =
    match[1]
      .replace(
        /[^\p{L}\p{N}\s]+/gu,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();

  if (
    [...prefix].length < 2
  ) {
    return null;
  }

  return prefix;
}

/*
 * 실제로 2개 이상 존재하는 시리즈만 인정
 */
function validateSeriesKeys(posts) {
  const counts =
    new Map();

  for (const post of posts) {
    const key =
      post._seriesKey;

    if (!key) {
      continue;
    }

    counts.set(
      key,
      (counts.get(key) || 0) + 1
    );
  }

  for (const post of posts) {
    if (
      !post._seriesKey ||
      (counts.get(post._seriesKey) || 0) < 2
    ) {
      post._seriesKey = null;
    }
  }
}

/*
 * --------------------------------------------------
 * 게시글 기본 분석
 * --------------------------------------------------
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

  const links = [
    ...html.matchAll(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi
    )
  ].map(
    match => match[1]
  );

  const host =
    new URL(blogUrl).hostname;

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
      /*
       * 잘못된 href 무시
       */
    }
  }

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

  if (
    labels.length === 0
  ) {
    warnings.push(
      "라벨 없음"
    );
  }

  /*
   * 제목 > 라벨 > 본문 순으로
   * 추천에 영향이 가도록 구성
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

    incomingLinks: 0,

    incomingFrom: [],

    recommendations: [],

    warnings,

    /*
     * 내부 계산용
     */
    _outgoingInternalUrls:
      [
        ...outgoingInternalUrls
      ],

    _tokens:
      tokenize(
        recommendationText
      ),

    _titleTokens:
      tokenize(title),

    _seriesKey:
      inferSeriesKey(title)
  };
}

/*
 * --------------------------------------------------
 * 받는 내부링크 계산
 * --------------------------------------------------
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
     * 한 글에서 같은 target을
     * 여러 번 링크해도 1개로 처리
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
        byUrl.get(targetUrl);

      if (
        !target ||
        target.id === source.id
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
 * --------------------------------------------------
 * TF-IDF
 * --------------------------------------------------
 */

function buildTfidfVectors(posts) {
  const documentFrequency =
    new Map();

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

      const idf =
        Math.log(
          (totalDocs + 1) /
          (df + 1)
        ) + 1;

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
      id:
        post.id,

      vector,

      magnitude:
        Math.sqrt(
          magnitudeSquared
        )
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
 * --------------------------------------------------
 * 제목 겹침
 * --------------------------------------------------
 */

function overlapCoefficient(
  tokensA,
  tokensB
) {
  const a =
    new Set(tokensA || []);

  const b =
    new Set(tokensB || []);

  if (
    !a.size ||
    !b.size
  ) {
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
    Math.min(
      a.size,
      b.size
    )
  );
}

/*
 * --------------------------------------------------
 * 라벨 가중치 자동 계산
 * --------------------------------------------------
 *
 * 자주 쓰이는 라벨:
 * 영향력 자동 감소
 *
 * 희귀한 구체 라벨:
 * 영향력 자동 증가
 */

function buildLabelStats(posts) {
  const counts =
    new Map();

  const totalPosts =
    posts.length;

  for (const post of posts) {
    const uniqueLabels =
      new Set(
        (post.labels || [])
          .map(
            label =>
              label
                .normalize("NFKC")
                .toLowerCase()
                .trim()
          )
          .filter(Boolean)
      );

    for (
      const label
      of uniqueLabels
    ) {
      counts.set(
        label,
        (
          counts.get(label) || 0
        ) + 1
      );
    }
  }

  const weights =
    new Map();

  for (
    const [label, count]
    of counts
  ) {
    /*
     * 1개 글에만 있는 라벨은 강함.
     * 거의 모든 글에 있는 라벨은 0에 가까움.
     */
    const rarity =
      Math.log(
        (totalPosts + 1) /
        (count + 1)
      ) /
      Math.log(
        totalPosts + 1
      );

    weights.set(
      label,
      clamp(
        rarity,
        0,
        1
      )
    );
  }

  const commonLabels =
    [
      ...counts.entries()
    ]
      .filter(
        ([, count]) =>
          count >=
          Math.max(
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
      .map(
        ([label, count]) => ({
          label,
          count,

          ratio:
            Number(
              (
                count /
                totalPosts
              ).toFixed(3)
            )
        })
      );

  return {
    counts,
    weights,
    commonLabels
  };
}

/*
 * --------------------------------------------------
 * 두 글 관계 점수
 * --------------------------------------------------
 */

function calculatePairFeatures(
  source,
  target,
  vectorById,
  labelStats
) {
  const sourceVector =
    vectorById.get(
      source.id
    );

  const targetVector =
    vectorById.get(
      target.id
    );

  /*
   * 본문 + 제목 + 라벨 전체 TF-IDF
   */
  const semantic =
    cosineSimilarity(
      sourceVector,
      targetVector
    );

  /*
   * 제목 핵심 단어 겹침
   */
  const titleOverlap =
    overlapCoefficient(
      source._titleTokens,
      target._titleTokens
    );

  /*
   * 공통 라벨
   */
  const sourceLabels =
    new Set(
      (source.labels || [])
        .map(
          label =>
            label
              .normalize("NFKC")
              .toLowerCase()
              .trim()
        )
        .filter(Boolean)
    );

  const targetLabels =
    new Set(
      (target.labels || [])
        .map(
          label =>
            label
              .normalize("NFKC")
              .toLowerCase()
              .trim()
        )
        .filter(Boolean)
    );

  const sharedLabels = [];

  let labelStrength = 0;

  for (
    const label
    of sourceLabels
  ) {
    if (
      !targetLabels.has(label)
    ) {
      continue;
    }

    sharedLabels.push(label);

    const rarity =
      labelStats.weights
        .get(label) || 0;

    /*
     * 희귀 라벨 최대 약 18% 보너스.
     * 흔한 라벨은 거의 보너스 없음.
     */
    labelStrength +=
      rarity * 0.18;
  }

  labelStrength =
    clamp(
      labelStrength,
      0,
      0.32
    );

  /*
   * 같은 시리즈
   */
  const seriesMatch =
    Boolean(
      source._seriesKey &&
      target._seriesKey &&
      source._seriesKey ===
        target._seriesKey
    );

  /*
   * 기본 점수
   */
  let score =
    semantic * 0.62;

  /*
   * 제목 관계
   */
  score +=
    titleOverlap * 0.28;

  /*
   * 라벨 희귀도 기반 관계
   */
  score +=
    labelStrength;

  /*
   * 시리즈는 강한 관계
   */
  if (seriesMatch) {
    score += 0.26;
  }

  /*
   * 제목/라벨/시리즈가 전혀 없으면
   * 단순 본문 단어 우연 일치 가능성이 높음.
   */
  const structuralEvidence =
    (
      titleOverlap > 0 ||
      labelStrength > 0.025 ||
      seriesMatch
    );

  if (!structuralEvidence) {
    score -= 0.06;
  }

  /*
   * 너무 짧은 글은 분석 신뢰도 감소
   */
  if (
    source.textLength < 700
  ) {
    score *= 0.94;
  }

  if (
    target.textLength < 700
  ) {
    score *= 0.94;
  }

  score =
    clamp(
      score,
      0,
      1
    );

  return {
    score,

    semantic,

    titleOverlap,

    sharedLabels,

    labelStrength,

    seriesMatch,

    structuralEvidence
  };
}

/*
 * --------------------------------------------------
 * 기존 실제 내부링크 수집
 * --------------------------------------------------
 *
 * 우리가 이미 사람이 넣어놓은 링크를
 * 일종의 학습 샘플로 사용한다.
 */

function collectExistingLinkedPairs(
  posts
) {
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

  const pairs = [];

  for (const source of posts) {
    const targets =
      new Set(
        source
          ._outgoingInternalUrls ||
        []
      );

    for (
      const targetUrl
      of targets
    ) {
      const target =
        byUrl.get(
          targetUrl
        );

      if (
        !target ||
        target.id ===
          source.id
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

/*
 * --------------------------------------------------
 * 자동 튜닝
 * --------------------------------------------------
 *
 * 1. 이미 존재하는 내부링크 점수 분포
 * 2. 전체 후보들의 점수 분포
 *
 * 두 가지를 보고 블로그별 추천 기준을
 * 매 실행마다 새로 계산한다.
 */

function learnRecommendationThreshold(
  posts,
  vectorById,
  labelStats
) {
  const existingPairs =
    collectExistingLinkedPairs(
      posts
    );

  const positiveScores =
    existingPairs.map(
      ({ source, target }) =>
        calculatePairFeatures(
          source,
          target,
          vectorById,
          labelStats
        ).score
    );

  const candidateScores = [];

  const linkedSet =
    new Set(
      existingPairs.map(
        ({ source, target }) =>
          `${source.id}:${target.id}`
      )
    );

  for (const source of posts) {
    for (const target of posts) {
      if (
        source.id ===
        target.id
      ) {
        continue;
      }

      if (
        linkedSet.has(
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
    median(
      positiveScores
    );

  const positiveQ30 =
    quantile(
      positiveScores,
      0.30
    );

  const candidateMedian =
    median(
      candidateScores
    );

  const candidateP85 =
    quantile(
      candidateScores,
      0.85
    );

  const candidateP95 =
    quantile(
      candidateScores,
      0.95
    );

  let threshold;

  /*
   * 실제 링크 샘플이 충분하면
   * 사람이 이미 만든 내부링크 관계를
   * 주된 기준으로 삼는다.
   */
  if (
    positiveScores.length >= 5
  ) {
    threshold =
      positiveQ30 * 0.65 +
      candidateP85 * 0.35;

  } else {
    /*
     * 샘플 부족 시
     * 전체 후보 상위권 분포 이용
     */
    threshold =
      candidateP85;
  }

  /*
   * 자동학습이 극단값으로 튀는 것을 막는
   * 안전 범위.
   *
   * 고정 추천 컷이 아니라
   * 학습값의 비정상 폭주 방지용이다.
   */
  threshold =
    clamp(
      threshold,
      0.14,
      0.58
    );

  /*
   * 제목/라벨/시리즈 증거가 전혀 없는 경우는
   * 훨씬 높은 점수가 필요하다.
   */
  const weakEvidenceThreshold =
    clamp(
      Math.max(
        threshold + 0.07,
        candidateP95
      ),
      0.18,
      0.72
    );

  return {
    threshold,

    weakEvidenceThreshold,

    positiveSamples:
      positiveScores.length,

    candidateSamples:
      candidateScores.length,

    positiveMedian,

    positiveQ30,

    candidateMedian,

    candidateP85,

    candidateP95,

    positiveAverage:
      average(
        positiveScores
      )
  };
}

/*
 * --------------------------------------------------
 * 자동 추천
 * --------------------------------------------------
 */

function addRecommendations(posts) {
  validateSeriesKeys(posts);

  const vectors =
    buildTfidfVectors(
      posts
    );

  const vectorById =
    new Map(
      vectors.map(
        item => [
          item.id,
          item
        ]
      )
    );

  const labelStats =
    buildLabelStats(
      posts
    );

  const tuning =
    learnRecommendationThreshold(
      posts,
      vectorById,
      labelStats
    );

  for (const source of posts) {
    const alreadyLinked =
      new Set(
        source
          ._outgoingInternalUrls ||
        []
      );

    const candidates = [];

    for (const target of posts) {
      if (
        target.id ===
        source.id
      ) {
        continue;
      }

      /*
       * 이미 연결된 글은
       * 다시 추천할 이유가 없음.
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

      const requiredThreshold =
        features.structuralEvidence
          ? tuning.threshold
          : tuning.weakEvidenceThreshold;

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
            features
              .score
              .toFixed(3)
          ),

        semantic:
          Number(
            features
              .semantic
              .toFixed(3)
          ),

        titleOverlap:
          Number(
            features
              .titleOverlap
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

    if (
      candidates.length === 0
    ) {
      source.recommendations = [];
      continue;
    }

    const topScore =
      candidates[0].score;

    /*
     * 최고 후보와 너무 차이가 많이 나는
     * 억지 2위/3위 추천 방지.
     *
     * 이 값 역시 절대 퍼센트 컷이 아니라
     * 해당 글 최고 후보 대비 상대 점수다.
     */
    const relativeFloor =
      topScore * 0.72;

    source.recommendations =
      candidates
        .filter(
          candidate =>
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

/*
 * --------------------------------------------------
 * report용 private 데이터 제거
 * --------------------------------------------------
 */

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

/*
 * --------------------------------------------------
 * 블로그 전체 검사
 * --------------------------------------------------
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
   * 자동 튜닝 + 추천
   */
  const recommendationAnalysis =
    addRecommendations(
      posts
    );

  const publicPosts =
    posts.map(
      cleanForReport
    );

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
    `⚠️ 경고 글: ${warningPosts.length}`
  );

  console.log(
    `🏝️ 고립 글: ${isolatedPosts.length}`
  );

  console.log(
    `🔗 추천 가능: ${recommendationPosts.length}`
  );

  console.log(
    `🎯 자동 추천 기준: ${
      (
        recommendationAnalysis
          .tuning
          .threshold *
        100
      ).toFixed(1)
    }%`
  );

  console.log(
    `🧪 기존 내부링크 학습 샘플: ${
      recommendationAnalysis
        .tuning
        .positiveSamples
    }개`
  );

  if (
    recommendationAnalysis
      .commonLabels
      .length > 0
  ) {
    console.log(
      "🏷️ 자동 감지된 흔한 라벨:",
      recommendationAnalysis
        .commonLabels
        .map(
          item =>
            `${item.label}(${item.count})`
        )
        .join(", ")
    );
  }

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

    /*
     * 이번 실행에서 자동 학습한 값
     */
    tuning: {
      threshold:
        Number(
          recommendationAnalysis
            .tuning
            .threshold
            .toFixed(3)
        ),

      weakEvidenceThreshold:
        Number(
          recommendationAnalysis
            .tuning
            .weakEvidenceThreshold
            .toFixed(3)
        ),

      positiveSamples:
        recommendationAnalysis
          .tuning
          .positiveSamples,

      positiveMedian:
        Number(
          recommendationAnalysis
            .tuning
            .positiveMedian
            .toFixed(3)
        ),

      positiveAverage:
        Number(
          recommendationAnalysis
            .tuning
            .positiveAverage
            .toFixed(3)
        ),

      candidateP85:
        Number(
          recommendationAnalysis
            .tuning
            .candidateP85
            .toFixed(3)
        ),

      candidateP95:
        Number(
          recommendationAnalysis
            .tuning
            .candidateP95
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

/*
 * --------------------------------------------------
 * 전체 실행
 * --------------------------------------------------
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
      "각 블로그의 기존 내부링크와 전체 후보 점수 분포를 이용해 추천 기준을 실행할 때마다 자동 학습합니다. 많이 사용되는 라벨은 자동으로 가중치가 낮아지고, 제목·희귀 라벨·시리즈 관계와 TF-IDF 본문 유사도를 함께 사용합니다.",

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

  console.error(
    error
  );

  process.exit(1);
});
