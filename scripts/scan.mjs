import fs from "node:fs/promises";
import path from "node:path";

const API_ROOT = "https://www.googleapis.com/blogger/v3";
const API_KEY = String(process.env.BLOGGER_API_KEY || "").trim();

if (!API_KEY) {
  throw new Error("BLOGGER_API_KEY secret is missing.");
}

const BLOGS = [
  {
    key: "wic",
    name: "별다알",
    url: "https://wic12.blogspot.com/",
    shortTextThreshold: 800,
    defaultThreshold: 0.20,
  },
  {
    key: "nobody",
    name: "Nobody Asked Data",
    url: "https://qevnaxori.blogspot.com/",
    shortTextThreshold: 800,
    defaultThreshold: 0.27,
  },
];

const MAX_RECOMMENDATIONS = 3;
const REPORT_PATH = path.resolve("data/report.json");

/* =========================================================
   Generic / low-information terms
========================================================= */

const GENERIC_RELATION_TOKENS = new Set([
  // Korean
  "한국",
  "대한민국",
  "사람",
  "사람들",
  "생활",
  "일상",
  "정보",
  "방법",
  "이유",
  "정도",
  "경우",
  "기준",
  "결과",
  "가능",
  "문제",
  "오늘",
  "내일",
  "이번",
  "정말",
  "진짜",
  "얼마",
  "얼마나",
  "하면",
  "했을",
  "있는",
  "없는",
  "대한",
  "관련",
  "글",
  "포스팅",
  "블로그",
  "하루",
  "때문",
  "이상",
  "이하",
  "전체",
  "한번",
  "무엇",
  "뭐",
  "왜",
  "어떻게",
  "그리고",
  "하지만",
  "그런데",
  "이런",
  "저런",
  "한다",
  "된다",
  "있다",
  "없다",
  "했다",
  "보다",
  "정리",
  "확인",

  // English
  "how",
  "what",
  "why",
  "when",
  "where",
  "who",
  "would",
  "could",
  "can",
  "actually",
  "really",
  "every",
  "much",
  "many",
  "long",
  "data",
  "asked",
  "nobody",
  "thing",
  "things",
  "people",
  "person",
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "from",
  "with",
  "without",
  "into",
  "about",
  "your",
  "you",
  "we",
  "our",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "as",
  "not",
  "all",
  "one",
  "two",
  "any",
]);

const GENERIC_LABELS = new Set([
  "생활정보",
  "생활 정보",
  "정보",
  "일상",
  "데이터",
  "data",
  "weird data",
  "thought experiments",
  "blog",
  "etc",
]);

/* =========================================================
   Topic groups

   제목 단어가 정확히 겹치지 않아도
   같은 실제 주제인지 확인하기 위한 보조 근거.
========================================================= */

const TOPIC_GROUPS = {
  money_banking: [
    "송금",
    "오송금",
    "계좌",
    "은행",
    "입금",
    "출금",
    "이체",
    "자동이체",
    "결제",
    "카드",
    "카드값",
    "월급",
    "급여",
    "잔액",
    "돈",
    "인증",
    "원",
    "bank",
    "banking",
    "transfer",
    "payment",
    "card",
    "salary",
    "deposit",
    "withdrawal",
    "money",
    "balance",
  ],

  weather_climate: [
    "여름",
    "폭염",
    "기후",
    "날씨",
    "기온",
    "더위",
    "장마",
    "온도",
    "열대야",
    "summer",
    "heat",
    "weather",
    "climate",
    "temperature",
    "hot",
    "warming",
  ],

  food_storage: [
    "음식",
    "식품",
    "냉장",
    "냉동",
    "보관",
    "해동",
    "피자",
    "유통기한",
    "상온",
    "food",
    "fridge",
    "refrigerator",
    "freezer",
    "frozen",
    "storage",
    "pizza",
    "thaw",
  ],

  export_economy: [
    "수출",
    "수입",
    "반도체",
    "무역",
    "경제",
    "물가",
    "인플레이션",
    "관세",
    "환율",
    "export",
    "import",
    "semiconductor",
    "trade",
    "economy",
    "inflation",
    "tariff",
    "currency",
  ],

  lab_interactive: [
    "nobody lab",
    "생활실험",
    "life experiment",
    "reaction",
    "button",
    "click",
    "finger",
    "seconds",
    "brain",
    "pixel",
    "test",
    "실험",
    "버튼",
    "클릭",
    "반응",
    "초",
    "뇌",
  ],

  human_scale: [
    "earth",
    "planet",
    "world",
    "ocean",
    "walk",
    "count",
    "everyone",
    "scream",
    "step",
    "hair",
    "pigeon",
    "people",
    "human",
    "지구",
    "세계",
    "바다",
    "걷기",
    "사람",
    "인류",
  ],

  electricity_home: [
    "전기",
    "전기요금",
    "에어컨",
    "냉방",
    "전력",
    "청소",
    "집",
    "가전",
    "electricity",
    "air conditioner",
    "power",
    "energy",
    "home",
    "cleaning",
  ],

  wedding_social: [
    "결혼식",
    "축의금",
    "하객",
    "예식",
    "wedding",
    "gift",
    "guest",
  ],
};

/* =========================================================
   Main
========================================================= */

async function main() {
  const reportBlogs = [];

  for (const config of BLOGS) {
    console.log(`Scanning ${config.name}...`);

    const blogMeta = await getBlogByUrl(config.url);

    const rawPosts = await fetchAllPosts(
      blogMeta.id
    );

    const analyzed = analyzeBlog(
      config,
      blogMeta,
      rawPosts
    );

    reportBlogs.push(analyzed);
  }

  const report = {
    generatedAt:
      new Date().toISOString(),

    modelVersion:
      "semantic-gate-v3",

    recommendationMethod:
      "기존 내부링크 학습 + 제목·구체 라벨·시리즈·본문 희귀 핵심어·주제군 관계 게이트를 사용합니다. " +
      "TF-IDF 점수가 높아도 의미 근거가 부족하면 추천하지 않습니다.",

    blogs:
      reportBlogs,
  };

  await fs.mkdir(
    path.dirname(REPORT_PATH),
    {
      recursive: true,
    }
  );

  await fs.writeFile(
    REPORT_PATH,
    JSON.stringify(
      report,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    `Saved ${REPORT_PATH}`
  );

  console.log(
    reportBlogs
      .map(
        (blog) =>
          `${blog.name}: ${blog.totalPosts} posts, ` +
          `${blog.warningPosts} warnings, ` +
          `${blog.recommendationPosts} recommendation posts`
      )
      .join("\n")
  );
}

/* =========================================================
   Blogger API
========================================================= */

async function getBlogByUrl(
  blogUrl
) {
  const url =
    new URL(
      `${API_ROOT}/blogs/byurl`
    );

  url.searchParams.set(
    "url",
    blogUrl
  );

  url.searchParams.set(
    "view",
    "READER"
  );

  url.searchParams.set(
    "key",
    API_KEY
  );

  return fetchJson(url);
}

async function fetchAllPosts(
  blogId
) {
  const posts = [];

  let pageToken = "";

  do {
    const url =
      new URL(
        `${API_ROOT}/blogs/${encodeURIComponent(
          blogId
        )}/posts`
      );

    url.searchParams.set(
      "key",
      API_KEY
    );

    url.searchParams.set(
      "maxResults",
      "500"
    );

    url.searchParams.set(
      "fetchBodies",
      "true"
    );

    url.searchParams.set(
      "status",
      "LIVE"
    );

    url.searchParams.set(
      "view",
      "READER"
    );

    if (pageToken) {
      url.searchParams.set(
        "pageToken",
        pageToken
      );
    }

    const data =
      await fetchJson(url);

    posts.push(
      ...(data.items || [])
    );

    pageToken =
      data.nextPageToken || "";

  } while (pageToken);

  return posts;
}

async function fetchJson(
  url,
  attempt = 0
) {
  const response =
    await fetch(
      url,
      {
        headers: {
          Accept:
            "application/json",

          "User-Agent":
            "wiclab-blogger-manager/1.0",
        },
      }
    );

  if (!response.ok) {
    const text =
      await response.text();

    if (
      (
        response.status === 429 ||
        response.status >= 500
      ) &&
      attempt < 3
    ) {
      await sleep(
        800 *
        2 ** attempt
      );

      return fetchJson(
        url,
        attempt + 1
      );
    }

    throw new Error(
      `Blogger API ${response.status}: ` +
      text.slice(
        0,
        500
      )
    );
  }

  return response.json();
}

/* =========================================================
   Blog analysis
========================================================= */

function analyzeBlog(
  config,
  blogMeta,
  rawPosts
) {
  const posts =
    rawPosts.map(
      (post) =>
        normalizePost(
          post,
          config
        )
    );

  const postByUrl =
    new Map(
      posts.map(
        (post) => [
          post.canonicalUrl,
          post,
        ]
      )
    );

  /* -----------------------------------------------------
     링크 / 기본 수치
  ----------------------------------------------------- */

  for (const post of posts) {
    const links =
      extractLinks(
        post.content,
        post.url
      );

    const internalTargetUrls =
      new Set();

    const externalUrls =
      new Set();

    for (const href of links) {
      const canonical =
        canonicalUrl(href);

      if (!canonical) {
        continue;
      }

      /*
       * 실제 존재하는 같은 블로그 게시글
       */
      if (
        postByUrl.has(
          canonical
        ) &&
        canonical !==
        post.canonicalUrl
      ) {
        internalTargetUrls.add(
          canonical
        );

        continue;
      }

      /*
       * 외부 사이트
       */
      try {
        const linkUrl =
          new URL(href);

        const blogHost =
          new URL(
            config.url
          ).hostname
            .toLowerCase();

        if (
          linkUrl.hostname
            .toLowerCase() !==
          blogHost
        ) {
          externalUrls.add(
            canonical
          );
        }

      } catch {
        // malformed URL 무시
      }
    }

    post._internalTargetUrls =
      internalTargetUrls;

    post.internalLinks =
      internalTargetUrls.size;

    post.externalLinks =
      externalUrls.size;

    post.images =
      countMatches(
        post.content,
        /<img\b/gi
      );

    post.h2 =
      countMatches(
        post.content,
        /<h2\b/gi
      );
  }

  /* -----------------------------------------------------
     들어오는 내부링크
  ----------------------------------------------------- */

  const incomingSources =
    new Map(
      posts.map(
        (post) => [
          post.canonicalUrl,
          new Set(),
        ]
      )
    );

  for (const source of posts) {
    for (
      const targetUrl
      of source._internalTargetUrls
    ) {
      incomingSources
        .get(targetUrl)
        ?.add(
          source.canonicalUrl
        );
    }
  }

  for (const post of posts) {
    post.incomingLinks =
      incomingSources
        .get(
          post.canonicalUrl
        )
        ?.size || 0;
  }

  /* -----------------------------------------------------
     의미 분석 모델
  ----------------------------------------------------- */

  const tokenStats =
    buildTokenStats(
      posts
    );

  const labelStats =
    buildLabelStats(
      posts
    );

  const pairCache =
    new Map();

  const scorePair =
    (
      source,
      target
    ) => {
      const key =
        `${source.id}::${target.id}`;

      if (
        !pairCache.has(key)
      ) {
        pairCache.set(
          key,

          evaluatePair(
            source,
            target,
            tokenStats,
            labelStats
          )
        );
      }

      return pairCache.get(
        key
      );
    };

  /*
   * 기존에 사람이 넣어둔 내부링크를
   * 학습 데이터로 사용해 기준점 자동 계산
   */
  const tuning =
    learnThresholds(
      config,
      posts,
      postByUrl,
      scorePair
    );

  /* -----------------------------------------------------
     추천 계산
  ----------------------------------------------------- */

  for (const source of posts) {
    const recommendations =
      [];

    for (const target of posts) {
      /*
       * 자기 자신 제외
       */
      if (
        source.id ===
        target.id
      ) {
        continue;
      }

      /*
       * 이미 걸려 있는 링크 제외
       */
      if (
        source
          ._internalTargetUrls
          .has(
            target.canonicalUrl
          )
      ) {
        continue;
      }

      const relation =
        scorePair(
          source,
          target
        );

      /*
       * ★ 최종 의미 관계 게이트
       *
       * 점수가 높아도 실제 주제 근거가 없으면
       * 여기서 탈락.
       */
      const decision =
        passesRecommendationGate(
          relation,
          tuning
        );

      if (
        !decision.pass
      ) {
        continue;
      }

      recommendations.push({
        title:
          target.title ||
          "(제목 없음)",

        url:
          target.url,

        score:
          roundScore(
            relation.finalScore
          ),

        reasons:
          relation.reasons,

        relationStrength:
          decision
            .relationStrength,
      });
    }

    source.recommendations =
      recommendations
        .sort(
          (a, b) =>
            b.score -
              a.score ||
            a.title.localeCompare(
              b.title
            )
        )
        .slice(
          0,
          MAX_RECOMMENDATIONS
        );
  }

  /* -----------------------------------------------------
     경고
  ----------------------------------------------------- */

  for (const post of posts) {
    const warnings = [];

    if (
      !post.title.trim()
    ) {
      warnings.push(
        "제목 없음"
      );
    }

    if (
      post.textLength <
      config.shortTextThreshold
    ) {
      warnings.push(
        "본문 짧음"
      );
    }

    if (
      post.h2 === 0
    ) {
      warnings.push(
        "H2 없음"
      );
    }

    if (
      post.internalLinks === 0
    ) {
      warnings.push(
        "내부링크 없음"
      );
    }

    if (
      post.incomingLinks === 0
    ) {
      warnings.push(
        "고립 글"
      );
    }

    post.warnings =
      warnings;
  }

  /* -----------------------------------------------------
     흔한 라벨
  ----------------------------------------------------- */

  const commonLabels =
    [
      ...labelStats
        .counts
        .entries(),
    ]
      .filter(
        ([, count]) =>
          count >= 2
      )
      .sort(
        (a, b) =>
          b[1] -
            a[1] ||
          a[0].localeCompare(
            b[0]
          )
      )
      .slice(
        0,
        5
      )
      .map(
        (
          [
            label,
            count,
          ]
        ) => ({
          label,
          count,
        })
      );

  const publicPosts =
    posts
      .sort(
        (a, b) =>
          new Date(
            b.published ||
            0
          ) -
          new Date(
            a.published ||
            0
          )
      )
      .map(
        toPublicPost
      );

  return {
    id:
      String(
        blogMeta.id
      ),

    name:
      config.name,

    url:
      config.url,

    totalPosts:
      publicPosts.length,

    warningPosts:
      publicPosts.filter(
        (post) =>
          post.warnings
            .length > 0
      ).length,

    isolatedPosts:
      publicPosts.filter(
        (post) =>
          post.incomingLinks ===
          0
      ).length,

    recommendationPosts:
      publicPosts.filter(
        (post) =>
          post
            .recommendations
            .length > 0
      ).length,

    tuning,

    commonLabels,

    posts:
      publicPosts,
  };
}

/* =========================================================
   Post normalization
========================================================= */

function normalizePost(
  post,
  config
) {
  const title =
    String(
      post.title || ""
    ).trim();

  const content =
    String(
      post.content || ""
    );

  const url =
    String(
      post.url || ""
    ).trim();

  const text =
    stripHtml(
      content
    );

  return {
    id:
      String(
        post.id || ""
      ),

    blogKey:
      config.key,

    title,

    content,

    text,

    url,

    canonicalUrl:
      canonicalUrl(
        url
      ),

    published:
      post.published ||
      null,

    updated:
      post.updated ||
      null,

    labels:
      Array.isArray(
        post.labels
      )
        ? post.labels
            .map(
              (label) =>
                String(
                  label
                ).trim()
            )
            .filter(
              Boolean
            )
        : [],

    textLength:
      text.length,

    internalLinks:
      0,

    incomingLinks:
      0,

    externalLinks:
      0,

    images:
      0,

    h2:
      0,

    recommendations:
      [],

    warnings:
      [],

    _internalTargetUrls:
      new Set(),
  };
}

function toPublicPost(
  post
) {
  /*
   * 본문 HTML은 report.json에 넣지 않는다.
   * GitHub Pages에 불필요하게 전체 본문을 노출하지 않음.
   */

  return {
    id:
      post.id,

    title:
      post.title,

    url:
      post.url,

    published:
      post.published,

    updated:
      post.updated,

    labels:
      post.labels,

    textLength:
      post.textLength,

    internalLinks:
      post.internalLinks,

    incomingLinks:
      post.incomingLinks,

    externalLinks:
      post.externalLinks,

    images:
      post.images,

    h2:
      post.h2,

    warnings:
      post.warnings,

    recommendations:
      post.recommendations,
  };
}

/* =========================================================
   Link extraction
========================================================= */

function extractLinks(
  html,
  baseUrl
) {
  const result = [];

  const regex =
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

  let match;

  while (
    (
      match =
        regex.exec(
          String(
            html ||
            ""
          )
        )
    )
  ) {
    const rawHref =
      decodeBasicEntities(
        match[1] ??
        match[2] ??
        match[3] ??
        ""
      )
        .trim();

    if (
      !rawHref
    ) {
      continue;
    }

    if (
      /^(?:javascript:|mailto:|tel:|data:)/i
        .test(
          rawHref
        )
    ) {
      continue;
    }

    try {
      const resolved =
        new URL(
          rawHref,
          baseUrl
        );

      if (
        resolved.protocol !==
          "http:" &&
        resolved.protocol !==
          "https:"
      ) {
        continue;
      }

      result.push(
        resolved.href
      );

    } catch {
      // malformed href 무시
    }
  }

  return result;
}

/* =========================================================
   Canonical URL
========================================================= */

function canonicalUrl(
  value
) {
  try {
    const url =
      new URL(
        String(
          value ||
          ""
        ).trim()
      );

    if (
      url.protocol !==
        "http:" &&
      url.protocol !==
        "https:"
    ) {
      return "";
    }

    url.hash =
      "";

    /*
     * Blogger 모바일 파라미터 제거
     */
    url.searchParams.delete(
      "m"
    );

    let pathname =
      url.pathname ||
      "/";

    if (
      pathname.length >
        1 &&
      pathname.endsWith(
        "/"
      )
    ) {
      pathname =
        pathname.slice(
          0,
          -1
        );
    }

    return (
      `${url.protocol.toLowerCase()}//` +
      `${url.hostname.toLowerCase()}` +
      `${
        url.port
          ? `:${url.port}`
          : ""
      }` +
      `${pathname}` +
      `${url.search}`
    );

  } catch {
    return "";
  }
}

/* =========================================================
   Semantic pair scoring
========================================================= */

function evaluatePair(
  source,
  target,
  tokenStats,
  labelStats
) {
  /*
   * 제목 핵심 토큰
   */
  const sourceTitleTokens =
    informativeTokens(
      tokenize(
        source.title
      ),
      tokenStats
    );

  const targetTitleTokens =
    informativeTokens(
      tokenize(
        target.title
      ),
      tokenStats
    );

  /*
   * 본문은 너무 길게 전부 넣지 않고
   * 앞 5천자 정도만 의미 비교.
   */
  const sourceBodyTokens =
    informativeTokens(
      tokenize(
        source.text.slice(
          0,
          5000
        )
      ),
      tokenStats
    );

  const targetBodyTokens =
    informativeTokens(
      tokenize(
        target.text.slice(
          0,
          5000
        )
      ),
      tokenStats
    );

  const titleCosine =
    tfidfCosine(
      sourceTitleTokens,
      targetTitleTokens,
      tokenStats.idf
    );

  const bodyCosine =
    tfidfCosine(
      sourceBodyTokens,
      targetBodyTokens,
      tokenStats.idf
    );

  /*
   * 구체 라벨
   */
  const sourceLabels =
    usefulLabels(
      source,
      labelStats
    );

  const targetLabels =
    usefulLabels(
      target,
      labelStats
    );

  const sharedLabels =
    intersection(
      sourceLabels,
      targetLabels
    );

  const labelScore =
    jaccard(
      sourceLabels,
      targetLabels
    );

  /*
   * 주제군
   */
  const sourceTopics =
    detectTopics(
      source
    );

  const targetTopics =
    detectTopics(
      target
    );

  const sharedTopics =
    intersection(
      sourceTopics,
      targetTopics
    );

  const topicScore =
    sharedTopics.length
      ? Math.min(
          1,
          sharedTopics.length /
          2
        )
      : 0;

  /*
   * 시리즈
   */
  const sourceSeries =
    getSeriesKey(
      source.title
    );

  const targetSeries =
    getSeriesKey(
      target.title
    );

  const sameSeries =
    Boolean(
      sourceSeries &&
      targetSeries &&
      sourceSeries ===
        targetSeries
    );

  /*
   * 실제 겹치는 핵심어
   */
  const sharedTitleTokens =
    intersection(
      sourceTitleTokens,
      targetTitleTokens
    );

  const sharedBodyTokens =
    intersection(
      sourceBodyTokens,
      targetBodyTokens
    );

  /*
   * 기본 의미 점수
   *
   * 제목을 가장 강하게,
   * 본문,
   * 구체 라벨,
   * 주제군 순서.
   */
  const baseScore =
    clamp(
      (
        0.52 *
        titleCosine
      ) +
      (
        0.28 *
        bodyCosine
      ) +
      (
        0.12 *
        labelScore
      ) +
      (
        0.08 *
        topicScore
      ),
      0,
      1
    );

  /*
   * 관계 근거
   */
  const evidence = {
    series:
      sameSeries,

    title:
      sharedTitleTokens
        .length >= 1,

    label:
      sharedLabels
        .length >= 1,

    topic:
      sharedTopics
        .length >= 1,

    body:
      sharedBodyTokens
        .length >= 2,
  };

  /*
   * 같은 시리즈는
   * 그 자체로 강한 근거 2개 상당.
   */
  let evidenceCount =
    0;

  if (
    evidence.series
  ) {
    evidenceCount +=
      2;
  }

  if (
    evidence.title
  ) {
    evidenceCount +=
      1;
  }

  if (
    evidence.label
  ) {
    evidenceCount +=
      1;
  }

  if (
    evidence.topic
  ) {
    evidenceCount +=
      1;
  }

  if (
    evidence.body
  ) {
    evidenceCount +=
      1;
  }

  /*
   * 의미 근거에 따른 가점
   */
  let boost = 0;

  if (
    evidence.series
  ) {
    boost +=
      0.18;
  }

  if (
    evidence.title
  ) {
    boost +=
      Math.min(
        0.10,
        sharedTitleTokens
          .length *
          0.04
      );
  }

  if (
    evidence.label
  ) {
    boost +=
      Math.min(
        0.08,
        sharedLabels
          .length *
          0.04
      );
  }

  if (
    evidence.topic
  ) {
    boost +=
      Math.min(
        0.06,
        sharedTopics
          .length *
          0.03
      );
  }

  if (
    evidence.body
  ) {
    boost +=
      Math.min(
        0.06,
        sharedBodyTokens
          .length *
          0.012
      );
  }

  const finalScore =
    clamp(
      baseScore +
      boost,
      0,
      1
    );

  /*
   * 대시보드 표시용 이유
   */
  const reasons = [];

  if (
    sameSeries
  ) {
    reasons.push(
      `같은 시리즈: ${sourceSeries}`
    );
  }

  if (
    sharedTitleTokens.length
  ) {
    reasons.push(
      `제목 핵심어: ${
        sharedTitleTokens
          .slice(
            0,
            3
          )
          .join(", ")
      }`
    );
  }

  if (
    sharedLabels.length
  ) {
    reasons.push(
      `공통 라벨: ${
        sharedLabels
          .slice(
            0,
            3
          )
          .join(", ")
      }`
    );
  }

  if (
    sharedTopics.length
  ) {
    reasons.push(
      `주제군: ${
        sharedTopics
          .slice(
            0,
            2
          )
          .join(", ")
      }`
    );
  }

  if (
    sharedBodyTokens
      .length >= 2
  ) {
    reasons.push(
      `본문 핵심어: ${
        sharedBodyTokens
          .slice(
            0,
            3
          )
          .join(", ")
      }`
    );
  }

  return {
    baseScore,

    finalScore,

    titleCosine,

    bodyCosine,

    evidence,

    evidenceCount,

    sameSeries,

    sharedTitleTokens,

    sharedLabels,

    sharedTopics,

    sharedBodyTokens,

    reasons,
  };
}

/* =========================================================
   ★ Final semantic recommendation gate
========================================================= */

function passesRecommendationGate(
  relation,
  tuning
) {
  /*
   * 같은 시리즈
   *
   * Nobody Lab ↔ Nobody Lab
   * 생활실험 ↔ 생활실험
   */
  if (
    relation.sameSeries &&
    relation.finalScore >=
      Math.max(
        0.12,
        tuning.threshold *
        0.75
      )
  ) {
    return {
      pass:
        true,

      relationStrength:
        "series",
    };
  }

  /*
   * 서로 다른 의미 근거가
   * 최소 2개 이상 존재.
   */
  if (
    relation.evidenceCount >=
      2 &&
    relation.finalScore >=
      tuning.threshold
  ) {
    return {
      pass:
        true,

      relationStrength:
        "multi-evidence",
    };
  }

  /*
   * 근거가 하나뿐인 경우에는
   * 훨씬 높은 점수가 필요.
   *
   * 제목 / 구체라벨 / 주제군만 허용.
   */
  const strongSingleEvidence =
    (
      relation
        .evidence
        .title ||
      relation
        .evidence
        .label ||
      relation
        .evidence
        .topic
    );

  if (
    relation.evidenceCount ===
      1 &&
    strongSingleEvidence &&
    relation.finalScore >=
      tuning
        .singleEvidenceThreshold
  ) {
    return {
      pass:
        true,

      relationStrength:
        "single-strong",
    };
  }

  /*
   * 본문 단어만 비슷한 경우는
   * 가장 보수적으로 처리.
   */
  if (
    relation.evidenceCount ===
      1 &&
    relation
      .evidence
      .body &&
    relation
      .sharedBodyTokens
      .length >= 2 &&
    relation.finalScore >=
      tuning
        .weakEvidenceThreshold
  ) {
    return {
      pass:
        true,

      relationStrength:
        "body-only",
    };
  }

  /*
   * ★ 여기로 오면
   * TF-IDF 점수가 높아도 추천 탈락.
   */
  return {
    pass:
      false,

    relationStrength:
      "none",
  };
}

/* =========================================================
   Threshold learning
   기존 내부링크를 positive sample로 사용
========================================================= */

function learnThresholds(
  config,
  posts,
  postByUrl,
  scorePair
) {
  const rawPositiveScores =
    [];

  const trustedPositiveScores =
    [];

  for (const source of posts) {
    for (
      const targetUrl
      of source._internalTargetUrls
    ) {
      const target =
        postByUrl.get(
          targetUrl
        );

      if (!target) {
        continue;
      }

      const relation =
        scorePair(
          source,
          target
        );

      rawPositiveScores.push(
        relation.finalScore
      );

      /*
       * 기존 링크라고 무조건 학습하지 않음.
       *
       * 실제 의미 관계 근거가 있는 링크만
       * 신뢰 positive sample로 채택.
       */
      if (
        relation.evidenceCount >=
          1 ||
        relation.sameSeries
      ) {
        trustedPositiveScores.push(
          relation.finalScore
        );
      }
    }
  }

  const trusted =
    trustedPositiveScores
      .sort(
        (a, b) =>
          a - b
      );

  const raw =
    rawPositiveScores.length;

  const trustedCount =
    trusted.length;

  const rejected =
    Math.max(
      0,
      raw -
      trustedCount
    );

  let threshold =
    config.defaultThreshold;

  /*
   * 샘플이 충분하면
   * 실제 기존 내부링크 분포로 자동 학습.
   */
  if (
    trusted.length >=
      4
  ) {
    const learned =
      quantile(
        trusted,
        0.25
      ) *
      0.90;

    threshold =
      clamp(
        learned,
        0.18,
        0.45
      );
  }

  const singleEvidenceThreshold =
    clamp(
      threshold +
      0.05,
      0.23,
      0.55
    );

  const weakEvidenceThreshold =
    clamp(
      threshold +
      0.10,
      0.28,
      0.65
    );

  return {
    threshold:
      roundScore(
        threshold
      ),

    singleEvidenceThreshold:
      roundScore(
        singleEvidenceThreshold
      ),

    weakEvidenceThreshold:
      roundScore(
        weakEvidenceThreshold
      ),

    trustedPositiveSamples:
      trustedCount,

    rawPositiveSamples:
      raw,

    rejectedPositiveSamples:
      rejected,
  };
}

/* =========================================================
   TF-IDF
========================================================= */

function buildTokenStats(
  posts
) {
  const df =
    new Map();

  const total =
    Math.max(
      1,
      posts.length
    );

  for (const post of posts) {
    const docTokens =
      unique([
        ...tokenize(
          post.title
        ),

        ...tokenize(
          post.text.slice(
            0,
            5000
          )
        ),
      ]);

    for (
      const token
      of docTokens
    ) {
      df.set(
        token,
        (
          df.get(token) ||
          0
        ) + 1
      );
    }
  }

  const idf =
    new Map();

  for (
    const [
      token,
      count,
    ]
    of df.entries()
  ) {
    idf.set(
      token,

      Math.log(
        (
          1 +
          total
        ) /
        (
          1 +
          count
        )
      ) + 1
    );
  }

  return {
    df,
    idf,
    total,
  };
}

/* =========================================================
   너무 흔한 단어 제거

   블로그 전체 글 35% 이상에서 등장하면
   관계 판단력이 약하다고 본다.
========================================================= */

function informativeTokens(
  tokens,
  tokenStats
) {
  return tokens.filter(
    (token) => {
      const count =
        tokenStats
          .df
          .get(token) ||
        0;

      const ratio =
        count /
        tokenStats.total;

      return (
        ratio <
        0.35
      );
    }
  );
}

/* =========================================================
   TF-IDF cosine
========================================================= */

function tfidfCosine(
  tokensA,
  tokensB,
  idf
) {
  if (
    !tokensA.length ||
    !tokensB.length
  ) {
    return 0;
  }

  const vectorA =
    tfidfVector(
      tokensA,
      idf
    );

  const vectorB =
    tfidfVector(
      tokensB,
      idf
    );

  let dot = 0;

  let normA = 0;

  let normB = 0;

  for (
    const value
    of vectorA.values()
  ) {
    normA +=
      value *
      value;
  }

  for (
    const value
    of vectorB.values()
  ) {
    normB +=
      value *
      value;
  }

  if (
    !normA ||
    !normB
  ) {
    return 0;
  }

  const [
    small,
    large,
  ] =
    vectorA.size <=
    vectorB.size
      ? [
          vectorA,
          vectorB,
        ]
      : [
          vectorB,
          vectorA,
        ];

  for (
    const [
      token,
      value,
    ]
    of small.entries()
  ) {
    dot +=
      value *
      (
        large.get(
          token
        ) ||
        0
      );
  }

  return (
    dot /
    (
      Math.sqrt(
        normA
      ) *
      Math.sqrt(
        normB
      )
    )
  );
}

/* =========================================================
   TF-IDF vector
========================================================= */

function tfidfVector(
  tokens,
  idf
) {
  const counts =
    new Map();

  for (
    const token
    of tokens
  ) {
    counts.set(
      token,
      (
        counts.get(
          token
        ) ||
        0
      ) + 1
    );
  }

  const total =
    Math.max(
      1,
      tokens.length
    );

  const vector =
    new Map();

  for (
    const [
      token,
      count,
    ]
    of counts.entries()
  ) {
    const tf =
      count /
      total;

    vector.set(
      token,

      tf *
      (
        idf.get(
          token
        ) ||
        1
      )
    );
  }

  return vector;
}

/* =========================================================
   Tokenization
========================================================= */

function tokenize(
  value
) {
  return String(
    value ||
    ""
  )
    .toLowerCase()

    .replace(
      /&nbsp;/gi,
      " "
    )

    .replace(
      /[^\p{L}\p{N}]+/gu,
      " "
    )

    .split(
      /\s+/
    )

    .map(
      normalizeToken
    )

    .filter(
      Boolean
    )

    .filter(
      (token) =>
        !GENERIC_RELATION_TOKENS
          .has(
            token
          )
    )

    /*
     * 연도 / 숫자 단독은
     * 관계 증거에서 제외
     */
    .filter(
      (token) =>
        !/^\d+(?:\.\d+)?$/
          .test(
            token
          )
    )

    .filter(
      (token) =>
        !(
          token.length <=
            1 &&
          /^[가-힣]$/u.test(
            token
          )
        )
    )

    .filter(
      (token) =>
        !(
          token.length <=
            2 &&
          /^[a-z]+$/i.test(
            token
          )
        )
    );
}

/* =========================================================
   간단한 token normalization
========================================================= */

function normalizeToken(
  token
) {
  let value =
    String(
      token ||
      ""
    )
      .trim()
      .toLowerCase();

  if (!value) {
    return "";
  }

  /*
   * English very-light stemming
   */
  if (
    /^[a-z]+$/i
      .test(
        value
      )
  ) {
    if (
      value.length > 5 &&
      value.endsWith(
        "ies"
      )
    ) {
      value =
        `${value.slice(
          0,
          -3
        )}y`;
    }

    else if (
      value.length > 5 &&
      value.endsWith(
        "ing"
      )
    ) {
      value =
        value.slice(
          0,
          -3
        );
    }

    else if (
      value.length > 4 &&
      value.endsWith(
        "ed"
      )
    ) {
      value =
        value.slice(
          0,
          -2
        );
    }

    else if (
      value.length > 4 &&
      value.endsWith(
        "s"
      ) &&
      !value.endsWith(
        "ss"
      )
    ) {
      value =
        value.slice(
          0,
          -1
        );
    }
  }

  /*
   * Korean 조사 약식 제거
   */
  if (
    /^[가-힣]+$/u
      .test(
        value
      ) &&
    value.length >=
      3
  ) {
    const suffixes = [
      "에서는",
      "으로",
      "에서",
      "에게",
      "까지",
      "부터",
      "보다",
      "처럼",
      "하고",
      "하며",
      "하면",
      "로",
      "은",
      "는",
      "이",
      "가",
      "을",
      "를",
      "의",
      "에",
      "와",
      "과",
      "도",
      "만",
    ];

    for (
      const suffix
      of suffixes
    ) {
      if (
        value.length -
          suffix.length >=
          2 &&
        value.endsWith(
          suffix
        )
      ) {
        value =
          value.slice(
            0,
            -suffix.length
          );

        break;
      }
    }
  }

  return value;
}

/* =========================================================
   Label statistics
========================================================= */

function buildLabelStats(
  posts
) {
  const counts =
    new Map();

  const total =
    Math.max(
      1,
      posts.length
    );

  for (const post of posts) {
    const labels =
      unique(
        post.labels
          .map(
            normalizeLabel
          )
          .filter(
            Boolean
          )
      );

    for (
      const label
      of labels
    ) {
      counts.set(
        label,
        (
          counts.get(
            label
          ) ||
          0
        ) + 1
      );
    }
  }

  return {
    counts,
    total,
  };
}

/* =========================================================
   Useful / specific labels only
========================================================= */

function usefulLabels(
  post,
  labelStats
) {
  return unique(
    post.labels
      .map(
        normalizeLabel
      )
      .filter(
        Boolean
      )
  )
    .filter(
      (label) => {
        if (
          GENERIC_LABELS
            .has(
              label
            )
        ) {
          return false;
        }

        const ratio =
          (
            labelStats
              .counts
              .get(
                label
              ) ||
            0
          ) /
          labelStats.total;

        /*
         * 글 절반 이상에 달린 라벨은
         * 관계 근거로 쓰지 않음.
         */
        return (
          ratio <
          0.5
        );
      }
    );
}

function normalizeLabel(
  value
) {
  return String(
    value ||
    ""
  )
    .trim()
    .toLowerCase();
}

/* =========================================================
   Series detection
========================================================= */

function getSeriesKey(
  title
) {
  const value =
    String(
      title ||
      ""
    )
      .toLowerCase();

  const patterns = [
    /\bnobody\s+lab\s*#?\s*\d+/i,

    /\blife\s+experiment\s*#?\s*\d+/i,

    /생활\s*실험\s*#?\s*\d+/i,
  ];

  for (
    const pattern
    of patterns
  ) {
    const match =
      value.match(
        pattern
      );

    if (!match) {
      continue;
    }

    return match[0]
      .replace(
        /#?\s*\d+$/i,
        ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }

  return "";
}

/* =========================================================
   Topic detection
========================================================= */

function detectTopics(
  post
) {
  const haystack =
    (
      `${post.title}\n` +
      `${post.text.slice(
        0,
        3500
      )}`
    )
      .toLowerCase();

  const result = [];

  for (
    const [
      topic,
      keywords,
    ]
    of Object.entries(
      TOPIC_GROUPS
    )
  ) {
    if (
      keywords.some(
        (keyword) =>
          haystack.includes(
            keyword
              .toLowerCase()
          )
      )
    ) {
      result.push(
        topic
      );
    }
  }

  return result;
}

/* =========================================================
   Strip HTML
========================================================= */

function stripHtml(
  html
) {
  return decodeBasicEntities(
    String(
      html ||
      ""
    )

      .replace(
        /<script\b[\s\S]*?<\/script>/gi,
        " "
      )

      .replace(
        /<style\b[\s\S]*?<\/style>/gi,
        " "
      )

      .replace(
        /<br\s*\/?\s*>/gi,
        "\n"
      )

      .replace(
        /<\/p\s*>/gi,
        "\n"
      )

      .replace(
        /<[^>]+>/g,
        " "
      )
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

/* =========================================================
   Basic entities
========================================================= */

function decodeBasicEntities(
  value
) {
  return String(
    value ||
    ""
  )
    .replaceAll(
      "&nbsp;",
      " "
    )
    .replaceAll(
      "&amp;",
      "&"
    )
    .replaceAll(
      "&lt;",
      "<"
    )
    .replaceAll(
      "&gt;",
      ">"
    )
    .replaceAll(
      "&quot;",
      "\""
    )
    .replaceAll(
      "&#39;",
      "'"
    )
    .replaceAll(
      "&#x27;",
      "'"
    );
}

/* =========================================================
   Helpers
========================================================= */

function countMatches(
  value,
  regex
) {
  return (
    String(
      value ||
      ""
    )
      .match(
        regex
      ) ||
    []
  ).length;
}

function intersection(
  a,
  b
) {
  const setB =
    new Set(b);

  return unique(
    a.filter(
      (item) =>
        setB.has(
          item
        )
    )
  );
}

function jaccard(
  a,
  b
) {
  const setA =
    new Set(a);

  const setB =
    new Set(b);

  if (
    !setA.size ||
    !setB.size
  ) {
    return 0;
  }

  let common =
    0;

  for (
    const item
    of setA
  ) {
    if (
      setB.has(
        item
      )
    ) {
      common +=
        1;
    }
  }

  return (
    common /
    (
      setA.size +
      setB.size -
      common
    )
  );
}

function unique(
  values
) {
  return [
    ...new Set(
      values
    ),
  ];
}

function quantile(
  sortedValues,
  q
) {
  if (
    !sortedValues.length
  ) {
    return 0;
  }

  if (
    sortedValues.length ===
      1
  ) {
    return sortedValues[0];
  }

  const position =
    (
      sortedValues.length -
      1
    ) *
    q;

  const base =
    Math.floor(
      position
    );

  const rest =
    position -
    base;

  const next =
    sortedValues[
      base + 1
    ];

  if (
    next ===
    undefined
  ) {
    return sortedValues[
      base
    ];
  }

  return (
    sortedValues[
      base
    ] +
    rest *
    (
      next -
      sortedValues[
        base
      ]
    )
  );
}

function clamp(
  value,
  min,
  max
) {
  return Math.min(
    max,
    Math.max(
      min,
      value
    )
  );
}

function roundScore(
  value
) {
  return (
    Math.round(
      Number(
        value ||
        0
      ) *
      10000
    ) /
    10000
  );
}

function sleep(
  ms
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}

/* =========================================================
   Run
========================================================= */

main()
  .catch(
    (error) => {
      console.error(
        error
      );

      process.exitCode =
        1;
    }
  );
