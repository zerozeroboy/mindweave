/// <reference types="vite/client" />

type Workspace = {
  name: string;
  source_path: string;
  mirror_path: string;
  model: string;
  enableWebSearch?: boolean;
};

type SyncResult = {
  success: boolean;
  files_converted: number;
  message: string;
};

type MirrorDirEntry = {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
  mtimeMs?: number;
};

type MirrorListDirResult = {
  directory: string;
  entries: MirrorDirEntry[];
};

type MirrorReadFileResult = {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
  mime?: string;
  truncated: boolean;
  bytes: number;
};

type StreamChunk = 
  | { type: "thought"; content: string[] }
  | { type: "thinking"; content: string; thinkingMode?: "delta" | "snapshot" }
  | { type: "text"; content: string }
  | {
      type: "tool";
      stage: "start" | "end";
      callId: string;
      name: string;
      title: string;
      details: string[];
      ok?: boolean;
      durationMs?: number;
    }
  | {
      type: "tool_args";
      callId: string;
      name: string;
      totalLen: number;
      preview: {
        path?: string;
        field?: "content" | "patch" | "arguments";
        text: string;
        truncated: boolean;
      };
    }
  | { type: "done"; sources: string[]; thought_trace: string[] };

type ElectronApi = {
  selectDirectory: () => Promise<string>;
  getWorkspaces: () => Promise<Workspace[]>;
  createWorkspace: (payload: { name: string; source_path: string; model: string; enableWebSearch?: boolean }) => Promise<Workspace>;
  updateWorkspace: (name: string, updates: { model?: string; enableWebSearch?: boolean }) => Promise<Workspace>;
  syncWorkspace: (workspaceName: string) => Promise<SyncResult>;
  listMirrorDir: (workspaceName: string, relativeDir?: string) => Promise<MirrorListDirResult>;
  readMirrorFile: (workspaceName: string, filePath: string, maxBytes?: number) => Promise<MirrorReadFileResult>;
  chat: (payload: {
    workspace_name: string;
    message: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
  }) => Promise<{ success: boolean }>;
  onChatStreamChunk: (callback: (chunk: StreamChunk) => void) => () => void;
  onChatStreamError: (callback: (error: { message: string }) => void) => () => void;
  clearChat: (workspaceName: string) => Promise<boolean>;
  windowMinimize: () => Promise<void>;
  windowToggleMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  onWindowMaximizedChanged: (callback: (maximized: boolean) => void) => () => void;
};

interface Window {
  electronAPI?: ElectronApi;
}
