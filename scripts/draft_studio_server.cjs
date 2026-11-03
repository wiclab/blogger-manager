"use strict";
/* Localhost-only backend. Credentials NEVER travel to GitHub Pages or Actions. */
const http=require("node:http");
const fs=require("node:fs");
const fsp=require("node:fs/promises");
const path=require("node:path");
const crypto=require("node:crypto");
const {parseJob,blogId}=require("./draft_studio_core.cjs");
const {generateArticle,generateImage}=require("./draft_studio_generate.cjs");
const {runChromium}=require("./draft_studio_blogger.cjs");

const PORT=Number(process.env.DRAFT_STUDIO_PORT||8765);
const HOST="127.0.0.1";
const ORIGIN="http://"+HOST+":"+PORT;
const ROOT=path.resolve(__dirname,"..");
const WORKDIR=path.join(ROOT,".local","draft-studio-jobs");
const JOBS=new Map();
let activeJob=null;
function allowedPath(url){
  return ["/draft-studio.html","/assets/cms-shell.js","/assets/cms-shell.css",
    "/assets/manager-header.css"].includes(url);
}
function send(res,status,obj){
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
    "Content-Security-Policy":"default-src 'none'","Referrer-Policy":"no-referrer"});
  res.end(JSON.stringify(obj));
}
function sameOrigin(req) {
  return req.headers.host===HOST+":"+PORT &&
    (req.method==="GET"||req.headers.origin===ORIGIN) &&
    (req.method==="GET"||req.headers["sec-fetch-site"]===undefined||
     req.headers["sec-fetch-site"]==="same-origin");
}
async function readBody(req) {
  let size=0,chunks=[];
  for await(const chunk of req){
    size+=chunk.length;
    if(size>16000)throw Error("입력은 최대 16KB");
    chunks.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
  catch(_){throw Error("요청 JSON 형식이 잘못됐어.");}
}
function report(job){
  return {id:job.id,status:job.status,stage:job.stage,updatedAt:job.updatedAt,
    error:job.error||null,article:job.article?{
      title:job.article.title,slug:job.article.slug,
      description:job.article.description,label:job.article.label,
      alt:job.article.alt,html:job.article.html
    }:null,hasImage:!!job.imagePath,blogger:job.blogger||null,
    note:"Blogger 편집기에서 임시글 status 확인 전에는 완료로 표시하지 않음"};
}
async function processJob(job) {
  const mark=(stage,status="running")=>{
    job.stage=stage;job.status=status;job.updatedAt=new Date().toISOString();
  };
  try{
    mark("원고 생성 중");
    job.article=await generateArticle(job.request);
    mark("대표이미지 생성 중");
    const file=path.join(WORKDIR,job.id,"featured.png");
    await generateImage(job.article,file);
    job.imagePath=file;
    // Persist the generated draft package before opening a potentially flaky Blogger editor.
    await fsp.writeFile(path.join(WORKDIR,job.id,"draft.json"),
      JSON.stringify({request:job.request,article:job.article,createdAt:job.updatedAt},null,2),
      {mode:0o600,flag:"wx"});
    mark("Chromium Blogger 이미지 업로드 및 초안 저장 중");
    job.blogger=await runChromium(job.request,job.article,file);
    if(job.blogger?.stage!=="draft_verified"||job.blogger?.verified!==true)
      throw Error("Blogger의 초안 저장 완료를 확인하지 못했어.");
    mark("Blogger 임시글 저장 검증 완료","completed");
  }catch(e){
    job.error=String(e.message||e).slice(0,280);
    if(e.partialRecord)job.blogger=e.partialRecord;
    mark("중단: "+job.error,"failed");
    console.error("Draft studio job "+job.id+": "+job.error);
  }finally{activeJob=null;}
}
async function serve(req,res) {
  if(!sameOrigin(req)){send(res,403,{error:"Localhost origin check failed"});return;}
  const pathname=new URL(req.url,ORIGIN).pathname;
  if(req.method==="GET"&&(pathname==="/"||allowedPath(pathname))){
    const relative=pathname==="/"?"/draft-studio.html":pathname;
    const file=path.resolve(ROOT,"."+relative);
    if(!file.startsWith(ROOT+path.sep)){send(res,404,{error:"Not found"});return;}
    try{
      const body=await fsp.readFile(file);
      const type=file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html";
      res.writeHead(200,{"Content-Type":type+"; charset=utf-8",
        "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
        "Referrer-Policy":"no-referrer",
        "Content-Security-Policy":"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;"});
      res.end(body);
    }catch(_){send(res,404,{error:"File not found"});}return;
  }
  if(req.method==="GET"&&pathname==="/api/health"){
    send(res,200,{ready:true,localOnly:true,apiKeyConfigured:!!process.env.OPENAI_API_KEY,
      configuredBlogs:{byeol:!!process.env.BLOGGER_BYEOL_ID,nobody:!!process.env.BLOGGER_NOBODY_ID},
      busy:!!activeJob});return;
  }
  const jobRoute=pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/image)?$/);
  if(req.method==="GET"&&jobRoute){
    const job=JOBS.get(jobRoute[1]);
    if(!job){send(res,404,{error:"No such job"});return;}
    if(jobRoute[2]){
      if(!job.imagePath){send(res,404,{error:"Image not generated yet"});return;}
      const img=await fsp.readFile(job.imagePath);
      res.writeHead(200,{"Content-Type":"image/png","Cache-Control":"no-store",
        "X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'"});
      res.end(img);
    }else send(res,200,report(job));
    return;
  }
  if(req.method==="POST"&&pathname==="/api/drafts"){
    if(activeJob){send(res,409,{error:"다른 초안 작업이 진행 중이야. 중복 생성 방지를 위해 대기해줘."});return;}
    let input;
    try{
      if(!String(req.headers["content-type"]||"").startsWith("application/json"))
        throw Error("JSON 요청만 허용해.");
      input=parseJob(await readBody(req));
      blogId(input);
      if(!process.env.OPENAI_API_KEY)throw Error("서버의 OPENAI_API_KEY 설정이 필요해.");
    }catch(e){send(res,400,{error:String(e.message||e)});return;}
    const id=crypto.randomUUID(),job={id,request:input,status:"queued",
      stage:"대기 중",updatedAt:new Date().toISOString(),article:null,imagePath:null,error:null,blogger:null};
    await fsp.mkdir(path.join(WORKDIR,id),{recursive:true,mode:0o700});
    JOBS.set(id,job);activeJob=id;
    send(res,202,{id,status:"queued"});
    void processJob(job);
    return;
  }
  send(res,404,{error:"Not found"});
}
function start(){
  if(!Number.isInteger(PORT)||PORT<1024||PORT>65535)throw Error("Invalid DRAFT_STUDIO_PORT");
  http.createServer((req,res)=>{serve(req,res).catch(e=>{
    console.error("Draft studio request: "+String(e.message||e));
    if(!res.headersSent)send(res,500,{error:"로컬 서버 처리 오류"});else res.end();
  });}).listen(PORT,HOST,()=>{
    console.log("초안 자동 준비기: "+ORIGIN+"/");
    console.log("Blogger 초안만 저장하며 게시·삭제 기능은 제공하지 않아.");
  });
}
if(require.main===module)start();
module.exports={sameOrigin,readBody,report,allowedPath,serve,start};
