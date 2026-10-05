import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: handler } = await import(workerUrl.href);
  const request = new Request("http://localhost/", {
    headers: { accept: "text/html" },
  });

  if (typeof handler === "function") return handler(request);

  return handler.fetch(
    request,
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Stock Analysis workspace without fake account controls", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Stock Analysis/);
  assert.match(html, /Search a company or ticker/);
  assert.match(html, /Switch to light theme/);
  assert.match(html, /Price history/);
  assert.match(html, /Model comparison/);
  assert.match(html, /Research lab/);
  assert.match(html, /Saved runs/);
  assert.doesNotMatch(
    html,
    /codex-preview|react-loading-skeleton|Starter Project|northstar|Notifications|Settings|>YW</i,
  );
  assert.doesNotMatch(html, /239\.42/); // Never silently show the old synthetic price.
});
