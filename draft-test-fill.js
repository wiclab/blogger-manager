/* One-click safe sample draft: keeps an existing R2 cover image and fills test copy.
 * This UI never sends an API request or publishes; the operator must press Save.
 */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const status = (text, kind="ok") => {
    $("status").textContent = text;
    $("status").className = kind;
  };
  let backup=null;
  const isDraftSelection = identity => /상태:\s*draft\b/i.test(identity);
  const validImage = (src, workerOrigin) => {
    try {
      const url=new URL(src);
      return url.origin===workerOrigin && /^\/images\/20\d{2}\/(?:0[1-9]|1[0-2])\/[0-9a-f-]{36}\.(webp|png|jpg)$/i.test(url.pathname);
    } catch{return false;}
  };
  function extractR2Cover(html, origin) {
    // Browser DOMParser avoids accidentally copying an unrelated image/script.
    const doc=new DOMParser().parseFromString(html,"text/html");
    const images=Array.from(doc.querySelectorAll("img"));
    const image=images.find(img=>validImage(img.getAttribute("src")||"",origin));
    if(!image)return null;
    if(!image.alt || !image.alt.trim())
      image.alt="별셈소 이미지 업로드 테스트를 나타내는 노트북과 클라우드 업로드 일러스트";
    image.setAttribute("loading","eager");
    image.setAttribute("decoding","async");
    image.style.maxWidth="100%";
    image.style.width="100%";
    image.style.height="auto";
    const figure=image.closest("figure");
    return figure ? figure.outerHTML :
      '<figure data-bm-cover="r2" style="max-width:720px;margin:24px auto 30px;text-align:center;">'+
      image.outerHTML+"</figure>";
  }
  async function insertSample() {
    const identity=$("identity").textContent;
    if(!isDraftSelection(identity)){
      status("먼저 왼쪽에서 공개되지 않은 테스트 임시글을 선택하세요. 게시된 글에는 적용하지 않습니다.","error");
      return;
    }
    const originString=window.BLOGGER_IMAGE_WORKER_URL||"";
    let origin;
    try{origin=new URL(originString).origin;}
    catch{status("이미지 Worker 주소가 설정되지 않았습니다.","error");return;}
    const currentHtml=$("html").value;
    const cover=extractR2Cover(currentHtml,origin);
    if(!cover){
      status("선택한 임시글 본문에서 R2 대표이미지를 찾지 못했어요. 먼저 R2에 테스트 이미지를 업로드하고 다시 눌러주세요.","error");
      return;
    }
    if(!window.confirm("선택한 임시글의 기존 본문은 대표이미지 1장만 남기고 테스트 원고로 교체합니다.\n\n저장은 아직 하지 않으며, 이후 '되돌리기'도 가능합니다.\n계속할까요?"))return;
    $("loadSample").disabled=true;
    try{
      const res=await fetch("./draft-test-article.html",{cache:"no-store"});
      if(!res.ok)throw new Error("예시 원고 로드 실패: HTTP "+res.status);
      const body=await res.text();
      if(!/<article class="bss-upload-test">/.test(body) || /<h1\b|<script\b/i.test(body))
        throw new Error("원고 파일 형식이 올바르지 않습니다.");
      // Do not mutate a different selected post if the network took a while.
      if($("identity").textContent!==identity){
        throw new Error("불러오는 동안 다른 임시글을 선택했습니다. 다시 시도하세요.");
      }
      backup={identity,title:$("title").value,labels:$("labels").value,html:$("html").value};
      $("title").value="별셈소 이미지 자동 업로드 테스트｜R2·WebP·ALT·모바일 표시 확인";
      $("labels").value="테스트";
      $("html").value=cover+"\n"+body;
      $("sourceTab").click();
      $("undoSample").disabled=false;
      status("테스트 원고를 채웠습니다. 기존 R2 대표이미지를 맨 위에 유지했고, 아직 Blogger에는 저장하지 않았습니다. 미리보기 후 '저장'을 눌러주세요.");
      $("html").scrollIntoView({behavior:"smooth",block:"center"});
    }catch(e){status("테스트 글 작성 실패: "+e.message,"error");}
    finally{$("loadSample").disabled=false;}
  }
  function undo() {
    if(!backup)return;
    if($("identity").textContent!==backup.identity){
      backup=null;$("undoSample").disabled=true;
      status("다른 글을 선택했기 때문에 되돌릴 수 없습니다.","error");return;
    }
    if(!window.confirm("방금 불러온 테스트 원고를 취소하고 이전 편집 내용으로 되돌릴까요?"))return;
    $("title").value=backup.title;
    $("labels").value=backup.labels;
    $("html").value=backup.html;
    $("sourceTab").click();
    backup=null;
    $("undoSample").disabled=true;
    status("테스트 원고 적용 전 편집 내용으로 되돌렸습니다. Blogger 저장 작업은 수행하지 않았습니다.");
  }
  $("loadSample").addEventListener("click",insertSample);
  $("undoSample").addEventListener("click",undo);
})();