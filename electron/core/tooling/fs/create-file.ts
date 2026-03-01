import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { ensureInside } from "../../path-safe.js";
import type { ToolDefinition } from "../types.js";
import { parseArgs } from "../types.js";
import { createDiffPreview } from "./fs-utils.js";

export const createFileTool: ToolDefinition = {
  schema: {
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
    const nextContent = String(args.content ?? "");
    await fs.writeFile(filePath, nextContent, "utf-8");
    return {
      ok: true,
      action: "created",
      path: relativePath,
      diff: createDiffPreview({ oldPath: relativePath, newPath: relativePath, oldContent: "", newContent: nextContent })
    };
  }
};
