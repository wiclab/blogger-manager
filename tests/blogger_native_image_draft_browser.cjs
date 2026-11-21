"use strict";
/* Local-only fixture of an existing Blogger draft, NEVER connects to production Google. */
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const zlib=require("node:zlib");
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
function crc32(data){
 let crc=0xffffffff;
 for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc&1)?(crc>>>1)^0xedb88320:crc>>>1;}
 return (crc^0xffffffff)>>>0;
}
function pngChunk(type,data){
 const t=Buffer.from(type,"ascii"),len=Buffer.alloc(4),crc=Buffer.alloc(4);
 len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));
 return Buffer.concat([len,t,data,crc]);
}
function makePng(){
 const w=64,h=64,raw=Buffer.alloc(h*(1+w*4));
 let seed=123456789;
 for(let y=0;y<h;y++){
  const start=y*(1+w*4);raw[start]=0;
  for(let x=0;x<w;x++){
   const p=start+1+x*4;
   for(let c=0;c<3;c++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw[p+c]=seed>>>24;}
   raw[p+3]=255;
  }
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([
   Buffer.from("89504e470d0a1a0a","hex"),
   pngChunk("IHDR",ihdr),pngChunk("IDAT",zlib.deflateSync(raw)),pngChunk("IEND",Buffer.alloc(0))
 ]);
}
async function scenario({wrongTitle=false,existingImage=false,mismatch=false}={}){
 const browser=await chromium.launch({headless:true});
 const ctx=await browser.newContext({permissions:["clipboard-read","clipboard-write"]});
 const page=await ctx.newPage();
 const imageFile=path.join(os.tmpdir(),"blogger-native-image-"+process.pid+"-"+Date.now()+".png");
 await fs.writeFile(imageFile,makePng());
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