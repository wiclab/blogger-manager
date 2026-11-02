// Static source extraction + pure-function smoke tests for Blogger Manager link actions.
// No browser, no network, no Blogger writes.
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const html=fs.readFileSync("indexing.html","utf8");
function between(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert(a>=0&&b>a, "Expected function not found: "+start);
 return html.slice(a,b);
}
const canonical=between("function canonical(raw){","const INDEXING_DATA_BASE=");
const actions=between("function bloggerEditURL(raw){","function renderLinkRows(){");
const f=vm.runInNewContext(
 "(function(){"+canonical+actions+"return {bloggerEditURL,linkHtmlSnippet};})()",
 {URL}
);
const good="https://www.blogger.com/blog/post/edit/1659014803305858421/9098581934010072421";
assert.equal(f.bloggerEditURL(good),good);
for(const bad of [
 "https://ggpong.blogspot.com/blog/post/edit/1/2",
 "http://www.blogger.com/blog/post/edit/1/2",
 "https://www.blogger.com.evil.example/blog/post/edit/1/2",
 "https://www.blogger.com/blog/post/edit/1/2?x=1",
 "https://www.blogger.com/blog/post/edit/1/2#frag",
 "https://www.blogger.com/blog/post/edit/1/../../x",
 "https://www.blogger.com/blog/post/edit/abc/2",
 "javascript:alert(1)",
 undefined
]) assert.equal(f.bloggerEditURL(bad),null, "Unsafe edit URL accepted: "+bad);
const dest="https://wic12.blogspot.com/2026/10/sample.html";
const sample=f.linkHtmlSnippet(dest,'A & B <script>alert("x")</script>');
assert.equal(sample,'<a href="'+dest+'">A &amp; B &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</a>');
assert.equal(f.linkHtmlSnippet("https://qevnaxori.blogspot.com/2026/10/sample.html","Other"),null);
assert.equal(f.linkHtmlSnippet("javascript:alert(1)","Bad"),null);
assert.equal(f.linkHtmlSnippet("http://wic12.blogspot.com/2026/10/sample.html","Bad"),null);
assert(!html.includes("fetch(edit"),"UI must not submit Blogger edits");
console.log("Blogger quick-link actions: 16 offline safety assertions passed.");
