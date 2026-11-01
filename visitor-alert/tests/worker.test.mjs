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
test("one Telegram alert per global five minutes, no IP or cookies stored",async()=>{
 const e=env();const sent=[];
 const old=globalThis.fetch;
 try{
   globalThis.fetch=async(url,options)=>{
     sent.push({url,body:JSON.parse(options.body)});
     return new Response(JSON.stringify({ok:true}),{status:200,headers:{"Content-Type":"application/json"}});
   };
   assert.equal((await app.fetch(browserReq(),e.bind)).status,204);
   assert.equal((await app.fetch(browserReq({data:{title:"두 번째 글",device:"desktop"}}),e.bind)).status,204);
   assert.equal(sent.length,1);
   assert.match(sent[0].body.text,/모바일/);
   assert.doesNotMatch(sent[0].body.text,/secret=|Cookie|IP 주소/);
   assert.deepEqual([...e.state.keys()],["lastAttemptAt"]);
   e.state.set("lastAttemptAt",Date.now()-301000);
   assert.equal((await app.fetch(browserReq({data:{device:"desktop"}}),e.bind)).status,204);
   assert.equal(sent.length,2);
   assert.match(sent[1].body.text,/PC/);
 }finally{globalThis.fetch=old;}
});
test("when Telegram fails, cooldown still prevents notification storms",async()=>{
 const e=env();const old=globalThis.fetch;let calls=0;
 try{
   globalThis.fetch=async()=>{calls++;return new Response("oops",{status:503})};
   assert.equal((await app.fetch(browserReq(),e.bind)).status,503);
   assert.equal((await app.fetch(browserReq(),e.bind)).status,204);
   assert.equal(calls,1);
 }finally{globalThis.fetch=old;}
});
test("invalid payload and missing secrets never contact Telegram",async()=>{
 const e=env();
 assert.equal((await app.fetch(browserReq(),{})).status,503);
 const req=new Request("https://visits.example.workers.dev/view",{method:"POST",headers:{"Origin":SITE,"Referer":SITE+"/","User-Agent":"Mozilla/5.0 Safari/605.1","Content-Type":"application/json"},body:"not json"});
 assert.equal((await app.fetch(req,e.bind)).status,400);
});
