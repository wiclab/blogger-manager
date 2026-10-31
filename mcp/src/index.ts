import { env } from "cloudflare:workers";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { GoogleHandler } from "./google-handler";

export type Props = {
  email: string;
  name: string;
  accessToken: string;
  refreshToken?: string;
  googleExpiresAt: number;
};

type Post = { id: string; title?: string; content?: string; labels?: string[]; status?: string; updated?: string; url?: string };
type Blog = { id: string; name: string; url: string };

const API = "https://www.googleapis.com/blogger/v3";

function fail(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
function ok(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
async function run(action: () => Promise<unknown>) {
  try { return ok(await action()); }
  catch (error) { return fail(error instanceof Error ? error.message : "알 수 없는 Blogger 오류"); }
}

async function googleToken() {
  const props = getMcpAuthContext()?.props as Props | undefined;
  if (!props?.email || !props.accessToken) throw new Error("Google 연결이 필요합니다.");
  if (!env.ALLOWED_EMAIL || props.email.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) {
    throw new Error("허용된 관리 계정이 아닙니다.");
  }
  // Upstream Google access tokens normally expire after ~1 hour.
  if (Date.now() < Number(props.googleExpiresAt) - 60000) return props.accessToken;
  if (!props.refreshToken) throw new Error("Google 인증이 만료되었습니다. MCP 연결을 다시 승인해주세요.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: props.refreshToken,
      grant_type: "refresh_token"
    })
  });
  if (!response.ok) throw new Error("Google 재인증이 필요합니다. MCP 연결을 다시 승인해주세요.");
  const result = await response.json() as { access_token?: string };
  if (!result.access_token) throw new Error("Google 갱신 토큰 응답이 잘못되었습니다.");
  return result.access_token;
}

async function googleApi<T>(token: string, route: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch(API + route, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(data === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  const body = await response.text();
  let result: any;
  try { result = body ? JSON.parse(body) : {}; } catch { result = {}; }
  if (!response.ok) {
    const message = String(result?.error?.message || response.statusText || "요청 실패");
    throw new Error("Blogger API " + response.status + ": " + message.slice(0, 300));
  }
  return result as T;
}

async function context() {
  const accessToken = await googleToken();
  const result = await googleApi<{ items?: Blog[] }>(accessToken, "/users/self/blogs");
  const host = env.ALLOWED_BLOG_HOST?.toLowerCase();
  if (!host) throw new Error("서버의 ALLOWED_BLOG_HOST 설정이 필요합니다.");
  const blog = (result.items || []).find(item => {
    try { return new URL(item.url).hostname.toLowerCase() === host; } catch { return false; }
  });
  if (!blog) throw new Error("로그인한 계정에서 허용된 블로그를 찾을 수 없습니다.");
  return { accessToken, blog };
}

function postId(id: string) {
  if (!/^[0-9]{1,30}$/.test(id)) throw new Error("유효하지 않은 게시물 ID입니다.");
  return encodeURIComponent(id);
}

async function loadPost(accessToken: string, blogId: string, id: string): Promise<Post> {
  return googleApi<Post>(accessToken, "/blogs/" + encodeURIComponent(blogId) + "/posts/" + postId(id) + "?view=ADMIN");
}

function createServer() {
  const server = new McpServer({ name: "Byeolsemso Blogger", version: "0.1.0" });

  server.registerTool("blog_info", {
    description: "연결된 Google 계정과 허용된 별셈소 Blogger 블로그 확인. 글 변경 전 먼저 사용하세요.",
    inputSchema: z.object({})
  }, async () => run(async () => {
    const { blog } = await context();
    return { id: blog.id, title: blog.name, url: blog.url };
  }));

  server.registerTool("list_posts", {
    description: "별셈소 게시물 목록 읽기. 제목, 게시 상태, 수정 시각, ID를 반환합니다. 초안/발행글 지원.",
    inputSchema: z.object({
      status: z.enum(["live", "draft", "scheduled"]).default("live"),
      max_results: z.number().int().min(1).max(100).default(30),
      page_token: z.string().max(1000).optional()
    })
  }, async ({ status, max_results, page_token }) => run(async () => {
    const { accessToken, blog } = await context();
    const qs = new URLSearchParams({ status, maxResults: String(max_results), fetchBodies: "false", view: "ADMIN" });
    if (page_token) qs.set("pageToken", page_token);
    const data = await googleApi<{ items?: Post[]; nextPageToken?: string }>(accessToken,
      "/blogs/" + encodeURIComponent(blog.id) + "/posts?" + qs);
    return {
      blog: blog.name, next_page_token: data.nextPageToken || null,
      posts: (data.items || []).map(p => ({
        id: p.id, title: p.title, status: p.status, updated: p.updated, url: p.url
      }))
    };
  }));

  server.registerTool("get_post", {
    description: "별셈소 글의 전체 HTML, 라벨, 제목, 수정시각 조회. 수정할 때 expected_updated에 이 updated 값을 사용하세요.",
    inputSchema: z.object({ post_id: z.string().max(30) })
  }, async ({ post_id }) => run(async () => {
    const { accessToken, blog } = await context();
    const p = await loadPost(accessToken, blog.id, post_id);
    if ((p.content || "").length > 300000) throw new Error("본문이 너무 깁니다. 관리자 편집기에서 직접 수정하세요.");
    return { blog: blog.name, id: p.id, title: p.title, html: p.content, labels: p.labels || [], status: p.status, updated: p.updated, url: p.url };
  }));

  server.registerTool("create_draft", {
    description: "별셈소에 공개되지 않는 새 임시글 생성. 맞춤 퍼머링크·검색설명·이미지 업로드는 Blogger 관리자에서 발행 전에 설정해야 합니다.",
    inputSchema: z.object({
      title: z.string().trim().min(3).max(160),
      html: z.string().min(1).max(300000),
      labels: z.array(z.string().min(1).max(60)).max(5).default([])
    })
  }, async ({ title, html, labels }) => run(async () => {
    const { accessToken, blog } = await context();
    const created = await googleApi<Post>(accessToken,
      "/blogs/" + encodeURIComponent(blog.id) + "/posts?isDraft=true",
      "POST", { kind: "blogger#post", blog: { id: blog.id }, title, content: html, labels });
    return { action: "draft_created", id: created.id, title: created.title, status: created.status, updated: created.updated, blogger_editor: "https://www.blogger.com/blog/post/edit/" + blog.id + "/" + created.id,
      reminder: "공개 전 맞춤 퍼머링크, 검색설명, 대표이미지를 Blogger 관리자에서 확인하세요." };
  }));

  server.registerTool("update_post", {
    description: "별셈소 글 수정(HTML, 제목, 라벨). 먼저 get_post로 현재 updated를 받고 정확히 일치할 때만 변경합니다. 생략한 항목은 유지합니다.",
    inputSchema: z.object({
      post_id: z.string().max(30),
      expected_updated: z.string().min(10).max(80),
      title: z.string().trim().min(3).max(160).optional(),
      html: z.string().min(1).max(300000).optional(),
      labels: z.array(z.string().min(1).max(60)).max(5).optional()
    })
  }, async ({ post_id, expected_updated, title, html, labels }) => run(async () => {
    const { accessToken, blog } = await context();
    const current = await loadPost(accessToken, blog.id, post_id);
    if (current.updated !== expected_updated) throw new Error("글이 다른 곳에서 수정됐습니다. get_post로 원문을 다시 읽으세요.");
    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = title;
    if (html !== undefined) patch.content = html;
    if (labels !== undefined) patch.labels = labels;
    if (!Object.keys(patch).length) throw new Error("수정할 필드가 없습니다.");
    const updated = await googleApi<Post>(accessToken,
      "/blogs/" + encodeURIComponent(blog.id) + "/posts/" + postId(post_id),
      "PATCH", patch);
    return { action: "post_updated", id: updated.id, title: updated.title, status: updated.status, updated: updated.updated, url: updated.url };
  }));

  server.registerTool("publish_draft", {
    description: "기존 임시글을 즉시 공개 발행합니다. 사용자에게 발행 지시를 받은 경우에만 실행. 퍼머링크·검색설명·대표이미지 확인 후 사용하세요.",
    inputSchema: z.object({
      post_id: z.string().max(30),
      expected_updated: z.string().min(10).max(80),
      confirm: z.literal("PUBLISH")
    })
  }, async ({ post_id, expected_updated }) => run(async () => {
    const { accessToken, blog } = await context();
    const p = await loadPost(accessToken, blog.id, post_id);
    if (p.status !== "DRAFT" && p.status !== "draft") throw new Error("임시글이 아니므로 발행할 수 없습니다.");
    if (p.updated !== expected_updated) throw new Error("글이 변경됐습니다. get_post로 원문을 다시 확인하세요.");
    const published = await googleApi<Post>(accessToken,
      "/blogs/" + encodeURIComponent(blog.id) + "/posts/" + postId(post_id) + "/publish", "POST");
    return { action: "post_published", id: published.id, title: published.title, status: published.status, url: published.url };
  }));

  return server;
}

const mcpHandler = createMcpHandler(createServer);
export default new OAuthProvider<Env>({
  apiHandler: { fetch(request: Request, bindings: Env, ctx: ExecutionContext) {
    return mcpHandler(request, bindings, ctx);
  }},
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: GoogleHandler as any,
  tokenEndpoint: "/token",
  resourceMetadata: { resource: env.MCP_RESOURCE }
});
