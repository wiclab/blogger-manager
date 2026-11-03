#!/usr/bin/env node
"use strict";
/* Read-only Playwright mobile layout probe. Never clicks, submits or edits blogs.
   Third-party scripts and XHR are blocked to avoid visit-notification traffic. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const HOSTS = Object.freeze({
  byeol: "wic12.blogspot.com",
  nobody: "qevnaxori.blogspot.com"
});
const WIDTHS = Object.freeze([320, 360, 390, 430]);
const MAX_SCREENSHOTS = 12;

function safeArticle(url, site) {
  try {
    const p = new URL(url);
    return p.protocol === "https:" && p.hostname === HOSTS[site] &&
      p.username === "" && p.password === "" && p.port === "" &&
      p.search === "" && p.hash === "" &&
      /^\/\d{4}\/\d{2}\/[^/]+\.html$/.test(p.pathname);
  } catch (_) {
    return false;
  }
}
function safeShot(url, width) {
  const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0,12);
  return "screenshots/" + hash + "-" + width + ".jpg";
}
function stateFor(issues, failed) {
  if (failed) return {state:"inconclusive", severity:"review"};
  if (!issues.length) return {state:"ok", severity:"none"};
  return {state:"issue", severity:issues.some(x => x.level === "high") ? "high" : "review"};
}
function filterIssues(issues) {
  const seen = new Set();
  return issues.filter(x => {
    const key = x.type + "|" + x.width + "|" + x.selector;
    if (seen.has(key)) return false;
    seen.add(key);return true;
  }).sort((a,b) => (b.level === "high") - (a.level === "high")).slice(0,8);
}
function allowResource(url, type, siteHost) {
  try {
    const p = new URL(url);
    if (!["https:", "data:", "blob:"].includes(p.protocol)) return false;
    if (p.protocol !== "https:") return true;
    const h = p.hostname;
    const safe = h === siteHost || h.endsWith(".blogger.com") ||
      h.endsWith(".googleusercontent.com") || h.endsWith(".gstatic.com") ||
      h === "fonts.googleapis.com" || h === "fonts.gstatic.com";
    // Layout needs fonts, stylesheets and images; never dispatch third-party JS
    // or trackers, beacons, worker APIs, XMLHttpRequest/fetch.
    if (["script","fetch","xhr","websocket","eventsource","ping"].includes(type)) return safe;
    return true;
  } catch (_) {return false;}
}
function evaluateLayout(width) {
  const viewport = window.innerWidth;
  const root = document.querySelector(".post-body, .entry-content, article .post-body, article") || document.body;
  const out = [];
  function selectorFor(node) {
    if (!node || node.nodeType !== 1) return "body";
    const parts = [];
    for (let n=node; n && n.nodeType===1 && parts.length<7; n=n.parentElement) {
      if (n.id && /^[A-Za-z][\w-]{0,60}$/.test(n.id)) {
        parts.unshift("#"+n.id);break;
      }
      let part=n.tagName.toLowerCase();
      let index=1;
      for (let prev=n.previousElementSibling;prev;prev=prev.previousElementSibling) {
        if (prev.tagName===n.tagName) index++;
      }
      part += ":nth-of-type("+index+")";
      parts.unshift(part);
      if (n===root) break;
    }
    return parts.join(" > ").slice(0,175);
  }
  function scrollAncestor(node) {
    for(let p=node.parentElement;p && p!==document.body;p=p.parentElement) {
      const style=getComputedStyle(p);
      if (/^(auto|scroll)$/.test(style.overflowX) && p.scrollWidth > p.clientWidth+8) return true;
    }
    return false;
  }
  function push(type, level, node, detail) {
    out.push({type, level, width, selector:selectorFor(node),detail:String(detail).slice(0,190)});
  }
  if (viewport > width+40) {
    push("viewport_mismatch","high",document.documentElement,
      "모바일 뷰포트가 "+width+"px 요청에서 실제 "+viewport+"px로 렌더링됨");
  }
  const documentWidth=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth);
  if (documentWidth > width+9) {
    const candidates=Array.from(root.querySelectorAll("*")).slice(0,2500);
    const culprit=candidates.find(node => {
      const r=node.getBoundingClientRect();
      const css=getComputedStyle(node);
      return r.width>0 && r.right>width+10 && r.left<width &&
        css.position!=="fixed" && css.position!=="sticky" && !scrollAncestor(node);
    }) || root;
    push("horizontal_overflow","high",culprit,
      "본문의 수평 크기 "+documentWidth+"px (요청한 화면 "+width+"px) — 가로 스크롤 의심");
  }
  const contentCandidates=Array.from(root.querySelectorAll("p,span,div,td,th,figcaption,li,blockquote")).slice(0,3000);
  for(const node of contentCandidates) {
    const style=getComputedStyle(node);
    if (style.display==="none" || style.visibility==="hidden" || style.position==="fixed") continue;
    const direct=Array.from(node.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join(" ").replace(/\s+/g," ").trim();
    if(direct.length<29) continue;
    const rect=node.getBoundingClientRect();
    if(rect.width>=132 || rect.width<15 || rect.height<120) continue;
    const lineHeight=parseFloat(style.lineHeight) || parseFloat(style.fontSize)*1.5 || 20;
    const lines=rect.height/Math.max(lineHeight,10);
    if(lines>=6 && direct.length/lines<9) {
      push("narrow_text","high",node,"좁은 문단 ("+Math.round(rect.width)+"px, 약 "+Math.round(lines)+"줄): "+direct.slice(0,75));
      if(out.length>=18) break;
    }
  }
  for(const node of Array.from(root.querySelectorAll("table")).slice(0,70)) {
    const rect=node.getBoundingClientRect();
    if(rect.width>width+10 && !scrollAncestor(node)) {
      push("table_overflow","high",node,
        "표 폭 "+Math.round(rect.width)+"px, 화면 "+width+"px — 표 전용 가로 스크롤 필요");
    }
  }
  for(const node of Array.from(root.querySelectorAll("input,textarea,select,button")).slice(0,100)) {
    const rect=node.getBoundingClientRect();
    const css=getComputedStyle(node);
    if(rect.width===0 || rect.height===0 || css.display==="none" || css.visibility==="hidden")continue;
    if((rect.right>width+10 || rect.left< -10) && !scrollAncestor(node)) {
      push("control_clipped","review",node,"입력창/버튼이 화면 너비를 벗어남");
    }
  }
  return out;
}
async function scanPost(browser, site, item, shotsDir, shotBudget) {
  const url=item.url;
  const context=await browser.newContext({
    viewport:{width:390,height:860},isMobile:true,hasTouch:true,deviceScaleFactor:1,
    locale:"ko-KR",serviceWorkers:"block",
    reducedMotion:"reduce"
  });
  const page=await context.newPage();
  const scriptErrors=[];
  page.on("pageerror", e => {
    const message=String(e.message || "").slice(0,160);
    if (scriptErrors.length<3 && /ReferenceError|TypeError|SyntaxError|is not defined|Cannot read/i.test(message)) {
      scriptErrors.push(message);
    }
  });
  await page.route("**/*", route => {
    if (!allowResource(route.request().url(),route.request().resourceType(),HOSTS[site])) {
      return route.abort().catch(()=>{});
    }
    return route.continue().catch(()=>{});
  });
  let failed=false,issues=[],screenshot=null;
  try {
    const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000});
    await page.waitForTimeout(400);
    if (!response || !response.ok() || new URL(page.url()).hostname!==HOSTS[site]) {
      throw new Error("페이지 응답 또는 최종 호스트가 유효하지 않음");
    }
    for (const width of WIDTHS) {
      await page.setViewportSize({width,height:860});
      await page.waitForTimeout(180);
      const layout=await page.evaluate(evaluateLayout,width);
      issues.push(...layout);
    }
    if(scriptErrors.length) {
      issues.push({type:"script_error",level:"review",width:390,selector:"body",
        detail:"본문 JavaScript 오류 감지(계산식 오류 확정 아님): "+scriptErrors[0].slice(0,100)});
    }
    issues=filterIssues(issues);
    // Preserve a screenshot of the earliest visibly suspect element, not merely page top.
    if(issues.length && shotBudget.remaining>0) {
      const target=issues[0];
      const shot=safeShot(url,target.width);
      try {
        await page.setViewportSize({width:target.width,height:860});
        if(target.selector && target.selector!=="body") {
          const loc=page.locator(target.selector).first();
          await loc.scrollIntoViewIfNeeded({timeout:2500}).catch(()=>{});
        }
        await fs.promises.mkdir(shotsDir,{recursive:true});
        await page.screenshot({path:path.join(shotsDir,path.basename(shot)),type:"jpeg",quality:66,
          animations:"disabled",timeout:10000});
        screenshot=shot;
        shotBudget.remaining--;
      } catch (_) {
        screenshot=null; // Layout issue remains visible even without snapshot.
      }
    }
  } catch (e) {
    failed=true;
    issues=[{type:"page_load_error",level:"review",width:390,selector:"body",
      detail:"접근·렌더링 확인 실패: "+String(e && e.message || "Unknown").slice(0,100)}];
  } finally {
    await context.close();
  }
  const status=stateFor(issues,failed);
  return {site,url,state:status.state,severity:status.severity,issues,screenshot};
}
async function main() {
  const [queueFile,resultFile,shotsDir]=process.argv.slice(2);
  if(!queueFile || !resultFile || !shotsDir) throw new Error("Usage: mobile_audit_scan.cjs queue.json out.json shots/");
  const queue=JSON.parse(fs.readFileSync(queueFile,"utf8"));
  if(queue.schema!==1 || !Array.isArray(queue.sites) || queue.sites.length!==2 ||
     queue.viewports?.join(",")!==WIDTHS.join(","))throw new Error("Invalid audit queue");
  for(const site of queue.sites) {
    if(!HOSTS[site.id] || site.base!=="https://"+HOSTS[site.id]+"/")throw new Error("Unknown blog in queue");
    for(const p of site.posts) if(!safeArticle(p.url,site.id))throw new Error("Cross-site article in queue");
  }
  const {chromium}=require("playwright");
  const browser=await chromium.launch({headless:true,args:["--disable-dev-shm-usage"]});
  const results=[],shotBudget={remaining:MAX_SCREENSHOTS};
  try {
    for(const site of queue.sites) {
      for(const item of site.posts) {
        const result=await scanPost(browser,site.id,item,shotsDir,shotBudget);
        results.push(result);
        console.log(site.id+": "+result.state+" "+result.severity+" ("+result.issues.length+" findings)");
      }
    }
  } finally {
    await browser.close();
  }
  await fs.promises.mkdir(path.dirname(resultFile),{recursive:true});
  await fs.promises.writeFile(resultFile,JSON.stringify({schema:1,results},null,2)+"\n");
  console.log("Mobile audit: "+results.length+" URLs; screenshots: "+(MAX_SCREENSHOTS-shotBudget.remaining));
}
if (require.main===module) main().catch(err=>{console.error("Mobile audit failed: "+err.message);process.exitCode=1;});
module.exports={HOSTS,WIDTHS,safeArticle,safeShot,stateFor,filterIssues,allowResource,evaluateLayout};
