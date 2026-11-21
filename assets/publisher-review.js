"use strict";

const form = document.getElementById("article");
const get = id => document.getElementById(id);
const status = get("status");
const sites = {
  byeol: {name: "별셈소", url: "https://wic12.blogspot.com/"},
  nobody: {name: "Nobody Asked Data", url: "https://qevnaxori.blogspot.com/"}
};
let current;
let generation = 0;

const isLocal = location.hostname === "127.0.0.1" && location.protocol === "http:";
get("previewButton").disabled = !isLocal;
if (!isLocal) status.textContent = "로컬 발행 서버에서 이 화면을 열어 주세요.";

async function api(route, body) {
  if (!isLocal) {
    throw new Error("이 화면은 로컬 발행 서버에서 열어야 합니다.");
  }
  const options = body === undefined ? {} : {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)
  };
  const response = await fetch("/api/publisher/" + route, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function reset() {
  generation++;
  current = undefined;
  window.BloggerPreview.cancel();
  get("review").hidden = true;
  get("consent").checked = false;
  get("approve").disabled = true;
  get("editor").hidden = true;
  status.textContent = "";
}

async function asPng(file) {
  if (!file || file.size > 8 * 1024 * 1024) throw new Error("대표이미지 파일은 8MB 이하여야 합니다.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 24_000_000) throw new Error("이미지는 2,400만 픽셀 이하여야 합니다.");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const data = canvas.toDataURL("image/png");
    if (data.length > 4 * Math.ceil(8 * 1024 * 1024 / 3) + 22) {
      throw new Error("PNG로 변환한 대표이미지가 8MB를 초과합니다.");
    }
    return data;
  } finally {
    bitmap.close();
  }
}

function renderBody() {
  const {article, imageUrl} = current;
  const cover = document.createElement("img");
  cover.src = imageUrl;
  cover.alt = article.alt;
  cover.style.cssText = "display:block;max-width:100%;height:auto;margin:0 auto 22px";
  const template = document.createElement("template");
  template.innerHTML = article.html;
  template.content.querySelectorAll("a[href],area[href]").forEach(node => node.removeAttribute("href"));
  window.BloggerPreview.render(cover.outerHTML + template.innerHTML, get("width").value);
}

function renderReview() {
  const {blog, article} = current;
  const site = sites[blog];
  const metadata = get("metadata");
  metadata.replaceChildren();
  for (const [name, value] of Object.entries({
    "블로그": site.name + " (" + site.url + ")",
    "제목": article.title,
    "맞춤 퍼머링크": article.slug + ".html",
    "라벨": article.label || "없음",
    "검색 설명": article.description || "없음",
    "대표이미지 대체 텍스트": article.alt
  })) {
    const term = document.createElement("dt");
    const definition = document.createElement("dd");
    term.textContent = name;
    definition.textContent = value;
    metadata.append(term, definition);
  }
  const links = get("links");
  links.replaceChildren();
  const template = document.createElement("template");
  template.innerHTML = article.html;
  for (const node of template.content.querySelectorAll("a[href]")) {
    const href = node.getAttribute("href").trim();
    if (!href) continue;
    try {
      const url = new URL(href, site.url);
      const internal = Object.values(sites).some(item => new URL(item.url).hostname === url.hostname);
      if (!internal || !["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
      const li = document.createElement("li");
      // Relative paths and fragment links are resolved by Blogger at publication time.
      li.textContent = (node.textContent.trim() || "이미지 또는 빈 링크") + " · " + href;
      links.append(li);
    } catch {
      // Malformed URLs cannot be classified as internal links.
    }
  }
  if (!links.children.length) {
    const empty = document.createElement("li");
    empty.textContent = "본문에서 내부링크를 찾지 못했습니다.";
    links.append(empty);
  }
  get("review").hidden = false;
  renderBody();
}

form.addEventListener("input", reset);
get("htmlFile").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  const expected = generation;
  try {
    if (file.size > 1000000) throw new Error("본문 HTML 파일은 1MB 이하여야 합니다.");
    const source = new TextDecoder("utf-8", {fatal:true}).decode(await file.arrayBuffer());
    if (expected !== generation) return;
    form.elements.html.value = source;
  } catch (error) {
    if (expected === generation) status.textContent = "HTML 파일을 읽지 못했습니다. " + error.message;
  }
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  reset();
  const expected = generation;
  const input = Object.fromEntries(new FormData(form));
  const button = get("previewButton");
  button.disabled = true;
  status.textContent = "검토본을 준비하는 중입니다.";
  try {
    const imageUrl = await asPng(get("cover").files[0]);
    if (expected !== generation) return;
    input.image = imageUrl.split(",")[1];
    const review = await api("review", input);
    if (expected !== generation) return;
    current = {...review, imageUrl};
    renderReview();
    status.textContent = "";
    get("review").scrollIntoView({block:"start"});
  } catch (error) {
    if (expected === generation) status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

get("width").addEventListener("change", renderBody);
get("consent").addEventListener("change", () => {
  get("approve").disabled = !current || !get("consent").checked;
});

get("approve").addEventListener("click", async () => {
  if (!current || !get("consent").checked) return;
  const id = current.id;
  get("approve").disabled = true;
  get("consent").disabled = true;
  form.inert = true;
  try {
    await api("approve", {id, approved: true});
    while (true) {
      const result = await api(id);
      if (result.editorUrl) {
        get("editor").href = result.editorUrl;
        get("editor").hidden = false;
      }
      if (result.status === "stopped") throw new Error(result.error);
      if (result.status === "browser_closed") {
        status.textContent = "Blogger 창이 닫혔습니다. 게시 여부와 공개 주소는 Blogger에서 확인하세요.";
        break;
      }
      status.textContent = result.status === "awaiting_blogger_confirmation"
        ? "임시글 저장을 확인했습니다. 열린 Blogger 창에서 최종 검토 후 게시할 수 있습니다."
        : "검토한 원고와 대표이미지를 Blogger에 전송 중입니다.";
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
  } catch (error) {
    status.textContent = error.message;
  } finally {
    get("consent").checked = false;
    get("consent").disabled = false;
    form.inert = false;
  }
});
