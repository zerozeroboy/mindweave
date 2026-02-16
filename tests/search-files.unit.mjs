import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { grepLike } from "../dist-electron/core/tooling/fs/fs-utils.js";
import { searchFilesTool } from "../dist-electron/core/tooling/fs/search-files.js";
import { listFilesTool } from "../dist-electron/core/tooling/fs/list-files.js";

test("grepLike 在多行中稳定命中固定词", () => {
  const content = ["email: a@b.com", "nothing", "my email is c@d.com"].join("\n");
  const matches = grepLike(content, { query: "email" });
  assert.equal(matches.length, 2);
  assert.equal(matches[0].line, 1);
  assert.equal(matches[1].line, 3);
});

test("grepLike 正则 OR 能匹配中英文关键词", () => {
  const content = ["联系方式：微信", "其他字段", "Email: test@example.com"].join("\n");
  const matches = grepLike(content, { query: "联系方式|邮箱|email", regex: true });
  assert.equal(matches.length, 2);
  assert.deepEqual(
    matches.map((item) => item.line),
    [1, 3]
  );
});

test("search_files 的 files_only 模式返回命中文件", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-search-"));
  try {
    await fs.writeFile(path.join(tempRoot, "a.md"), "作者: test\nemail: a@b.com\n", "utf-8");
    await fs.writeFile(path.join(tempRoot, "b.md"), "no hit\n", "utf-8");

    const workspaceStub = {
      name: "unit",
      source_path: tempRoot,
      mirror_path: tempRoot,
      model: "unit"
    };

    const result = await searchFilesTool.run(workspaceStub, {
      query: "联系方式|作者|邮箱|email",
      regex: true,
      mode: "files_only",
      limit: 20
    });

    const files = Array.isArray(result.files) ? result.files : [];
    assert.equal(files.length, 1);
    assert.equal(files[0], "a.md");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("list_files 默认仅返回 .md 与图片且隐藏备份", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-list-"));
  const prevVisible = process.env.MIRROR_VISIBLE_EXTS;
  const prevShowBackups = process.env.MIRROR_SHOW_BACKUPS;
  delete process.env.MIRROR_VISIBLE_EXTS;
  delete process.env.MIRROR_SHOW_BACKUPS;
  try {
    await fs.writeFile(path.join(tempRoot, "a.md"), "# A\n", "utf-8");
    await fs.writeFile(path.join(tempRoot, "b.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(path.join(tempRoot, "c.txt"), "txt\n", "utf-8");
    await fs.writeFile(path.join(tempRoot, "a.md.1700000000000.bak"), "# old\n", "utf-8");
    await fs.mkdir(path.join(tempRoot, ".mindweave"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, ".mindweave", "x.md"), "# hidden\n", "utf-8");

    const workspaceStub = {
      name: "unit",
      source_path: tempRoot,
      mirror_path: tempRoot,
      model: "unit"
    };

    const result = await listFilesTool.run(workspaceStub, { directory: ".", limit: 1000, offset: 0 });
    const files = Array.isArray(result.files) ? result.files : [];
    files.sort();
    assert.deepEqual(files, ["a.md", "b.png"]);
  } finally {
    if (typeof prevVisible === "string") process.env.MIRROR_VISIBLE_EXTS = prevVisible;
    else delete process.env.MIRROR_VISIBLE_EXTS;
    if (typeof prevShowBackups === "string") process.env.MIRROR_SHOW_BACKUPS = prevShowBackups;
    else delete process.env.MIRROR_SHOW_BACKUPS;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("list_files 支持配置展示所有与备份", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-list-"));
  const prevVisible = process.env.MIRROR_VISIBLE_EXTS;
  const prevShowBackups = process.env.MIRROR_SHOW_BACKUPS;
  process.env.MIRROR_VISIBLE_EXTS = "*";
  process.env.MIRROR_SHOW_BACKUPS = "0";
  try {
    await fs.writeFile(path.join(tempRoot, "a.md"), "# A\n", "utf-8");
    await fs.writeFile(path.join(tempRoot, "c.txt"), "txt\n", "utf-8");
    await fs.writeFile(path.join(tempRoot, "a.md.1700000000000.bak"), "# old\n", "utf-8");

    const workspaceStub = {
      name: "unit",
      source_path: tempRoot,
      mirror_path: tempRoot,
      model: "unit"
    };

    const result1 = await listFilesTool.run(workspaceStub, { directory: ".", limit: 1000, offset: 0 });
    const files1 = Array.isArray(result1.files) ? result1.files : [];
    files1.sort();
    assert.deepEqual(files1, ["a.md", "c.txt"]);

    process.env.MIRROR_SHOW_BACKUPS = "1";
    const result2 = await listFilesTool.run(workspaceStub, { directory: ".", limit: 1000, offset: 0 });
    const files2 = Array.isArray(result2.files) ? result2.files : [];
    files2.sort();
    assert.deepEqual(files2, ["a.md", "a.md.1700000000000.bak", "c.txt"]);
  } finally {
    if (typeof prevVisible === "string") process.env.MIRROR_VISIBLE_EXTS = prevVisible;
    else delete process.env.MIRROR_VISIBLE_EXTS;
    if (typeof prevShowBackups === "string") process.env.MIRROR_SHOW_BACKUPS = prevShowBackups;
    else delete process.env.MIRROR_SHOW_BACKUPS;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
