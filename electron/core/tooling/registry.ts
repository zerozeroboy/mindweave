import type { ToolDefinition, ToolSchema } from "./types.js";
import type { Workspace } from "../workspace-store.js";

// fs 领域
import { listFilesTool } from "./fs/list-files.js";
import { searchFilesTool } from "./fs/search-files.js";
import { readFileTool } from "./fs/read-file.js";
import { writeFileTool } from "./fs/write-file.js";
import { patchFileTool } from "./fs/patch-file.js";
import { createFileTool } from "./fs/create-file.js";

// web 领域
import { fetchWebpageTool } from "./web/fetch-webpage.js";

const TOOL_LIST: ToolDefinition[] = [
  listFilesTool,
  searchFilesTool,
  readFileTool,
  writeFileTool,
  patchFileTool,
  createFileTool,
  fetchWebpageTool
];

const TOOL_REGISTRY = new Map<string, ToolDefinition>(
  TOOL_LIST.map((t) => [t.schema.name, t])
);

export function toolSchemas(): ToolSchema[] {
  return TOOL_LIST.map((t) => t.schema);
}

export async function runTool(
  workspace: Workspace,
  toolName: string,
  argsRaw: unknown
) {
  const tool = TOOL_REGISTRY.get(toolName);
  if (!tool) {
    throw new Error(`未知工具: ${toolName}`);
  }
  return await tool.run(workspace, argsRaw);
}

