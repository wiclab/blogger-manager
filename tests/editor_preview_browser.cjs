'use strict';
// Real Chromium rendering only. All Google/Blogger requests are blocked; no login or writes.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGPkSTnxn4GBgYGJAQoAIOwCO1zDvI0AAAAASUVORK5CYII=';
const fixtures = {
  sentence: '일반 문장 한 줄',
  paragraph: '<p>창문 &amp; 창틀 &lt;확인&gt; “물방울” &#39;습기&#39;</p>',
  heading: '<h2>결로와 누수 확인</h2>',
  table: '<table style="width:100%"><tr><th>구분</th><th>관찰 내용</th></tr><tr><td>결로</td><td>비가 오지 않아도 물방울이 생기는지 확인합니다.</td></tr></table>',
  image: '<img width="1536" height="1024" alt="결로 일러스트" src="' + image + '">',
  faq: '<h2>FAQ</h2>' + Array.from({length:5}, (_,i)=>`<h3>질문 ${i+1}</h3><p>창과 창틀의 물기 위치를 확인하세요.</p>`).join(''),
  long: '<h2>긴 본문</h2>' + '<p>창가의 물기를 닦고 온습도와 발생 위치를 기록합니다.</p>'.repeat(160)
};
(async () => {
  const server = http.createServer((req,res) => {
    const file = path.join(root, new URL(req.url,'http://fixture').pathname);
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file)) {res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = process.env.PREVIEW_LIVE_URL || `http://127.0.0.1:${server.address().port}/editor.html`;
  const browser = await chromium.launch({headless:true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--no-zygote','--use-gl=angle','--use-angle=swiftshader']} : {})});
  let passed = 0;
  try {
    const context = await browser.newContext({viewport:{width:1280,height:900}});
    const page = await context.newPage();
    const jsErrors = [], writes = [];
    page.on('pageerror',error=>jsErrors.push(error.message));
    await page.route('**/*',route => {
      const req=route.request(), url=req.url();
      if (/googleapis\.com\/blogger/.test(url)) writes.push(req.method());
      if (/^https:\/\/(accounts\.google\.com|www\.googleapis\.com)/.test(url)) return route.abort();
      return route.continue();
    });
    await page.goto(base);
    // Make the locally editable panel visible without invoking authentication or a write API.
    await page.evaluate(()=>document.getElementById('app').classList.remove('hide'));
    await page.fill('#title','Fixture title'); await page.fill('#labels','생활정보');
    async function render(source, width='auto', expected='ready') {
      await page.click('#sourceTab');
      await page.fill('#html',source);
      await page.selectOption('#previewWidth',width);
      await page.click('#previewTab');
      try { await page.waitForFunction(state=>document.getElementById('previewStatus').dataset.state===state,expected,{timeout:15000}); } catch(error) { console.error(await page.locator('#previewStatus').textContent()); throw error; }
      assert.equal(await page.inputValue('#html'),source,'preview must not alter source');
      assert.equal(await page.inputValue('#title'),'Fixture title');
      assert.equal(await page.inputValue('#labels'),'생활정보');
      assert.equal(await page.locator('#preview').getAttribute('sandbox'),'allow-same-origin');
      if(expected==='ready') {
        const frame=page.frameLocator('#preview');
        const metrics=await frame.locator('html').evaluate(el=>({w:el.clientWidth,s:el.scrollWidth,b:el.ownerDocument.body.scrollWidth}));
        if(width!=='auto') assert.equal(metrics.w,Number(width),'exact child viewport');
        assert.ok(Math.max(metrics.s,metrics.b)<=metrics.w+1,JSON.stringify(metrics));
      }
      passed++;
    }
    for(const width of ['360','375','412']) for(const [name,source] of Object.entries(fixtures)) {
      await render(source,width);
      if(name==='paragraph') assert.equal(await page.frameLocator('#preview').locator('p').innerText(),"창문 & 창틀 <확인> “물방울” '습기'");
      if(name==='image') assert.equal(await page.frameLocator('#preview').locator('img').evaluate(el=>el.complete&&el.naturalWidth>0),true);
    }
    for(let i=0;i<20;i++) await render(`<p>연속 갱신 ${i}</p>`,'360');
    // Cancel a pending generation; its late image event must not replace the next result.
    await page.route('https://slow.invalid/image.png',async route=>{
      await new Promise(resolve=>setTimeout(resolve,500)); await route.abort().catch(()=>{});
    });
    await page.click('#sourceTab');await page.fill('#html','<img src="https://slow.invalid/image.png">');await page.click('#previewTab');
    await render('<p>최신 갱신만 표시</p>','360');
    await page.waitForTimeout(650);
    assert.equal(await page.locator('#previewStatus').getAttribute('data-state'),'ready');
    await render('<style>body{display:none}</style><p>숨김</p>','360','error');
    await render('','360','error');
    await render('<!doctype html><html><head><style>p{font-size:18px}</style></head><body class="full-doc"><p>전체 HTML 문서</p></body></html>','360');
    await render('<html style="display:none"><body><p>전체 문서 숨김</p></body></html>','360','error');
    await render('<p>폭 검사</p><div style="width:2000px">고정 폭</div>','360','error');
    await page.route('https://broken.invalid/**',route=>route.fulfill({status:404,body:''}));
    await render('<p>이미지 실패 확인</p><img src="https://broken.invalid/no.png">','360','error');
    // A load event without a usable rendered document must time out, never report ready.
    await page.click('#sourceTab'); await page.fill('#html','<p>로드 확인</p>'); await page.click('#previewTab');
    await page.evaluate(()=>{document.getElementById('preview').srcdoc='';});
    await page.waitForFunction(()=>document.getElementById('previewStatus').dataset.state==='error',null,{timeout:12000});
    assert.match(await page.locator('#previewStatus').textContent(),/시간이 초과/); passed++;
    // Source scripts and inline handlers cannot read/modify the parent despite same-origin inspection.
    await render('<p>보안 확인</p><script>parent.previewEscaped=true</script><img src="'+image+'" onload="parent.previewEscaped=true"><iframe src="https://example.invalid"></iframe>','360');
    assert.equal(await page.evaluate(()=>window.previewEscaped),undefined);
    assert.equal(await page.frameLocator('#preview').locator('script,iframe').count(),0);
    // Whole CMS page at each mobile viewport, plus the exact child viewports above.
    for(const width of [360,375,412]) {
      await page.setViewportSize({width,height:900});
      await render(Object.values(fixtures).join(''),'auto');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'CMS horizontal overflow '+width);
    }
    assert.deepEqual(writes,[],'preview must never call Blogger APIs');
    assert.deepEqual(jsErrors,[]);
    if(process.env.PREVIEW_SCREENSHOT) await page.screenshot({path:process.env.PREVIEW_SCREENSHOT,fullPage:true});
    console.log(JSON.stringify({passed,exactPreviewWidths:[360,375,412],cmsViewportWidths:[360,375,412],repeatedUpdates:20,bloggerApiRequests:writes.length,jsErrors},null,2));
    await context.close();
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
