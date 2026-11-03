"use strict";
/* Locally authenticated Chromium runs Blogger's actual editor. Fail closed if UI differs.
   Deliberately contains no Publish click, no post deletion and no API publish route. */
const fs=require("node:fs/promises");
const path=require("node:path");
const {BLOGS,blogId,composeHtml}=require("./draft_studio_core.cjs");

const timeout=9000;
const publicationPattern=/^(Publish|게시|발행|공개)$/i;
function editorUrl(blogIdValue,postId){
  if(!/^\d{8,24}$/.test(String(blogIdValue)))throw Error("Invalid blog id");
  return "https://www.blogger.com/blog/post/edit/"+blogIdValue+
    (postId?"/"+postId:"");
}
async function requireOne(locator,what){
  const count=await locator.count();
  if(count!==1)throw Error(what+" UI를 정확히 찾지 못했어 ("+count+"개). 자동 저장을 중단해.");
  const item=locator.first();
  if(!(await item.isVisible()))throw Error(what+" UI가 표시되지 않아 자동 저장 중단");
  return item;
}
async function clickFirst(page,locators,what){
  for(const loc of locators){
    const count=await loc.count();
    if(count===1 && await loc.first().isVisible()){
      await loc.first().click({timeout});return loc.first();
    }
  }
  throw Error(what+" 버튼이 없거나 여러 개야. 발행하지 않고 중단해.");
}
async function setPanelField(page,pattern,value,kind){
  const heading=await clickFirst(page,[
    page.getByRole("button",{name:pattern}),
    page.getByText(pattern,{exact:true})
  ],kind+" 설정");
  const container=heading.locator("xpath=parent::*");
  let field=container.locator("input:not([type=radio]),textarea");
  if(await field.count()!==1){
    // Blogger often keeps the setting fields in a sibling collapse pane.
    field=heading.locator("xpath=following-sibling::*").locator("input:not([type=radio]),textarea");
  }
  const elem=await requireOne(field,kind+" 입력");
  await elem.fill(value,{timeout});
  if((await elem.inputValue())!==value)throw Error(kind+" 값이 입력 후 일치하지 않아.");
}
async function permalink(page,slug) {
  const panel=await clickFirst(page,[
    page.getByRole("button",{name:/^(Permalink|고유주소|퍼머링크)$/i}),
    page.getByText(/^(Permalink|고유주소|퍼머링크)$/i,{exact:true})
  ],"퍼머링크");
  const custom=page.getByRole("radio",{name:/Custom Permalink|사용자 지정|맞춤 고유주소|맞춤 퍼머링크|맞춤설정/i});
  if(await custom.count()===1 && await custom.isVisible())await custom.check({timeout});
  const root=panel.locator("xpath=parent::*");
  let inputs=root.locator("input:not([type=radio])");
  if(await inputs.count()!==1){
    inputs=page.locator('input[aria-label*="Permalink"],input[aria-label*="고유"],input[aria-label*="퍼머링크"]');
  }
  const input=await requireOne(inputs,"맞춤 퍼머링크");
  await input.fill(slug,{timeout});
  if((await input.inputValue()).replace(/\.html$/,"")!==slug)throw Error("퍼머링크 입력값 검증 실패");
}
async function assignTitle(page,title){
  const choices=[
    page.getByRole("textbox",{name:/^Title$|^제목$|^Post title$|^글 제목$/i}),
    page.locator('input[aria-label="Title"],input[placeholder="Title"],input[aria-label="제목"],input[placeholder="제목"]')
  ];
  for(const loc of choices){
    if(await loc.count()===1&&await loc.first().isVisible()){
      await loc.fill(title,{timeout});return;
    }
  }
  throw Error("제목 입력창을 식별하지 못했어.");
}
async function imageFromClipboard(page,filePath) {
  const data=await fs.readFile(filePath);
  if(!data.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex")))
    throw Error("이미지 파일은 PNG여야 해.");
  if(data.length>15*1024*1024)throw Error("이미지 파일 최대 15MB");
  const editable=page.locator('[contenteditable="true"]').filter({visible:true});
  // Editor must have a single live compose field; HTML source view is not suitable for paste.
  const target=await requireOne(editable,"Blogger 본문 편집");
  await target.click({timeout});
  const b64=data.toString("base64");
  await page.evaluate(async encoded=>{
    const bytes=Uint8Array.from(atob(encoded),x=>x.charCodeAt(0));
    const blob=new Blob([bytes],{type:"image/png"});
    await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);
  },b64);
  await page.keyboard.press("ControlOrMeta+V");
  try{
    await page.locator('img[src*="googleusercontent.com"]').first().waitFor({state:"attached",timeout:18000});
  }catch(_){
    throw Error("Blogger가 클립보드 이미지를 실제 업로드한 것을 확인하지 못했어. 새 글은 게시하지 않아.");
  }
  const urls=await page.locator('img[src*="googleusercontent.com"]').evaluateAll(nodes=>
    nodes.map(n=>n.getAttribute("src")||"").filter(Boolean));
  const imageUrl=urls[urls.length-1];
  if(!imageUrl || !/^https:\/\/[^/]*googleusercontent\.com\//.test(imageUrl))
    throw Error("Blogger 이미지 주소 검증 실패");
  return imageUrl;
}
async function replaceWithHtml(page,html){
  await clickFirst(page,[
    page.getByRole("button",{name:/HTML view|HTML 보기|HTML 모드|HTML/i}),
    page.getByLabel(/Compose view|작성 보기|보기 전환/i)
  ],"HTML 편집 모드");
  const input=page.locator("textarea:visible");
  if(await input.count()!==1)
    throw Error("HTML 원본 입력창을 구분하지 못했어. 글 내용은 임의로 덮어쓰지 않아.");
  await input.fill(html,{timeout});
  const read=await input.inputValue();
  if(!read.includes("googleusercontent.com")||!read.includes("<h2"))
    throw Error("이미지 주소나 소제목이 본문에서 누락됐어.");
}
async function openNewEditor(page,blogIdValue){
  await page.goto("https://www.blogger.com/blog/posts/"+blogIdValue,
    {waitUntil:"domcontentloaded",timeout:30000});
  const current=new URL(page.url());
  if(!/(\.|^)blogger\.com$/.test(current.hostname) || /accounts\.google\.com/.test(current.hostname))
    throw Error("Blogger 로그인 세션을 확인하지 못했어. 먼저 수동 로그인 연결을 해줘.");
  await clickFirst(page,[
    page.getByRole("button",{name:/새 글|새 게시물|새 포스트|New post/i}),
    page.getByRole("link",{name:/새 글|새 게시물|New post/i})
  ],"새 글");
  await page.waitForURL(/\/blog\/post\/edit\/\d+/,{timeout:15000});
  if(!page.url().includes("/blog/post/edit/"+blogIdValue))
    throw Error("의도한 Blogger 블로그 편집기가 열리지 않았어.");
  return page.url();
}
async function draftOnly(page,job,article,imagePath,env=process.env){
  const id=blogId(job,env);
  const record={blog:job.blog,blogId:id,editorUrl:null,verified:false,stage:"starting"};
  try{
    await openNewEditor(page,id);
    record.editorUrl=page.url();
    record.stage="new_editor";
    await assignTitle(page,article.title);
    // Permalink before save: a missing field is a stop condition, never publish.
    await permalink(page,article.slug);
    record.stage="permalink";
    await setPanelField(page,/^(Labels|라벨)$/i,article.label,"라벨");
    record.stage="labels";
    await setPanelField(page,/^(Search description|검색 설명|검색설명)$/i,article.description,"검색 설명");
    record.stage="description";
    const imageUrl=await imageFromClipboard(page,imagePath);
    record.stage="image_uploaded";
    record.imageUrl=imageUrl;
    const fullHtml=composeHtml(article,imageUrl);
    await replaceWithHtml(page,fullHtml);
    record.stage="html_completed";
    // Strictly Save; never match Publish/발행/게시.
    const save=await clickFirst(page,[
      page.getByRole("button",{name:/^(Save|저장)$/i})
    ],"초안 저장");
    const text=(await save.innerText()).trim();
    if(publicationPattern.test(text))throw Error("게시 버튼과 혼동된 저장 버튼. 동작 중지.");
    await page.waitForTimeout(1800);
    record.stage="save_clicked";
    const editor=new URL(page.url());
    if(!/^\/blog\/post\/edit\/\d+\/\d+$/.test(editor.pathname)||
       !editor.pathname.includes("/"+id+"/"))
       throw Error("저장 후 임시글 고유 ID를 확인하지 못했어.");
    record.editorUrl=page.url();
    // Edit page can prove draft state if explicit status label appears.
    const draftStatus=page.getByText(/^(Draft|임시글|임시 저장됨|임시 저장)$/i);
    if(await draftStatus.count()<1)
      throw Error("저장 버튼은 실행됐지만 '임시글' 상태를 확인하지 못했어. 게시 여부를 수동 확인해줘.");
    record.verified=true;
    record.stage="draft_verified";
    return record;
  }catch(error){
    error.partialRecord={...record,verified:false};
    throw error;
  }
}
async function runChromium(job,article,imagePath,env=process.env){
  const {chromium}=require("playwright");
  const profile=path.resolve(".local/draft-studio-profile");
  await fs.mkdir(profile,{recursive:true,mode:0o700});
  const context=await chromium.launchPersistentContext(profile,{
    headless:false,viewport:{width:1400,height:900},locale:"ko-KR",
    permissions:["clipboard-read","clipboard-write"]
  });
  try{
    const page=context.pages()[0]||await context.newPage();
    return await draftOnly(page,job,article,imagePath,env);
  }finally{await context.close();}
}
async function loginChromium(blog,env=process.env){
  if(!BLOGS[blog])throw Error("Unknown blog");
  const id=blogId({blog},env);
  const {chromium}=require("playwright");
  const profile=path.resolve(".local/draft-studio-profile");
  await fs.mkdir(profile,{recursive:true,mode:0o700});
  const context=await chromium.launchPersistentContext(profile,{headless:false,viewport:{width:1400,height:900}});
  const page=context.pages()[0]||await context.newPage();
  await page.goto("https://www.blogger.com/blog/posts/"+id,{waitUntil:"domcontentloaded",timeout:35000});
  console.log("열린 Chromium 창에서 본인 Google 계정으로 Blogger에 로그인해줘.");
  console.log("로그인이 끝난 뒤 이 터미널에서 Enter를 누르면 프로필을 보존하고 종료해.");
  await new Promise(resolve=>process.stdin.once("data",resolve));
  await context.close();
}
if(require.main===module&&process.argv[2]==="login"){
  loginChromium(process.argv[3]||"byeol").catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={editorUrl,requireOne,clickFirst,permalink,assignTitle,replaceWithHtml,imageFromClipboard,openNewEditor,draftOnly,runChromium,loginChromium};
