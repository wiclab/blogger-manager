"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const {validateQueueJob,loadPending,processQueue}=require("../scripts/blogger_native_image_queue.cjs");
const env={BLOGGER_BYEOL_ID:"1659014803305858421"};
const slug="wifi-connected-no-internet-troubleshooting";
const postId="9098581934010072421";
const name="READY_IMAGE__"+slug+"__"+postId+".json";
const job={
 version:1,task:"blogger_native_image",blog:"byeol",mode:"draft_only",publish:false,
 blogId:env.BLOGGER_BYEOL_ID,postId,
 title:"와이파이 연결됐는데 인터넷이 안 된다면? 휴대폰과 공유기 점검",
 slug,description:"연결 오류를 해결하는 방법",alt:"인터넷이 연결되지 않는 공유기 일러스트",
 html:"<article><h2>문제 해결</h2><p>"+("와이파이 연결 상태를 점검합니다. ").repeat(80)+"</p></article>",
 imageFileId:"1eXZmZgDlTabh5ibXkQGp-Adh8y5gysLM",
 imageFileName:slug+"-featured.png",sourceDocId:"doc-ref-test"
};
const quiet=()=>{};
async function tempQueue(f){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"byeol-image-queue-"));
 try{return await f(root);}finally{await fs.rm(root,{recursive:true,force:true});}
}
async function fill(root,withImage=true){
 await fs.writeFile(path.join(root,name),JSON.stringify(job));
 if(withImage)await fs.writeFile(path.join(root,job.imageFileName),
   Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),Buffer.alloc(1100)]));
}
test("accepts only matching byeol draft-sidecar filename and exact image path",()=>{
 assert.equal(validateQueueJob(job,name,env).imageFileName,slug+"-featured.png");
 assert.throws(()=>validateQueueJob({...job,blog:"nobody"},name,env),/draft-only/);
 assert.throws(()=>validateQueueJob({...job,publish:true},name,env),/draft-only/);
 assert.throws(()=>validateQueueJob({...job,postId:"99"},name,env),/post ID/);
 assert.throws(()=>validateQueueJob({...job,blogId:"123456789"},name,env),/mismatch/);
 assert.throws(()=>validateQueueJob({...job,imageFileName:"../danger.png"},name,env),/image filename/);
 assert.throws(()=>validateQueueJob({...job,imageFileId:"x"},name,env),/image ID/);
 assert.throws(()=>validateQueueJob(job,"READY_IMAGE__other__"+postId+".json",env),/file name/);
 assert.throws(()=>validateQueueJob({...job,html:job.html+"<img src='x'>"},name,env),/image/);
});
test("dry-run is read only and missing PNG remains queued",async()=>{
 await tempQueue(async root=>{
  await fill(root,false);
  const messages=[],check=await processQueue({queueDir:root,run:false,env,print:x=>messages.push(x)});
  assert.equal(check.run,false);
  assert.equal(check.total,1);
  assert.match(messages[0],/PNG not yet synced/);
  const after=await fs.readdir(root);
  assert.ok(after.includes(name));
 });
});
test("on-demand verified image marks exactly existing job done",async()=>{
 await tempQueue(async root=>{
  await fill(root,true);
  const calls=[];
  const outcome=await processQueue({queueDir:root,run:true,env,print:quiet,
    runner:async(j,imagePath)=>{
      calls.push({j,imagePath});
      return {verified:true,stage:"draft_image_verified",postId:j.postId,
        editorUrl:"https://www.blogger.com/blog/post/edit/"+j.blogId+"/"+j.postId};
    }});
  assert.equal(outcome.processed,1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].j.title,job.title);
  const files=await fs.readdir(root);
  assert.ok(files.includes(name.replace("READY_IMAGE__","DONE_IMAGE__")));
  assert.ok(!files.includes(name));
  const second=await processQueue({queueDir:root,run:true,env,print:quiet,runner:async()=>{
    throw Error("not expected");
  }});
  assert.equal(second.processed,0);
 });
});
test("uncertain browser save is REVIEW and never retried automatically",async()=>{
 await tempQueue(async root=>{
  await fill(root,true);
  let calls=0;
  const one=await processQueue({queueDir:root,run:true,env,print:quiet,runner:async()=>{
    calls++;throw Error("Blogger save timeout");
  }});
  assert.equal(one.failed,1);
  assert.equal(calls,1);
  const files=await fs.readdir(root);
  assert.ok(files.includes(name.replace("READY_IMAGE__","REVIEW_IMAGE__")));
  const two=await processQueue({queueDir:root,run:true,env,print:quiet,runner:async()=>{
    calls++;return {verified:true};
  }});
  assert.equal(two.processed,0);
  assert.equal(calls,1);
 });
});
