const SITE="https://wic12.blogspot.com";
const RATE_WINDOW_MS=60000;
const RATE_LIMIT=60;
const PATH=/^\/(?:20\d{2}\/\d{2}\/[a-z0-9_.-]+\.html|p\/[a-z0-9_.-]+\.html|search(?:\/label\/[a-z0-9%._-]+)?)$/i;
const BOTS=/bot|crawl|spider|headless|lighthouse|pagespeed|facebookexternalhit|bingpreview|slurp|curl|wget|python-requests|postman/i;
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const reply=(status=204,extra={})=>new Response(null,{status,headers:{...headers,...extra}});
const cors={"Access-Control-Allow-Origin":SITE,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Access-Control-Max-Age":"600","Vary":"Origin"};
function validPage(p){return typeof p==="string"&&(p==="/"||p.length<=180&&PATH.test(p));}
function cleanTitle(t){return typeof t==="string"?t.replace(/[\u0000-\u001f\u007f<>]/g," ").replace(/\s+/g," ").trim().slice(0,85)||"별셈소":"별셈소";}
function browser(req){
  if(req.headers.get("Origin")!==SITE)return false;
  try{if(new URL(req.headers.get("Referer")||"").origin!==SITE)return false;}catch{return false;}
  const agent=req.headers.get("User-Agent")||"";
  if(!agent||BOTS.test(agent)||req.cf?.botManagement?.verifiedBot)return false;
  const score=req.cf?.botManagement?.score;
  if(typeof score==="number"&&score>0&&score<20)return false;
  return true;
}
export default {
 async fetch(req,env){
  const url=new URL(req.url);
  if(url.pathname==="/health"&&req.method==="GET")
    return new Response(JSON.stringify({status:"ok",site:SITE}),{headers:{...headers,"Content-Type":"application/json"}});
  if(url.pathname!=="/view")return reply(404);
  if(req.method==="OPTIONS")return reply(req.headers.get("Origin")===SITE?204:403,req.headers.get("Origin")===SITE?cors:{});
  if(req.method!=="POST")return reply(405);
  if(!browser(req))return reply(403);
  if(req.headers.get("Content-Type")?.split(";")[0].trim()!=="application/json")return reply(415,cors);
  if(Number(req.headers.get("Content-Length")||0)>2048)return reply(413,cors);
  if(!env.GATE||!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)return reply(503,cors);
  let data;
  try{const raw=await req.text();if(raw.length>1500)return reply(413,cors);data=JSON.parse(raw);}catch{return reply(400,cors);}
  if(!data||!validPage(data.page)||!["mobile","desktop"].includes(data.device))return reply(400,cors);
  const payload={page:data.page,title:data.page.startsWith("/search")?"별셈소 목록 페이지":cleanTitle(data.title),device:data.device};
  const id=env.GATE.idFromName("global-visit-alerts");
  const result=await env.GATE.get(id).fetch(new Request("https://internal.invalid/notify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}));
  return reply(result.ok?204:503,cors);
 }
};
export class VisitAlertGate {
 constructor(state,env){
  this.state=state;
  this.env=env;
  // Serialize sends so simultaneous distinct page opens do not silently disappear.
  this.queue=Promise.resolve();
  this.pending=0;
 }
 async fetch(req){
  if(new URL(req.url).pathname!=="/notify"||req.method!=="POST")return reply(404);
  let d;try{d=await req.json();}catch{return reply(400);}
  if(!validPage(d?.page)||!["mobile","desktop"].includes(d?.device))return reply(400);
  // Emergency flood safety only: ordinary visits are never deduplicated or delayed by 5 minutes.
  if(this.pending>=20)return reply(429);
  this.pending++;
  const job=this.queue.then(()=>this.notify(d));
  this.queue=job.catch(()=>{});
  try{return await job;}finally{this.pending--;}
 }
 async notify(d){
  const now=Date.now();
  const current=await this.state.storage.get("minuteWindow");
  const window=current&&now-Number(current.start)>-1&&now-Number(current.start)<RATE_WINDOW_MS
    ?current:{start:now,count:0};
  if(window.count>=RATE_LIMIT)return reply(429);
  // Only aggregate volume is stored. Never store IP, user-agent, cookies, page, title or visitor IDs.
  await this.state.storage.put("minuteWindow",{start:window.start,count:window.count+1});
  const kst=new Intl.DateTimeFormat("ko-KR",{
   timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"
  }).format(new Date(now));
  const pageTitle=cleanTitle(d.title);
  const displayTitle=pageTitle==="별셈소"
    ?(d.page==="/"? "별셈소 홈":d.page.startsWith("/search")?"별셈소 목록":"별셈소 게시글")
    :pageTitle;
  const message=[
   "🔔 별셈소 방문 감지",
   "글: "+displayTitle,
   "기기: "+(d.device==="mobile"?"모바일":"PC"),
   "시각: "+kst+" (KST)",
   "👇 방문한 페이지는 아래 버튼을 눌러 열 수 있어요."
  ].join("\n");
  // Use a Telegram inline keyboard instead of a long, line-wrapped raw URL.
  // The target is exactly the current Blogger pathname; no invented slug or query.
  const payload={
   chat_id:this.env.TELEGRAM_CHAT_ID,
   text:message,
   disable_web_page_preview:true,
   reply_markup:{inline_keyboard:[[{text:"📖 방문한 글 열기",url:SITE+d.page}]]}
  };
  try{
   const res=await fetch("https://api.telegram.org/bot"+this.env.TELEGRAM_BOT_TOKEN+"/sendMessage",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(7000)
   });
   if(!res.ok)return reply(503);
   const json=await res.json();
   return reply(json?.ok===true?204:503);
  }catch{return reply(503);}
 }
}
