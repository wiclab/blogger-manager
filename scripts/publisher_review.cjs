"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const {BLOGS, blogId} = require("./draft_studio_core.cjs");
const {runChromium} = require("./draft_studio_blogger.cjs");

const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_REQUEST = 12 * 1024 * 1024;
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const REVIEW_LIFETIME = 30 * 60 * 1000;

function validate(value) {
  if (!value || !Object.hasOwn(BLOGS, value.blog)) throw Error("발행할 블로그를 선택하세요.");
  function field(name, limit, required = true) {
    if (typeof value[name] !== "string") throw Error(name + " 입력 형식을 확인하세요.");
    const text = value[name].trim();
    if ((required && !text) || text.length > limit) throw Error(name + " 입력 길이를 확인하세요.");
    return text;
  }
  const blog = value.blog;
  const slug = field("slug", 75).replace(/\.html$/i, "");
  if (slug.length > 70 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw Error("퍼머링크는 70자 이내의 영문 소문자, 숫자, 하이픈으로 입력하세요.");
  }
  const title = field("title", 180);
  const label = field("label", 509, false).split(",").map(item => item.trim()).filter(Boolean);
  if (label.length > 10 || label.some(item => item.length > 50 || /[<>\r\n]/.test(item))) {
    throw Error("라벨은 쉼표로 구분해 최대 10개까지 입력하세요.");
  }
  if (/[\r\n]/.test(title)) throw Error("제목은 한 줄로 입력하세요.");
  const html = field("html", 250000);
  if (/<\/?(?:html|head|body)\b|<!doctype\b/i.test(html)) {
    throw Error("HTML 문서 전체 대신 Blogger 본문에 들어갈 HTML 조각을 입력하세요.");
  }
  const alt = field("alt", 160);
  const description = field("description", 165, false);
  const image = Buffer.from(field("image", Math.ceil(MAX_IMAGE / 3) * 4), "base64");
  if (image.length > MAX_IMAGE || !image.subarray(0, 8).equals(PNG)) {
    throw Error("8MB 이하 PNG 대표이미지가 필요합니다.");
  }
  return {blog, article: {title, slug, label: [...new Set(label)].join(", "), html, alt, description}, image};
}

async function readReviewBody(req, maxBytes = MAX_REQUEST) {
  if (req.headers["content-type"] !== "application/json") throw Error("JSON 요청이 필요합니다.");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Error("요청 크기 제한을 초과했습니다.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createPublisher({workdir, runner = runChromium, env = process.env, isBusy = () => false}) {
  let review;
  let active = false;

  function prepare(input) {
    if (active) throw Error("Blogger 창에서 진행 중인 작업을 먼저 마치세요.");
    const payload = validate(input);
    review = {
      ...payload, id: crypto.randomUUID(), expiresAt: Date.now() + REVIEW_LIFETIME,
      status: "review"
    };
    return report(review);
  }

  function report(item) {
    return {
      id: item.id, blog: item.blog, article: item.article, status: item.status,
      editorUrl: item.editorUrl, error: item.error
    };
  }

  function lookup(id) {
    if (!review || review.id !== id || (review.status === "review" && Date.now() >= review.expiresAt)) {
      throw Error("검토본이 만료되었거나 교체됐습니다. 미리보기를 다시 만드세요.");
    }
    return review;
  }

  async function transfer(item) {
    let dir;
    try {
      await fs.mkdir(workdir, {recursive: true, mode: 0o700});
      // Keep an exclusive receipt for the blog and slug, even after uncertainty or restart.
      const receipt = path.join(workdir, item.blog + "-" + item.article.slug + ".json");
      await fs.writeFile(receipt, JSON.stringify({id: item.id, at: new Date().toISOString()}),
        {flag: "wx", mode: 0o600});
      dir = await fs.mkdtemp(path.join(workdir, "cover-"));
      const file = path.join(dir, "featured.png");
      await fs.writeFile(file, item.image, {mode: 0o600});
      const result = await runner({blog: item.blog}, item.article, file, env, {
        manualPublish: {
          onReady(record) {
            item.status = "awaiting_blogger_confirmation";
            item.editorUrl = record.editorUrl;
          }
        }
      });
      item.editorUrl = result.editorUrl;
      item.status = "browser_closed";
    } catch (error) {
      item.status = "stopped";
      item.editorUrl = error.partialRecord?.editorUrl;
      item.error = error.code === "EEXIST"
        ? "같은 블로그와 퍼머링크의 전송 기록이 있습니다. Blogger에서 기존 임시글과 게시 상태를 확인하세요."
        : String(error.message || error).slice(0, 280);
    } finally {
      try {
        if (dir) await fs.rm(dir, {recursive: true, force: true});
      } finally {
        item.image = null;
        active = false;
      }
    }
  }

  function approve(id) {
    const item = lookup(id);
    if (item.status !== "review" || active || isBusy()) throw Error("이미 처리한 요청이거나 다른 Blogger 작업이 진행 중입니다.");
    if (!Object.hasOwn(BLOGS, item.blog)) throw Error("알 수 없는 Blogger 대상입니다.");
    blogId(item, env);
    active = true;
    item.status = "transferring";
    void transfer(item).catch(() => {});
    return report(item);
  }

  return {prepare, approve, get: id => report(lookup(id)), busy: () => active};
}

module.exports = {createPublisher, readReviewBody};
