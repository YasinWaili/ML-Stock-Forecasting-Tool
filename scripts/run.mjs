import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const production = process.argv.includes("--production");
const port = process.env.STOCK_API_PORT || "8010";
const apiUrl = process.env.STOCK_API_URL || `http://127.0.0.1:${port}`;
const python = resolve(
  root,
  "backend/.venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const children = [];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 300).unref();
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
function launch(command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!closing) stop(code ?? 1);
  });
  return child;
}
async function healthy() {
  try {
    const response = await fetch(`${apiUrl}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok && (await response.json()).status === "ok";
  } catch {
    return false;
  }
}
if (!(await healthy())) {
  if (process.env.STOCK_API_URL) {
    console.error(`The configured API is not responding at ${apiUrl}.`);
    process.exit(1);
  }
  if (!existsSync(python)) {
    console.error(
      "Set up the Python environment first. See the Run locally section in README.md.",
    );
    process.exit(1);
  }
  console.log(`Starting Stock Analysis API at ${apiUrl}`);
  launch(
    python,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", port],
    { ...process.env, PYTHONPATH: resolve(root, "backend") },
  );
  let ready = false;
  for (let attempt = 0; attempt < 40 && !closing; attempt++) {
    if (await healthy()) {
      ready = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!ready) {
    console.error(
      "The API could not start. If this port is blocked, set STOCK_API_PORT to another port.",
    );
    stop(1);
  }
}
if (!closing) {
  launch(
    process.execPath,
    [
      resolve(root, "node_modules/vinext/dist/cli.js"),
      production ? "start" : "dev",
    ],
    { ...process.env, STOCK_API_URL: apiUrl },
  );
}
