/* Blogger Manager image workflow. Google ID login -> WebP -> R2 -> insert responsive HTML. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const CLIENT_ID = "745983224346-2bir36jrfv79g8igk46aocv49o44u50f.apps.googleusercontent.com";
  const configured = String(window.BLOGGER_IMAGE_WORKER_URL || "").trim().replace(/\/+$/, "");
  const enabled = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(configured)
    && !/REPLACE|YOUR-|example/i.test(configured);
  let idToken = sessionStorage.getItem("bloggerManagerIdToken") || "";
  let running = false;

  function message(s, error = false) {
    const node = $("imageStatus");
    node.textContent = s;
    node.style.color = error ? "#a12a29" : "#376391";
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
  }
  function setWorking(value) {
    running=value;
    $("uploadImage").disabled = !enabled || value;
    $("clipboardImage").disabled = !enabled || value;
    $("imageFile").disabled = !enabled || value;
  }
  function initializeIdentity() {
    if (!enabled) {
      message("R2 서버가 아직 설정되지 않았습니다. image-upload-config.js에 배포한 Worker 주소를 입력하세요.", true);
      setWorking(false);
      return;
    }
    message("Google 관리자 인증 후 이미지를 선택하면 WebP로 압축해 업로드합니다.");
    const attach = () => {
      if (!window.google?.accounts?.id) {
        window.setTimeout(attach, 250);
        return;
      }
      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: response => {
          idToken = String(response.credential || "");
          if(idToken) {
            sessionStorage.setItem("bloggerManagerIdToken", idToken);
            message("이미지 업로드용 Google 관리자 계정이 인증되었습니다.");
          }
        },
        auto_select: false
      });
      google.accounts.id.renderButton($("imageGoogleSignIn"), {
        theme: "outline", size: "medium", shape: "pill", text:"signin_with", width: 260
      });
      if(idToken) message("기존 Google 인증이 있습니다. 만료됐으면 아래에서 다시 로그인하세요.");
    };
    attach();
    setWorking(false);
  }
  async function convertToWebp(file) {
    const bitmap = await createImageBitmap(file);
    try {
      let maxDimension = 1254;
      let best = null, width = bitmap.width, height = bitmap.height;
      if(!width || !height || width * height > 30e6) throw new Error("이미지 크기가 너무 큽니다.");
      // Compress enough for a fast mobile blog thumbnail; do not upscale.
      for(let attempt=0; attempt<8; attempt++){
        const scale = Math.min(1, maxDimension / Math.max(width,height));
        const targetW = Math.max(1,Math.round(width*scale));
        const targetH = Math.max(1,Math.round(height*scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const context=canvas.getContext("2d");
        if(!context) throw new Error("이미지 변환을 지원하지 않는 브라우저입니다.");
        context.drawImage(bitmap,0,0,targetW,targetH);
        const quality = Math.max(0.57,0.85-(attempt%4)*0.09);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",quality));
        if(!blob || blob.type!=="image/webp") throw new Error("WebP 변환에 실패했습니다.");
        best={blob,width:targetW,height:targetH};
        if(blob.size <= 210*1024) break;
        if(attempt%4===3)maxDimension=Math.max(800,Math.floor(maxDimension*0.78));
      }
      return best;
    } finally {bitmap.close();}
  }
  async function submitFile(file) {
    if (running || !enabled) return;
    if(!file) return;
    if(!["image/png","image/jpeg","image/webp"].includes(file.type)){
      message("PNG, JPG, WebP 이미지만 지원합니다.",true);return;
    }
    if(file.size>20*1024*1024){message("원본 이미지 크기는 최대 20MB입니다.",true);return;}
    if(!idToken){message("먼저 아래 Google 로그인 버튼으로 관리자 인증을 진행해주세요.",true);return;}
    const alt=$("imageAlt").value.trim();
    if(!alt){message("대표이미지 ALT 설명을 먼저 입력하세요.",true);$("imageAlt").focus();return;}
    const postIdentity=$("identity").textContent;
    const htmlBefore=$("html").value;
    if (/<img\b/i.test(htmlBefore.slice(0,3500)) &&
        !confirm("본문 앞부분에 이미지가 이미 있습니다. 새 이미지를 맨 위에 추가할까요?")) return;
    setWorking(true);
    let uploadedUrl = null;
    try {
      message("WebP 최적화 중...");
      const optimized = await convertToWebp(file);
      message("R2 저장소에 업로드 중... "+Math.round(optimized.blob.size/1024)+"KB");
      const response = await fetch(configured+"/api/upload", {
        method:"POST",
        headers:{"Authorization":"Bearer "+idToken,"Content-Type":"image/webp"},
        body:optimized.blob
      });
      const data=await response.json();
      if(!response.ok || !data.ok)throw new Error(data.error || "R2 응답 오류 "+response.status);
      uploadedUrl=data.url;
      const u=new URL(uploadedUrl);
      if(u.origin!==new URL(configured).origin || !/^\/images\/20\d\d\//.test(u.pathname))
        throw new Error("이미지 저장 주소를 검증하지 못했습니다.");
      if(postIdentity!==$("identity").textContent)
        throw new Error("업로드 중 선택한 글이 바뀌었습니다. 이미지 주소만 복사해서 원하는 글에 넣으세요: "+uploadedUrl);
      const code='<figure data-bm-cover="r2" style="max-width:720px;margin:24px auto 30px;text-align:center;">\n'+
        '  <img src="'+escapeHtml(uploadedUrl)+'" alt="'+escapeHtml(alt)+'" width="'+optimized.width+'" height="'+optimized.height+'"'+
        ' loading="eager" decoding="async" fetchpriority="high"'+
        ' style="display:block;width:100%;max-width:100%;height:auto;margin:0 auto;border-radius:14px;" />\n</figure>\n';
      $("sourceTab").click();
      $("html").value=code+htmlBefore.trimStart();
      $("html").dispatchEvent(new Event("input",{bubbles:true}));
      message("R2 업로드 + 본문 첫 이미지 삽입 완료 ("+Math.round(data.bytes/1024)+"KB). 이제 「저장」을 눌러 Blogger에 반영하세요.");
      $("imageResult").href=uploadedUrl;
      $("imageResult").textContent="업로드한 이미지 확인";
      $("imageResult").hidden=false;
      $("imageFile").value="";
    } catch(err){
      const extra=uploadedUrl?" (저장된 이미지: "+uploadedUrl+")":"";
      message((err.message||"이미지 업로드 실패")+extra,true);
    } finally {setWorking(false);}
  }
  $("imageFile").addEventListener("change",event=>{
    const file=event.target.files && event.target.files[0];
    if(file)submitFile(file);
  });
  $("uploadImage").addEventListener("click",()=>$("imageFile").click());
  $("clipboardImage").addEventListener("click",async()=>{
    if(running)return;
    if(!navigator.clipboard?.read){message("이 브라우저는 이미지 클립보드 읽기를 지원하지 않습니다.",true);return;}
    try{
      const items=await navigator.clipboard.read();
      for(const item of items){
        const type=["image/webp","image/png","image/jpeg"].find(m=>item.types.includes(m));
        if(type){const blob=await item.getType(type);await submitFile(new File([blob],"clipboard-image",{type}));return;}
      }
      message("클립보드에 이미지가 없습니다. ChatGPT 이미지에서 '이미지 복사'를 먼저 선택하세요.",true);
    }catch(err){message("클립보드 권한을 허용하거나 이미지 파일 선택을 사용하세요: "+err.message,true);}
  });
  initializeIdentity();
})();
