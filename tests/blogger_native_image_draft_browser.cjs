"use strict";
/* Local-only fixture of an existing Blogger draft, NEVER connects to production Google. */
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const {runOnPage,assertJob}=require("../scripts/blogger_native_image_draft.cjs");
const BLOG_ID="1659014803305858421",POST_ID="999999999999999999";
const html='<article><h2>문제 확인</h2><p>'+
   ("와이파이 신호는 보이지만 인터넷이 안 된다면 연결 상태를 확인합니다. ").repeat(45)+
   '</p></article>';
const job={
  blog:"byeol",mode:"draft_only",publish:false,
  title:"와이파이는 연결됐는데 인터넷이 안 된다면? 휴대폰·공유기 구별법",
  html,alt:"와이파이 장애 원인을 설명하는 일러스트",postId:POST_ID
};
const profileEnv={BLOGGER_BYEOL_ID:BLOG_ID};
function mockBody({mismatch=false,existingImage=false,savedHtml=""}={}){
 const body=mismatch?html.replace("와이파이","블루투스"):html;
 const content=savedHtml || (existingImage?'<img src="https://blogger.googleusercontent.com/img/b/existing" />'+body:body);
 return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>'+
 '<input aria-label="Title" id="title" value="'+job.title+'"/>'+
 '<span id="status">Draft</span>'+
 '<div id="body" contenteditable="true">'+content+'</div>'+
 '<button id="html-button" type="button">HTML</button>'+
 '<textarea id="html" style="display:none"></textarea>'+
 '<button id="save" type="button">Save</button>'+
 '<button id="publish" type="button">Publish</button>'+
 '<script>'+
 'window.publishClicked=0;document.getElementById("publish").onclick=()=>{fetch("/fixture/publish",{method:"POST"})};'+
 'document.getElementById("html-button").onclick=()=>{const el=document.getElementById("html");el.value=document.getElementById("body").innerHTML;el.style.display="block";};'+
 'document.getElementById("body").addEventListener("paste",e=>{'+
 'e.preventDefault();const img=document.createElement("img");'+
 'img.src="https://blogger.googleusercontent.com/img/b/new-upload-001";'+
 'document.getElementById("body").insertBefore(img,document.getElementById("body").firstChild);'+
 '});'+
 'document.getElementById("save").onclick=async()=>{await fetch("/fixture/save",{method:"POST",body:document.getElementById("html").value});};'+
 '</script></body></html>';
}
async function scenario({wrongTitle=false,existingImage=false,mismatch=false}={}){
 const browser=await chromium.launch({headless:true});
 const ctx=await browser.newContext({permissions:["clipboard-read","clipboard-write"]});
 const page=await ctx.newPage();
 const imageFile=path.join(os.tmpdir(),"blogger-native-image-"+process.pid+"-"+Date.now()+".png");
 await fs.writeFile(imageFile,Buffer.concat([Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABd0lEQVQ4T6WTTU8CQRSGn3kmO+5jktHuK/yBprb5Sw5aFVgxiM83DnOemJjtgnbpi0IPvevUf4EYudCy3nrqkg7OxrbNfzFkTMjkLh14BYQCmtstG/vAfi2LFHQDfjXlmrNT9chB0uRJ10dJ6FZQfhzw3hPUteq5jtGf7gmwlIG1hfi4J6xyJtmWIHdqVesWY3+4xUpVg+1Z1cIMWS0V4xfpGdI0YS/nXb8hEjP73zOa7g0uuOskwQ0gR8M8ToCkHLi36jpcbnKeA1bwtB5rSMGPbM6KakVIiyjtka4qy+2D89jpHsUsSMzmhx3zUmihTs2tHUUcqorjOc6tP2TyKhPBa1V6dJRHXdozBIpSbI74/RKgOOuEez2o7IlaAPJNAEr2OsrvKyUuO4PY6Gl8bYLURlJHGV6BnjK3Jav5ge4iM/KfYDZvXDgV0jjcAAAAASUVORK5CYII=","base64"),Buffer.alloc(2048)]));
 // Padding only for a PNG signature/fixture; no real photo involved.
 let persisted="",publish=0,saves=0,newPosts=0;
 await page.route("https://www.blogger.com/**",route=>{
  const u=new URL(route.request().url());
  if(u.pathname==="/fixture/save"){
    saves++;persisted=route.request().postData()||"";
    return route.fulfill({status:200,contentType:"text/plain",body:"ok"});
  }
  if(u.pathname==="/fixture/publish"){publish++;return route.fulfill({status:400,body:"forbidden"});}
  if(u.pathname.includes("/blog/posts/")){newPosts++;return route.fulfill({status:400,body:"forbidden"});}
  if(u.pathname.includes("/blog/post/edit/")){
    let markup=mockBody({mismatch,existingImage,savedHtml:persisted});
    if(wrongTitle)markup=markup.replace('value="'+job.title+'"','value="wrong post"');
    return route.fulfill({status:200,contentType:"text/html",body:markup});
  }
  return route.abort();
 });
 try{
  let result=null,failed=null;
  try{result=await runOnPage(page,job,imageFile,profileEnv)}catch(e){failed=e.message;}
  return {result,failed,persisted,saves,publish,newPosts};
 }finally{
  await ctx.close();await browser.close();await fs.unlink(imageFile);
 }
}
(async()=>{
 assert.throws(()=>assertJob({...job,publish:true},profileEnv),/draft_only/);
 assert.throws(()=>assertJob({...job,postId:"garbage"},profileEnv),/post ID/);
 const good=await scenario();
 if(good.failed)throw Error("Successful fixture failed: "+good.failed);
 assert.equal(good.result.verified,true);
 assert.equal(good.result.stage,"draft_image_verified");
 assert.match(good.result.imageUrl,/blogger\.googleusercontent\.com/);
 assert.match(good.persisted,/alt="와이파이 장애 원인을 설명하는 일러스트"/);
 assert.equal(good.saves,1);
 assert.equal(good.newPosts,0);
 assert.equal(good.publish,0);
 const wrong=await scenario({wrongTitle:true});
 assert.match(wrong.failed,/title does not match/);
 assert.equal(wrong.saves,0);
 const altered=await scenario({mismatch:true});
 assert.match(altered.failed,/Existing body differs/);
 assert.equal(altered.saves,0);
 const duplicate=await scenario({existingImage:true});
 assert.match(duplicate.failed,/already contains an image/);
 assert.equal(duplicate.saves,0);
 console.log("Existing-draft image fixture passed: native image, ALT, reload, no new post, no Publish");
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});