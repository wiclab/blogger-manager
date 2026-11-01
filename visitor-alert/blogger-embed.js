<!-- 별셈소 방문 알림: Blogger 테마 HTML의 닫는 body 태그 바로 앞에 한 번만 삽입. Worker 주소 확인 완료 -->
<script type='text/javascript'>
//<![CDATA[
(function(){
  "use strict";
  var WORKER_URL="https://byeolsemso-visitor-alert.chldndlf91.workers.dev";
  if(window.top!==window.self || document.prerendering || navigator.webdriver)return;
  if(location.origin!=="https://wic12.blogspot.com")return;
  if(!(/^\/(?:20\d{2}\/\d{2}\/[a-z0-9_.-]+\.html|p\/[a-z0-9_.-]+\.html|search(?:\/label\/[a-z0-9%._-]+)?)$/i.test(location.pathname)||location.pathname==="/"))return;
  if(/bot|crawl|spider|headless|lighthouse|pagespeed/i.test(navigator.userAgent))return;
  function displayTitle(){
    if(location.pathname==="/")return "별셈소 홈";
    if(location.pathname.startsWith("/search"))return "별셈소 목록 페이지";
    var heading=document.querySelector("article .post-title, .post-title.entry-title, h1.entry-title");
    var post=heading&&heading.textContent?heading.textContent.replace(/\s+/g," ").trim():"";
    var og=document.querySelector('meta[property="og:title"]');
    var name=post||(og&&og.getAttribute("content"))||document.title||"별셈소";
    return name.replace(/\s*[-|–—]\s*별셈소\s*$/,"").slice(0,85);
  }
  function send(){
    if(document.visibilityState!=="visible")return;
    var mobile=navigator.userAgentData&&typeof navigator.userAgentData.mobile==="boolean"
      ?navigator.userAgentData.mobile:/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    fetch(WORKER_URL.replace(/\/$/,"")+"/view",{
      method:"POST",mode:"cors",credentials:"omit",cache:"no-store",keepalive:true,
      referrerPolicy:"strict-origin-when-cross-origin",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({page:location.pathname,title:displayTitle(),device:mobile?"mobile":"desktop"})
    }).catch(function(){});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",send,{once:true});
  else send();
})();
//]]>
</script>
