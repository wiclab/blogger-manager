/* Local, read-only duplicate risk matcher for existing published Blogger posts.
 * No API keys, credentials, network calls or publishing actions. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DuplicateGuard = api;
})(typeof window !== "undefined" ? window : undefined, function () {
  "use strict";
  const STOP = new Set(("a an and are as at be been but by can could do does for from had has have how if in into is it its " +
    "many more most of on or our should than that the their these this those to was were what when where which who why will with would you your " +
    "actually really much long best guide tips explained complete new latest updated 2026 2027 calculator calculation " +
    "글 포스팅 블로그 알아보기 확인 방법 정리 이유 무엇 어떻게 언제 어디 왜 정말 진짜 경우 기준 계산기").split(/\s+/));
  const ALIASES = {
    subscriptions:"subscription",subscribed:"subscription",subscribing:"subscription",membership:"subscription",memberships:"subscription",
    monthly:"month",months:"month",yearly:"year",annual:"year",annually:"year",years:"year",
    watching:"watch",watched:"watch",videos:"video",playback:"video",speeds:"speed",
    prices:"cost",pricing:"cost",price:"cost",fees:"cost",fee:"cost",costs:"cost",expenses:"cost",
    saving:"save",savings:"save",saved:"save",cheaper:"cheap",cheapest:"cheap",
    electricity:"electric",electrical:"electric",electricitybill:"electric",bills:"bill",
    subscriptionsplans:"subscription",plans:"plan",compared:"compare",comparing:"compare",comparison:"compare",
    refunded:"refund",refunds:"refund",cancelling:"cancel",cancellation:"cancel",
    시간절약:"절약",시간절약법:"절약",요금제:"요금",구독료:"구독",구독서비스:"구독",전기요금:"전기",전기세:"전기",결제일:"결제",
    환불받는:"환불",환불방법:"환불",자동이체일:"자동이체",반입금지:"반입"
  };
  function normalize(value) {
    return String(value || "").normalize("NFKC").toLowerCase()
      .replace(/&(?:amp|nbsp|quot|#\d+);/g, " ")
      .replace(/([a-z])['’]s\b/g, "$1")
      .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  }
  function words(value) {
    const parts = normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
    return new Set(parts.filter(x => x.length >= 2 && !STOP.has(x)).map(x => ALIASES[x] || x));
  }
  function intersect(a,b) { return Array.from(a).filter(x => b.has(x)); }
  function scoreOne(query, raw, record) {
    const title = String(record.title || "").trim();
    const hints = record.topicHints || {};
    const headings = Array.isArray(hints.headings) ? hints.headings.filter(x => typeof x === "string").slice(0,8) : [];
    const summary = String(hints.summary || record.description || "").slice(0,500);
    const candidateTitle = words(title);
    const candidateAll = words([title,summary,...headings].join(" "));
    const candidateContext = words([summary,...headings].join(" "));
    const queryTitle = words(query);
    const queryAll = words([query,raw].join(" "));
    const sharedTitles = intersect(queryTitle,candidateTitle);
    const sharedFull = intersect(queryAll,candidateAll);
    const intersection = sharedTitles.length;
    const union = new Set([...queryTitle,...candidateTitle]).size;
    const overlap = intersection/Math.max(1,Math.min(queryTitle.size,candidateTitle.size));
    const jaccard = intersection/Math.max(1,union);
    const titleSimilarity = (0.55*overlap+0.45*jaccard)*100;
    const titleCoverage = intersect(queryTitle,candidateAll).length/Math.max(1,queryTitle.size);
    const contextCoverage = intersect(queryAll,candidateContext).length/Math.max(1,Math.min(queryAll.size,candidateContext.size));
    let value = titleSimilarity*0.62 + titleCoverage*25 + contextCoverage*13;
    const exact = normalize(query) === normalize(title);
    const containment = normalize(query).length >= 16 && normalize(title).length >= 16 &&
      (normalize(query).includes(normalize(title)) || normalize(title).includes(normalize(query)));
    if (exact) value=100;
    else if (containment) value=Math.max(value,91);
    // One generic title word is not evidence that the search intent is identical.
    else if (sharedTitles.length < 2) {
      if (intersect(queryTitle,candidateContext).length >= 2 && sharedFull.length >= 3)
        value=Math.min(value,64);
      else value=Math.min(value,40);
    }
    value=Math.max(0,Math.min(100,Math.round(value)));
    return {
      title, url:String(record.url || ""), score:value,
      level:value>=75?"high":value>=45?"review":"low",
      shared:sharedFull.slice(0,8), titleShared:sharedTitles.slice(0,6),
      clues:headings.slice(0,3), hasContext:Boolean(summary || headings.length),
      published:String(record.published || "")
    };
  }
  function compare(title, outline, posts) {
    const cleanTitle=String(title || "").trim();
    if (cleanTitle.length < 5 || words(cleanTitle).size === 0) throw new Error("글 제목을 5자 이상 구체적으로 입력해.");
    if (!Array.isArray(posts) || !posts.length) throw new Error("기존 공개 글 목록을 불러오지 못했어. 검사 결과를 신뢰할 수 없어.");
    const valid=posts.filter(p => p && typeof p.title==="string" && /^https:\/\/(wic12|qevnaxori)\.blogspot\.com\//.test(String(p.url || "")));
    if (!valid.length) throw new Error("유효한 기존 글이 없어. 블로그 선택과 분석 보고서를 확인해.");
    const matches=valid.map(p=>scoreOne(cleanTitle,String(outline || "").slice(0,4000),p))
      .sort((a,b)=>b.score-a.score || a.title.localeCompare(b.title,"ko"));
    const best=matches[0];
    const staleContext=valid.some(p => p.topicHints && (p.topicHints.summary || (p.topicHints.headings || []).length));
    return {total:valid.length, best:best.score, level:best.level, matches:matches.slice(0,8),
      hasContext:staleContext, message:best.level==="high"?"중복 위험 높음: 기존 글 보강을 우선 검토"
        :best.level==="review"?"유사 글 있음: 기존 본문 확인 후 새 글 판단"
        :"직접적인 유사 후보 낮음: 본문 확인 없이 중복 없음으로 단정하지 마"};
  }
  return {normalize,words,compare};
});
