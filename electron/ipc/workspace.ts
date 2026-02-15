import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { createWorkspace, listWorkspaces, updateWorkspace } from "../core/workspace-store.js";
import { syncWorkspaceFiles } from "../core/sync.js";
import { ensureInside, toUnixRelative } from "../core/path-safe.js";

type MirrorDirEntry = {
  name: string;
  path: string; // unix relative path
  kind: "file" | "dir";
  size?: number;
  mtimeMs?: number;
};

type MirrorListDirResult = {
  directory: string; // unix relative path
  entries: MirrorDirEntry[];
};

type MirrorReadFileResult = {
  path: string; // unix relative path
  content: string;
  truncated: boolean;
  bytes: number;
};

export function registerWorkspaceIpc() {
  ipcMain.handle("select-directory", async () => {
    try {
      const parentWindow = BrowserWindow.getFocusedWindow();
      const options: OpenDialogOptions = {
        title: "选择项目目录",
        properties: ["openDirectory", "createDirectory"]
      };
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        return "";
      }
      return result.filePaths[0];
    } catch (error) {
      throw new Error(`打开目录选择器失败: ${(error as Error).message}`);
    }
  });

  ipcMain.handle("workspace:list", async () => {
    return listWorkspaces();
  });

  ipcMain.handle("workspace:create", async (_event, payload: { name: string; source_path: string; model: string; enableWebSearch?: boolean }) => {
    return createWorkspace(payload);
  });

  ipcMain.handle("workspace:update", async (_event, name: string, updates: { model?: string; enableWebSearch?: boolean }) => {
    return updateWorkspace(name, updates);
  });

  ipcMain.handle("workspace:sync", async (_event, workspaceName: string) => {
    const list = await listWorkspaces();
    const workspace = list.find((item) => item.name === workspaceName);
    if (!workspace) {
      throw new Error("工作空间不存在");
    }
    return syncWorkspaceFiles(workspace);
  });

  ipcMain.handle(
    "workspace:mirror:listDir",
    async (_event, workspaceName: string, relativeDir?: string): Promise<MirrorListDirResult> => {
      const list = await listWorkspaces();
      const workspace = list.find((item) => item.name === workspaceName);
      if (!workspace) {
        throw new Error("工作空间不存在");
      }

      const root = workspace.mirror_path;
      const safeDir = ensureInside(root, String(relativeDir ?? "."));
      const dirents = await fs.readdir(safeDir, { withFileTypes: true });

      const entries: MirrorDirEntry[] = [];
      for (const ent of dirents) {
        const fullPath = path.join(safeDir, ent.name);
        if (ent.isDirectory()) {
          entries.push({
            name: ent.name,
            path: toUnixRelative(root, fullPath),
            kind: "dir"
          });
        } else if (ent.isFile()) {
          const stat = await fs.stat(fullPath);
          entries.push({
            name: ent.name,
            path: toUnixRelative(root, fullPath),
            kind: "file",
            size: stat.size,
            mtimeMs: stat.mtimeMs
          });
        }
      }

      entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return {
        directory: toUnixRelative(root, safeDir) || ".",
        entries
      };
    }
  );

  ipcMain.handle(
    "workspace:mirror:readFile",
    async (
      _event,
      payload: { workspaceName: string; path: string; maxBytes?: number }
    ): Promise<MirrorReadFileResult> => {
      const list = await listWorkspaces();
      const workspace = list.find((item) => item.name === payload.workspaceName);
      if (!workspace) {
        throw new Error("工作空间不存在");
      }
      const root = workspace.mirror_path;
      const relativePath = String(payload.path ?? "");
      const filePath = ensureInside(root, relativePath);
      const maxBytesRaw = Number(payload.maxBytes ?? 240_000);
      const maxBytes = Math.max(4_096, Math.min(2_000_000, Number.isFinite(maxBytesRaw) ? maxBytesRaw : 240_000));

      const fh = await fs.open(filePath, "r");
      try {
        const stat = await fh.stat();
        const buf = Buffer.alloc(maxBytes);
        const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
        const truncated = stat.size > bytesRead;
        const content = buf.subarray(0, bytesRead).toString("utf-8");
        return {
          path: toUnixRelative(root, filePath),
          content,
          truncated,
          bytes: stat.size
        };
      } finally {
        await fh.close();
      }
    }
  );
}
