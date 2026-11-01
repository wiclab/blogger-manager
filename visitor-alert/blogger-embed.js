<!-- 별셈소: 테마 HTML의 </body> 앞에 한 번만 삽입. 배포 후 실제 Worker URL로 교체 -->
<script>
(function(){
  "use strict";
  var WORKER_URL="https://REPLACE-WITH-YOUR-WORKER.workers.dev";
  if(WORKER_URL.indexOf("REPLACE-WITH-YOUR-WORKER")!==-1)return;
  if(window.top!==window.self || document.prerendering || navigator.webdriver)return;
  if(location.origin!=="https://wic12.blogspot.com")return;
  if(!(/^\/(?:20\d{2}\/\d{2}\/[a-z0-9_.-]+\.html|p\/[a-z0-9_.-]+\.html|search(?:\/label\/[a-z0-9%._-]+)?)$/i.test(location.pathname)||location.pathname==="/"))return;
  if(/bot|crawl|spider|headless|lighthouse|pagespeed/i.test(navigator.userAgent))return;
  function send(){
    if(document.visibilityState!=="visible")return;
    var mobile=navigator.userAgentData&&typeof navigator.userAgentData.mobile==="boolean"
      ?navigator.userAgentData.mobile:/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    fetch(WORKER_URL.replace(/\/$/,"")+"/view",{
      method:"POST",mode:"cors",credentials:"omit",cache:"no-store",keepalive:true,
      referrerPolicy:"strict-origin-when-cross-origin",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({page:location.pathname,title:location.pathname.startsWith("/search")?"별셈소 목록 페이지":document.title.slice(0,85),device:mobile?"mobile":"desktop"})
    }).catch(function(){});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",send,{once:true});
  else send();
})();
</script>
