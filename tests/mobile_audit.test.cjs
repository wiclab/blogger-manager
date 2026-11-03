"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const audit=require("../scripts/mobile_audit_scan.cjs");

test("only exact public article URLs are auditable",()=>{
 assert.equal(audit.safeArticle("https://wic12.blogspot.com/2026/11/foo.html","byeol"),true);
 assert.equal(audit.safeArticle("https://qevnaxori.blogspot.com/2026/11/foo.html","nobody"),true);
 for(const value of [
  "https://qevnaxori.blogspot.com/2026/11/foo.html",
  "https://wic12.blogspot.com.evil/2026/11/foo.html",
  "https://wic12.blogspot.com/search/label/news",
  "http://wic12.blogspot.com/2026/11/foo.html",
  "https://wic12.blogspot.com/2026/11/foo.html?m=1"
 ])assert.equal(audit.safeArticle(value,"byeol"),false,value);
});
test("screenshots are stable per page and viewport",()=>{
 const url="https://wic12.blogspot.com/2026/11/foo.html";
 const shot=audit.safeShot(url,320);
 assert.match(shot,/^screenshots\/[0-9a-f]{12}-320\.jpg$/);
 assert.equal(audit.safeShot(url,320),shot);
 assert.notEqual(audit.safeShot(url,360),shot);
});
test("severity and deduplication are deterministic",()=>{
 assert.deepEqual(audit.stateFor([],false),{state:"ok",severity:"none"});
 assert.deepEqual(audit.stateFor([],true),{state:"inconclusive",severity:"review"});
 assert.deepEqual(audit.stateFor([{type:"narrow_text",level:"high"}],false),
                  {state:"issue",severity:"high"});
 const x={type:"narrow_text",level:"high",width:320,selector:"p",detail:"narrow"};
 assert.equal(audit.filterIssues([x,x]).length,1);
});
test("third-party scripts and beacons cannot run",()=>{
 assert.equal(audit.allowResource("https://traffic.example.net/report","fetch","wic12.blogspot.com"),false);
 assert.equal(audit.allowResource("https://worker.workers.dev/visit","script","wic12.blogspot.com"),false);
 assert.equal(audit.allowResource("https://wic12.blogspot.com/my.js","script","wic12.blogspot.com"),true);
 assert.equal(audit.allowResource("https://blogger.googleusercontent.com/img.jpg","image","wic12.blogspot.com"),true);
 assert.equal(audit.allowResource("https://external.example/stylesheet.css","stylesheet","wic12.blogspot.com"),true);
});
