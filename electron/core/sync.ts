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

export type SyncProgressStage = "queued" | "scanning" | "syncing" | "indexing" | "done" | "failed";

export type SyncProgressEvent = {
  taskId: string;
  workspaceName: string;
  stage: SyncProgressStage;
  current: number;
  total: number;
  percent: number;
  currentFile?: string;
  speed?: number;
  etaSeconds?: number;
  message?: string;
};

type SyncOptions = {
  taskId?: string;
  onProgress?: (event: SyncProgressEvent) => void;
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
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fsSync.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", (err) => reject(err));
  });
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

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".mindweave"
]);

export async function walkFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(root, entry.name);
      files.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(path.join(root, entry.name));
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

export async function syncWorkspaceFiles(workspace: Workspace, options?: SyncOptions) {
  const taskId = options?.taskId || `${workspace.name}-${Date.now()}`;
  const reportProgress = (event: Omit<SyncProgressEvent, "taskId" | "workspaceName">) => {
    options?.onProgress?.({
      taskId,
      workspaceName: workspace.name,
      ...event
    });
  };

  reportProgress({
    stage: "queued",
    current: 0,
    total: 0,
    percent: 0,
    message: "同步任务已创建"
  });

  ensureDirSync(workspace.mirror_path);
  const state = await readSyncState(workspace);
  reportProgress({
    stage: "scanning",
    current: 0,
    total: 0,
    percent: 2,
    message: "正在扫描源目录"
  });
  const sourceFiles = await walkFiles(workspace.source_path);
  const syncStartAt = Date.now();
  const syncTotal = sourceFiles.length;
  let processed = 0;
  reportProgress({
    stage: "syncing",
    current: 0,
    total: syncTotal,
    percent: syncTotal === 0 ? 90 : 5,
    message: syncTotal === 0 ? "没有可同步文件" : `发现 ${syncTotal} 个文件`
  });
  let filesConverted = 0;
  let staleStateRemoved = 0;
  const conflicts: string[] = [];
  const skippedLocalChanges: string[] = [];
  const staleMirrorLocalChanges: string[] = [];
  const sourceSet = new Set<string>();

  async function processFile(sourceFile: string) {
    const relativeSourcePath = path.relative(workspace.source_path, sourceFile).replace(/\\/g, "/");
    try {
      const ext = path.extname(sourceFile).toLowerCase();

      let mode: "markdown" | "copy" | "skip" = "skip";
      if (DOC_TO_MARKDOWN_EXTS.has(ext)) {
        mode = "markdown";
      } else if (isMediaExt(sourceFile)) {
        mode = "copy";
      } else if (await isTextFile(sourceFile)) {
        mode = "copy";
      }

      if (mode === "skip") return;
      sourceSet.add(relativeSourcePath);

      const { mirrorPath } = getMirrorPath(sourceFile, workspace.source_path, workspace.mirror_path, mode);
      
      const stat = await fs.stat(sourceFile);
      const prev = state.files[relativeSourcePath];
      
      let sourceHash = "";
      let sourceChanged = true;
      
      if (prev && prev.sourceSize === stat.size && prev.sourceMtimeMs === stat.mtimeMs) {
        sourceChanged = false;
        sourceHash = prev.sourceHash;
      } else {
        sourceHash = await readFileHash(sourceFile);
        if (prev && prev.sourceHash === sourceHash) {
          sourceChanged = false;
        }
      }

      const mirrorExists = fsSync.existsSync(mirrorPath);
      let mirrorHashCurrent = "";
      if (mirrorExists) {
        mirrorHashCurrent = await readFileHash(mirrorPath);
      }
      
      const mirrorChanged = !!prev && mirrorExists && prev.mirrorHash !== mirrorHashCurrent;

      ensureDirSync(path.dirname(mirrorPath));

      if (!mirrorExists || (sourceChanged && !mirrorChanged)) {
        if (mirrorExists) {
          const backupPath = `${mirrorPath}.${nowTag()}.bak`;
          await fs.copyFile(mirrorPath, backupPath);
        }
        
        let newMirrorHash = "";
        if (mode === "markdown") {
          const converted = await convertSourceFile(sourceFile, ext, relativeSourcePath);
          const content = converted.mode === "markdown" ? converted.content : "";
          await fs.writeFile(mirrorPath, content, "utf-8");
          newMirrorHash = sha256(content);
        } else {
          await fs.copyFile(sourceFile, mirrorPath);
          newMirrorHash = sourceHash;
        }
        
        state.files[relativeSourcePath] = {
          sourceHash,
          sourceMtimeMs: stat.mtimeMs,
          sourceSize: stat.size,
          mirrorHash: newMirrorHash,
          mirrorPath: path.relative(workspace.mirror_path, mirrorPath).replace(/\\/g, "/"),
          updatedAt: new Date().toISOString()
        };
        filesConverted += 1;
        return;
      }

      if (!sourceChanged && mirrorChanged) {
        skippedLocalChanges.push(relativeSourcePath);
        return;
      }

      if (sourceChanged && mirrorChanged) {
        const conflictPath = buildConflictPath(mirrorPath);
        if (mode === "markdown") {
          const converted = await convertSourceFile(sourceFile, ext, relativeSourcePath);
          const content = converted.mode === "markdown" ? converted.content : "";
          await fs.writeFile(conflictPath, content, "utf-8");
        } else {
          await fs.copyFile(sourceFile, conflictPath);
        }
        conflicts.push(path.relative(workspace.mirror_path, conflictPath).replace(/\\/g, "/"));
        return;
      }

      if (!sourceChanged && !mirrorChanged && prev && (prev.sourceMtimeMs !== stat.mtimeMs || prev.sourceSize !== stat.size)) {
        state.files[relativeSourcePath].sourceMtimeMs = stat.mtimeMs;
        state.files[relativeSourcePath].sourceSize = stat.size;
      }
    } finally {
      processed += 1;
      const elapsedSec = Math.max(1, Math.floor((Date.now() - syncStartAt) / 1000));
      const speed = processed / elapsedSec;
      const remaining = Math.max(0, syncTotal - processed);
      const etaSeconds = speed > 0 ? Math.ceil(remaining / speed) : undefined;
      const percent = syncTotal > 0 ? Math.min(90, 5 + Math.floor((processed / syncTotal) * 85)) : 90;
      reportProgress({
        stage: "syncing",
        current: processed,
        total: syncTotal,
        percent,
        currentFile: relativeSourcePath,
        speed,
        etaSeconds,
        message: `正在同步 ${processed}/${syncTotal}`
      });
    }
  }

  const CONCURRENCY = 10;
  let currentIndex = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const index = currentIndex++;
      if (index >= sourceFiles.length) break;
      await processFile(sourceFiles[index]);
    }
  });
  await Promise.all(workers);

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
  reportProgress({
    stage: "indexing",
    current: syncTotal,
    total: syncTotal,
    percent: 95,
    message: "正在更新索引"
  });
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

  reportProgress({
    stage: "done",
    current: syncTotal,
    total: syncTotal,
    percent: 100,
    message: "同步完成"
  });

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
