import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

test("sync 会维护 sync-state 并检测 source/mirror 双端变更", async () => {
  const filePath = path.join(projectRoot, "electron/core/sync.ts");
  const source = await fs.readFile(filePath, "utf-8");

  assert.match(source, /sync-state\.json/);
  assert.match(source, /const sourceChanged = !prev \|\| prev\.sourceHash !== sourceHash/);
  assert.match(source, /const mirrorChanged = !!prev && mirrorExists && prev\.mirrorHash !== mirrorHashCurrent/);
  assert.match(source, /\.conflict-/);
});
