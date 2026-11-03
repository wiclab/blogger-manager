/* Traffic dashboard: read-only Blogger PageViews + authenticated CMS GA4 summary. */
(()=>{
'use strict';
const CLIENT_ID='745983224346-2bir36jrfv79g8igk46aocv49o44u50f.apps.googleusercontent.com';
const WORKER='https://blogger-manager-api.chldndlf91.workers.dev';
const API='https://www.googleapis.com/blogger/v3';
const SITE='wic12.blogspot.com';
const $=id=>document.getElementById(id);
const fmt=n=>n!==null&&n!==undefined&&n!==''&&Number.isSafeInteger(Number(n))&&Number(n)>=0?Number(n).toLocaleString('ko-KR'):'—';
const now=()=>new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
let token='',expires=0,blogId='',oauthClient=null,busyBlogger=false;
let adminVerified=false,busyGA=false,gaPending=false,days=28,googleReady=false;
function message(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
function pill(id,text,kind=''){$(id).textContent=text;$(id).className='chip'+(kind?' '+kind:'');}
function validToken(){return !!token&&Date.now()<expires-30000;}
function clearBlogger(){
 token='';expires=0;blogId='';
 for(const id of ['pv7','pv30','pvAll'])$(id).textContent='—';
 $('pvStamp').textContent='미조회';$('bloggerOut').disabled=true;pill('pvState','연결 필요');
}
function extractCount(data,range){
 if(!data||!Array.isArray(data.counts))return null;
 let item=data.counts.find(v=>String(v.timeRange||'').toUpperCase()===range.toUpperCase());
 if(!item&&data.counts.length===1)item=data.counts[0];
 if(!item||item.count===undefined||! /^\d+$/.test(String(item.count)))return null;
 const value=Number(item.count);return Number.isSafeInteger(value)?value:null;
}
async function bloggerGet(path){
 if(!validToken())throw Error('Blogger 권한이 만료되었습니다. 다시 연결해 주세요.');
 let response;
 try{response=await fetch(API+path,{headers:{Authorization:'Bearer '+token},cache:'no-store'});}
 catch{throw Error('Blogger API에 연결하지 못했습니다.');}
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error('Blogger API '+response.status+': '+(data.error?.message||'조회 실패'));
 return data;
}
async function resolveBlog(){
 const data=await bloggerGet('/users/self/blogs');
 const blog=(data.items||[]).find(b=>{try{return new URL(b.url).hostname.toLowerCase()===SITE;}catch{return false;}});
 if(!blog?.id)throw Error('현재 Google 계정에서 별셈소 블로그를 찾지 못했습니다. 다른 블로그의 수치는 표시하지 않습니다.');
 return String(blog.id);
}
async function loadBlogger(){
 if(!validToken()){clearBlogger();message('pvStatus','Blogger 조회수 연결이 필요합니다.');return;}
 if(busyBlogger)return;
 busyBlogger=true;$('bloggerIn').disabled=true;pill('pvState','조회 중');
 message('pvStatus','Blogger의 별셈소 전체 조회수를 조회하고 있습니다.');
 try{
  if(!blogId)blogId=await resolveBlog();
  const ranges=[['7DAYS','pv7'],['30DAYS','pv30'],['all','pvAll']];
  const requestToken=token;
  const results=await Promise.allSettled(ranges.map(([range])=>bloggerGet('/blogs/'+encodeURIComponent(blogId)+'/pageviews?range='+encodeURIComponent(range))));
  if(requestToken!==token||!validToken())return;
  let good=0;const errors=[];
  results.forEach((r,i)=>{
   const [range,id]=ranges[i];const count=r.status==='fulfilled'?extractCount(r.value,range):null;
   $(id).textContent=count==null?'—':fmt(count);
   if(count!=null)good++;else errors.push(range+(r.status==='rejected'?' ('+String(r.reason?.message||'오류')+')':' (값 없음)'));
  });
  $('pvStamp').textContent='조회: '+now();
  pill('pvState',good===3?'정상':good?'부분 조회':'조회 실패',good===3?'ok':'bad');
  message('pvStatus',good===3?'별셈소 블로그의 세 가지 기간 조회수를 가져왔습니다.':'일부 값을 가져오지 못했습니다: '+errors.join(', '),good!==3);
 }catch(e){pill('pvState','조회 실패','bad');message('pvStatus',e.message,true);}
 finally{busyBlogger=false;$('bloggerIn').disabled=false;$('bloggerOut').disabled=!token;}
}
function connectBlogger(){
 if(!window.google?.accounts?.oauth2){message('pvStatus','Google 인증 모듈을 불러오지 못했습니다. 새로고침해 주세요.',true);return;}
 if(!oauthClient)oauthClient=google.accounts.oauth2.initTokenClient({
  client_id:CLIENT_ID,scope:'https://www.googleapis.com/auth/blogger',
  callback:async r=>{
   if(!r?.access_token||r.error){message('pvStatus','Blogger 권한 승인에 실패했거나 취소되었습니다.',true);return;}
   token=r.access_token;expires=Date.now()+(Number(r.expires_in)||3500)*1000;blogId='';
   $('bloggerOut').disabled=false;await loadBlogger();
  },
  error_callback:r=>message('pvStatus','Google 인증 창 오류: '+String(r?.type||'알 수 없음'),true)
 });
 oauthClient.requestAccessToken({prompt:validToken()?'':'consent'});
}
function disconnectBlogger(){
 const previous=token;clearBlogger();
 if(previous&&window.google?.accounts?.oauth2?.revoke)google.accounts.oauth2.revoke(previous,()=>{});
 message('pvStatus','Blogger 조회 연결이 해제되었습니다.');
}
function idToken(){return sessionStorage.getItem('bloggerManagerIdToken')||'';}
async function verifyAdmin(){
 const value=idToken();
 if(!value)return false;
 try{
  const res=await fetch(WORKER+'/auth/check',{method:'POST',headers:{Authorization:'Bearer '+value},cache:'no-store'});
  const body=await res.json();
  if(!res.ok||!body.ok||!body.admin)throw Error('인증 만료');
  adminVerified=true;$('gaOut').disabled=false;$('gaLogin').hidden=true;
  pill('gaState','CMS 연결됨','ok');message('gaStatus','CMS 관리자 인증이 확인됐습니다.');
  return true;
 }catch{
  sessionStorage.removeItem('bloggerManagerIdToken');
  adminVerified=false;$('gaLogin').hidden=false;
  pill('gaState','인증 필요','bad');message('gaStatus','CMS 관리자 인증이 만료되었거나 연결되지 않았습니다.',true);
  return false;
 }
}
async function authenticateAdmin(r){
 if(!r?.credential){message('gaStatus','Google 계정 인증 정보가 없습니다.',true);return;}
 sessionStorage.setItem('bloggerManagerIdToken',String(r.credential));
 if(await verifyAdmin())await loadGA();
}
function initGoogleLogin(attempt=0){
 if(window.google?.accounts?.id){
  if(googleReady)return;googleReady=true;
  google.accounts.id.initialize({client_id:CLIENT_ID,callback:authenticateAdmin,auto_select:false});
  google.accounts.id.renderButton($('gaLogin'),{theme:'outline',size:'large',shape:'pill',width:240});
 }else if(attempt<32)setTimeout(()=>initGoogleLogin(attempt+1),250);
 else message('gaStatus','Google 로그인 모듈이 로드되지 않았습니다. 새로고침해 주세요.',true);
}
function pathOnly(s){
 const raw=String(s||'');
 if(!raw.startsWith('/')||raw.startsWith('//')||raw.includes('\\'))return '';
 try{const u=new URL(raw,'https://'+SITE);return u.hostname===SITE?u.pathname:'';}catch{return '';}
}
function renderPages(items){
 const root=$('popular');root.replaceChildren();
 const rows=(Array.isArray(items)?items:[]).map(p=>({...p,n:Number(p.screenPageViews)}))
  .filter(p=>Number.isSafeInteger(p.n)&&p.n>=0&&pathOnly(p.pagePath))
  .sort((a,b)=>b.n-a.n).slice(0,10);
 if(!rows.length){
  const empty=document.createElement('p');empty.className='muted';empty.textContent='이 기간에 표시할 개별 페이지 데이터가 없습니다.';
  root.append(empty);return;
 }
 const highest=Math.max(1,rows[0].n);
 rows.forEach((p,index)=>{
  const item=document.createElement('div');item.className='rank-row';
  const left=document.createElement('div'),a=document.createElement('a'),sub=document.createElement('small'),track=document.createElement('div'),fill=document.createElement('div'),total=document.createElement('strong');
  const path=pathOnly(p.pagePath);
  a.href='https://'+SITE+path;a.target='_blank';a.rel='noopener noreferrer';
  a.textContent=(index+1)+'. '+String(p.pageTitle||path);
  sub.textContent=path;
  track.className='rank-track';fill.className='rank-fill';fill.style.width=(p.n?Math.max(1,p.n/highest*100):0)+'%';
  track.append(fill);left.append(a,sub,track);
  total.textContent=fmt(p.n);item.append(left,total);root.append(item);
 });
}
async function adminGetStats(){
 const res=await fetch(WORKER+'/stats/overview?blog=wic12&days='+days,{headers:{Authorization:'Bearer '+idToken()},cache:'no-store'});
 const data=await res.json().catch(()=>({}));
 if(!res.ok||data.ok===false)throw Error(data.error||'통계 API HTTP '+res.status);
 return data;
}
async function loadGA(){
 if(!adminVerified)return;
 if(busyGA){gaPending=true;return;}
 const requestedDays=days,requestToken=idToken();
 busyGA=true;pill('gaState','조회 중');message('gaStatus','CMS의 GA4 '+requestedDays+'일 통계를 확인 중입니다.');
 try{
  const data=await adminGetStats();
  if(requestedDays!==days||!adminVerified||requestToken!==idToken())return;
  if(data.blog?.url&&new URL(data.blog.url).hostname.toLowerCase()!==SITE)throw Error('대상 블로그 불일치');
  const ga=data.analytics;
  if(!ga?.summary)throw Error('GA4 통계가 제공되지 않습니다. 관리자 계정 또는 GA4 연결을 확인하세요.');
  $('gaUsers').textContent=fmt(ga.summary.activeUsers);
  $('gaSessions').textContent=fmt(ga.summary.sessions);
  $('gaViews').textContent=fmt(ga.summary.screenPageViews);
  renderPages(ga.pages);
  const updated=data.generatedAt?new Date(data.generatedAt):new Date();
  $('gaStamp').textContent='기준: '+(Number.isNaN(+updated)?'미확인':updated.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}));
  pill('gaState','정상','ok');message('gaStatus','최근 '+days+'일의 GA4 통계를 가져왔습니다.');
 }catch(e){
  for(const id of ['gaUsers','gaSessions','gaViews'])$(id).textContent='—';
  renderPages([]);pill('gaState','조회 실패','bad');message('gaStatus','GA4 조회 실패: '+e.message,true);
 }finally{busyGA=false;if(gaPending){gaPending=false;if(adminVerified)loadGA();}}
}
function logoutGA(){
 sessionStorage.removeItem('bloggerManagerIdToken');adminVerified=false;$('gaOut').disabled=true;$('gaLogin').hidden=false;
 for(const id of ['gaUsers','gaSessions','gaViews'])$(id).textContent='—';
 $('gaStamp').textContent='미조회';renderPages([]);pill('gaState','인증 필요');message('gaStatus','CMS 관리자 세션을 종료했습니다.');
}
$('bloggerIn').addEventListener('click',connectBlogger);
$('bloggerOut').addEventListener('click',disconnectBlogger);
$('gaOut').addEventListener('click',logoutGA);
$('refresh').addEventListener('click',async()=>{
 $('refresh').disabled=true;
 try{await Promise.all([validToken()?loadBlogger():Promise.resolve(),adminVerified?loadGA():Promise.resolve()]);}
 finally{$('refresh').disabled=false;}
});
document.querySelectorAll('[data-days]').forEach(btn=>btn.addEventListener('click',()=>{
 days=Number(btn.dataset.days);
 document.querySelectorAll('[data-days]').forEach(x=>x.setAttribute('aria-pressed',String(Number(x.dataset.days)===days)));
 if(adminVerified)loadGA();
}));
initGoogleLogin();
verifyAdmin().then(ok=>{if(ok)loadGA();});
})();