import type { Workspace } from "../workspace-store.js";

export type SearchMatch = {
  line: number;
  text: string;
  column?: number;
  beforeContext?: string[];
  afterContext?: string[];
};

export type SearchHit = {
  path: string;
  matches: SearchMatch[];
};

export type ToolResult = {
  files?: string[];
  query?: string;
  hits?: SearchHit[];
  path?: string;
  directory?: string;
  total?: number;
  offset?: number;
  limit?: number;
  truncated?: boolean;
  range?: [number, number];
  content?: string;
  ok?: boolean;
  action?: "updated" | "created";
  backup?: string;
};

export type ToolSchema = {
  type: "function";
  name: string;
  description: string;
  // 这里保持与模型工具 schema 兼容，参数结构不强约束
  parameters: Record<string, unknown>;
};

export type ToolDefinition = {
  schema: ToolSchema;
  run: (workspace: Workspace, argsRaw: unknown) => Promise<ToolResult>;
};

export function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  const text = String(raw);
  try {
    return JSON.parse(text);
  } catch (err) {
    const preview = text.length > 800 ? `${text.slice(0, 800)}...` : text;
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`工具参数不是合法 JSON：${reason}\n参数预览：${preview}`);
  }
}

