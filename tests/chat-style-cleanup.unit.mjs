import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

test("App.css 不再包含 ProChat 全局样式污染", async () => {
  const appCss = await fs.readFile(path.join(projectRoot, "src/App.css"), "utf-8");
  assert.doesNotMatch(appCss, /\.ant-pro-chat-/);
});

test("Chat UI 样式文件包含 X 组件关键类", async () => {
  const chatCss = await fs.readFile(path.join(projectRoot, "src/components/ChatArea/chatUi.module.css"), "utf-8");
  assert.match(chatCss, /\.bubbleList/);
  assert.match(chatCss, /\.composerRoot/);
  assert.match(chatCss, /\.composerActions/);
  assert.match(chatCss, /\.inputAreaOuter/);
});
