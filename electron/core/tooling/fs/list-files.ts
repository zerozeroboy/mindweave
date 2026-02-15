import { ensureInside, toUnixRelative } from "../../path-safe.js";
import { walkFiles } from "../../sync.js";
import type { ToolDefinition } from "../types.js";
import { parseArgs } from "../types.js";

export const listFilesTool: ToolDefinition = {
  schema: {
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
  async run(workspace, argsRaw) {
    const root = workspace.mirror_path;
    const args = parseArgs(argsRaw);
    const dirPath = ensureInside(root, String(args.directory ?? "."));
    const files = await walkFiles(dirPath);
    return {
      files: files.map((item) => toUnixRelative(root, item)).slice(0, 1000)
    };
  }
};

