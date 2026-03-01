import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import type { Workspace } from "./workspace-store.js";
import { buildWorkspacePageIndex } from "./page-index.js";

type SyncStateItem = {
  sourceHash: string;
  sourceMtimeMs: number;
  sourceSize: number;
  mirrorHash: string;
  mirrorPath: string;
  updatedAt: string;
};

type SyncState = {
  version: 1;
  files: Record<string, SyncStateItem>;
};

function ensureDirSync(target: string) {
  if (!fsSync.existsSync(target)) {
    fsSync.mkdirSync(target, { recursive: true });
  }
}

function sha256(input: string | Buffer) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function readFileHash(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return sha256(buffer);
}

function nowTag() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function readSyncState(workspace: Workspace): Promise<SyncState> {
  const statePath = path.join(workspace.mirror_path, ".mindweave", "sync-state.json");
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as SyncState;
    if (!parsed || parsed.version !== 1 || typeof parsed.files !== "object") {
      return { version: 1, files: {} };
    }
    return parsed;
  } catch {
    return { version: 1, files: {} };
  }
}

async function writeSyncState(workspace: Workspace, state: SyncState) {
  const stateDir = path.join(workspace.mirror_path, ".mindweave");
  ensureDirSync(stateDir);
  const statePath = path.join(stateDir, "sync-state.json");
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export async function walkFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function getMirrorPath(sourceFile: string, sourceRoot: string, mirrorRoot: string) {
  const relative = path.relative(sourceRoot, sourceFile);
  const ext = path.extname(relative).toLowerCase();
  const relativeNoExt = relative.slice(0, relative.length - ext.length);
  return {
    ext,
    relativeSourcePath: relative.replace(/\\/g, "/"),
    mirrorPath: path.join(mirrorRoot, `${relativeNoExt}.md`)
  };
}

async function runPythonConverter(sourcePath: string, relativeSourcePath: string): Promise<string> {
  const scriptPath = path.join(process.cwd(), "scripts", "convert_document.py");
  return await new Promise((resolve, reject) => {
    const proc = spawn("python3", [scriptPath, sourcePath, relativeSourcePath], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += String(d);
    });
    proc.stderr.on("data", (d) => {
      stderr += String(d);
    });
    proc.on("error", (error) => reject(error));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr || `converter exit code ${code}`));
    });
  });
}

async function convertSourceFile(filePath: string, ext: string, relativeSourcePath: string) {
  if (ext === ".md" || ext === ".txt") {
    return fs.readFile(filePath, "utf-8");
  }
  if ([".docx", ".pdf", ".pptx", ".xlsx"].includes(ext)) {
    try {
      return await runPythonConverter(filePath, relativeSourcePath);
    } catch (error) {
      return [
        `# ${path.basename(filePath)}`,
        "",
        `原始文件: ${relativeSourcePath}`,
        "",
        `> 文档转换失败：${(error as Error).message}`,
        "> 可尝试：安装 Python 依赖（如 pypdf）或检查文件是否损坏。"
      ].join("\n");
    }
  }
  return null;
}

export async function syncWorkspaceFiles(workspace: Workspace) {
  ensureDirSync(workspace.mirror_path);
  const state = await readSyncState(workspace);
  const sourceFiles = await walkFiles(workspace.source_path);
  let filesConverted = 0;
  const conflicts: string[] = [];
  const skippedLocalChanges: string[] = [];

  for (const sourceFile of sourceFiles) {
    const { ext, relativeSourcePath, mirrorPath } = getMirrorPath(sourceFile, workspace.source_path, workspace.mirror_path);
    const content = await convertSourceFile(sourceFile, ext, relativeSourcePath);
    if (content === null) continue;

    const stat = await fs.stat(sourceFile);
    const sourceHash = await readFileHash(sourceFile);
    const mirrorExists = fsSync.existsSync(mirrorPath);
    const prev = state.files[relativeSourcePath];

    let mirrorHashCurrent = "";
    if (mirrorExists) {
      mirrorHashCurrent = await readFileHash(mirrorPath);
    }

    const sourceChanged = !prev || prev.sourceHash !== sourceHash;
    const mirrorChanged = !!prev && mirrorExists && prev.mirrorHash !== mirrorHashCurrent;

    ensureDirSync(path.dirname(mirrorPath));

    if (!mirrorExists || (sourceChanged && !mirrorChanged)) {
      if (mirrorExists) {
        const backupPath = `${mirrorPath}.${nowTag()}.bak`;
        await fs.copyFile(mirrorPath, backupPath);
      }
      await fs.writeFile(mirrorPath, content, "utf-8");
      const newMirrorHash = sha256(content);
      state.files[relativeSourcePath] = {
        sourceHash,
        sourceMtimeMs: stat.mtimeMs,
        sourceSize: stat.size,
        mirrorHash: newMirrorHash,
        mirrorPath: path.relative(workspace.mirror_path, mirrorPath).replace(/\\/g, "/"),
        updatedAt: new Date().toISOString()
      };
      filesConverted += 1;
      continue;
    }

    if (!sourceChanged && mirrorChanged) {
      skippedLocalChanges.push(relativeSourcePath);
      continue;
    }

    if (sourceChanged && mirrorChanged) {
      const conflictPath = mirrorPath.replace(/\.md$/i, `.conflict-${nowTag()}.md`);
      await fs.writeFile(conflictPath, content, "utf-8");
      conflicts.push(path.relative(workspace.mirror_path, conflictPath).replace(/\\/g, "/"));
      continue;
    }
  }

  await writeSyncState(workspace, state);

  let indexUpdated = 0;
  let indexTotal = 0;
  try {
    const r = await buildWorkspacePageIndex({ workspace });
    indexUpdated = r.updated;
    indexTotal = r.total;
  } catch (_error) {
    indexUpdated = -1;
    indexTotal = -1;
  }

  const warnings: string[] = [];
  if (skippedLocalChanges.length > 0) warnings.push(`镜像本地改动保留: ${skippedLocalChanges.length}`);
  if (conflicts.length > 0) warnings.push(`冲突副本: ${conflicts.length}`);

  return {
    success: true,
    files_converted: filesConverted,
    page_index: { updated: indexUpdated, total: indexTotal },
    conflicts,
    skipped_local_changes: skippedLocalChanges,
    message: `同步完成: ${filesConverted} 个文件${warnings.length ? `（${warnings.join("，")}）` : ""}`
  };
}
