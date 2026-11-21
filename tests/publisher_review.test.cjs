"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {setTimeout: pause} = require("node:timers/promises");
const {createPublisher} = require("../scripts/publisher_review.cjs");

const input = {
  blog: "byeol", title: "검토용 제목", slug: "review-example.html",
  html: '<p><a href="/2026/11/sample.html">관련 글</a></p>',
  alt: "대표이미지 설명", description: "", label: "생활정보, 게임, 게임",
  image: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGPkSTnxn4GBgYGJAQoAIOwCO1zDvI0AAAAASUVORK5CYII="
};

async function until(read, status) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = read();
    if (result.status === status) return result;
    await pause(10);
  }
  assert.fail("Did not reach " + status);
}

test("review snapshots are local, one-time, and superseded by new edits", async t => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "publisher-review-"));
  t.after(() => fs.rm(workdir, {recursive: true, force: true}));
  const env = {BLOGGER_BYEOL_ID: "1659014803305858421"};
  const calls = [];
  const editorUrl = "https://www.blogger.com/blog/post/edit/1659014803305858421/123";
  let release;
  const browser = new Promise(resolve => { release = resolve; });
  const publisher = createPublisher({workdir, env, runner: async (job, article, file, opts, handoff) => {
    calls.push({job, article, image: await fs.readFile(file, "base64")});
    handoff.manualPublish.onReady({editorUrl});
    await browser;
    return {editorUrl};
  }});
  const previous = publisher.prepare(input);
  const reviewed = publisher.prepare({...input, title: "최종 제목"});
  assert.equal(reviewed.article.slug, "review-example");
  assert.equal(reviewed.article.label, "생활정보, 게임");
  assert.deepEqual(calls, []);
  assert.deepEqual(await fs.readdir(workdir), []);
  assert.throws(() => publisher.approve(previous.id), /만료/);
  publisher.approve(reviewed.id);
  assert.throws(() => publisher.approve(reviewed.id), /진행 중/);
  assert.throws(() => publisher.prepare(input), /Blogger 창/);
  await until(() => publisher.get(reviewed.id), "awaiting_blogger_confirmation");
  assert.equal(calls[0].job.blog, input.blog);
  assert.equal(calls[0].article.title, "최종 제목");
  assert.equal(calls[0].article.html, input.html);
  assert.equal(calls[0].image, input.image);
  release();
  await until(() => ({status: publisher.busy() ? "busy" : "idle"}), "idle");
  assert.equal(publisher.get(reviewed.id).status, "browser_closed");
  const restarted = createPublisher({workdir, env, runner: () => assert.fail("Duplicate transfer")});
  const repeat = restarted.prepare(input);
  restarted.approve(repeat.id);
  assert.match((await until(() => restarted.get(repeat.id), "stopped")).error, /전송 기록/);
});

test("review rejects invalid destinations, permalink and image, and needs configuration before approval", () => {
  const publisher = createPublisher({env: {}});
  assert.throws(() => publisher.prepare({...input, blog: "__proto__"}), /블로그/);
  assert.throws(() => publisher.prepare({...input, slug: "../../test"}), /퍼머링크/);
  assert.throws(() => publisher.prepare({...input, image: "invalid"}), /PNG/);
  const reviewed = publisher.prepare({...input, blog: "nobody"});
  assert.throws(() => publisher.approve(reviewed.id), /BLOGGER_NOBODY_ID/);
  assert.equal(publisher.get(reviewed.id).status, "review");
});
