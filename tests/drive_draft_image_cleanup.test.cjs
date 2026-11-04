"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const script=fs.readFileSync(path.resolve(__dirname,"../integrations/drive-draft-bridge/Code.gs"),"utf8");
const sourceId="1MhpObRInSIgXfl-E1dnJf7RifqPCEr8ov98YE13M0Sc";
const postId="998877665544332211";
const blogId="1659014803305858421";
const title="와이파이는 연결됐는데 인터넷이 안 된다면? 휴대폰·공유기 원인 구별법";
const alt="와이파이는 연결됐으나 인터넷 사용이 안 되는 공유기와 휴대폰 일러스트";
const src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgTest123/w640-h360/wifi.png";
const original='<article style="max-width:740px;"><p>연결 상태를 확인합니다.</p>'+
  '<h2 style="border-bottom:2px solid #ddd;">Wi-Fi 첫 점검</h2>'+
  '<p>다른 기기로 비교하세요. <a href="https://support.google.com/android/answer/2651367">공식 안내</a></p>'+
  ('<p>공유기 전원과 케이블을 순서대로 점검하세요.</p>').repeat(40)+'</article>';
const withImage=original.replace('</article>',
  '<div class="separator" style="clear:both;text-align:center;">'+
  '<a href="'+src+'"><img border="0" width="1024" height="580" src="'+src+'" /></a></div></article>');
const article={
 version:1,blog:"byeol",publish:false,mode:"draft_only",title,label:"생활정보",
 slug:"wifi-connected-no-internet-troubleshooting",
 description:"와이파이는 연결되는데 인터넷 접속이 안 되는 상황에서 휴대폰과 공유기 연결 상태를 안전하게 점검하는 방법을 사례별로 정리했습니다.",
 alt,imageUrl:"",html:original
};
function build(o={}){
 const props=new Map([["BLOG_ID",blogId],["INBOX_FOLDER_ID","1Xi-7jbr9epijmFHcdoUVnJoXOsRMzySC"],
   ["draft:"+sourceId,JSON.stringify({status:"DRAFT_SAVED_NEEDS_SETTINGS",postId})]]);
 let content=o.content===undefined?withImage:o.content;
 let postStatus=o.status||"DRAFT";
 const sourceFile={
   getId(){return sourceId;},getName(){return "SAVED_NEEDS_SETTINGS__와이파이";},
   getParents(){let once=false;return {hasNext(){return !once;},next(){once=true;return {getId(){return "1Xi-7jbr9epijmFHcdoUVnJoXOsRMzySC";}};}};}
 };
 const req={version:1,action:"tidy_uploaded_blogger_image",blog:"byeol",
   publish:false,mode:"draft_only",sourceDocId:sourceId};
 const file={name:"READY_CLEANUP__"+sourceId,id:"request-1",
   getName(){return this.name;},setName(s){this.name=s;},getId(){return this.id;}};
 let writes=0;
 const calls=[];
 const folder={getFilesByType(){let once=false;return {hasNext(){return !once;},
   next(){once=true;return file;}};}};
 const scope={
  MimeType:{GOOGLE_DOCS:"docs"},
  DriveApp:{getFileById(id){assert.equal(id,sourceId);return sourceFile;}},
  DocumentApp:{openById(id){
    return {getBody(){return {getText(){
      return id===file.id?JSON.stringify(o.request||req):JSON.stringify(article);
    }};}};
  }},
  PropertiesService:{getScriptProperties(){return {getProperty:k=>props.get(k)||null,
     setProperty:(k,v)=>props.set(k,v)};}},
  UrlFetchApp:{fetch(url,options){
    calls.push({url,method:options.method,payload:options.payload});
    let res={};
    if(/\/posts\/998877665544332211/.test(url)){
      if(options.method==="patch"){
        writes++;
        if(o.patchError)return {getResponseCode(){return 503;},getContentText(){return '{"error":"timeout"}';}};
        content=JSON.parse(options.payload).content;
        if(o.afterPatchStatus)postStatus=o.afterPatchStatus;
      }
      res={id:postId,title:o.wrongTitle?"Wrong title":title,status:postStatus,content};
    } else throw Error("Unexpected URL:"+url);
    return {getResponseCode(){return 200;},getContentText(){return JSON.stringify(res);}};
  }},
  ScriptApp:{getOAuthToken(){return "fixture-oauth";}},
  console:{log(){},error(){}},Object,Date,JSON,String,Array,RegExp,Error,
  encodeURIComponent
 };
 vm.createContext(scope);
 vm.runInContext(script,scope,{filename:"Code.gs"});
 return {scope,folder,file,props,calls,getWrites:()=>writes,getContent:()=>content};
}
test("extract image, hoist to top, preserve all article text and links",()=>{
 const h=build();
 const tidy=h.scope.normalizeUploadedImageHtml_(withImage,alt,original);
 assert.match(tidy.html,/^<article[^>]*>\s*<div class="separator" data-byeol-featured="1"/);
 assert.equal((tidy.html.match(/<img\b/g)||[]).length,1);
 assert.match(tidy.html,/alt="와이파이는 연결됐으나/);
 assert.match(tidy.html,/max-width:100%/);
 assert.match(tidy.html,/https:\/\/support\.google\.com\/android/);
 assert.doesNotMatch(tidy.html,/width="1024"/);
 assert.equal(h.scope.imageFingerprint_(tidy.html),h.scope.imageFingerprint_(withImage));
 assert.equal(tidy.imageUrl,src);
});
test("opt-in request patches content only, verifies DRAFT and marks done once",()=>{
 const h=build();h.scope.processImageCleanupInbox_(h.folder,{folderId:"1Xi-7jbr9epijmFHcdoUVnJoXOsRMzySC",blogId});
 assert.equal(h.getWrites(),1);
 assert.equal(h.file.name,"DONE_CLEANUP__"+sourceId);
 assert.equal(JSON.parse(h.props.get("tidy:request-1")).status,"IMAGE_CLEANED");
 const writes=h.calls.filter(x=>x.method==="patch");
 assert.equal(writes.length,1);
 const payload=JSON.parse(writes[0].payload);
 assert.deepEqual(Object.keys(payload),["content"]);
 assert.equal(writes[0].url,"https://www.googleapis.com/blogger/v3/blogs/"+blogId+"/posts/"+postId);
 assert.doesNotMatch(h.calls.map(x=>x.url).join("\n"),/\/publish|\/revert|isDraft=true/);
 h.scope.processImageCleanupInbox_(h.folder,{folderId:"1Xi-7jbr9epijmFHcdoUVnJoXOsRMzySC",blogId});
 assert.equal(h.getWrites(),1,"one-shot request cannot patch twice");
});
test("no image, multiple images, published posts and wrong title: refuse write",()=>{
 const cases=[
   {content:original}, {content:withImage.replace("</article>",'<img src="'+src+'" /></article>')},
   {status:"LIVE"}, {wrongTitle:true},
   {content:withImage.replace(src,"https://example.com/danger.png")},
   {content:withImage.replace("다른 기기로 비교하세요","임의로 수정했습니다")},
 ];
 for(const opts of cases) {
   const h=build(opts);h.scope.processImageCleanupInbox_(h.folder,{folderId:"1Xi-7jbr9epijmFHcdoUVnJoXOsRMzySC",blogId});
   assert.equal(h.getWrites(),0,JSON.stringify(opts).slice(0,90));
   assert.equal(h.file.name,"REVIEW_CLEANUP__"+sourceId);
 }
});
test("ambiguous patch never auto-retries and persists review state",()=>{
 const h=build({patchError:true});
 h.scope.processImageCleanupInbox_(h.folder,{folderId:"1Xi-7jbr9epijmFHcdoUVnJoXOsRMzySC",blogId});
 assert.equal(h.getWrites(),1);
 assert.equal(h.file.name,"REVIEW_CLEANUP__"+sourceId);
 assert.equal(JSON.parse(h.props.get("tidy:request-1")).attemptedPatch,true);
 h.scope.processImageCleanupInbox_(h.folder,{folderId:"1Xi-7jbr9epijmFHcdoUVnJoXOsRMzySC",blogId});
 assert.equal(h.getWrites(),1);
});
test("cannot reuse another source request or wrong mode to edit draft",()=>{
 const h=build({request:{version:1,action:"tidy_uploaded_blogger_image",blog:"byeol",mode:"publish",publish:true,sourceDocId:sourceId}});
 h.scope.processImageCleanupInbox_(h.folder,{folderId:"1Xi-7jbr9epijmFHcdoUVnJoXOsRMzySC",blogId});
 assert.equal(h.getWrites(),0);
});
