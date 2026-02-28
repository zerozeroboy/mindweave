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
    return Array.isArray(parsed) ? (parsed as Workspace[]) : [];
  } catch (_error) {
    return [];
  }
}

async function saveWorkspaces(workspaces: Workspace[]) {
  await ensureStore();
  const { workspacesFile } = getStorePaths();
  await fs.writeFile(workspacesFile, JSON.stringify(workspaces, null, 2), "utf-8");
}

export async function createWorkspace(payload: {
  name: string;
  source_path: string;
  model: string;
  enableWebSearch?: boolean;
}): Promise<Workspace> {
  const all = await listWorkspaces();
  if (all.find((item) => item.name === payload.name)) {
    throw new Error("工作空间名称已存在");
  }

  const { agentSpace } = getStorePaths();
  const mirror_path = path.join(agentSpace, payload.name, "docs");
  ensureDirSync(mirror_path);

  const workspace: Workspace = {
    name: payload.name,
    source_path: payload.source_path,
    mirror_path,
    model: payload.model,
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
  const all = await listWorkspaces();
  const workspace = all.find((item) => item.name === name);
  if (!workspace) {
    throw new Error("工作空间不存在");
  }
  Object.assign(workspace, updates);
  await saveWorkspaces(all);
  return workspace;
}
