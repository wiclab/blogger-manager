import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const ui=read("../../editor.html");
const fill=read("../../draft-test-fill.js");
const body=read("../../draft-test-article.html");

test("sample article has strong mobile styles and no extra image/H1/scripts",()=>{
  assert.ok(body.includes(".bss-upload-test"));
  assert.ok(body.includes("@media(max-width:600px)"));
  assert.equal((body.match(/<h2>/g)||[]).length,5);
  assert.doesNotMatch(body,/<h1\b|<script\b|<img\b/i);
  assert.match(body,/<article class="bss-upload-test">/);
});

test("UI imports sample filler and includes explicit undo",()=>{
  assert.match(ui,/id="loadSample"/);
  assert.match(ui,/id="undoSample"/);
  assert.match(ui,/src="\.\/draft-test-fill\.js"/);
});

test("filler requires draft, existing R2 cover and confirmation",()=>{
  assert.match(fill,/isDraftSelection\(identity\)/);
  assert.match(fill,/extractR2Cover\(currentHtml,origin\)/);
  assert.match(fill,/window\.confirm/);
  assert.match(fill,/figure\.outerHTML/);
  assert.match(fill,/backup=\{identity,title:/);
  assert.doesNotMatch(fill,/\/publish|method:\s*["']POST|Google.*token/i);
});

test("upload cover retains R2 origin restrictions",()=>{
  assert.match(fill,/url\.origin===workerOrigin/);
  assert.match(fill,/\/images\\\/20/);
});
