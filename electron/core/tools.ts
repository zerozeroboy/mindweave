import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { ensureInside, toUnixRelative } from "./path-safe.js";
import { walkFiles } from "./sync.js";
import type { Workspace } from "./workspace-store.js";

type SearchHit = { path: string; matches: Array<{ line: number; text: string }> };
type ToolResult = {
  files?: string[];
  query?: string;
  hits?: SearchHit[];
  path?: string;
  range?: [number, number];
  content?: string;
  ok?: boolean;
  action?: "updated" | "created";
};

export function toolSchemas() {
  return [
    {
      type: "function",
      name: "list_files",
      description: "列出镜像目录文件路径",
      parameters: {
        type: "object",
        properties: {
          directory: { type: "string", description: "相对目录，默认根目录" }
        }
      }
    },
    {
      type: "function",
      name: "search_files",
      description: "按关键词搜索镜像文件并返回命中行",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" }
        },
        required: ["query"]
      }
    },
    {
      type: "function",
      name: "read_file",
      description: "读取镜像文件内容，可选行范围",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          start_line: { type: "number" },
          end_line: { type: "number" }
        },
        required: ["path"]
      }
    },
    {
      type: "function",
      name: "write_file",
      description: "覆盖写入镜像文件并自动备份",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"]
      }
    },
    {
      type: "function",
      name: "create_file",
      description: "创建新镜像文件",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"]
      }
    }
  ];
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return JSON.parse(String(raw));
}

function grepLike(content: string, query: string) {
  const keyword = String(query || "").trim().toLowerCase();
  if (!keyword) return [];
  const lines = content.split(/\r?\n/);
  const result: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].toLowerCase().includes(keyword)) {
      result.push({ line: i + 1, text: lines[i] });
    }
  }
  return result;
}

export async function runTool(workspace: Workspace, toolName: string, argsRaw: unknown): Promise<ToolResult> {
  const root = workspace.mirror_path;
  const args = parseArgs(argsRaw);

  if (toolName === "list_files") {
    const dirPath = ensureInside(root, String(args.directory ?? "."));
    const files = await walkFiles(dirPath);
    return {
      files: files.map((item) => toUnixRelative(root, item)).slice(0, 1000)
    };
  }

  if (toolName === "search_files") {
    const query = String(args.query ?? "");
    const limit = Number(args.limit ?? 20);
    const files = await walkFiles(root);
    const hits: SearchHit[] = [];
    for (const file of files) {
      const text = await fs.readFile(file, "utf-8");
      const matches = grepLike(text, query);
      if (matches.length > 0) {
        hits.push({
          path: toUnixRelative(root, file),
          matches: matches.slice(0, 5)
        });
      }
      if (hits.length >= limit) break;
    }
    return { query, hits };
  }

  if (toolName === "read_file") {
    const relativePath = String(args.path ?? "");
    const filePath = ensureInside(root, relativePath);
    const text = await fs.readFile(filePath, "utf-8");
    const lines = text.split(/\r?\n/);
    const startLine = Math.max(1, Number(args.start_line ?? 1));
    const endLine = Math.min(lines.length, Number(args.end_line ?? lines.length));
    return {
      path: relativePath,
      range: [startLine, endLine],
      content: lines.slice(startLine - 1, endLine).join("\n")
    };
  }

  if (toolName === "write_file") {
    const relativePath = String(args.path ?? "");
    const filePath = ensureInside(root, relativePath);
    if (fsSync.existsSync(filePath)) {
      await fs.copyFile(filePath, `${filePath}.${Date.now()}.bak`);
    }
    await fs.writeFile(filePath, String(args.content ?? ""), "utf-8");
    return { ok: true, action: "updated", path: relativePath };
  }

  if (toolName === "create_file") {
    const relativePath = String(args.path ?? "");
    const filePath = ensureInside(root, relativePath);
    if (fsSync.existsSync(filePath)) {
      throw new Error("目标文件已存在");
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, String(args.content ?? ""), "utf-8");
    return { ok: true, action: "created", path: relativePath };
  }

  throw new Error(`未知工具: ${toolName}`);
}
