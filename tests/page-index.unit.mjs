import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildWorkspacePageIndex, loadWorkspacePageIndex } from "../dist-electron/core/page-index.js";
import {
  pageIndexGetTreeTool,
  pageIndexReadNodesTool,
  pageIndexSearchNodesTool
} from "../dist-electron/core/tooling/fs/page-index.js";

test("pageIndex 能为 Markdown 构建标题树并读取节点正文", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-pageindex-"));
  try {
    const docPath = path.join(tempRoot, "a.md");
    await fs.writeFile(
      docPath,
      ["# 第一章", "", "这里是第一章内容。", "", "## 小节 A", "", "小节 A 内容", "", "## 小节 B", "", "小节 B 内容"].join("\n"),
      "utf-8"
    );

    const workspaceStub = {
      name: "unit",
      source_path: tempRoot,
      mirror_path: tempRoot,
      model: "unit"
    };

    const build = await buildWorkspacePageIndex({ workspace: workspaceStub });
    assert.equal(build.total, 1);

    const store = await loadWorkspacePageIndex(workspaceStub);
    assert.ok(store);
    assert.ok(store.documents["a.md"]);
    assert.equal(store.version, 2);
    assert.ok(Array.isArray(store.documents["a.md"].structure));

    const tree = await pageIndexGetTreeTool.run(workspaceStub, { path: "a.md", maxDepth: 10, maxNodes: 200 });
    assert.equal(tree.path, "a.md");
    assert.ok(tree.tree);
    assert.ok(Array.isArray(tree.tree.structure));
    assert.equal(tree.tree.structure.length, 1);

    const chapter = tree.tree.structure[0];
    assert.equal(chapter.title, "第一章");
    assert.ok(chapter.node_id);

    const search = await pageIndexSearchNodesTool.run(workspaceStub, { query: "小节 A" });
    assert.ok(Array.isArray(search.results));
    assert.ok(search.results.some((r) => r.path === "a.md" && r.title === "小节 A"));

    const read = await pageIndexReadNodesTool.run(workspaceStub, { path: "a.md", nodeIds: [chapter.node_id], maxChars: 5000 });
    assert.equal(read.path, "a.md");
    assert.equal(read.nodes.length, 1);
    assert.ok(read.nodes[0].text.includes("这里是第一章内容"));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
