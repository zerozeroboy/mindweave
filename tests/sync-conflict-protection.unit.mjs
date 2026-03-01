import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncWorkspaceFiles } from "../dist-electron/core/sync.js";

function mkWorkspace(name, sourcePath, mirrorPath) {
  return {
    name,
    source_path: sourcePath,
    mirror_path: mirrorPath,
    model: "unit"
  };
}

test("sync 在双端变更时会保留本地镜像并生成冲突副本", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-sync-conflict-"));
  const sourcePath = path.join(root, "source");
  const mirrorPath = path.join(root, "mirror");
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.mkdir(mirrorPath, { recursive: true });
  try {
    const sourceFile = path.join(sourcePath, "notes.md");
    await fs.writeFile(sourceFile, "v1\n", "utf-8");
    const workspace = mkWorkspace("unit", sourcePath, mirrorPath);

    await syncWorkspaceFiles(workspace);
    const mirrorFile = path.join(mirrorPath, "notes.md");
    await fs.writeFile(mirrorFile, "local edit\n", "utf-8");
    await fs.writeFile(sourceFile, "v2\n", "utf-8");

    const result = await syncWorkspaceFiles(workspace);
    assert.equal(Array.isArray(result.conflicts), true);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.skipped_local_changes.length, 0);

    const mirrorContent = await fs.readFile(mirrorFile, "utf-8");
    assert.equal(mirrorContent, "local edit\n");

    const conflictRel = result.conflicts[0];
    const conflictAbs = path.join(mirrorPath, conflictRel);
    const conflictContent = await fs.readFile(conflictAbs, "utf-8");
    assert.match(conflictContent, /v2/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("sync 会清理失效 state：未改动镜像自动删除，改动镜像保留", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-sync-stale-"));
  const sourcePath = path.join(root, "source");
  const mirrorPath = path.join(root, "mirror");
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.mkdir(mirrorPath, { recursive: true });
  try {
    const unchangedSourceFile = path.join(sourcePath, "unchanged.md");
    const localEditedSourceFile = path.join(sourcePath, "local.md");
    await fs.writeFile(unchangedSourceFile, "same\n", "utf-8");
    await fs.writeFile(localEditedSourceFile, "v1\n", "utf-8");
    const workspace = mkWorkspace("unit", sourcePath, mirrorPath);

    await syncWorkspaceFiles(workspace);

    const localMirrorFile = path.join(mirrorPath, "local.md");
    await fs.writeFile(localMirrorFile, "local changed\n", "utf-8");

    await fs.unlink(unchangedSourceFile);
    await fs.unlink(localEditedSourceFile);

    const result = await syncWorkspaceFiles(workspace);
    assert.equal(result.stale_state_removed, 1);
    assert.deepEqual(result.stale_mirror_local_changes, ["local.md"]);

    const removedMirror = await fs.stat(path.join(mirrorPath, "unchanged.md")).catch(() => null);
    assert.equal(removedMirror, null);

    const keptMirror = await fs.readFile(localMirrorFile, "utf-8");
    assert.equal(keptMirror, "local changed\n");

    const stateRaw = await fs.readFile(path.join(mirrorPath, ".mindweave", "sync-state.json"), "utf-8");
    const state = JSON.parse(stateRaw);
    assert.equal(state.files["unchanged.md"], undefined);
    assert.ok(state.files["local.md"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
