"use strict";
/* Existing Blogger DRAFT image completion. Requires a locally authenticated Chromium profile.
   No new-post creation, no publish, no delete, no hidden API upload endpoint. */
const fs=require("node:fs/promises");
const path=require("node:path");
const {
  editorUrl,replaceWithHtml,requireOne,clickFirst
}=require("./draft_studio_blogger.cjs");
const {composeHtml}=require("./draft_studio_core.cjs");

const BLOG_ID_ENV="BLOGGER_BYEOL_ID";
const PNG_SIGNATURE=Buffer.from("89504e470d0a1a0a","hex");
function assertJob(job,env=process.env){
  if(!job||job.blog!=="byeol"||job.mode!=="draft_only"||job.publish!==false)
    throw Error("Only byeol draft_only jobs are allowed");
  const blogId=String(env[BLOG_ID_ENV]||"").trim();
  if(!/^\d{8,24}$/.test(blogId) ||
     !/^\d{8,24}$/.test(String(job.postId||"")))
    throw Error("An exact Blogger blog ID and an existing post ID are required");
  if(!String(job.title||"").trim() ||
     !String(job.html||"").includes("<h2") ||
     String(job.html).length<1300 || String(job.html).length>100000 ||
     !String(job.alt||"").trim())
    throw Error("Complete verified HTML, title and representative image ALT required");
  if(/<\s*(?:script|h1|iframe|object|embed|form)\b/i.test(job.html) ||
     /\bon(?:error|load|click|mouseover)\s*=/i.test(job.html) ||
     /(?:javascript:|data:image|srcdoc=)/i.test(job.html))
    throw Error("Unsafe HTML is not allowed");
  if(/<img\b/i.test(job.html))
    throw Error("Body already includes an image. Do not upload a duplicate");
  return {blogId,postId:String(job.postId)};
}
function clean(s){return String(s||"").replace(/[\s\u00a0\u200b]+/g,"").trim();}
async function assertDraftAndContent(page,job){
  const heading=await requireOne(page.getByRole("textbox",
    {name:/^Title$|^제목$|^Post title$|^글 제목$/i}),"Blogger post title");
  if((await heading.inputValue()).trim()!==job.title.trim())
    throw Error("The Blogger draft title does not match. Nothing will be changed");
  if(!await page.getByText(/^(Draft|임시글|임시 저장됨|임시 저장)$/i).count())
    throw Error("Explicit draft status was not found; refusing to edit");
  const editor=await requireOne(page.locator('[contenteditable="true"]').filter({visible:true}),"Blogger compose body");
  if(await editor.locator("img").count())
    throw Error("This draft already contains an image; refuse duplicate upload");
  const comparison=await editor.evaluate((node,expected)=>{
    const tmp=document.createElement("div");
    tmp.innerHTML=expected;
    return {original:node.textContent||"",expected:tmp.textContent||""};
  },job.html);
  if(!comparison.expected||clean(comparison.original)!==clean(comparison.expected))
    throw Error("Existing body differs from the expected source; refuse to overwrite user edits");
  return editor;
}
async function uploadNewPng(page,editor,imagePath){
  const image=await fs.readFile(imagePath);
  if(image.length<1000||image.length>15*1024*1024||!image.subarray(0,8).equals(PNG_SIGNATURE))
    throw Error("Valid PNG between 1KB and 15MB required");
  const before=await page.locator('img[src*="googleusercontent.com"]').evaluateAll(nodes=>
    nodes.map(n=>n.getAttribute("src")||"").filter(Boolean));
  await editor.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.evaluate(async encoded=>{
    const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    const blob=new Blob([bytes],{type:"image/png"});
    await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);
  },image.toString("base64"));
  await page.keyboard.press("ControlOrMeta+V");
  const url=await page.waitForFunction(old=>{
    const urls=[...document.querySelectorAll('[contenteditable="true"] img[src]')]
      .map(n=>n.getAttribute("src")||"");
    return urls.find(u=>/^https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com\//i.test(u) &&
      !old.includes(u))||null;
  },before,{timeout:28000}).then(h=>h.jsonValue()).catch(()=>{
    throw Error("Blogger-hosted newly uploaded image not detected; no draft save attempted");
  });
  if(!url)throw Error("New image URL is unavailable");
  return url;
}
async function runOnPage(page,job,imagePath,env=process.env){
  const {blogId,postId}=assertJob(job,env);
  const exactUrl=editorUrl(blogId,postId);
  const record={editorUrl:exactUrl,postId,verified:false,stage:"initial"};
  try{
    await page.goto(exactUrl,{waitUntil:"domcontentloaded",timeout:30000});
    const current=new URL(page.url());
    if(current.origin!=="https://www.blogger.com"||current.pathname!==new URL(exactUrl).pathname)
      throw Error("Google login failed or Blogger opened an unexpected page");
    const editor=await assertDraftAndContent(page,job);
    record.stage="draft_content_verified";
    const imageUrl=await uploadNewPng(page,editor,imagePath);
    record.stage="image_uploaded";
    record.imageUrl=imageUrl;
    await replaceWithHtml(page,composeHtml({html:job.html,alt:job.alt},imageUrl));
    record.stage="html_prepared";
    await clickFirst(page,[page.getByRole("button",{name:/^(Save|저장)$/i})],"Save draft only");
    record.stage="save_clicked";
    await page.waitForTimeout(1000);
    await page.reload({waitUntil:"domcontentloaded",timeout:30000});
    if(new URL(page.url()).pathname!==new URL(exactUrl).pathname)
      throw Error("Unexpected redirect after saving");
    const heading=await requireOne(page.getByRole("textbox",
      {name:/^Title$|^제목$|^Post title$|^글 제목$/i}),"Reloaded Blogger post title");
    if((await heading.inputValue()).trim()!==job.title.trim())
      throw Error("Reloaded post title changed");
    if(!await page.getByText(/^(Draft|임시글|임시 저장됨|임시 저장)$/i).count())
      throw Error("Draft state not verified after reload");
    // Blogger can reopen in HTML or compose view. Verify whichever is visible.
    const html=await page.locator('textarea#html,textarea[aria-label*="HTML"]').filter({visible:true}).count();
    let persisted=false;
    if(html===1){
      const val=await page.locator('textarea#html,textarea[aria-label*="HTML"]').filter({visible:true}).inputValue();
      persisted=val.includes(imageUrl)&&val.includes(job.alt);
    }else{
      const body=await requireOne(page.locator('[contenteditable="true"]').filter({visible:true}),"Reloaded body");
      persisted=await body.locator('img[alt]').evaluateAll((imgs,expected)=>
        imgs.some(img=>img.getAttribute("alt")===expected.alt &&
        (img.getAttribute("src")||"")===expected.url),{alt:job.alt,url:imageUrl});
    }
    if(!persisted)throw Error("Image and ALT were not confirmed after reload");
    record.verified=true;
    record.stage="draft_image_verified";
    return record;
  }catch(err){
    err.partialRecord={...record,verified:false};
    throw err;
  }
}
async function runChromium(job,imagePath,env=process.env){
  assertJob(job,env);
  const {chromium}=require("playwright");
  const profile=path.resolve(".local/draft-studio-profile");
  await fs.mkdir(profile,{recursive:true,mode:0o700});
  const ctx=await chromium.launchPersistentContext(profile,{
    headless:false,viewport:{width:1400,height:900},locale:"ko-KR",
    permissions:["clipboard-read","clipboard-write"]
  });
  try{return await runOnPage(ctx.pages()[0]||await ctx.newPage(),job,imagePath,env);}
  finally{await ctx.close();}
}
if(require.main===module){
  const [jsonPath,pngPath]=process.argv.slice(2);
  if(!jsonPath||!pngPath){
    console.error("Usage: node scripts/blogger_native_image_draft.cjs draft-job.json featured.png");
    process.exitCode=2;
  }else{
    fs.readFile(jsonPath,"utf8").then(JSON.parse).then(job=>runChromium(job,pngPath))
      .then(x=>console.log("Blogger DRAFT image verified:",x.editorUrl))
      .catch(e=>{console.error("Stopped (never published):",e.message);process.exitCode=1;});
  }
}
module.exports={assertJob,assertDraftAndContent,uploadNewPng,runOnPage,runChromium};