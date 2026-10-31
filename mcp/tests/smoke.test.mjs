import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

test("only intended Blogger management tools are registered", () => {
  const s = source("src/index.ts");
  const actual = [...s.matchAll(/registerTool\("([a-z_]+)"/g)].map(x => x[1]).sort();
  assert.deepEqual(actual, ["blog_info", "create_draft", "get_post", "list_posts", "publish_draft", "update_post"].sort());
  assert.ok(!s.includes("DELETE"));
  assert.ok(!s.includes("/revert"));
});

test("blocks edits to other blogs and unapproved identities", () => {
  const s = source("src/index.ts");
  const oauth = source("src/google-handler.ts");
  assert.match(s, /ALLOWED_BLOG_HOST/);
  assert.match(s, /ALLOWED_EMAIL/);
  assert.match(oauth, /verified_email/);
  assert.match(oauth, /ALLOWED_EMAIL/);
});

test("prevents stale writes and publishes drafts only", () => {
  const s = source("src/index.ts");
  assert.match(s, /current.updated !== expected_updated/);
  assert.match(s, /p.updated !== expected_updated/);
  assert.match(s, /p.status !== "DRAFT"/);
  assert.match(s, /z.literal\("PUBLISH"\)/);
  assert.match(s, /isDraft=true/);
});

test("uses OAuth callback with CSRF and consent handling", () => {
  const oauth = source("src/google-handler.ts");
  assert.match(oauth, /renderApprovalDialog/);
  assert.match(oauth, /validateOAuthState/);
  assert.match(oauth, /validateCSRFToken/);
  assert.match(oauth, /https:\/\/www.googleapis.com\/auth\/blogger/);
  assert.match(source("src/utils.ts"), /"access_type", "offline"/);
});

test("does not embed secrets in public source", () => {
  const s = source("src/index.ts") + source("src/google-handler.ts");
  assert.ok(!s.includes("client_secret: \""));
  assert.ok(!s.includes("refresh_token: \""));
  assert.ok(!s.includes("localStorage"));
  assert.ok(!s.includes("sessionStorage"));
});
