"use strict";
/* Optional handoff from a ChatGPT Work session that already has the generated
   image and source-verified article on its own computer. No re-generation cost. */
const fs=require("node:fs/promises");
const path=require("node:path");
const {parseJob,validateArticle}=require("./draft_studio_core.cjs");
const {runChromium}=require("./draft_studio_blogger.cjs");

async function importDraft(jsonPath,imagePath,env=process.env,runner=runChromium){
  const metadata=JSON.parse(await fs.readFile(jsonPath,"utf8"));
  const request=parseJob(metadata.request||{});
  const article=validateArticle(metadata.article||{},request);
  const file=path.resolve(imagePath);
  const png=await fs.readFile(file);
  if(png.length>15*1024*1024||png.length<1000||
    !png.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex")))
    throw Error("PNG 대표이미지가 없거나 이미지 형식/크기가 잘못됐어.");
  return runner(request,article,file,env);
}
if(require.main===module){
  if(process.argv.length!==4){
    console.error("Usage: node scripts/draft_studio_import.cjs package.json featured.png");
    process.exitCode=2;
  }else{
    importDraft(process.argv[2],process.argv[3])
      .then(r=>{console.log(r.verified?"Blogger 임시글 검증 완료: "+r.editorUrl:"검증 미완료");})
      .catch(e=>{console.error("임시글 자동 저장 중단: "+e.message);
        if(e.partialRecord?.editorUrl)console.error("부분 초안 확인 URL: "+e.partialRecord.editorUrl);
        process.exitCode=1;});
  }
}
module.exports={importDraft};
