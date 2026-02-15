import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { ensureInside } from "../../path-safe.js";
import type { ToolDefinition } from "../types.js";
import { parseArgs } from "../types.js";

export const createFileTool: ToolDefinition = {
  schema: {
    type: "function",
    name: "create_file",
    description: "创建新镜像文件",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        backup: { type: "boolean", description: "是否保留备份（默认 false）" }
      },
      required: ["path", "content"]
    }
  },
  async run(workspace, argsRaw) {
    const root = workspace.mirror_path;
    const args = parseArgs(argsRaw);
    const relativePath = String(args.path ?? "");
    const filePath = ensureInside(root, relativePath);
    if (fsSync.existsSync(filePath)) {
      throw new Error("目标文件已存在");
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, String(args.content ?? ""), "utf-8");
    return { ok: true, action: "created", path: relativePath };
  }
};

