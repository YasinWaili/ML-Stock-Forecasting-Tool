import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/[...path]/route.ts";

test("proxy forwards allowed requests and query parameters", async (t) => {
  let received;
  t.mock.method(globalThis, "fetch", async (url) => {
    received = url;
    return Response.json({ results: [{ symbol: "CIEN" }] });
  });
  const response = await GET(
    new Request("http://localhost/api/stocks/search?q=Ciena"),
    { params: Promise.resolve({ path: ["stocks", "search"] }) },
  );
  assert.equal(response.status, 200);
  assert.equal(received.pathname, "/api/stocks/search");
  assert.equal(received.searchParams.get("q"), "Ciena");
});

test("proxy rejects arbitrary paths without a network request", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("must not run");
  });
  const response = await GET(new Request("http://localhost/api/private"), {
    params: Promise.resolve({ path: ["..", "private"] }),
  });
  assert.equal(response.status, 404);
  assert.equal(fetch.mock.callCount(), 0);
});

test("proxy reports offline API as an actionable 503", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("connection refused");
  });
  const response = await GET(new Request("http://localhost/api/health"), {
    params: Promise.resolve({ path: ["health"] }),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).detail, /Start both services/);
});

test("proxy preserves image content and browser cache headers", async (t) => {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(bytes, {
        headers: {
          "content-type": "image/png",
          "cache-control": "public, max-age=86400",
        },
      }),
  );
  const response = await GET(
    new Request("http://localhost/api/stocks/CIEN/logo"),
    { params: Promise.resolve({ path: ["stocks", "CIEN", "logo"] }) },
  );
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.match(response.headers.get("cache-control"), /86400/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});
