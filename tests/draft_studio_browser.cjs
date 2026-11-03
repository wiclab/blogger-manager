"use strict";
/* Browser fixture: no real Blogger login and no external Google API requests. */
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const {draftOnly}=require("../scripts/draft_studio_blogger.cjs");
const {parseJob,validateArticle}=require("../scripts/draft_studio_core.cjs");
const BLOG_ID="1659014803305858421";
const html=[
'<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>',
'<input role="textbox" aria-label="Title" id="title"/>',
'<section><button type="button">Permalink</button><label>Custom Permalink<input type="radio" name="perm" checked/></label><input id="slug"/></section>',
'<section><button type="button">Labels</button><input id="labels"/></section>',
'<section><button type="button">Search description</button><textarea id="search"></textarea></section>',
'<div contenteditable="true" role="textbox" aria-label="Post content" id="body"></div>',
'<button type="button" id="html-button">HTML</button><textarea id="html" style="display:none"></textarea>',
'<button type="button" id="save">Save</button><button type="button" id="publish">Publish</button>',
'<span id="draft-status"></span><script>',
'window.publishClicks=0;document.getElementById("publish").onclick=()=>{window.publishClicks++;};',
'document.getElementById("html-button").onclick=()=>{document.getElementById("html").style.display="block";};',
'document.getElementById("body").addEventListener("paste",evt=>{',
'evt.preventDefault();const img=document.createElement("img");',
'img.src="https://blogger.googleusercontent.com/img/b/fixture";',
'document.getElementById("body").append(img);});',
'document.getElementById("save").onclick=()=>{document.getElementById("draft-status").textContent="Draft";};',
'</script></body></html>'
].join("");
const list='<!doctype html><html><body><button id="new">New post</button>'+
'<script>document.getElementById("new").onclick=()=>{window.location.href="/blog/post/edit/'+BLOG_ID+'/999999999999999999";};</script>'+
'</body></html>';
(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({permissions:["clipboard-read","clipboard-write"],viewport:{width:1280,height:900}});
 const page=await context.newPage();
 const image=path.join(os.tmpdir(),"draft-studio-fixture-"+Date.now()+".png");
 await fs.writeFile(image,Buffer.from(
   "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fO0AAAAASUVORK5CYII=","base64"));
 try{
  await page.route("https://www.blogger.com/**",route=>{
    const pathname=new URL(route.request().url()).pathname;
    return route.fulfill({status:200,contentType:"text/html",body:pathname.includes("/blog/post/edit/")?html:list});
  });
  const job=parseJob({blog:"byeol",topic:"휴대폰 변경 전 준비 체크리스트",label:"생활정보"});
  const article=validateArticle({
    title:"휴대폰 변경 전 꼭 확인할 사항과 점검표",
    slug:"phone-change-checklist-2026",
    description:"휴대폰을 변경하기 전 연락처, 사진 백업, 인증 앱, 금융 앱, 유심과 계정 이전 순서를 점검할 수 있도록 정리한 체크리스트입니다. 실제로 놓치기 쉬운 사항도 알려드립니다.",
    alt:"휴대폰과 체크표를 그린 파란색 일러스트",
    image_prompt:"Clean flat illustration of smartphone and checklist, pale blue background, no text",
    html:"<h2>핵심 점검표</h2><p>"+("사진과 연락처 백업 여부를 확인하고 계정을 점검합니다. ").repeat(80)+"</p>"
  },job);
  const result=await draftOnly(page,job,article,image,{BLOGGER_BYEOL_ID:BLOG_ID});
  assert.equal(result.verified,true);
  assert.equal(result.stage,"draft_verified");
  assert.match(result.imageUrl,/blogger.googleusercontent.com/);
  const state=await page.evaluate(()=>({
    title:document.getElementById("title").value,
    slug:document.getElementById("slug").value,
    label:document.getElementById("labels").value,
    search:document.getElementById("search").value,
    html:document.getElementById("html").value,
    published:window.publishClicks,
    draft:document.getElementById("draft-status").textContent
  }));
  assert.equal(state.title,article.title);
  assert.equal(state.slug,article.slug);
  assert.equal(state.label,"생활정보");
  assert.equal(state.search,article.description);
  assert.match(state.html,/blogger\.googleusercontent\.com/);
  assert.match(state.html,/alt="휴대폰과 체크표/);
  assert.equal(state.published,0);
  assert.equal(state.draft,"Draft");
  console.log("Draft-only fixture: PNG paste, HTML, metadata, save verified; Publish never clicked");
 }finally{await browser.close();await fs.unlink(image);}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
