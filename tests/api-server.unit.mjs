import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

async function waitForHealth(url, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) {
        const json = await res.json();
        if (json && json.ok === true) return;
      }
    } catch (_e) { }
    await delay(150);
  }
  throw new Error(`Health check timeout: ${url}`);
}

test("api-server health and workspaces endpoints", async (t) => {
  const port = 37000 + Math.floor(Math.random() * 2000);
  const baseUrl = `http://127.0.0.1:${port}`;
  let proc;
  try {
    proc = spawn(process.execPath, ["dist-electron/api-server.js"], {
      cwd: projectRoot,
      env: { ...process.env, AGENTOS_API_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    if ((error && typeof error === "object" && "code" in error && error.code === "EPERM")) {
      t.skip("当前环境禁止 spawn 子进程，跳过 API 集成测试");
      return;
    }
    throw error;
  }

  try {
    await waitForHealth(`${baseUrl}/api/health`);
    const res = await fetch(`${baseUrl}/api/workspaces`, { method: "GET" });
    assert.equal(res.ok, true);
    const json = await res.json();
    assert.equal(Array.isArray(json), true);
  } finally {
    proc.kill();
  }
});
