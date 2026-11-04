"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../integrations/drive-draft-bridge/Code.gs"), "utf8");
function article(changes={}) {
  return {
    version:1,blog:"byeol",publish:false,mode:"draft_only",
    title:"세탁기 탈수할 때 쿵쿵 소리가 난다면? 원인 확인",
    label:"생활정보",slug:"washing-machine-spin-noise-vibration-guide",
    description:"세탁기 탈수 시 반복되는 쿵쿵 소리와 흔들림의 원인을 빨랫감 쏠림, 설치 수평, 주변 물건 접촉으로 나누어 확인하는 순서를 정리했습니다.",
    alt:"세탁기가 흔들리는 원인을 설명하는 일러스트",
    imageUrl:"",
    html:"<h2>탈수 시 확인할 항목</h2>" + "<p>안전한 사용을 위해 정상 작동 여부를 확인하세요.</p>".repeat(40),
    ...changes,
  };
}
function harness(options={}) {
  const props = new Map([
    ["BLOG_ID","1659014803305858421"],
    ["INBOX_FOLDER_ID","1Xi-7jbr9epijmFHcdoUVnJoXOsRMzySC"],
  ]);
  const calls=[],log=[];
  const file={id:"doc-unique-1",name:"READY__washer",
    getId(){return this.id;},getName(){return this.name;},
    setName(name){this.name=name;}};
  const fake={
    ScriptApp:{getOAuthToken(){return "test-oauth-token";}},
    MimeType:{GOOGLE_DOCS:"docs"},
    PropertiesService:{getScriptProperties(){return {
      getProperty(k){return props.get(k)||null;},
      setProperty(k,v){props.set(k,v);},
      getProperties(){return Object.fromEntries(props);}
    };}},
    LockService:{getScriptLock(){return {tryLock(){return true;},releaseLock(){}};}},
    DriveApp:{getFolderById(){let sent=false;return {getFilesByType(){return {
      hasNext(){return !sent;},next(){sent=true;return file;}
    };}};}},
    DocumentApp:{openById(){return {getBody(){return {getText(){return JSON.stringify(options.article||article());}}}};}},
    UrlFetchApp:{fetch(url,params){
      calls.push({url,method:params.method,payload:params.payload});
      let data;
      if (options.authError || (options.httpError && params.method === "post")) return {
        getResponseCode(){return options.authError ? 403 : 502;},
        getContentText(){return options.authError ? '{"error":{"errors":[{"reason":"accessNotConfigured"}],"details":[{"reason":"SERVICE_DISABLED"}],"message":"private-diagnostic-must-not-log"}}' : '{"error":"timeout"}';}
      };
      if (/\/posts\?isDraft=true$/.test(url)){
        data={id:"99009",status:options.badCreateStatus||"DRAFT",title:(options.article||article()).title};
      } else if (/\/posts\/99009\?view=ADMIN$/.test(url)){
        data={id:"99009",status:"DRAFT",title:(options.article||article()).title};
      } else if (/\/posts\?/.test(url)){
        data={items: options.duplicate ? [{title:(options.article||article()).title}] : []};
      } else if (/\/blogs\/1659014803305858421\?view=ADMIN$/.test(url)){
        data={url:options.wrongBlog ? "https://other-blog.blogspot.com/" : "https://wic12.blogspot.com/"};
      } else {throw new Error("Unexpected URL: "+url);}
      return {getResponseCode(){return 200;},getContentText(){return JSON.stringify(data);}};
    }},
    console:{log(x){log.push(x);},error(x){log.push(x);}},
    Date,JSON,String,Object,Error,RegExp,encodeURIComponent,
  };
  vm.createContext(fake);vm.runInContext(source,fake,{filename:"Code.gs"});
  return {fake,props,calls,file,log};
}
test("validates strict draft-only scope and rejects risky HTML",()=>{
  const h=harness();
  assert.equal(h.fake.parseAndValidate_(JSON.stringify(article())).slug,"washing-machine-spin-noise-vibration-guide");
  assert.throws(()=>h.fake.parseAndValidate_(JSON.stringify(article({publish:true}))),/Wrong blog/);
  assert.throws(()=>h.fake.parseAndValidate_(JSON.stringify(article({blog:"nobody"}))),/Wrong blog/);
  assert.throws(()=>h.fake.parseAndValidate_(JSON.stringify(article({html:"<h2>x</h2><script>alert(1)</script>"+"hello".repeat(300)}))),/Disallowed/);
  assert.throws(()=>h.fake.parseAndValidate_(JSON.stringify(article({imageUrl:"https://example.com/a.png"}))),/host not allowed/);
});
test("creates only an explicitly draft post, verifies readback, records settings gap",()=>{
  const h=harness();h.fake.processDraftInbox();
  const writes=h.calls.filter(x=>x.method==="post");
  assert.equal(writes.length,1);
  assert.match(writes[0].url,/isDraft=true$/);
  const payload=JSON.parse(writes[0].payload);
  assert.equal(payload.title,article().title);
  assert.equal(payload.labels[0],"생활정보");
  assert.equal(payload.content,article().html);
  const state=JSON.parse(h.props.get("draft:doc-unique-1"));
  assert.equal(state.status,"DRAFT_SAVED_NEEDS_SETTINGS");
  assert.equal(state.needsBloggerPermalink,true);
  assert.equal(state.needsBloggerSearchDescription,true);
  assert.equal(state.needsImageUpload,true);
  assert.match(h.file.name,/^SAVED_NEEDS_SETTINGS__/);
  h.fake.processDraftInbox();
  assert.equal(h.calls.filter(x=>x.method==="post").length,1,"must not create duplicate");
  assert.equal(h.calls.filter(x=>x.url.endsWith("/publish")).length,0);
});
test("existing matching post stops before any draft creation",()=>{
  const h=harness({duplicate:true});h.fake.processDraftInbox();
  assert.equal(h.calls.filter(x=>x.method==="post").length,0);
  assert.match(h.file.name,/^REVIEW_DUPLICATE__/);
});
test("wrong blog stops before write",()=>{
  const h=harness({wrongBlog:true});
  assert.throws(()=>h.fake.processDraftInbox(),/not scoped/);
  assert.equal(h.calls.filter(x=>x.method==="post").length,0);
});
test("ambiguous Blogger insert error never causes an automatic second POST",()=>{
  const h=harness({httpError:true});
  h.fake.processDraftInbox();
  assert.equal(h.calls.filter(x=>x.method==="post").length,1);
  const state = JSON.parse(h.props.get("draft:doc-unique-1"));
  assert.equal(state.status,"NEEDS_MANUAL_REVIEW");
  assert.equal(state.attemptedWrite,true);
  h.fake.processDraftInbox();
  assert.equal(h.calls.filter(x=>x.method==="post").length,1);
});

test("Docs BOM is accepted without changing article content",()=>{
  const h=harness();
  const parsed=h.fake.parseAndValidate_("\uFEFF"+JSON.stringify(article()));
  assert.equal(parsed.html,article().html);
  assert.equal(parsed.title,article().title);
});
test("API denial reports reason codes without logging raw response",()=>{
  const h=harness({authError:true});
  assert.throws(()=>h.fake.processDraftInbox(),/HTTP 403 \(accessNotConfigured,SERVICE_DISABLED\)/);
  assert.equal(h.calls.filter(x=>x.method==="post").length,0);
  assert.equal(h.log.some(x=>x.includes("private-diagnostic")),false);
});
