/* Preview-only controller. Never reads OAuth state or calls Blogger APIs. */
'use strict';
window.BloggerPreview = (() => {
  let generation = 0;
  let cancelPending = () => {};
  const policy = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";
  function buildDocument(source) {
    // Parse HTML once: entities remain HTML entities, rather than being double-escaped.
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    parsed.querySelectorAll('script,base,meta[http-equiv],iframe,object,embed').forEach(node => node.remove());
    const attributes = node => [...node.attributes].filter(attr => ['lang','dir','class','style'].includes(attr.name)).map(attr => ' ' + attr.name + '="' + attr.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"').join('');
    const safeHead = [...parsed.head.querySelectorAll('style,link[rel="stylesheet"]')].map(node => node.outerHTML).join('');
    return '<!doctype html><html' + attributes(parsed.documentElement) + '><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="' + policy + '">' +
      '<style>html{box-sizing:border-box}*,*:before,*:after{box-sizing:inherit}body{padding:16px;margin:0;font-family:system-ui,sans-serif;line-height:1.75;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%;table-layout:fixed;overflow-wrap:anywhere}td,th{overflow-wrap:anywhere}</style>' +
      safeHead + '</head><body' + attributes(parsed.body) + '>' + parsed.body.innerHTML + '</body></html>';
  }
  function visibleContent(doc) {
    const win = doc.defaultView;
    const visible = node => {
      for (let el = node.nodeType === 1 ? node : node.parentElement; el; el = el.parentElement) {
        const css = win.getComputedStyle(el);
        if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0) return false;
      }
      const range = doc.createRange(); range.selectNodeContents(node);
      const rects = node.nodeType === 1 ? node.getClientRects() : range.getClientRects();
      return [...rects].some(rect => rect.width > 0 && rect.height > 0);
    };
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent.trim() && !node.parentElement.closest('style,script,noscript,template') && visible(node)) return true;
    }
    return [...doc.querySelectorAll('img,svg,video,canvas')].some(el =>
      visible(el) && (el.tagName !== 'IMG' || (el.complete && el.naturalWidth > 0)));
  }
  function cancel() { generation++; cancelPending(); cancelPending = () => {}; }
  function render(source, width) {
    cancel();
    const id = generation;
    const previous = document.getElementById('preview');
    const status = document.getElementById('previewStatus');
    const frame = document.createElement('iframe');
    frame.id = 'preview';
    frame.title = '본문 미리보기: 스크립트 실행 차단';
    // Same-origin permits parent-side render inspection; scripts remain forbidden by
    // BOTH the sandbox (no allow-scripts) and CSP. Forms/popups/navigation stay blocked.
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.referrerPolicy = 'no-referrer';
    frame.style.width = width === 'auto' ? '100%' : Number(width) + 'px';
    frame.style.boxSizing = 'content-box';
    frame.style.maxWidth = 'calc(100% - 2px)';
    status.className = 'muted'; status.dataset.state = 'loading';
    status.textContent = '미리보기 렌더링을 확인하는 중…';
    frame.setAttribute('aria-busy', 'true');
    let settled = false;
    let timer;
    const finish = (state, message) => {
      if (settled || id !== generation) return;
      settled = true; clearTimeout(timer);
      frame.removeAttribute('aria-busy');
      status.dataset.state = state;
      status.className = state === 'error' ? 'preview-error' : 'muted';
      status.textContent = message;
      frame.dataset.state = state;
    };
    cancelPending = () => { settled = true; clearTimeout(timer); frame.onload = null; frame.onerror = null; };
    frame.onerror = () => finish('error', '미리보기 프레임을 불러오지 못했습니다. HTML 편집으로 돌아가 다시 시도하세요.');
    frame.onload = async () => {
      if (settled || id !== generation) return;
      try {
        const doc = frame.contentDocument;
        // Ignore the initial about:blank event. Only inspect this generation's document.
        if (!doc || !doc.head.querySelector('meta[http-equiv="Content-Security-Policy"]')) return;
        const images = [...doc.images];
        images.forEach(img => { img.loading = 'eager'; });
        await Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
          img.addEventListener('load', resolve, {once:true});
          img.addEventListener('error', resolve, {once:true});
        })));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (settled || id !== generation) return;
        if (doc !== frame.contentDocument || !doc.defaultView) return;
        if (images.some(img => !img.complete || !img.naturalWidth)) throw new Error('이미지를 불러오지 못했습니다. 이미지 주소와 접근 권한을 확인하세요.');
        if (!visibleContent(doc)) throw new Error('표시할 내용이 없거나 HTML/CSS가 내용을 숨기고 있습니다.');
        const viewport = doc.defaultView.innerWidth;
        const contentWidth = doc.documentElement.clientWidth;
        if (!viewport || !frame.getBoundingClientRect().height) throw new Error('미리보기 화면의 크기가 0입니다.');
        const overflow = Math.max(doc.documentElement.scrollWidth, doc.body.scrollWidth) > contentWidth + 1;
        finish(overflow ? 'error' : 'ready', overflow ?
          '미리보기에서 가로 넘침이 발견됐습니다. 고정 너비·표·이미지 CSS를 확인하세요.' :
          '미리보기 표시 확인 완료 · 실제 너비 ' + viewport + 'px · 이미지 ' + images.length + '개');
      } catch (error) { finish('error', '미리보기 실패: ' + error.message); }
    };
    try {
      if (!source.trim()) throw new Error('본문 HTML을 입력하세요.');
      // A fresh, visible iframe avoids retaining a previous srcdoc browsing context.
      // Attach handlers before insertion/navigation so fast load events cannot be missed.
      const doc = buildDocument(source);
      previous.replaceWith(frame);
      timer = setTimeout(() => finish('error', '미리보기 확인 시간이 초과됐습니다. 이미지·네트워크 또는 렌더링 상태를 확인하고 다시 시도하세요.'), 10000);
      frame.srcdoc = doc;
    } catch (error) { finish('error', '미리보기 실패: ' + error.message); }
  }
  return {render, cancel};
})();
