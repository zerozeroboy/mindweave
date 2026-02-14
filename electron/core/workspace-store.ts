import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { getConfig } from "./env.js";

export type Workspace = {
  name: string;
  source_path: string;
  mirror_path: string;
  model: string;
};

const config = getConfig();
const AGENT_SPACE = path.join(config.rootDir, "agent-space");
const WORKSPACES_FILE = path.join(AGENT_SPACE, "workspaces.json");

function ensureDirSync(target: string) {
  if (!fsSync.existsSync(target)) {
    fsSync.mkdirSync(target, { recursive: true });
  }
}

async function ensureStore() {
  ensureDirSync(AGENT_SPACE);
  if (!fsSync.existsSync(WORKSPACES_FILE)) {
    await fs.writeFile(WORKSPACES_FILE, "[]", "utf-8");
  }
}

export async function listWorkspaces(): Promise<Workspace[]> {
  await ensureStore();
  const text = await fs.readFile(WORKSPACES_FILE, "utf-8");
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as Workspace[]) : [];
  } catch (_error) {
    return [];
  }
}

async function saveWorkspaces(workspaces: Workspace[]) {
  await ensureStore();
  await fs.writeFile(WORKSPACES_FILE, JSON.stringify(workspaces, null, 2), "utf-8");
}

export async function createWorkspace(payload: {
  name: string;
  source_path: string;
  model: string;
}): Promise<Workspace> {
  const all = await listWorkspaces();
  if (all.find((item) => item.name === payload.name)) {
    throw new Error("工作空间名称已存在");
  }

  const mirror_path = path.join(AGENT_SPACE, payload.name, "docs");
  ensureDirSync(mirror_path);

  const workspace: Workspace = {
    name: payload.name,
    source_path: payload.source_path,
    mirror_path,
    model: payload.model
  };
  all.push(workspace);
  await saveWorkspaces(all);
  return workspace;
}
