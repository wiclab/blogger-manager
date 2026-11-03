"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]);
const source = scripts.find(script => script.includes("async function connectBlogger()"));
assert.ok(source, "CMS inline JavaScript must exist");

function harness() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        hidden: false, href: "", textContent: "", className: "",
        style: {}, removeAttribute(name) { if (name === "href") this.href = ""; }
      });
    }
    return elements.get(id);
  };
  const tokens = new Map([["bloggerManagerIdToken", "original-token"]]);
  const context = vm.createContext({
    URL, Headers, console,
    setTimeout: () => {},
    document: {
      head: {appendChild() {}},
      createElement: () => ({}),
      getElementById: get
    },
    sessionStorage: {
      getItem: key => tokens.get(key) || null,
      setItem: (key, value) => tokens.set(key, value),
      removeItem: key => tokens.delete(key)
    },
    localStorage: {getItem() {return null;}, setItem() {}},
    window: {addEventListener() {}, open() {return null;}},
    location: {reload() {}},
    alert() {}, confirm() {return false;}
  });
  vm.runInContext(source, context, {timeout: 2000});
  return {context, get, tokens, run: expression => vm.runInContext(expression, context)};
}

async function testPopupBeforeRequest() {
  const h = harness(), events = [];
  const popup = {
    closed: false,
    location: {replace(url) {events.push("navigate:" + new URL(url).hostname);}},
    focus() {events.push("focus");},
    close() {this.closed = true;}
  };
  h.context.window.open = url => {events.push("popup:" + url);return popup;};
  h.context.events = events;
  h.run('adminApi = async () => { events.push("request"); return {authorizationUrl:"https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture"}; }');
  await h.run("connectBlogger()");
  assert.deepEqual(events.slice(0, 3), ["popup:about:blank", "request", "navigate:accounts.google.com"]);
  assert.equal(h.get("bloggerOAuthFallback").hidden, true);
  assert.equal(h.get("bloggerOAuthMessage").hidden, false);
}

async function testBlockedPopupFallback() {
  const h = harness();
  h.context.window.open = () => null;
  h.run('adminApi = async () => ({authorizationUrl:"https://accounts.google.com/o/oauth2/v2/auth?state=fixture"})');
  await h.run("connectBlogger()");
  assert.equal(h.get("bloggerOAuthFallback").hidden, false);
  assert.match(h.get("bloggerOAuthFallback").href, /^https:\/\/accounts\.google\.com\//);
  assert.equal(h.get("bloggerOAuthMessage").hidden, false);
}

async function testUnsafeRedirectRejected() {
  const h = harness();
  let closed = false;
  h.context.window.open = () => ({
    closed: false, location: {replace() {throw Error("should not navigate");}},
    focus() {}, close() {closed = true;}
  });
  h.run('adminApi = async () => ({authorizationUrl:"https://example.invalid/oauth"})');
  await h.run("connectBlogger()");
  assert.equal(closed, true);
  assert.equal(h.get("bloggerOAuthFallback").hidden, true);
  assert.match(h.get("bloggerOAuthMessage").textContent, /인증 주소/);
}

async function testRetainSessionOnTransientAuthFailure() {
  const h = harness();
  h.context.fetch = async () => ({ok:false,status:503,json:async()=>({error:"temporary"})});
  assert.equal(await h.run("restoreSession()"), false);
  assert.equal(h.tokens.get("bloggerManagerIdToken"), "original-token");
  assert.equal(h.get("sessionRetry").hidden, false);
  h.context.fetch = async () => {throw Error("offline");};
  assert.equal(await h.run("restoreSession()"), false);
  assert.equal(h.tokens.get("bloggerManagerIdToken"), "original-token");
}

async function testClearOnlyRejectedSession() {
  const h = harness();
  h.context.fetch = async () => ({ok:false,status:401,json:async()=>({error:"expired"})});
  assert.equal(await h.run("restoreSession()"), false);
  assert.equal(h.tokens.has("bloggerManagerIdToken"), false);
  assert.equal(h.get("sessionRetry").hidden, true);
}

async function testReportFailureDoesNotLogout() {
  const h = harness();
  h.run('checkBloggerStatus = async () => {}; loadReport = async () => {throw Error("report unavailable");};');
  await h.run('showApp({name:"Admin"})');
  assert.equal(h.get("app").style.display, "block");
  assert.equal(h.get("reportError").hidden, false);
  assert.match(h.get("reportErrorText").textContent, /보고서를 불러오지 못했습니다/);
  assert.equal(h.tokens.get("bloggerManagerIdToken"), "original-token");
  h.run('loadReport = async () => {};');
  assert.equal(await h.run("retryReport()"), true);
  assert.equal(h.get("reportError").hidden, true);
}

(async () => {
  await testPopupBeforeRequest();
  await testBlockedPopupFallback();
  await testUnsafeRedirectRejected();
  await testRetainSessionOnTransientAuthFailure();
  await testClearOnlyRejectedSession();
  await testReportFailureDoesNotLogout();
  console.log("CMS auth/OAuth/report behavioral regression: 6 scenarios passed");
})().catch(error => {console.error(error); process.exitCode = 1;});
