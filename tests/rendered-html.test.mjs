import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("YBM 교과서 심사 지원 앱의 초기 화면을 렌더링한다", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<html[^>]*lang="ko"/i);
  assert.match(html, /<title>YBM 교과서 심사 지원 AI/);
  assert.match(html, /교과서 사전 점검/);
  assert.match(html, /2022 개정 교육과정/);
  assert.match(html, /확인 중/);
  assert.match(html, /교육과정 적합성/);
  assert.match(html, /PDF 나누기/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("API 키가 없으면 AI 검수 설정 오류를 반환한다", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/review", { method: "POST", body: new FormData() }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 503);
  assert.match(await response.text(), /API 키/);
});
