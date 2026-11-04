"use strict";
/**
 * Private Drive-for-desktop image queue processor (no Work needed per article).
 * Only adds one Blogger-hosted PNG to an existing, matching Blogger DRAFT.
 * Requires user's own logged-in Chromium (never uploads cookies to GitHub).
 *
 * Usage:
 *   node scripts/blogger_native_image_queue.cjs --queue "G:\My Drive\별셈소 ChatGPT 임시글 큐" --check
 *   node scripts/blogger_native_image_queue.cjs --queue "G:\My Drive\별셈소 ChatGPT 임시글 큐" --run
 */
const fs=require("node:fs/promises");
const path=require("node:path");
const {runChromium,assertJob}=require("./blogger_native_image_draft.cjs");
const MAX_PER_RUN=5;
const MAX_JOB_SIZE=180000;
const PREFIX="READY_IMAGE__";
const PNG_SUFFIX="-featured.png";
function validateQueueJob(value,fileName,env=process.env){
  if(!value||typeof value!=="object"||Array.isArray(value) ||
    value.version!==1 || value.task!=="blogger_native_image" ||
    value.blog!=="byeol" || value.mode!=="draft_only" || value.publish!==false)
      throw Error("Invalid draft-only Blogger image job");
  const slug=String(value.slug||"");
  const postId=String(value.postId||"");
  const blogId=String(value.blogId||"");
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
     !/^\d{8,24}$/.test(postId) ||
     !/^\d{8,24}$/.test(blogId) ||
     blogId!==String(env.BLOGGER_BYEOL_ID||"").trim())
      throw Error("Blogger blog, post ID or slug mismatch");
  const expectedName=PREFIX+slug+"__"+postId+".json";
  if(fileName!==expectedName)
    throw Error("Queued file name does not match embedded draft ID");
  const imageFileName=String(value.imageFileName||"");
  if(imageFileName!==slug+PNG_SUFFIX ||
     path.basename(imageFileName)!==imageFileName ||
     !String(value.imageFileId||"").trim())
    throw Error("Unexpected image filename or missing private Drive image ID");
  if(!/^[a-zA-Z0-9_-]{15,200}$/.test(String(value.imageFileId)))
    throw Error("Invalid Google Drive image ID");
  assertJob(value,env);
  return {job:value,imageFileName};
}
async function loadPending(queueDir,env=process.env){
  const entries=(await fs.readdir(queueDir,{withFileTypes:true}))
    .filter(x=>x.isFile() && x.name.startsWith(PREFIX) && x.name.endsWith(".json"))
    .map(x=>x.name).sort();
  const jobs=[];
  for(const fileName of entries.slice(0,MAX_PER_RUN)){
    const absolute=path.join(queueDir,fileName);
    const stat=await fs.stat(absolute);
    if(stat.size===0||stat.size>MAX_JOB_SIZE) {
      jobs.push({fileName,issue:"JSON is empty or too large",ready:false});
      continue;
    }
    try {
      const raw=await fs.readFile(absolute,"utf8");
      const value=JSON.parse(raw.replace(/^\uFEFF/,""));
      const parsed=validateQueueJob(value,fileName,env);
      const imagePath=path.join(queueDir,parsed.imageFileName);
      const imageStat=await fs.stat(imagePath).catch(()=>null);
      if(!imageStat||!imageStat.isFile()){
        jobs.push({fileName,issue:"PNG not yet synced",ready:false});continue;
      }
      if(imageStat.size<1000||imageStat.size>15*1024*1024) {
        jobs.push({fileName,issue:"PNG size invalid/incomplete",ready:false});continue;
      }
      jobs.push({fileName,absolute,imagePath,job:parsed.job,ready:true});
    }catch(e){
      jobs.push({fileName,issue:String(e.message||e).slice(0,140),ready:false});
    }
  }
  return {jobs,total:entries.length};
}
async function processQueue({queueDir,run=false,runner=runChromium,env=process.env,print=console.log}){
  if(!queueDir)throw Error("Google Drive for desktop queue folder is required");
  const dir=path.resolve(queueDir);
  const {jobs,total}=await loadPending(dir,env);
  if(!run) {
    print(JSON.stringify({mode:"check_only",total,ready:jobs.filter(x=>x.ready).length,
      pending:jobs.map(x=>({file:x.fileName,state:x.ready?"READY":x.issue}))}));
    return {total,checked:jobs.length,run:false};
  }
  if(!jobs.some(x=>x.ready)) {
    print("No ready image jobs. Missing or unsynced files will remain queued.");
    return {total,processed:0,run:true};
  }
  // Only one local queue worker at a time. Lock remains only on this PC (not Drive).
  const lockPath=path.resolve(".local/blogger-native-image-queue.lock");
  await fs.mkdir(path.dirname(lockPath),{recursive:true,mode:0o700});
  let lock;
  try{lock=await fs.open(lockPath,"wx",0o600);}
  catch(e){if(e.code==="EEXIST")throw Error("Another queue run is active or stale lock needs review");throw e;}
  let processed=0,failed=0;
  try {
    for (const item of jobs.filter(x=>x.ready)) {
      const {job,fileName,imagePath}=item;
      try{
        const outcome=await runner(job,imagePath,env);
        if(outcome.verified!==true||outcome.postId!==String(job.postId) ||
           outcome.stage!=="draft_image_verified")
          throw Error("Blogger draft image save/readback not verified");
        await fs.rename(item.absolute,path.join(dir,"DONE_IMAGE__"+fileName.slice(PREFIX.length)));
        print(JSON.stringify({status:"DONE",postId:job.postId,editorUrl:outcome.editorUrl}));
        processed++;
      }catch(e){
        failed++;
        // An upload may have succeeded while save/readback failed.
        // Do not automatically retry an ambiguous write.
        try{await fs.rename(item.absolute,path.join(dir,"REVIEW_IMAGE__"+fileName.slice(PREFIX.length)));}
        catch(renameError){print("Unable to rename failed queue entry: "+renameError.message);}
        print(JSON.stringify({status:"REVIEW",file:fileName,
          reason:String(e.message||e).slice(0,180),
          warning:"Do not retry until Blogger draft is checked manually"}));
      }
    }
  }finally{
    await lock.close();
    await fs.unlink(lockPath).catch(()=>{});
  }
  return {total,processed,failed,run:true};
}
function commandArgs(args){
  let queueDir="",run=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==="--queue"&&args[i+1])queueDir=args[++i];
    else if(args[i]==="--check")run=false;
    else if(args[i]==="--run")run=true;
    else throw Error("Usage: node scripts/blogger_native_image_queue.cjs --queue <Drive folder> [--check|--run]");
  }
  if(!queueDir)queueDir=process.env.BYEOL_DRIVE_QUEUE_DIR||"";
  return {queueDir,run};
}
if(require.main===module){
  Promise.resolve().then(()=>processQueue(commandArgs(process.argv.slice(2))))
    .then(result=>{if(result.failed)process.exitCode=1;})
    .catch(e=>{console.error("Queue stopped:",e.message);process.exitCode=1;});
}
module.exports={PREFIX,validateQueueJob,loadPending,processQueue,commandArgs};
