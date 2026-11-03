"use strict";
/* Validate draft-only jobs. No WordPress, no external image hosts, no publishing. */
const BLOGS=Object.freeze({
  byeol:{label:"별셈소",site:"https://wic12.blogspot.com/",env:"BLOGGER_BYEOL_ID",lang:"ko"},
  nobody:{label:"Nobody Asked Data",site:"https://qevnaxori.blogspot.com/",env:"BLOGGER_NOBODY_ID",lang:"en"}
});
function cleanText(value,limit=300){
  return String(value||"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,limit);
}
function xmlEscape(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function parseJob(input){
  if(!input||typeof input!=="object"||Array.isArray(input))throw Error("올바른 글쓰기 요청이 아니야.");
  const blog=String(input.blog||"");
  if(!BLOGS[blog])throw Error("블로그는 byeol 또는 nobody만 선택할 수 있어.");
  const topic=cleanText(input.topic,200);
  if(topic.length<4)throw Error("글 주제를 네 글자 이상 적어줘.");
  if(String(input.notes||"").length>12000)throw Error("참고 메모는 12,000자 이하로 적어줘.");
  const notes=String(input.notes||"").trim();
  const label=cleanText(input.label,50);
  if(!label||/[<>]/.test(label))throw Error("블로그에서 사용할 라벨 하나를 입력해줘.");
  if(input.publish||input.isPublished||input.mode==="publish")throw Error("이 도구는 게시를 지원하지 않아.");
  return {blog,topic,notes,label,mode:"draft_only"};
}
function validateArticle(value,job){
  if(!value||typeof value!=="object")throw Error("생성된 원고 형식이 잘못됐어.");
  const title=cleanText(value.title,120);
  const slug=cleanText(value.slug,90).replace(/\.html$/i,"");
  const description=cleanText(value.description,180);
  const alt=cleanText(value.alt,160);
  const imagePrompt=cleanText(value.image_prompt,1200);
  const body=String(value.html||"").trim();
  if(title.length<8)throw Error("원고에 제목이 없어.");
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>70)
    throw Error("퍼머링크는 소문자 영문, 숫자, 하이픈만 사용해야 해.");
  if(description.length<60||description.length>165)
    throw Error("검색 설명이 60~165자 범위를 벗어났어.");
  if(!alt||alt.length<8)throw Error("대표이미지 ALT가 누락됐어.");
  if(!imagePrompt||imagePrompt.length<25)throw Error("일러스트 생성 프롬프트가 부족해.");
  if(body.length<1300)throw Error("본문이 너무 짧아. 자동 임시저장하지 않아.");
  if(/<\s*(?:h1|script|iframe|object|embed|form)\b/i.test(body)||
     /on(?:error|load|click|mouseover)\s*=/i.test(body)||
     /(?:javascript:|data:image|srcdoc=)/i.test(body))
    throw Error("본문에 허용하지 않는 HTML 또는 실행 코드가 있어.");
  if(!/<h2\b/i.test(body))throw Error("본문에 H2 소제목이 없어.");
  if(/https?:\/\/(?:www\.)?(?:example\.com|example\.org)/i.test(body))
    throw Error("예시 URL이 포함돼 있어. 확인 전 저장하지 않아.");
  return {title,slug,description,alt,imagePrompt,html:body,label:job.label,blog:job.blog};
}
function composeHtml(article,imageUrl){
  const url=String(imageUrl||"");
  const parsed=new URL(url);
  if(parsed.protocol!=="https:"||!parsed.hostname.endsWith(".googleusercontent.com")||
     !/^https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com\//i.test(url)){
    throw Error("Blogger에 업로드된 googleusercontent 이미지 주소를 확인하지 못했어.");
  }
  const image='<div class="separator" style="clear:both;text-align:center;margin:0 0 22px">'+
    '<img alt="'+xmlEscape(article.alt)+'" loading="eager" decoding="async" '+
    'style="display:block;max-width:100%;height:auto;margin:auto" src="'+xmlEscape(url)+'"/></div>';
  return image+"\n"+article.html;
}
function blogId(job,env=process.env){
  const id=String(env[BLOGS[job.blog].env]||"").trim();
  if(!/^\d{8,24}$/.test(id))throw Error(BLOGS[job.blog].env+" 환경변수에 본인 Blogger 블로그 ID를 설정해야 해.");
  return id;
}
module.exports={BLOGS,parseJob,validateArticle,composeHtml,blogId,xmlEscape,cleanText};
