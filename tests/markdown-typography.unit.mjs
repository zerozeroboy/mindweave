import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

test("FilePreviewPanel 的 Markdown 容器使用 mw-markdown 且不使用 prose-sm", async () => {
  const panelPath = path.join(repoRoot, "src", "components", "ChatArea", "FilePreviewPanel.tsx");
  const content = await fs.readFile(panelPath, "utf-8");

  assert.match(content, /className="mw-markdown\b/);
  assert.doesNotMatch(content, /\bprose-sm\b/);
});

test("App.css 为 mw-markdown 定义基础 font-size，避免正文继承过小字号", async () => {
  const cssPath = path.join(repoRoot, "src", "App.css");
  const css = await fs.readFile(cssPath, "utf-8");

  assert.match(css, /\.mw-markdown\s*\{[\s\S]*?font-size:\s*(1[4-9]|[2-9]\d)px;/);
});
