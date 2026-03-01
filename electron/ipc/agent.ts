import { ipcMain, BrowserWindow } from "electron";
import { runAgentChatStream } from "../core/agent-runtime.js";
import { listWorkspaces } from "../core/workspace-store.js";

type ChatHistoryItem = { role: "user" | "assistant"; content: string };
const sessionCache = new Map<string, ChatHistoryItem[]>();
const activeChatControllers = new Map<string, AbortController>();

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
      // 只要前端显式传入 history（即便是空数组），都以传入值为准；仅在未传时回退缓存
      const history: ChatHistoryItem[] =
        payload.history !== undefined ? payload.history : cachedHistory;
      
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        throw new Error("无法获取窗口");
      }

      let finalResponse = "";
      try {
        const ac = new AbortController();
        activeChatControllers.set(payload.workspace_name, ac);
        
        for await (const chunk of runAgentChatStream({
          workspace,
          message: payload.message,
          history,
          signal: ac.signal
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
      } finally {
        activeChatControllers.delete(payload.workspace_name);
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

  ipcMain.handle("agent:chat-cancel", async (_event, workspaceName: string) => {
    const ac = activeChatControllers.get(workspaceName);
    if (ac) {
      ac.abort();
      activeChatControllers.delete(workspaceName);
    }
    return true;
  });

  ipcMain.handle("agent:clear-chat", async (_event, workspaceName: string) => {
    sessionCache.delete(workspaceName);
    return true;
  });
}
