/* Private R2 bucket, public immutable /images/:key, authenticated upload endpoint */
const MAX_SIZE = 5 * 1024 * 1024;
const IMAGE_PATH = /^\/images\/(20\d\d\/(?:0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:webp|png|jpg))$/;
let cachedKeys, keysExpires = 0;
function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {status, headers: {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store", ...extra}});
}
function cors(origin) {
  return {"Access-Control-Allow-Origin":origin,"Vary":"Origin","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Max-Age":"600"};
}
function decode(s) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error("Invalid JWT part");
  return Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
}
async function signingKeys() {
  if (cachedKeys && Date.now() < keysExpires) return cachedKeys;
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!response.ok) throw new Error("Google signing keys unavailable");
  const data = await response.json();
  if (!Array.isArray(data.keys)) throw new Error("Invalid Google JWKS");
  cachedKeys=data.keys;
  const maxAge=/max-age=(\d+)/.exec(response.headers.get("Cache-Control") || "");
  keysExpires=Date.now()+Math.min(3600,Math.max(60,Number(maxAge?.[1]||300)))*1000;
  return cachedKeys;
}
async function verifyAdmin(bearer, env) {
  const m=/^Bearer ([A-Za-z0-9._-]+)$/.exec(bearer||"");
  if (!m||m[1].length>12000) throw new Error("Missing authorization");
  const parts=m[1].split(".");
  if(parts.length!==3) throw new Error("JWT format");
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const user=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  const now=Math.floor(Date.now()/1000);
  if(header.alg!=="RS256"||typeof header.kid!=="string"||!env.GOOGLE_CLIENT_ID||!env.ALLOWED_GOOGLE_EMAIL
    ||!["https://accounts.google.com","accounts.google.com"].includes(user.iss)
    ||user.aud!==env.GOOGLE_CLIENT_ID||Number(user.exp)<=now||!Number.isFinite(Number(user.exp))
    ||Number(user.iat)>now+60||!user.sub||!user.email
    ||String(user.email).toLowerCase()!==env.ALLOWED_GOOGLE_EMAIL.toLowerCase()
    ||![true,"true"].includes(user.email_verified)
    ||(env.ALLOWED_GOOGLE_SUB && env.ALLOWED_GOOGLE_SUB!==user.sub)) throw new Error("Google ID token claims mismatch");
  const jwk=(await signingKeys()).find(k=>k.kid===header.kid&&k.kty==="RSA"&&(!k.alg||k.alg==="RS256"));
  if(!jwk) throw new Error("Missing Google signing key");
  const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const verified=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,decode(parts[2]),new TextEncoder().encode(parts[0]+"."+parts[1]));
  if(!verified) throw new Error("Invalid Google ID token signature");
}
function sniff(bytes) {
  if(bytes.length>12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP") return ["webp","image/webp"];
  if(bytes.length>8&&[137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x)) return ["png","image/png"];
  if(bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255) return ["jpg","image/jpeg"];
  return null;
}
async function readBounded(request) {
  if(Number(request.headers.get("Content-Length")||0)>MAX_SIZE)return null;
  if(!request.body)return new Uint8Array(0);
  const reader=request.body.getReader(),parts=[];let total=0;
  while(true){
    const {value,done}=await reader.read();
    if(done)break;
    total+=value.byteLength;
    if(total>MAX_SIZE){await reader.cancel();return null;}
    parts.push(value);
  }
  const output=new Uint8Array(total);
  let offset=0;
  for(const p of parts){output.set(p,offset);offset+=p.length;}
  return output;
}
async function upload(request,env,origin) {
  const headers=cors(origin);
  try{await verifyAdmin(request.headers.get("Authorization"),env);}
  catch{return json({error:"관리자 Google 인증 실패: 이미지 업로드 로그인을 다시 진행하세요."},401,headers);}
  const mimetype=(request.headers.get("Content-Type")||"").split(";")[0].toLowerCase();
  if(!["image/webp","image/png","image/jpeg"].includes(mimetype))return json({error:"PNG/JPEG/WebP만 업로드 가능합니다."},415,headers);
  let bytes;
  try{bytes=await readBounded(request);}
  catch{return json({error:"파일을 읽지 못했습니다."},400,headers);}
  if(bytes===null)return json({error:"최대 이미지 크기는 5MB입니다."},413,headers);
  if(bytes.length<32)return json({error:"이미지 내용이 올바르지 않습니다."},400,headers);
  const type=sniff(bytes);
  if(!type||type[1]!==mimetype)return json({error:"파일 내용과 MIME 형식이 일치하지 않습니다."},415,headers);
  const date=new Date(),key=[date.getUTCFullYear(),String(date.getUTCMonth()+1).padStart(2,"0"),crypto.randomUUID()+"."+type[0]].join("/");
  try{await env.IMAGES.put(key,bytes,{httpMetadata:{contentType:type[1],cacheControl:"public, max-age=31536000, immutable"},customMetadata:{purpose:"blog-featured"}});}
  catch{return json({error:"R2 저장 실패: 버킷 바인딩을 확인하세요."},502,headers);}
  return json({ok:true,url:new URL("/images/"+key,request.url).href,key,contentType:type[1],bytes:bytes.length},201,headers);
}
async function serve(request,env,key){
  const file=request.method==="HEAD"?await env.IMAGES.head(key):await env.IMAGES.get(key);
  if(!file)return new Response("Not found",{status:404});
  const headers=new Headers({"Content-Type":file.httpMetadata?.contentType||(key.endsWith(".webp")?"image/webp":key.endsWith(".png")?"image/png":"image/jpeg"),"Content-Disposition":"inline","Cache-Control":"public, max-age=31536000, immutable","X-Content-Type-Options":"nosniff","Cross-Origin-Resource-Policy":"cross-origin"});
  if(file.httpEtag)headers.set("ETag",file.httpEtag);
  return new Response(request.method==="HEAD"?null:file.body,{status:200,headers});
}
export default {
  async fetch(request,env){
    const pathname=new URL(request.url).pathname;
    if(pathname==="/api/health"&&request.method==="GET")return json({status:env.IMAGES&&env.GOOGLE_CLIENT_ID&&env.ALLOWED_GOOGLE_EMAIL?"configured":"setup_required",version:1});
    const match=IMAGE_PATH.exec(pathname);
    if(match&&(request.method==="GET"||request.method==="HEAD"))return serve(request,env,match[1]);
    if(pathname==="/api/upload"){
      const origin=request.headers.get("Origin");
      if(origin!==(env.ALLOWED_ORIGIN||"https://wiclab.github.io"))return json({error:"허용되지 않은 웹사이트입니다."},403);
      if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
      if(request.method==="POST"){
        if(!env.IMAGES)return json({error:"R2 버킷 연결이 없습니다."},503,cors(origin));
        return upload(request,env,origin);
      }
      return json({error:"Method not allowed"},405,cors(origin));
    }
    return new Response("Not found",{status:404});
  }
};
