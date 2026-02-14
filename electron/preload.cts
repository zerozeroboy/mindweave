import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  getWorkspaces: () => ipcRenderer.invoke("workspace:list"),
  createWorkspace: (payload: { name: string; source_path: string; model: string }) =>
    ipcRenderer.invoke("workspace:create", payload),
  syncWorkspace: (workspaceName: string) => ipcRenderer.invoke("workspace:sync", workspaceName),
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
  clearChat: (workspaceName: string) => ipcRenderer.invoke("agent:clear-chat", workspaceName)
});
