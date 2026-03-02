import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

export type Workspace = {
  name: string;
  source_path: string;
  mirror_path: string;
  model: string;
  enableWebSearch?: boolean;
};

const RESERVED_WINDOWS_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);

function getFallbackDataRoot() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "AgentOS", "user-data");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "AgentOS", "user-data");
  }
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgDataHome, "AgentOS", "user-data");
}

function getDataRoot() {
  const envDataDir = typeof process.env.AGENTOS_DATA_DIR === "string" ? process.env.AGENTOS_DATA_DIR.trim() : "";
  if (envDataDir) return envDataDir;
  return getFallbackDataRoot();
}

function getStorePaths() {
  const dataRoot = getDataRoot();
  return {
    agentSpace: path.join(dataRoot, "agent-space"),
    workspacesFile: path.join(dataRoot, "agent-space", "workspaces.json")
  };
}

function ensureDirSync(target: string) {
  if (fsSync.existsSync(target)) {
    const stat = fsSync.statSync(target);
    if (!stat.isDirectory()) {
      throw new Error(`路径不是目录，无法初始化工作空间存储: ${target}`);
    }
    return;
  }
  try {
    fsSync.mkdirSync(target, { recursive: true });
  } catch (error) {
    throw new Error(`初始化工作空间目录失败: ${target} (${(error as Error).message})`);
  }
}

async function ensureStore() {
  const { agentSpace, workspacesFile } = getStorePaths();
  ensureDirSync(agentSpace);
  if (fsSync.existsSync(workspacesFile)) {
    const stat = fsSync.statSync(workspacesFile);
    if (!stat.isFile()) {
      throw new Error(`工作空间索引文件路径无效: ${workspacesFile}`);
    }
    return;
  }
  await fs.writeFile(workspacesFile, "[]", "utf-8");
}

export async function listWorkspaces(): Promise<Workspace[]> {
  await ensureStore();
  const { workspacesFile } = getStorePaths();
  const text = await fs.readFile(workspacesFile, "utf-8");
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: Workspace[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      try {
        const name = normalizeWorkspaceName(obj.name);
        const source_path = String(obj.source_path ?? "").trim();
        const mirror_path = String(obj.mirror_path ?? "").trim();
        const model = normalizeModel(obj.model);
        if (!source_path || !mirror_path) continue;
        out.push({
          name,
          source_path,
          mirror_path,
          model,
          enableWebSearch: typeof obj.enableWebSearch === "boolean" ? obj.enableWebSearch : false
        });
      } catch {
        continue;
      }
    }
    return out;
  } catch (_error) {
    return [];
  }
}

async function saveWorkspaces(workspaces: Workspace[]) {
  await ensureStore();
  const { workspacesFile } = getStorePaths();
  await fs.writeFile(workspacesFile, JSON.stringify(workspaces, null, 2), "utf-8");
}

function normalizeWorkspaceName(raw: unknown) {
  const name = String(raw ?? "").trim();
  if (!name) throw new Error("工作空间名称不能为空");
  if (name.length > 64) throw new Error("工作空间名称过长（最多 64 字符）");
  if (/[\\/:*?"<>|\r\n\t]/.test(name)) {
    throw new Error("工作空间名称包含非法字符");
  }
  if (name === "." || name === "..") {
    throw new Error("工作空间名称非法");
  }
  const normalized = name.toLowerCase();
  if (RESERVED_WINDOWS_NAMES.has(normalized)) {
    throw new Error("工作空间名称为系统保留字");
  }
  return name;
}

async function normalizeSourcePath(raw: unknown) {
  const sourcePath = String(raw ?? "").trim();
  if (!sourcePath) throw new Error("source_path 不能为空");
  if (!path.isAbsolute(sourcePath)) throw new Error("source_path 必须是绝对路径");
  const st = await fs.stat(sourcePath).catch(() => null);
  if (!st || !st.isDirectory()) throw new Error("source_path 不存在或不是目录");
  return sourcePath;
}

function normalizeModel(raw: unknown) {
  const model = String(raw ?? "").trim();
  if (!model) throw new Error("model 不能为空");
  return model;
}

export async function createWorkspace(payload: {
  name: string;
  source_path: string;
  model: string;
  enableWebSearch?: boolean;
}): Promise<Workspace> {
  const name = normalizeWorkspaceName(payload.name);
  const source_path = await normalizeSourcePath(payload.source_path);
  const model = normalizeModel(payload.model);
  const all = await listWorkspaces();
  if (all.find((item) => item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("工作空间名称已存在");
  }

  const { agentSpace } = getStorePaths();
  const mirror_path = path.resolve(agentSpace, name, "docs");
  const relative = path.relative(agentSpace, mirror_path);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("工作空间路径非法");
  }
  ensureDirSync(mirror_path);

  const workspace: Workspace = {
    name,
    source_path,
    mirror_path,
    model,
    enableWebSearch: payload.enableWebSearch ?? false
  };
  all.push(workspace);
  await saveWorkspaces(all);
  return workspace;
}

export async function updateWorkspace(
  name: string,
  updates: Partial<Pick<Workspace, "model" | "enableWebSearch">>
): Promise<Workspace> {
  const safeName = normalizeWorkspaceName(name);
  const all = await listWorkspaces();
  const workspace = all.find((item) => item.name === safeName);
  if (!workspace) {
    throw new Error("工作空间不存在");
  }
  if (Object.prototype.hasOwnProperty.call(updates, "model")) {
    workspace.model = normalizeModel(updates.model);
  }
  if (typeof updates.enableWebSearch === "boolean") {
    workspace.enableWebSearch = updates.enableWebSearch;
  }
  await saveWorkspaces(all);
  return workspace;
}
