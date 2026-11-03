"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const core=require("../scripts/draft_studio_core.cjs");
const gen=require("../scripts/draft_studio_generate.cjs");
const runner=require("../scripts/draft_studio_blogger.cjs");
const server=require("../scripts/draft_studio_server.cjs");
const html=fs.readFileSync(path.resolve(__dirname,"../draft-studio.html"),"utf8");
const makeJob=()=>core.parseJob({blog:"byeol",topic:"휴대폰을 바꾸기 전 확인할 체크리스트",label:"생활정보",notes:""});
const goodArticle=()=>({
 title:"휴대폰 변경 전에 확인할 필수 점검 목록",
 slug:"phone-change-essential-checklist",
 description:"휴대폰을 교체할 때 사진, 연락처, 로그인 계정, 인증 수단과 금융 앱을 안전하게 이전하는 순서를 자세히 정리했습니다. 놓치기 쉬운 항목을 점검표와 함께 안내합니다.",
 alt:"휴대폰과 체크리스트를 보여주는 깔끔한 파란색 일러스트",
 image_prompt:"A calm editorial flat vector illustration showing smartphone and a checklist on a light desk, warm accents, no text",
 html:"<h2>먼저 확인할 것</h2><p>"+("휴대폰을 바꾸기 전에 연락처와 사진 백업을 확인합니다. ").repeat(80)+"</p>"
});
test("draft-only jobs restrict exactly two user blogs and require one label",()=>{
 const j=makeJob(); assert.equal(j.blog,"byeol");assert.equal(j.mode,"draft_only");
 assert.throws(()=>core.parseJob({blog:"ggpong",topic:"a long real topic",label:"a"}));
 assert.throws(()=>core.parseJob({blog:"byeol",topic:"a long real topic",label:""}));
 assert.throws(()=>core.parseJob({blog:"byeol",topic:"a long real topic",label:"생활정보",publish:true}));
 assert.throws(()=>core.parseJob({blog:"byeol",topic:"a long real topic",label:"생활정보",mode:"publish"}));
});
test("exact blog IDs required, never infer target from name",()=>{
 const job=makeJob();
 assert.throws(()=>core.blogId(job,{}),/BLOGGER_BYEOL_ID/);
 assert.equal(core.blogId(job,{BLOGGER_BYEOL_ID:"1659014803305858421"}),"1659014803305858421");
 assert.throws(()=>core.blogId({blog:"nobody"},{BLOGGER_BYEOL_ID:"1659014803305858421"}),/BLOGGER_NOBODY_ID/);
});
test("full article verifies permalink, metadata, ALT, HTML safety",()=>{
 const j=makeJob();
 const a=core.validateArticle(goodArticle(),j);
 assert.equal(a.slug,"phone-change-essential-checklist");
 assert.equal(a.label,"생활정보");
 assert.match(core.composeHtml(a,"https://blogger.googleusercontent.com/img/b/test"),/alt="휴대폰과 체크리스트/);
 assert.throws(()=>core.composeHtml(a,"https://attacker.example/image.png"),/Blogger/);
 assert.throws(()=>core.composeHtml(a,"https://googleusercontent.com.evil/image.png"),/Blogger/);
 const wrong=goodArticle();wrong.slug="../danger";
 assert.throws(()=>core.validateArticle(wrong,j),/퍼머링크/);
 wrong.slug="phone-checklist";wrong.html="<h2>Hi</h2><script>alert(1)</script>"+goodArticle().html;
 assert.throws(()=>core.validateArticle(wrong,j),/HTML/);
});
test("editor URL and browser script never provide publishing endpoint",()=>{
 assert.equal(runner.editorUrl("123456789"),"https://www.blogger.com/blog/post/edit/123456789");
 const code=fs.readFileSync(path.resolve(__dirname,"../scripts/draft_studio_blogger.cjs"),"utf8");
 assert.doesNotMatch(code,/\+['"]\/publish['"]|\.click\(\s*['"]Publish|method:\s*['"]DELETE/i);
 assert.match(code,/publicationPattern/);
 assert.match(code,/draft_verified/);
 assert.doesNotMatch(code,/page\.getByRole\(["']button["'],\s*{name:\/Publish/);
});
test("server is bound to localhost with strict Origin/Host checks",()=>{
 assert.equal(server.sameOrigin({method:"POST",headers:{host:"127.0.0.1:8765",origin:"http://127.0.0.1:8765"}}),true);
 assert.equal(server.sameOrigin({method:"POST",headers:{host:"evil.test:8765",origin:"http://127.0.0.1:8765"}}),false);
 assert.equal(server.sameOrigin({method:"POST",headers:{host:"127.0.0.1:8765",origin:"https://evil.test"}}),false);
 assert.equal(server.sameOrigin({method:"POST",headers:{host:"127.0.0.1:8765"}}),false);
 assert.equal(server.allowedPath("/draft-studio.html"),true);
 assert.equal(server.allowedPath("/.local/draft-studio-profile/Default/Cookies"),false);
});
test("AI generation uses server-side key and validates structured output",async()=>{
 const calls=[];
 const fake=async(url,options)=>{
  calls.push({url,headers:options.headers,body:JSON.parse(options.body)});
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(goodArticle())}}]})};
 };
 const j=makeJob();
 const article=await gen.generateArticle(j,{OPENAI_API_KEY:"FAKE-UNIT-KEY",OPENAI_TEXT_MODEL:"mock-text"},fake);
 assert.equal(article.blog,"byeol");
 assert.equal(calls.length,1);
 assert.equal(calls[0].body.model,"mock-text");
 assert.match(calls[0].headers.Authorization,/Bearer FAKE-UNIT-KEY/);
 assert.doesNotMatch(html,/OPENAI_API_KEY\s*[:=]\s*['"][A-Za-z0-9]/);
 assert.throws(()=>core.composeHtml(article,"https://cdn.example.com/x.png"));
});
test("CMS static page uses local bridge; no public save or publish action",()=>{
 assert.match(html,/http:\/\/127\.0\.0\.1:8765/);
 assert.match(html,/\/api\/drafts/);
 assert.match(html,/draft-form/);
 assert.doesNotMatch(html,/\/publish['"]/);
 assert.match(html,/임시글/);
 assert.match(fs.readFileSync(path.resolve(__dirname,"../assets/cms-shell.js"),"utf8"),/draft-studio\.html/);
});
