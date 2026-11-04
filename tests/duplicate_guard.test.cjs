"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const guard=require("../assets/duplicate-guard.js");
const W="https://wic12.blogspot.com/2026/10/",N="https://qevnaxori.blogspot.com/2026/10/";
const posts=[
  {title:"Annual vs. Monthly Subscriptions: When Is Yearly Worth It?",
   url:N+"annual-monthly-subscriptions.html",topicHints:{
    summary:"Monthly price annual payment break even month calculator and cancellation risks",
    headings:["Break Even Month","Annual vs Monthly Cost"]}},
  {title:"Streaming Subscription Rotation Calculator",url:N+"streaming-subscription-rotation.html",
   topicHints:{summary:"Calculate annual and monthly expenses from rotating streaming services",
     headings:["Monthly vs annual cost and break-even months"]}},
  {title:"Does Watching Videos at 1.5x Speed Save Time?",url:N+"video-speed.html",
   topicHints:{summary:"Compare 1x 1.5x 2x viewing times with a video playback speed calculator",
     headings:["How much time does 1.5x save?"]}},
  {title:"전기요금 누진제 계산 방법",url:W+"electric-bill.html",
   topicHints:{summary:"주택용 전기요금 산정 전력량 계산",headings:["누진 구간"]}}
];
test("same title is high risk, all scores bounded",()=>{
 const x=guard.compare(posts[0].title,"",posts);
 assert.equal(x.level,"high");
 assert.equal(x.best,100);
 assert.equal(x.matches[0].url,posts[0].url);
 assert(x.matches.every(m=>Number.isInteger(m.score)&&m.score>=0&&m.score<=100));
});
test("same topic wording in a different order is surfaced",()=>{
 const x=guard.compare("Monthly versus annual subscription costs: break even month",
   "monthly vs yearly fees annual plan calculator",posts);
 assert(x.matches.slice(0,2).some(m=>m.url===posts[0].url));
 assert(x.best>=45);
});
test("similar broad topic need not be labelled exact duplicate",()=>{
 const subset=[posts[1]];
 const x=guard.compare("Annual vs Monthly Subscriptions: How Many Months Make Annual Worth It?",
   "yearly pricing break even before cancellation",subset);
 assert(x.best<100);
 assert.notEqual(x.level,"high");
});
test("unrelated topics score low",()=>{
 const x=guard.compare("How to clean a cast iron skillet safely",
   "rust prevention cooking oil storage",posts);
 assert.equal(x.level,"low");
});
test("blog-specific inventory works and no cross-blog leaking",()=>{
 const x=guard.compare("전기요금 누진제 계산 방법","",posts.filter(p=>p.url.startsWith(W)));
 assert.equal(x.total,1);
 assert.equal(x.best,100);
});
test("missing inventory, short title or untrusted hosts fail closed",()=>{
 assert.throws(()=>guard.compare("good title","",[]),/기존 공개 글/);
 assert.throws(()=>guard.compare("hi","",posts),/5자/);
 assert.throws(()=>guard.compare("good title","",[{title:"good title",url:"javascript:alert(1)"}]),/유효한 기존 글/);
});
test("legacy scan inventory without context still reports a result",()=>{
 const x=guard.compare("Watching videos at 1.5x speed", "", [{title:posts[2].title,url:posts[2].url}]);
 assert.equal(x.hasContext,false);
 assert(x.best>30);
});
test("unicode and English term normalization",()=>{
 assert(guard.words("Annual subscriptions and monthly fees").has("subscription"));
 assert(guard.words("Annual subscriptions and monthly fees").has("year"));
 assert(guard.words("Videos at 1.5x speeds").has("video"));
});
