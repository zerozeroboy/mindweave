import fs from "node:fs/promises";
import { ensureInside } from "../../path-safe.js";
import type { ToolDefinition } from "../types.js";
import { parseArgs } from "../types.js";

export const readFileTool: ToolDefinition = {
  schema: {
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
  async run(workspace, argsRaw) {
    const root = workspace.mirror_path;
    const args = parseArgs(argsRaw);
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
};

