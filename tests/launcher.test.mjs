import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("launcher refuses an older running API instead of silently reusing it", () => {
  const launcher = new URL("../scripts/run.mjs", import.meta.url).href;
  const source = `globalThis.fetch = async () => Response.json({status:"ok", version:"0.1.0"}); await import(${JSON.stringify(launcher)});`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env, STOCK_API_URL: "http://127.0.0.1:8010" },
    },
  );
  assert.equal(child.status, 1);
  assert.match(child.stderr, /older API is still running/);
  assert.match(child.stderr, /Stop that server/);
});
