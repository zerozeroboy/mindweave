import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

test("ChatArea 使用 @ant-design/x 的 Bubble，并复用统一 ChatComposer", async () => {
  const filePath = path.join(projectRoot, "src/components/ChatArea/index.tsx");
  const source = await fs.readFile(filePath, "utf-8");

  assert.match(source, /from '@ant-design\/x'/);
  assert.match(source, /<Bubble\.List/);
  assert.match(source, /<ChatComposer/);
  assert.doesNotMatch(source, /@ant-design\/pro-chat/);
  assert.doesNotMatch(source, /<ProChat/);
  assert.doesNotMatch(source, /<Sender/);
});

test("ChatComposer 保留联网开关按钮渲染", async () => {
  const filePath = path.join(projectRoot, "src/components/ChatArea/ChatComposer.tsx");
  const source = await fs.readFile(filePath, "utf-8");

  assert.match(source, /aria-label="联网搜索"/);
  assert.match(source, /aria-pressed=\{webSearchEnabled\}/);
  assert.match(source, /onToggleWebSearch\(!webSearchEnabled\)/);
});
