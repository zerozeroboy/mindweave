import { ensureInside, toUnixRelative } from "../../path-safe.js";
import type { ToolDefinition } from "../types.js";
import { parseArgs } from "../types.js";
import { atomicReplaceFile, createDiffPreview } from "./fs-utils.js";
import fs from "node:fs/promises";

export const writeFileTool: ToolDefinition = {
  schema: {
    type: "function",
    name: "write_file",
    description: "覆盖写入镜像文件并自动备份",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        backup: { type: "boolean", description: "是否保留备份（默认 true）" },
        backup_keep: { type: "number", description: "最多保留多少份备份（默认 3）" }
      },
      required: ["path", "content"]
    }
  },
  async run(workspace, argsRaw) {
    const root = workspace.mirror_path;
    const args = parseArgs(argsRaw);
    const relativePath = String(args.path ?? "");
    const filePath = ensureInside(root, relativePath);
    const backup = args.backup === false ? false : true;
    const backupKeep = Number.isFinite(Number(args.backup_keep)) ? Number(args.backup_keep) : 3;
    const oldContent = await fs.readFile(filePath, "utf-8").catch(() => "");
    const nextContent = String(args.content ?? "");
    const { backupPath } = await atomicReplaceFile({
      filePath,
      content: nextContent,
      backup,
      backupKeep
    });
    return {
      ok: true,
      action: "updated",
      path: relativePath,
      backup: backupPath ? toUnixRelative(root, backupPath) : undefined,
      diff: createDiffPreview({ oldPath: relativePath, newPath: relativePath, oldContent, newContent: nextContent })
    };
  }
};
