import { ipcMain, BrowserWindow } from "electron";
import { runAgentChatStream } from "../core/agent-runtime.js";
import { listWorkspaces } from "../core/workspace-store.js";

type ChatHistoryItem = { role: "user" | "assistant"; content: string };
const sessionCache = new Map<string, ChatHistoryItem[]>();

export function registerAgentIpc() {
  // 流式聊天
  ipcMain.handle(
    "agent:chat",
    async (
      event,
      payload: {
        workspace_name: string;
        message: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
      }
    ) => {
      const list = await listWorkspaces();
      const workspace = list.find((item) => item.name === payload.workspace_name);
      if (!workspace) {
        throw new Error("工作空间不存在");
      }

      const cachedHistory: ChatHistoryItem[] = sessionCache.get(workspace.name) ?? [];
      const history: ChatHistoryItem[] =
        payload.history && payload.history.length > 0 ? payload.history : cachedHistory;
      
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        throw new Error("无法获取窗口");
      }

      let finalResponse = "";
      try {
        for await (const chunk of runAgentChatStream({
          workspace,
          message: payload.message,
          history
        })) {
          window.webContents.send("agent:chat-stream-chunk", chunk);
          if (chunk.type === "text") {
            finalResponse += chunk.content;
          }
        }
      } catch (error) {
        window.webContents.send("agent:chat-stream-error", {
          message: (error as Error).message
        });
        throw error;
      }

      const nextHistory: ChatHistoryItem[] = [
        ...history,
        { role: "user", content: payload.message },
        { role: "assistant", content: finalResponse }
      ];
      sessionCache.set(workspace.name, nextHistory.slice(-20));
      return { success: true };
    }
  );

  ipcMain.handle("agent:clear-chat", async (_event, workspaceName: string) => {
    sessionCache.delete(workspaceName);
    return true;
  });
}
