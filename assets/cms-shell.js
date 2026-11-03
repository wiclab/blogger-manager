/* Shared CMS navigation. Does not read credentials or mutate Blogger content. */
(function(){
'use strict';
var groups=[
 {title:'작업 공간',items:[['dashboard.html','운영 대시보드','◫'],['traffic.html','방문 통계','📊'],['index.html','게시글 관리','▤'],['editor.html','글 편집·발행','✎']]},
 {title:'콘텐츠 기획',items:[['news.html','뉴스 수집','▣'],['intelligence.html','뉴스 인텔리전스','✧'],['write.html','주제 발굴','◎']]},
 {title:'검색 · 품질',items:[['seo.html','Bing · 글 갱신','↗'],['indexing.html','별셈소 Bing 제출','⇧'],['nobody-indexing.html','노바디 Bing 제출','⇧'],['gsc.html','Google 색인 관제','⌕'],['mobile-audit.html','모바일 오류 사냥꾼','▣'],['sources.html','출처 링크 점검','🔗']]}
];
function el(tag,cls,text){var x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x;}
function init(){
 if(document.querySelector('.cms-sidebar'))return;
 var app=document.getElementById('app'),isLoginGated=!!(app&&app.tagName==='MAIN'),host=document.body;
 var current=location.pathname.split('/').pop()||'index.html',title='운영 대시보드';
 var overlay=el('div','cms-overlay');overlay.id='cms-overlay';document.body.appendChild(overlay);
 var aside=el('aside','cms-sidebar');aside.id='cms-sidebar';aside.setAttribute('aria-label','CMS 전체 메뉴');
 var brand=el('a','cms-brand');brand.href='./dashboard.html';
 var brandText=el('span');brandText.append(el('strong','', 'Blogger Manager'),el('small','', 'CONTENT MANAGEMENT'));
 brand.append(el('span','cms-brand-mark','B'),brandText);aside.appendChild(brand);
 var nav=el('nav','cms-nav');nav.setAttribute('aria-label','관리 메뉴');
 groups.forEach(function(group){
  var section=el('div','cms-nav-group');section.appendChild(el('div','cms-nav-title',group.title));
  group.items.forEach(function(item){
   var a=el('a','cms-nav-link');a.href='./'+item[0];
   a.append(el('span','cms-nav-icon',item[2]),el('span','',item[1]));
   if(item[0]===current){a.setAttribute('aria-current','page');title=item[1];}
   section.appendChild(a);
  });nav.appendChild(section);
 });
 aside.append(nav,el('div','cms-sidebar-foot','블로그 운영 도구 · 기존 Blogger 기능 유지'));
 var bar=el('div','cms-topbar');bar.setAttribute('role','banner');
 var left=el('div','cms-topbar-left'),right=el('div','cms-topbar-right');
 var toggle=el('button','cms-menu-toggle','☰');toggle.type='button';
 toggle.id='cms-menu-toggle';toggle.setAttribute('aria-controls','cms-sidebar');
 toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','관리 메뉴 열기');
 var nobodyPage=current==='nobody-indexing.html';
 left.append(toggle,el('span','cms-topbar-title',title),el('span','cms-topbar-caption',nobodyPage?'/ Nobody Asked Data CMS':'/ 별셈소 CMS'));
 var site=el('a','', '블로그 보기');site.href=nobodyPage?'https://qevnaxori.blogspot.com/':'https://wic12.blogspot.com/';site.rel='noopener noreferrer';site.target='_blank';
 var editor=el('a','cms-topbar-primary','+ 글 작성');editor.href='./editor.html';right.append(site,editor);
 bar.append(left,right);
 host.insertBefore(aside,host.firstChild);host.insertBefore(bar,aside.nextSibling);
 var mobile=window.matchMedia('(max-width:1080px)');
 function syncDrawer(){
  var expanded=mobile.matches&&document.body.classList.contains('cms-drawer-open');
  var active=document.body.classList.contains('cms-enabled')&&(!mobile.matches||expanded);
  aside.inert=!active;
  aside.setAttribute('aria-hidden',String(!active));
  toggle.setAttribute('aria-expanded',String(expanded));
  toggle.setAttribute('aria-label',expanded?'관리 메뉴 닫기':'관리 메뉴 열기');
 }
 function close(back){document.body.classList.remove('cms-drawer-open');syncDrawer();if(back&&mobile.matches)toggle.focus();}
 function open(){if(!document.body.classList.contains('cms-enabled'))return;document.body.classList.add('cms-drawer-open');syncDrawer();(aside.querySelector('[aria-current="page"]')||aside.querySelector('a')).focus();}
 toggle.addEventListener('click',function(){if(document.body.classList.contains('cms-drawer-open'))close(true);else open();});
 overlay.addEventListener('click',function(){close(true);});
 aside.addEventListener('click',function(e){if(e.target.closest('a'))close(false);});
 document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&document.body.classList.contains('cms-drawer-open'))close(true);
  if(e.key==='Tab'&&document.body.classList.contains('cms-drawer-open')){
   var links=Array.from(aside.querySelectorAll('a')),first=links[0],last=links[links.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
 });
 function syncAuth(){
  var shown=!isLoginGated||getComputedStyle(app).display!=='none';
  document.body.classList.toggle('cms-enabled',shown);
  if(!shown||!mobile.matches)close(false);
  syncDrawer();
 }
 if(isLoginGated)new MutationObserver(syncAuth).observe(app,{attributes:true,attributeFilter:['style','class','hidden']});
 if(mobile.addEventListener)mobile.addEventListener('change',syncAuth);
 else if(mobile.addListener)mobile.addListener(syncAuth);
 syncAuth();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
