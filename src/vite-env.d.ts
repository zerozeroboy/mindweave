/// <reference types="vite/client" />

type Workspace = {
  name: string;
  source_path: string;
  mirror_path: string;
  model: string;
};

type SyncResult = {
  success: boolean;
  files_converted: number;
  message: string;
};

type StreamChunk = 
  | { type: "thought"; content: string[] }
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | { type: "done"; sources: string[]; thought_trace: string[] };

type ElectronApi = {
  selectDirectory: () => Promise<string>;
  getWorkspaces: () => Promise<Workspace[]>;
  createWorkspace: (payload: { name: string; source_path: string; model: string }) => Promise<Workspace>;
  syncWorkspace: (workspaceName: string) => Promise<SyncResult>;
  chat: (payload: {
    workspace_name: string;
    message: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
  }) => Promise<{ success: boolean }>;
  onChatStreamChunk: (callback: (chunk: StreamChunk) => void) => () => void;
  onChatStreamError: (callback: (error: { message: string }) => void) => () => void;
  clearChat: (workspaceName: string) => Promise<boolean>;
};

interface Window {
  electronAPI?: ElectronApi;
}
