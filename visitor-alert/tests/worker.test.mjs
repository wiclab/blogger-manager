import test from "node:test";
import assert from "node:assert/strict";
import app,{VisitAlertGate} from "../src/worker.js";

const SITE="https://wic12.blogspot.com";
const PAGE="/2026/11/sample-post.html";
function browserReq(overrides={}){
 return new Request("https://visits.example.workers.dev/view",{
   method:"POST",
   headers:{
    "Origin":SITE,
    "Referer":SITE+"/",
    "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0",
    "Content-Type":"application/json",
    ...overrides.headers
   },
   body:JSON.stringify({page:PAGE,title:"자동차세 안내",device:"mobile",...overrides.data})
 });
}
function env(){
 const state=new Map();
 const gate=new VisitAlertGate({storage:{get:async key=>state.get(key),put:async(key,value)=>{state.set(key,value)}}},
  {TELEGRAM_BOT_TOKEN:"example-secret-not-real",TELEGRAM_CHAT_ID:"123456"});
 return {state,bind:{TELEGRAM_BOT_TOKEN:"example-secret-not-real",TELEGRAM_CHAT_ID:"123456",
   GATE:{idFromName:name=>name,get:id=>({fetch:req=>gate.fetch(req)})}}};
}
test("health exposes no configuration or secrets",async()=>{
 const r=await app.fetch(new Request("https://visits.example.workers.dev/health"),{});
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{status:"ok",site:SITE});
});
test("CORS restricted to Byeolsemso",async()=>{
 const ok=await app.fetch(new Request("https://visits.example.workers.dev/view",{
   method:"OPTIONS",headers:{"Origin":SITE}}),{});
 assert.equal(ok.status,204);
 assert.equal(ok.headers.get("Access-Control-Allow-Origin"),SITE);
 const bad=await app.fetch(new Request("https://visits.example.workers.dev/view",{
   method:"OPTIONS",headers:{"Origin":"https://other.blogspot.com"}}),{});
 assert.equal(bad.status,403);
});
test("wrong origin, absent referer, or bot blocked",async()=>{
 const e=env();
 assert.equal((await app.fetch(browserReq({headers:{"Origin":"https://bad.example"}}),e.bind)).status,403);
 assert.equal((await app.fetch(browserReq({headers:{"Referer":"https://fake.example/"}}),e.bind)).status,403);
 assert.equal((await app.fetch(browserReq({headers:{"User-Agent":"Googlebot/2.1"}}),e.bind)).status,403);
});
test("rejects query-bearing path and unrecognized device",async()=>{
 const e=env();
 assert.equal((await app.fetch(browserReq({data:{page:PAGE+"?secret=1"}}),e.bind)).status,400);
 assert.equal((await app.fetch(browserReq({data:{device:"tablet"}}),e.bind)).status,400);
});
test("every individual open sends Telegram immediately, with a clean open-page button",async()=>{
 const e=env();const sent=[];const old=globalThis.fetch;
 try{
  globalThis.fetch=async(url,options)=>{
   sent.push({url,body:JSON.parse(options.body)});
   return new Response(JSON.stringify({ok:true}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  assert.equal((await app.fetch(browserReq(),e.bind)).status,204);
  assert.equal((await app.fetch(browserReq({data:{title:"두 번째 글",device:"desktop"}}),e.bind)).status,204);
  assert.equal((await app.fetch(browserReq(),e.bind)).status,204);
  assert.equal(sent.length,3,"no five minute cooldown");
  assert.match(sent[0].body.text,/모바일/);
  assert.match(sent[1].body.text,/PC/);
  assert.doesNotMatch(sent[0].body.text,/https?:\/\/|5분|Cookie|IP 주소/);
  assert.equal(sent[0].body.reply_markup.inline_keyboard[0][0].url,SITE+PAGE);
  assert.equal(sent[0].body.reply_markup.inline_keyboard[0][0].text,"📖 방문한 글 열기");
  assert.deepEqual([...e.state.keys()],["minuteWindow"]);
 }finally{globalThis.fetch=old;}
});
test("simultaneous separate opens each result in a notification",async()=>{
 const e=env();let count=0;const old=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{count++;return new Response('{"ok":true}',{status:200})};
  const responses=await Promise.all(Array.from({length:7},()=>app.fetch(browserReq(),e.bind)));
  assert.deepEqual(responses.map(x=>x.status),Array(7).fill(204));
  assert.equal(count,7);
 }finally{globalThis.fetch=old;}
});
test("Telegram failure allows another immediate attempt, not a 5 minute wait",async()=>{
 const e=env();const old=globalThis.fetch;let count=0;
 try{
  globalThis.fetch=async()=>{count++;return new Response("error",{status:503})};
  assert.equal((await app.fetch(browserReq(),e.bind)).status,503);
  assert.equal((await app.fetch(browserReq(),e.bind)).status,503);
  assert.equal(count,2);
 }finally{globalThis.fetch=old;}
});
test("large bot-like burst is capped globally at 60 attempts per minute without identity tracking",async()=>{
 const e=env();const old=globalThis.fetch;let count=0;
 try{
  globalThis.fetch=async()=>{count++;return new Response('{"ok":true}',{status:200})};
  let last;
  for(let i=0;i<61;i++)last=await app.fetch(browserReq(),e.bind);
  assert.equal(count,60);
  assert.equal(last.status,503); // frontend intentionally hides internal rate state
  assert.equal(e.state.get("minuteWindow").count,60);
 }finally{globalThis.fetch=old;}
});
test("invalid payload and missing secrets never contact Telegram",async()=>{
 const e=env();
 assert.equal((await app.fetch(browserReq(),{})).status,503);
 const req=new Request("https://visits.example.workers.dev/view",{method:"POST",headers:{"Origin":SITE,"Referer":SITE+"/","User-Agent":"Mozilla/5.0 Safari/605.1","Content-Type":"application/json"},body:"not json"});
 assert.equal((await app.fetch(req,e.bind)).status,400);
});

test("home, static pages, and label views remain allowed without exposing search text",async()=>{
 const e=env();const sent=[];const old=globalThis.fetch;
 try{
  globalThis.fetch=async(url,opts)=>{
   sent.push(JSON.parse(opts.body).text);
   return new Response(JSON.stringify({ok:true}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  assert.equal((await app.fetch(browserReq({data:{page:"/p/about.html",title:"소개"}}),e.bind)).status,204);
  assert.equal((await app.fetch(browserReq({data:{page:"/search",title:"사용자가 검색한 비공개 문장"}}),e.bind)).status,204);
  assert.equal(sent.length,2);
  assert.doesNotMatch(sent[1],/비공개 문장/);
  assert.match(sent[1],/별셈소 목록 페이지/);
  assert.equal((await app.fetch(browserReq({data:{page:"/search/label/%EA%B2%8C%EC%9E%84",title:"검색어"}}),e.bind)).status,204);
  assert.equal(sent.length,3);
 }finally{globalThis.fetch=old;}
});

test("Blogger XML template embed uses CDATA and valid JavaScript",async()=>{
 const {readFileSync}=await import("node:fs");
 const {Script}=await import("node:vm");
 const html=readFileSync(new URL("../blogger-embed.js",import.meta.url),"utf8");
 assert.match(html,/\/\/<!\[CDATA\[/);
 assert.match(html,/\/\/\]\]>/);
 const code=html.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1];
 assert.ok(code);
 assert.doesNotThrow(()=>new Script(code));
 assert.match(code,/credentials:"omit"/);
 assert.match(code,/displayTitle\(\)/);
 assert.doesNotMatch(code,/TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
});
