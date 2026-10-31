import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../src/index.js";

globalThis.crypto ||= webcrypto;
const origin="https://wiclab.github.io";
const base="https://byeolsemso-image-worker.example.workers.dev";
const env={
  GOOGLE_CLIENT_ID:"test-google-client.apps.googleusercontent.com",
  ALLOWED_GOOGLE_EMAIL:"owner@gmail.com",
  ALLOWED_ORIGIN:origin,
  IMAGES:{
    store:new Map(),
    async put(key,bytes,options){this.store.set(key,{data:new Uint8Array(bytes),contentType:options.httpMetadata.contentType});},
    async get(key){const data=this.store.get(key);return data?{body:data.data,httpMetadata:{contentType:data.contentType}}:null;},
    async head(key){const data=this.store.get(key);return data?{httpMetadata:{contentType:data.contentType}}:null;}
  }
};
const keys=await webcrypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]);
const publicJwk={...(await webcrypto.subtle.exportKey("jwk",keys.publicKey)),kid:"dev-test-key",alg:"RS256"};
const realFetch=globalThis.fetch;
globalThis.fetch=async url=>{
  if(String(url).includes("oauth2/v3/certs"))return new Response(JSON.stringify({keys:[publicJwk]}),{headers:{"Cache-Control":"max-age=600"}});
  return realFetch(url);
};
const b64=s=>Buffer.from(typeof s==="string"?s:Buffer.from(s)).toString("base64url");
async function jwt(overrides={}){
  const now=Math.floor(Date.now()/1000);
  const header=b64(JSON.stringify({alg:"RS256",kid:"dev-test-key"}));
  const payload=b64(JSON.stringify({iss:"https://accounts.google.com",aud:env.GOOGLE_CLIENT_ID,sub:"user-001",
    exp:now+3600,iat:now,email:"owner@gmail.com",email_verified:true,...overrides}));
  const signature=new Uint8Array(await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5",keys.privateKey,new TextEncoder().encode(header+"."+payload)));
  return header+"."+payload+"."+b64(signature);
}
const img=new Uint8Array(40);img.set([137,80,78,71,13,10,26,10],0);
function request(method,path,{token,body,origin:requestOrigin=origin,mime="image/png"}={}){
 const headers={Origin:requestOrigin};
 if(token)headers.Authorization="Bearer "+token;
 if(body)headers["Content-Type"]=mime;
 return new Request(base+path,{method,headers,...(body?{body}:{})});
}
test("health status reports binding readiness",async()=>{
 const res=await worker.fetch(request("GET","/api/health"),env);
 assert.equal(res.status,200);
 assert.equal((await res.json()).status,"configured");
});
test("disallowed origin is rejected on preflight and upload",async()=>{
 const res=await worker.fetch(request("OPTIONS","/api/upload",{origin:"https://evil.example"}),env);
 assert.equal(res.status,403);
});
test("unauthenticated upload is rejected",async()=>{
 const res=await worker.fetch(request("POST","/api/upload",{body:img}),env);
 assert.equal(res.status,401);
});
test("signed token with wrong audience or email is rejected",async()=>{
 for(const attrs of [{aud:"wrong"},{email:"attacker@gmail.com"},{exp:1}]){
  const res=await worker.fetch(request("POST","/api/upload",{token:await jwt(attrs),body:img}),env);
  assert.equal(res.status,401);
 }
});
test("valid token can upload an image and public URL serves it",async()=>{
 const response=await worker.fetch(request("POST","/api/upload",{token:await jwt(),body:img}),env);
 assert.equal(response.status,201);
 assert.equal(response.headers.get("Access-Control-Allow-Origin"),origin);
 const data=await response.json();
 assert.match(data.url,/\/images\/20\d{2}\/\d{2}\/[0-9a-f-]{36}\.png$/);
 const get=await worker.fetch(new Request(data.url),env);
 assert.equal(get.status,200);
 assert.equal(get.headers.get("Content-Type"),"image/png");
 assert.equal(get.headers.get("Cache-Control"),"public, max-age=31536000, immutable");
 const head=await worker.fetch(new Request(data.url,{method:"HEAD"}),env);
 assert.equal(head.status,200);
 assert.equal((await get.arrayBuffer()).byteLength,img.byteLength);
});
test("rejects forged file format and missing image URLs",async()=>{
 const res=await worker.fetch(request("POST","/api/upload",{token:await jwt(),body:img,mime:"image/webp"}),env);
 assert.equal(res.status,415);
 const missing=await worker.fetch(new Request(base+"/images/2026/10/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png"),env);
 assert.equal(missing.status,404);
});
test("rejects oversize request before storing",async()=>{
 const big=new Uint8Array(5*1024*1024+1);big.set([137,80,78,71,13,10,26,10]);
 const res=await worker.fetch(request("POST","/api/upload",{token:await jwt(),body:big}),env);
 assert.equal(res.status,413);
});
