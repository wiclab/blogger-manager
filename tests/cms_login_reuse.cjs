"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const inline = file => {
  const blocks = [...read(file).matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi)];
  const code = blocks.map(x => x[1]).find(x => x.includes("restoreSession") || x.includes("async function login()"));
  assert.ok(code, file + ": inline script missing");
  return code;
};
const okResponse = (status, data) => ({
  status, ok: status >= 200 && status < 300, json: async () => data
});

function sandbox(initialToken = "") {
  const store = new Map(initialToken ? [["bloggerManagerIdToken", initialToken]] : []);
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, disabled: false, className: "", value: "", textContent: "",
      style: {}, dataset: {}, href: "", classList: {
        add() {}, remove() {}, toggle() {}, contains() {return false;}
      },
      addEventListener() {}, setAttribute() {}, replaceChildren() {}, append() {},
      removeAttribute() {}, querySelectorAll() {return [];}
    });
    return elements.get(id);
  };
  const calls = {prompt: 0, disable: 0, oauth: []};
  const gis = {
    id: {
      initialize() {}, renderButton() {},
      prompt() {calls.prompt++;},
      disableAutoSelect() {calls.disable++;}
    },
    oauth2: {
      initTokenClient() {
        return {requestAccessToken(config) {calls.oauth.push(config);}};
      }
    }
  };
  const google = {accounts:gis};
  const window = {google, addEventListener() {}, open() {}};
  const ctx = vm.createContext({
    window, google, console, URL, Headers,
    sessionStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key,v) => store.set(key,String(v)),
      removeItem: key => store.delete(key)
    },
    localStorage: {getItem() {return null;}, setItem() {}},
    document: {
      head: {appendChild() {}},
      createElement() {return el("created");},
      getElementById: el,
      querySelectorAll() {return [];}
    },
    location: {reload() {}},
    setTimeout() {}, alert() {}, confirm() {return false;},
    fetch: async () => {throw Error("fetch not stubbed");}
  });
  return {ctx, store, el, calls, eval: code => vm.runInContext(code,ctx,{timeout:3000})};
}

(async () => {
  const write = sandbox("keep-write");
  write.eval(inline("write.html"));
  write.ctx.fetch = async () => okResponse(503,{error:"backend unavailable"});
  assert.equal(await write.eval("restoreSession()"), false);
  assert.equal(write.store.get("bloggerManagerIdToken"),"keep-write");
  assert.equal(write.el("sessionRetry").hidden,false);
  write.ctx.fetch = async () => okResponse(200,{});
  assert.equal(await write.eval("restoreSession()"), false);
  assert.equal(write.store.get("bloggerManagerIdToken"),"keep-write");
  write.ctx.fetch = async () => okResponse(401,{error:"expired"});
  assert.equal(await write.eval("restoreSession()"), false);
  assert.equal(write.store.has("bloggerManagerIdToken"),false);

  const rootLogin = sandbox();
  rootLogin.eval(inline("index.html"));
  rootLogin.eval("initGoogleLogin()");
  assert.equal(rootLogin.calls.prompt,1);
  rootLogin.eval("logout()");
  assert.equal(rootLogin.calls.disable,1);
  assert.equal(rootLogin.store.get("bloggerManagerExplicitLogout"),"1");
  rootLogin.eval("initGoogleLogin()");
  assert.equal(rootLogin.calls.prompt,1);

  const editor = sandbox();
  editor.eval(inline("editor.html"));
  await editor.eval("login()");
  assert.equal(editor.calls.oauth.length,1);
  assert.equal(editor.calls.oauth[0].prompt,"");

  const traffic = sandbox();
  const trafficCode=read("assets/traffic-dashboard.js").replace(/\}\)\(\);\s*$/,
    "globalThis.__traffic={verifyAdmin,connectBlogger};})();");
  assert.notEqual(trafficCode,read("assets/traffic-dashboard.js"));
  traffic.eval(trafficCode);
  traffic.eval("__traffic.connectBlogger()");
  assert.equal(traffic.calls.oauth.length,1);
  assert.equal(traffic.calls.oauth[0].prompt,"");

  traffic.store.set("bloggerManagerIdToken","keep-traffic");
  traffic.ctx.fetch = async () => okResponse(503,{error:"temporary"});
  assert.equal(await traffic.eval("__traffic.verifyAdmin()"),false);
  assert.equal(traffic.store.get("bloggerManagerIdToken"),"keep-traffic");
  assert.equal(traffic.el("gaRetry").hidden,false);
  traffic.ctx.fetch = async () => okResponse(401,{error:"expired"});
  assert.equal(await traffic.eval("__traffic.verifyAdmin()"),false);
  assert.equal(traffic.store.has("bloggerManagerIdToken"),false);

  console.log("CMS login reuse regression: 10 assertions/scenarios passed");
})().catch(error => {console.error(error);process.exitCode=1;});
