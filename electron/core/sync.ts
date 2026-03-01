import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import type { Workspace } from "./workspace-store.js";
import { buildWorkspacePageIndex } from "./page-index.js";
import { DOC_TO_MARKDOWN_EXTS, isMediaExt, isTextFile } from "./file-support.js";

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
  if (fsSync.existsSync(target)) {
    const stat = fsSync.statSync(target);
    if (!stat.isDirectory()) {
      throw new Error(`路径不是目录: ${target}`);
    }
    return;
  }
  fsSync.mkdirSync(target, { recursive: true });
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

function buildConflictPath(targetPath: string): string {
  const parsed = path.parse(targetPath);
  return path.join(parsed.dir, `${parsed.name}.conflict-${nowTag()}${parsed.ext || ".md"}`);
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

function getMirrorPath(sourceFile: string, sourceRoot: string, mirrorRoot: string, mode: "markdown" | "copy") {
  const relative = path.relative(sourceRoot, sourceFile);
  const ext = path.extname(relative).toLowerCase();
  const relativeNoExt = relative.slice(0, relative.length - ext.length);
  return {
    ext,
    relativeSourcePath: relative.replace(/\\/g, "/"),
    mirrorPath: mode === "markdown" ? path.join(mirrorRoot, `${relativeNoExt}.md`) : path.join(mirrorRoot, relative)
  };
}

function getPythonCommandCandidates() {
  const env = typeof process.env.AGENTOS_PYTHON_BIN === "string" ? process.env.AGENTOS_PYTHON_BIN.trim() : "";
  const candidates: Array<{ command: string; argsPrefix: string[] }> = [];
  if (env) {
    candidates.push({ command: env, argsPrefix: [] });
  }
  if (process.platform === "win32") {
    candidates.push({ command: "py", argsPrefix: ["-3"] });
    candidates.push({ command: "python", argsPrefix: [] });
    candidates.push({ command: "python3", argsPrefix: [] });
  } else {
    candidates.push({ command: "python3", argsPrefix: [] });
    candidates.push({ command: "python", argsPrefix: [] });
  }
  return candidates;
}

async function runWithPython(sourcePath: string, relativeSourcePath: string) {
  const scriptPath = path.join(process.cwd(), "scripts", "convert_document.py");
  const candidates = getPythonCommandCandidates();
  const launchErrors: string[] = [];

  for (const item of candidates) {
    try {
      const result = await new Promise<string>((resolve, reject) => {
        const proc = spawn(item.command, [...item.argsPrefix, scriptPath, sourcePath, relativeSourcePath], {
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
      return result;
    } catch (error) {
      const msg = (error as Error).message || String(error);
      launchErrors.push(`${item.command}${item.argsPrefix.length ? ` ${item.argsPrefix.join(" ")}` : ""}: ${msg}`);
      const code = (error as NodeJS.ErrnoException).code;
      const isLaunchNotFound = code === "ENOENT";
      if (!isLaunchNotFound) {
        throw error;
      }
    }
  }

  throw new Error(`未找到可用 Python 解释器（尝试: ${launchErrors.join(" | ")}）`);
}

async function runPythonConverter(sourcePath: string, relativeSourcePath: string): Promise<string> {
  return runWithPython(sourcePath, relativeSourcePath);
}

type ConversionResult =
  | { mode: "markdown"; content: string }
  | { mode: "copy" }
  | { mode: "skip" };

async function convertSourceFile(filePath: string, ext: string, relativeSourcePath: string): Promise<ConversionResult> {
  if (DOC_TO_MARKDOWN_EXTS.has(ext)) {
    try {
      return { mode: "markdown", content: await runPythonConverter(filePath, relativeSourcePath) };
    } catch (error) {
      return {
        mode: "markdown",
        content: [
          `# ${path.basename(filePath)}`,
          "",
          `原始文件: ${relativeSourcePath}`,
          "",
          `> 文档转换失败：${(error as Error).message}`,
          "> 可尝试：安装 Python 依赖（如 pypdf）或检查文件是否损坏。"
        ].join("\n")
      };
    }
  }
  if (isMediaExt(filePath)) {
    return { mode: "copy" };
  }
  if (await isTextFile(filePath)) {
    return { mode: "copy" };
  }
  return { mode: "skip" };
}

export async function syncWorkspaceFiles(workspace: Workspace) {
  ensureDirSync(workspace.mirror_path);
  const state = await readSyncState(workspace);
  const sourceFiles = await walkFiles(workspace.source_path);
  let filesConverted = 0;
  let staleStateRemoved = 0;
  const conflicts: string[] = [];
  const skippedLocalChanges: string[] = [];
  const staleMirrorLocalChanges: string[] = [];
  const sourceSet = new Set<string>();

  for (const sourceFile of sourceFiles) {
    const ext = path.extname(sourceFile).toLowerCase();
    const converted = await convertSourceFile(sourceFile, ext, path.relative(workspace.source_path, sourceFile).replace(/\\/g, "/"));
    const mode = converted.mode;
    if (mode === "skip") continue;
    const { relativeSourcePath, mirrorPath } = getMirrorPath(sourceFile, workspace.source_path, workspace.mirror_path, mode);
    sourceSet.add(relativeSourcePath);

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
      if (mode === "markdown") {
        await fs.writeFile(mirrorPath, converted.content, "utf-8");
      } else {
        await fs.copyFile(sourceFile, mirrorPath);
      }
      const newMirrorHash = mode === "markdown" ? sha256(converted.content) : sourceHash;
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
      const conflictPath = buildConflictPath(mirrorPath);
      if (mode === "markdown") {
        await fs.writeFile(conflictPath, converted.content, "utf-8");
      } else {
        await fs.copyFile(sourceFile, conflictPath);
      }
      conflicts.push(path.relative(workspace.mirror_path, conflictPath).replace(/\\/g, "/"));
      continue;
    }
  }

  for (const [relativeSourcePath, prev] of Object.entries(state.files)) {
    if (sourceSet.has(relativeSourcePath)) continue;
    const mirrorPath = path.join(workspace.mirror_path, prev.mirrorPath);
    if (!fsSync.existsSync(mirrorPath)) {
      delete state.files[relativeSourcePath];
      staleStateRemoved += 1;
      continue;
    }
    const mirrorHashCurrent = await readFileHash(mirrorPath);
    if (mirrorHashCurrent === prev.mirrorHash) {
      await fs.unlink(mirrorPath).catch(() => {});
      delete state.files[relativeSourcePath];
      staleStateRemoved += 1;
      continue;
    }
    staleMirrorLocalChanges.push(prev.mirrorPath);
  }

  await writeSyncState(workspace, state);

  let indexUpdated = 0;
  let indexTotal = 0;
  let indexError = "";
  try {
    const r = await buildWorkspacePageIndex({ workspace });
    indexUpdated = r.updated;
    indexTotal = r.total;
  } catch (error) {
    indexUpdated = -1;
    indexTotal = -1;
    indexError = (error as Error).message || String(error);
  }

  const warnings: string[] = [];
  if (skippedLocalChanges.length > 0) warnings.push(`镜像本地改动保留: ${skippedLocalChanges.length}`);
  if (conflicts.length > 0) warnings.push(`冲突副本: ${conflicts.length}`);
  if (staleStateRemoved > 0) warnings.push(`清理失效镜像: ${staleStateRemoved}`);
  if (staleMirrorLocalChanges.length > 0) warnings.push(`保留孤儿镜像改动: ${staleMirrorLocalChanges.length}`);
  if (indexError) warnings.push(`索引失败: ${indexError}`);

  return {
    success: true,
    files_converted: filesConverted,
    stale_state_removed: staleStateRemoved,
    stale_mirror_local_changes: staleMirrorLocalChanges,
    page_index: { updated: indexUpdated, total: indexTotal, error: indexError || undefined },
    conflicts,
    skipped_local_changes: skippedLocalChanges,
    message: `同步完成: ${filesConverted} 个文件${warnings.length ? `（${warnings.join("，")}）` : ""}`
  };
}
