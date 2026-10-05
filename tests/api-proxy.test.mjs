import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "../app/api/[...path]/route.ts";

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

test("proxy forwards bounded research submissions as JSON", async (t) => {
  let options;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    options = init;
    return Response.json(
      { id: "a".repeat(32), status: "queued" },
      { status: 202 },
    );
  });
  const response = await POST(
    new Request("http://localhost/api/jobs", {
      method: "POST",
      body: JSON.stringify({ kind: "analysis", symbols: ["CIEN"] }),
    }),
    { params: Promise.resolve({ path: ["jobs"] }) },
  );
  assert.equal(response.status, 202);
  assert.equal(options.method, "POST");
  assert.deepEqual(JSON.parse(options.body).symbols, ["CIEN"]);
  const oversized = await POST(
    new Request("http://localhost/api/jobs", {
      method: "POST",
      body: "x".repeat(8193),
    }),
    { params: Promise.resolve({ path: ["jobs"] }) },
  );
  assert.equal(oversized.status, 413);
});

test("proxy preserves ledger download headers and blocks writes to other routes", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("side,price\nBUY,10", {
        headers: {
          "content-type": "text/csv",
          "content-disposition": 'attachment; filename="ledger.csv"',
        },
      }),
  );
  const response = await GET(
    new Request("http://localhost/api/jobs/" + "a".repeat(32) + "/ledger"),
    { params: Promise.resolve({ path: ["jobs", "a".repeat(32), "ledger"] }) },
  );
  assert.match(response.headers.get("content-disposition"), /ledger.csv/);
  const invalid = await POST(
    new Request("http://localhost/api/health", { method: "POST", body: "{}" }),
    { params: Promise.resolve({ path: ["health"] }) },
  );
  assert.equal(invalid.status, 404);
});
