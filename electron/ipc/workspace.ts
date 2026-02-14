import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { createWorkspace, listWorkspaces } from "../core/workspace-store.js";
import { syncWorkspaceFiles } from "../core/sync.js";

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

  ipcMain.handle("workspace:create", async (_event, payload: { name: string; source_path: string; model: string }) => {
    return createWorkspace(payload);
  });

  ipcMain.handle("workspace:sync", async (_event, workspaceName: string) => {
    const list = await listWorkspaces();
    const workspace = list.find((item) => item.name === workspaceName);
    if (!workspace) {
      throw new Error("工作空间不存在");
    }
    return syncWorkspaceFiles(workspace);
  });
}
