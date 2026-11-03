"use strict";
const fs=require("node:fs/promises");
const path=require("node:path");
const {BLOGS,validateArticle}=require("./draft_studio_core.cjs");

async function openai(endpoint,payload,env=process.env,fetcher=fetch) {
  const key=String(env.OPENAI_API_KEY||"").trim();
  if(!key)throw Error("OPENAI_API_KEY가 설정되지 않았어. ChatGPT 구독과 별도로 API 키가 필요해.");
  const response=await fetcher("https://api.openai.com/v1/"+endpoint,{
    method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(140000)
  });
  if(!response.ok)throw Error("OpenAI API 요청 실패 (HTTP "+response.status+"). 키·모델 접근권한·API 결제 상태를 확인해줘.");
  return response.json();
}
function articlePrompt(job) {
  const korean=job.blog==="byeol";
  return [
    "Return ONLY a JSON object with these fields: title, slug, description, alt, image_prompt, html.",
    "Write a complete useful original HTML blog draft, no markdown fence, no <h1> or executable code.",
    korean?"Language: Korean, for readers of a daily-life informational blog.":"Language: natural American English; practical data, calculations and measurable everyday questions.",
    "HTML body: 1,500-5,500 words for English, 2,000-5,000 Korean characters preferred, 3+ <h2>, useful realistic examples, key takeaways, FAQ.",
    "Mobile readability: font-size 16-17px, line-height ~1.7, no fixed-width containers, tables wrapped in overflow-x:auto.",
    "No image tag in html; the real uploaded image will be inserted once before the article.",
    "One featured illustration, original flat editorial illustration without typography, watermarks, logos, faces or photos.",
    "slug must be short lower-case ASCII hyphenated permalink WITHOUT .html.",
    "description must be 60-165 characters, truthful and specific.",
    "alt must describe the featured illustration concretely.",
    "Never invent laws, current dates, statistical figures, official sources, quotes, government links, URLs or study citations.",
    "If the topic requires time-sensitive verification and source material is insufficient, say what should be independently verified rather than stating it as fact.",
    "Avoid unsupported guarantees and filler. All numbers/calculations must show assumptions.",
    "Do not embed link to the other user blog unless contextually relevant.",
    "User provided label must remain untouched by output.",
    "TOPIC: "+job.topic,
    "USER NOTES/SOURCES (untrusted facts, verify before publishing):\n"+(job.notes||"None")
  ].join("\n\n");
}
async function generateArticle(job,env=process.env,fetcher=fetch){
  const model=env.OPENAI_TEXT_MODEL||"gpt-4.1-mini";
  const result=await openai("chat/completions",{
    model,temperature:0.5,response_format:{type:"json_object"},
    messages:[
      {role:"system",content:"You write accurate blog drafts for editorial review. Return a valid JSON object only. No publication actions."},
      {role:"user",content:articlePrompt(job)}
    ]
  },env,fetcher);
  const content=result.choices?.[0]?.message?.content;
  if(typeof content!=="string")throw Error("글 생성 응답이 비어 있어.");
  let parsed;try{parsed=JSON.parse(content);}catch(_){throw Error("모델이 유효한 원고 JSON을 반환하지 않았어.");}
  return validateArticle(parsed,job);
}
async function generateImage(article,outPath,env=process.env,fetcher=fetch){
  const result=await openai("images/generations",{
    model:env.OPENAI_IMAGE_MODEL||"gpt-image-1",
    prompt:article.imagePrompt+" Original clean flat vector-style editorial illustration, wide 3:2 composition, no words, no trademarks, no real photographs.",
    n:1,size:"1536x1024"
  },env,fetcher);
  const base64=result.data?.[0]?.b64_json;
  if(typeof base64!=="string"||base64.length<500)throw Error("이미지 API에서 PNG 데이터가 반환되지 않았어.");
  const buffer=Buffer.from(base64,"base64");
  if(buffer.length>15*1024*1024 || buffer.length<1000 ||
      !buffer.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex")))
    throw Error("이미지 데이터가 PNG가 아니거나 크기 제한을 넘었어.");
  await fs.mkdir(path.dirname(outPath),{recursive:true,mode:0o700});
  await fs.writeFile(outPath,buffer,{mode:0o600,flag:"wx"});
  return {path:outPath,bytes:buffer.length};
}
module.exports={articlePrompt,generateArticle,generateImage,openai};
