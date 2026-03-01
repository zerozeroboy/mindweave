import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const modulePath = "../dist-electron/core/workspace-store.js";

test("createWorkspace 校验名称与 source_path", async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-workspaces-"));
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-source-"));
  const prev = process.env.AGENTOS_DATA_DIR;
  process.env.AGENTOS_DATA_DIR = dataRoot;

  try {
    const store = await import(modulePath);

    await assert.rejects(
      () =>
        store.createWorkspace({
          name: "../escape",
          source_path: sourceDir,
          model: "m"
        }),
      /名称包含非法字符|名称非法/
    );

    await assert.rejects(
      () =>
        store.createWorkspace({
          name: "ok",
          source_path: "relative/path",
          model: "m"
        }),
      /source_path 必须是绝对路径/
    );

    await assert.rejects(
      () =>
        store.createWorkspace({
          name: "ok",
          source_path: path.join(sourceDir, "missing"),
          model: "m"
        }),
      /source_path 不存在或不是目录/
    );

    const created = await store.createWorkspace({
      name: "demo",
      source_path: sourceDir,
      model: "m"
    });
    assert.equal(created.name, "demo");
    assert.equal(path.isAbsolute(created.mirror_path), true);

    await assert.rejects(
      () =>
        store.createWorkspace({
          name: "demo",
          source_path: sourceDir,
          model: "m"
        }),
      /名称已存在/
    );

    await assert.rejects(() => store.updateWorkspace("demo", { model: "" }), /model 不能为空/);
    const updated = await store.updateWorkspace("demo", { model: "m2", enableWebSearch: true });
    assert.equal(updated.model, "m2");
    assert.equal(updated.enableWebSearch, true);
  } finally {
    if (typeof prev === "string") process.env.AGENTOS_DATA_DIR = prev;
    else delete process.env.AGENTOS_DATA_DIR;
    await fs.rm(dataRoot, { recursive: true, force: true });
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
});
