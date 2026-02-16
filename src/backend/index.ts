export type ChatHistoryItem = { role: "user" | "assistant"; content: string };

export type ChatStartPayload = {
  workspace_name: string;
  message: string;
  history: ChatHistoryItem[];
};

export type ChatStreamHandlers = {
  onChunk: (chunk: StreamChunk) => void;
  onError: (error: { message: string }) => void;
};

export type Backend = {
  selectDirectory: () => Promise<string>;
  getWorkspaces: () => Promise<Workspace[]>;
  createWorkspace: (payload: { name: string; source_path: string; model: string; enableWebSearch?: boolean }) => Promise<Workspace>;
  updateWorkspace: (name: string, updates: { model?: string; enableWebSearch?: boolean }) => Promise<Workspace>;
  syncWorkspace: (workspaceName: string) => Promise<SyncResult>;
  listMirrorDir: (workspaceName: string, relativeDir?: string) => Promise<MirrorListDirResult>;
  readMirrorFile: (workspaceName: string, filePath: string, maxBytes?: number) => Promise<MirrorReadFileResult>;
  chatStream: (payload: ChatStartPayload, handlers: ChatStreamHandlers) => Promise<void>;
};

function getApiBaseUrl() {
  const raw = (import.meta as any).env?.VITE_API_BASE_URL;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "http://127.0.0.1:3189";
}

async function readSseStream(
  response: Response,
  handlers: { onEvent: (event: string, data: string) => void; onError: (message: string) => void }
) {
  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try {
      const text = await response.text();
      if (text) msg = text;
    } catch (_e) { }
    handlers.onError(msg);
    return;
  }
  if (!response.body) {
    handlers.onError("Response body is empty");
    return;
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  const processBuffer = () => {
    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx === -1) break;
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const lines = frame.split(/\r?\n/);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim() || "message";
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      const data = dataLines.join("\n");
      handlers.onEvent(event, data);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    processBuffer();
  }

  buffer += decoder.decode();
  processBuffer();

  const tail = buffer.trim();
  if (tail) {
    const lines = tail.split(/\r?\n/);
    let event = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim() || "message";
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    const data = dataLines.join("\n");
    if (data || event !== "message") {
      handlers.onEvent(event, data);
    }
  }
}

function createHttpBackend(): Backend {
  const base = getApiBaseUrl().replace(/\/+$/, "");

  const jsonFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {})
      }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  };

  return {
    selectDirectory: async () => "",
    getWorkspaces: async () => jsonFetch<Workspace[]>("/api/workspaces"),
    createWorkspace: async (payload) => jsonFetch<Workspace>("/api/workspaces", { method: "POST", body: JSON.stringify(payload) }),
    updateWorkspace: async (name, updates) =>
      jsonFetch<Workspace>(`/api/workspaces/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify(updates) }),
    syncWorkspace: async (workspaceName) =>
      jsonFetch<SyncResult>(`/api/workspaces/${encodeURIComponent(workspaceName)}/sync`, { method: "POST", body: "{}" }),
    listMirrorDir: async (workspaceName, relativeDir) => {
      const q = new URLSearchParams();
      if (relativeDir) q.set("dir", relativeDir);
      return jsonFetch<MirrorListDirResult>(
        `/api/workspaces/${encodeURIComponent(workspaceName)}/mirror/listDir?${q.toString()}`
      );
    },
    readMirrorFile: async (workspaceName, filePath, maxBytes) => {
      const q = new URLSearchParams();
      q.set("path", filePath);
      if (typeof maxBytes === "number") q.set("maxBytes", String(maxBytes));
      return jsonFetch<MirrorReadFileResult>(
        `/api/workspaces/${encodeURIComponent(workspaceName)}/mirror/readFile?${q.toString()}`
      );
    },
    chatStream: async (payload, handlers) => {
      let gotDone = false;
      const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      await readSseStream(res, {
        onEvent: (event, data) => {
          if (event === "error") {
            try {
              const parsed = JSON.parse(data) as { message?: string };
              handlers.onError({ message: parsed?.message ? String(parsed.message) : "Unknown error" });
            } catch (_e) {
              handlers.onError({ message: data || "Unknown error" });
            }
            return;
          }
          if (event !== "chunk") return;
          try {
            const chunk = JSON.parse(data) as StreamChunk;
            if (chunk?.type === "done") gotDone = true;
            handlers.onChunk(chunk);
          } catch (e) {
            handlers.onError({ message: (e as Error).message });
          }
        },
        onError: (message) => handlers.onError({ message })
      });

      if (!gotDone) {
        handlers.onChunk({ type: "done", sources: [], thought_trace: [] });
      }
    }
  };
}

export function getBackend(): Backend {
  if (typeof window !== "undefined" && window.electronAPI) {
    return {
      selectDirectory: () => window.electronAPI!.selectDirectory(),
      getWorkspaces: () => window.electronAPI!.getWorkspaces(),
      createWorkspace: (payload) => window.electronAPI!.createWorkspace(payload),
      updateWorkspace: (name, updates) => window.electronAPI!.updateWorkspace(name, updates),
      syncWorkspace: (workspaceName) => window.electronAPI!.syncWorkspace(workspaceName),
      listMirrorDir: (workspaceName, relativeDir) => window.electronAPI!.listMirrorDir(workspaceName, relativeDir),
      readMirrorFile: (workspaceName, filePath, maxBytes) => window.electronAPI!.readMirrorFile(workspaceName, filePath, maxBytes),
      chatStream: async (payload, handlers) => {
        const cleanupChunk = window.electronAPI!.onChatStreamChunk((chunk) => handlers.onChunk(chunk));
        const cleanupError = window.electronAPI!.onChatStreamError((err) => handlers.onError(err));
        try {
          await window.electronAPI!.chat(payload);
        } finally {
          cleanupChunk();
          cleanupError();
        }
      }
    };
  }
  return createHttpBackend();
}
