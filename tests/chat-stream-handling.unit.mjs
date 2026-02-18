import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

test("ChatArea 保留流式 chunk 分支处理", async () => {
  const filePath = path.join(projectRoot, "src/components/ChatArea/index.tsx");
  const source = await fs.readFile(filePath, "utf-8");

  assert.match(source, /chunk\.type === 'thinking'/);
  assert.match(source, /chunk\.type === 'thought'/);
  assert.match(source, /chunk\.type === 'tool'/);
  assert.match(source, /chunk\.type === 'tool_args'/);
  assert.match(source, /chunk\.type === 'text'/);
  assert.match(source, /chunk\.type === 'done'/);
});

test("ChatArea 的流式文本与完成态仍会写回消息", async () => {
  const filePath = path.join(projectRoot, "src/components/ChatArea/index.tsx");
  const source = await fs.readFile(filePath, "utf-8");

  assert.match(source, /accumulatedText \+= chunk\.content/);
  assert.match(source, /updateAssistant\(\{ content: accumulatedText \}\)/);
  assert.match(source, /safeFinish\(\)/);
});
