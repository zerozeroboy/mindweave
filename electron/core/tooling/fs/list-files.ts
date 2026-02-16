import { ensureInside, toUnixRelative } from "../../path-safe.js";
import fs from "node:fs/promises";
import path from "node:path";
import { getMirrorVisibilityConfig, shouldIncludeMirrorFile, type MirrorVisibilityConfig } from "../../mirror-visibility.js";
import type { ToolDefinition } from "../types.js";
import { parseArgs } from "../types.js";

async function walkFilesFileFirst(root: string, vis: MirrorVisibilityConfig): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  const dirs: string[] = [];

  for (const entry of entries) {
    if (entry.name === ".mindweave") continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isFile()) {
      if (!shouldIncludeMirrorFile(entry.name, vis)) continue;
      files.push(fullPath);
    } else if (entry.isDirectory()) {
      dirs.push(fullPath);
    }
  }

  const out = [...files];
  for (const dir of dirs) {
    out.push(...(await walkFilesFileFirst(dir, vis)));
  }
  return out;
}

export const listFilesTool: ToolDefinition = {
  schema: {
    type: "function",
    name: "list_files",
    description: "列出镜像目录文件路径（支持分页）",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "相对目录，默认根目录" },
        limit: { type: "number", description: "最多返回多少条（默认 1000）" },
        offset: { type: "number", description: "从第几条开始返回（默认 0）" }
      }
    }
  },
  async run(workspace, argsRaw) {
    const root = workspace.mirror_path;
    const args = parseArgs(argsRaw);
    const dirPath = ensureInside(root, String(args.directory ?? "."));
    const limitRaw = Number(args.limit ?? 1000);
    const offsetRaw = Number(args.offset ?? 0);
    const limit = Math.max(1, Math.min(10_000, Number.isFinite(limitRaw) ? limitRaw : 1000));
    const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);

    const vis = getMirrorVisibilityConfig();
    const allFiles = await walkFilesFileFirst(dirPath, vis);
    const relativeFiles = allFiles.map((item) => toUnixRelative(root, item));
    const total = relativeFiles.length;
    const page = relativeFiles.slice(offset, offset + limit);
    return {
      directory: toUnixRelative(root, dirPath) || ".",
      total,
      offset,
      limit,
      truncated: offset + limit < total,
      files: page
    };
  }
};

