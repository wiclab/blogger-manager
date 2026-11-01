const SITE="https://wic12.blogspot.com";
const WAIT=300000;
const PATH=/^\/20\d{2}\/\d{2}\/[a-z0-9_.-]+\.html$/i;
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
  const payload={page:data.page,title:cleanTitle(data.title),device:data.device};
  const id=env.GATE.idFromName("global-five-minute-cooldown");
  const result=await env.GATE.get(id).fetch(new Request("https://internal.invalid/notify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}));
  return reply(result.ok?204:503,cors);
 }
};
export class VisitAlertGate {
 constructor(state,env){this.state=state;this.env=env;this.busy=false;}
 async fetch(req){
  if(new URL(req.url).pathname!=="/notify"||req.method!=="POST")return reply(404);
  let d;try{d=await req.json();}catch{return reply(400);}
  if(!validPage(d?.page)||!["mobile","desktop"].includes(d?.device))return reply(400);
  if(this.busy)return reply(204);
  const now=Date.now();
  const last=Number(await this.state.storage.get("lastAttemptAt")||0);
  if(this.busy||now-last<WAIT)return reply(204);
  this.busy=true;
  try{
   // Reserve cooldown before the external call, including failed attempts.
   await this.state.storage.put("lastAttemptAt",now);
   const kst=new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(now));
   const message=["🔔 별셈소 방문 감지","글: "+cleanTitle(d.title),"기기: "+(d.device==="mobile"?"모바일":"PC"),"시각: "+kst+" (KST)","페이지: "+SITE+d.page,"알림 최소 간격: 5분"].join("\n");
   const res=await fetch("https://api.telegram.org/bot"+this.env.TELEGRAM_BOT_TOKEN+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:this.env.TELEGRAM_CHAT_ID,text:message,disable_web_page_preview:true}),signal:AbortSignal.timeout(7000)});
   if(!res.ok)return reply(503);
   const json=await res.json();return reply(json?.ok===true?204:503);
  }catch{return reply(503);}finally{this.busy=false;}
 }
}
