import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

test("App 的新建任务只进入空输入态，不立即写入任务历史", async () => {
  const filePath = path.join(projectRoot, "src/App.tsx");
  const source = await fs.readFile(filePath, "utf-8");

  assert.match(source, /onNewChat=\{\(\) => \{\s*setActiveThreadId\(""\);/);
});

test("ChatArea 在未选中任务时，发送首条消息会创建任务", async () => {
  const filePath = path.join(projectRoot, "src/components/ChatArea/index.tsx");
  const source = await fs.readFile(filePath, "utf-8");

  assert.match(source, /const createdThread = !activeThread/);
  assert.match(source, /if \(createdThread\) \{\s*setActiveThreadId\(createdThread\.id\);/);
});
