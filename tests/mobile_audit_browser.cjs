"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const {chromium}=require("playwright");
const {evaluateLayout}=require("../scripts/mobile_audit_scan.cjs");

(async function(){
 const browser=await chromium.launch({headless:true,args:["--disable-dev-shm-usage"]});
 try{
  const context=await browser.newContext({viewport:{width:320,height:860},isMobile:true});
  const page=await context.newPage();
  const narrow="매달 백만 원 사용 결제 비율 삼십 퍼센트 연 수수료율 십칠 퍼센트 가정 모바일 텍스트 줄바꿈 검증용 문장 ";
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+
   '<style>body{margin:0;font:16px/24px sans-serif}.post-body{padding:8px}.narrow{width:85px;background:#f1edff;word-break:break-all}'+
   'table{width:800px;border-collapse:collapse}th,td{padding:10px}</style></head><body>'+
   '<article class="post-body"><div class="narrow">'+narrow.repeat(4)+'</div>'+
   '<table><tbody><tr><th>월차</th><th>총 사용금액</th><th>납부액</th></tr>'+
   '<tr><td>1</td><td>1,000,000</td><td>300,000</td></tr></tbody></table></article></body></html>');
  const broken=await page.evaluate(evaluateLayout,320);
  const types=new Set(broken.map(x=>x.type));
  assert(types.has("narrow_text"),"Should detect narrow multi-line text");
  assert(types.has("horizontal_overflow"),"Should detect body width overflow");
  assert(types.has("table_overflow"),"Should detect table outside scroll wrapper");
  const shot=path.join(os.tmpdir(),"mobile-audit-positive-smoke.jpg");
  await page.screenshot({path:shot,type:"jpeg",quality:65});
  assert((await fs.stat(shot)).size>1000,"Should produce screenshot evidence");
  await fs.unlink(shot);
  console.log("Positive browser fixture: narrow text + table overflow detected; screenshot written");

  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+
   '<style>body{margin:0;font:16px/24px sans-serif}.post-body{padding:8px}'+
   '.scroll{max-width:100%;overflow-x:auto}table{min-width:800px}p{margin:8px 0}</style></head><body>'+
   '<article class="post-body"><p>정상 줄바꿈이 가능한 모바일 화면입니다. 문단 너비는 화면에 맞게 자연스럽게 조절됩니다.</p>'+
   '<div class="scroll"><table><tr><th>월차</th><th>총 이용 금액</th><th>수수료</th></tr></table></div></article></body></html>');
  const clean=await page.evaluate(evaluateLayout,320);
  assert(!clean.some(x=>["narrow_text","table_overflow","horizontal_overflow"].includes(x.type)),
   "A deliberately scrollable table should not be flagged as breaking the entire mobile viewport");
  console.log("Negative browser fixture: responsive paragraph + contained table not flagged");
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
