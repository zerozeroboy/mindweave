import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  getWorkspaces: () => ipcRenderer.invoke("workspace:list"),
  createWorkspace: (payload: { name: string; source_path: string; model: string; enableWebSearch?: boolean }) =>
    ipcRenderer.invoke("workspace:create", payload),
  updateWorkspace: (name: string, updates: { model?: string; enableWebSearch?: boolean }) =>
    ipcRenderer.invoke("workspace:update", name, updates),
  syncWorkspace: (workspaceName: string) => ipcRenderer.invoke("workspace:sync", workspaceName),
  listMirrorDir: (workspaceName: string, relativeDir?: string) =>
    ipcRenderer.invoke("workspace:mirror:listDir", workspaceName, relativeDir),
  readMirrorFile: (workspaceName: string, filePath: string, maxBytes?: number) =>
    ipcRenderer.invoke("workspace:mirror:readFile", { workspaceName, path: filePath, maxBytes }),
  openSourceFile: (workspaceName: string, mirrorPath: string) =>
    ipcRenderer.invoke("workspace:source:open", { workspaceName, mirrorPath }),
  chat: (payload: {
    workspace_name: string;
    message: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
  }) => ipcRenderer.invoke("agent:chat", payload),
  onChatStreamChunk: (callback: (chunk: unknown) => void) => {
    const handler = (_event: unknown, chunk: unknown) => callback(chunk);
    ipcRenderer.on("agent:chat-stream-chunk", handler);
    return () => ipcRenderer.removeListener("agent:chat-stream-chunk", handler);
  },
  onChatStreamError: (callback: (error: unknown) => void) => {
    const handler = (_event: unknown, error: unknown) => callback(error);
    ipcRenderer.on("agent:chat-stream-error", handler);
    return () => ipcRenderer.removeListener("agent:chat-stream-error", handler);
  },
  clearChat: (workspaceName: string) => ipcRenderer.invoke("agent:clear-chat", workspaceName),
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowToggleMaximize: () => ipcRenderer.invoke("window:maximize-toggle"),
  windowClose: () => ipcRenderer.invoke("window:close"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:maximize-toggle"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onWindowMaximizedChanged: (callback: (maximized: boolean) => void) => {
    const handler = (_event: unknown, maximized: unknown) => callback(Boolean(maximized));
    ipcRenderer.on("window:maximized-changed", handler);
    return () => ipcRenderer.removeListener("window:maximized-changed", handler);
  }
});
