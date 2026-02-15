import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  sources?: string[];
  thoughtTrace?: string[];
  thinkingContent?: string;
  tool?: {
    callId: string;
    name: string;
    status: "running" | "success" | "error";
    title: string;
    details: string[];
    durationMs?: number;
    preview?: {
      path?: string;
      field?: "content" | "patch" | "arguments";
      text: string;
      truncated: boolean;
      totalLen?: number;
    };
  };
};

type ChatThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};

const DEFAULT_MODEL = "doubao-seed-2-0-lite-260215";

function uid() {
  return crypto.randomUUID();
}

const THREAD_STORAGE_VERSION = 1;
function threadStorageKey(workspaceName: string) {
  return `agentos:threads:v${THREAD_STORAGE_VERSION}:${workspaceName}`;
}

function clampThreads(input: unknown): { threads: ChatThread[]; activeThreadId: string } | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const rawThreads = Array.isArray(obj.threads) ? (obj.threads as unknown[]) : [];
  const threads: ChatThread[] = rawThreads
    .map((t) => {
      if (!t || typeof t !== "object") return null;
      const tt = t as Record<string, unknown>;
      const id = typeof tt.id === "string" ? tt.id : "";
      const title = typeof tt.title === "string" ? tt.title : "";
      const createdAt = typeof tt.createdAt === "number" ? tt.createdAt : Date.now();
      const updatedAt = typeof tt.updatedAt === "number" ? tt.updatedAt : createdAt;
      const messages = Array.isArray(tt.messages) ? (tt.messages as ChatMessage[]) : [];
      if (!id || !title) return null;
      return {
        id,
        title,
        createdAt,
        updatedAt,
        messages: Array.isArray(messages) ? messages.slice(-400) : []
      } satisfies ChatThread;
    })
    .filter((x): x is ChatThread => Boolean(x));
  const activeThreadId = typeof obj.activeThreadId === "string" ? (obj.activeThreadId as string) : "";
  if (threads.length === 0) return null;
  return { threads, activeThreadId };
}

function createEmptyThread(title = "新对话"): ChatThread {
  const now = Date.now();
  return {
    id: uid(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

function modelLabel(model: string) {
  const map: Record<string, string> = {
    "doubao-seed-2-0-lite-260215": "Seed 2.0 Lite",
    "doubao-seed-1-8-251228": "Seed 1.8",
    "doubao-pro-32k": "Pro 32K",
    "doubao-pro-128k": "Pro 128K",
    "doubao-lite-32k": "Lite 32K"
  };
  return map[model] ?? model;
}

function toConversationHistory(messages: ChatMessage[]) {
  return messages
    .filter(
      (m): m is ChatMessage & { role: "user" | "assistant" } =>
        m.role === "user" || m.role === "assistant"
    )
    .map((m) => ({ role: m.role, content: m.content }));
}

export default function App() {
  const [status, setStatus] = useState("就绪");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [isSending, setIsSending] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceModel, setWorkspaceModel] = useState(DEFAULT_MODEL);
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [input, setInput] = useState("");

  const [dirCache, setDirCache] = useState<Record<string, MirrorDirEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({ ".": true });
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [filePreview, setFilePreview] = useState<MirrorReadFileResult | null>(null);
  const [fileStatus, setFileStatus] = useState<string>("");

  const chatRef = useRef<HTMLTextAreaElement | null>(null);
  const hasWorkspace = useMemo(() => Boolean(currentWorkspace), [currentWorkspace]);
  const hasElectronApi = Boolean(window.electronAPI);

  const activeThread = useMemo(() => {
    if (!threads.length) return null;
    const found = threads.find((t) => t.id === activeThreadId);
    return found ?? threads[0] ?? null;
  }, [threads, activeThreadId]);

  const activeMessages = useMemo(() => activeThread?.messages ?? [], [activeThread]);

  useEffect(() => {
    void loadWorkspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 根据工作空间加载本地会话历史（持久化在 localStorage）
  useEffect(() => {
    if (!currentWorkspace) {
      setThreads([]);
      setActiveThreadId("");
      return;
    }
    const key = threadStorageKey(currentWorkspace.name);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        const t = createEmptyThread();
        setThreads([t]);
        setActiveThreadId(t.id);
        return;
      }
      const parsed = clampThreads(JSON.parse(raw));
      if (!parsed) {
        const t = createEmptyThread();
        setThreads([t]);
        setActiveThreadId(t.id);
        return;
      }
      setThreads(parsed.threads);
      setActiveThreadId(
        parsed.threads.some((t) => t.id === parsed.activeThreadId)
          ? parsed.activeThreadId
          : parsed.threads[0]?.id ?? ""
      );
    } catch (_err) {
      const t = createEmptyThread();
      setThreads([t]);
      setActiveThreadId(t.id);
    }
  }, [currentWorkspace?.name]);

  // 会话历史写回 localStorage（做简单防抖，避免流式渲染频繁写入）
  useEffect(() => {
    if (!currentWorkspace) return;
    if (threads.length === 0) return;
    const key = threadStorageKey(currentWorkspace.name);
    const handle = window.setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify({ activeThreadId, threads }));
      } catch (_err) {
        // ignore
      }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [currentWorkspace?.name, threads, activeThreadId]);

  // 文件树：切换工作空间时重置并加载根目录
  useEffect(() => {
    setDirCache({});
    setExpandedDirs({ ".": true });
    setSelectedFile("");
    setFilePreview(null);
    setFileStatus("");
    if (currentWorkspace) {
      void loadMirrorDir(".");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspace?.name]);

  const loadWorkspaces = async () => {
    if (!window.electronAPI) {
      setStatus("请在 Electron 中运行");
      return;
    }
    try {
      const list = await window.electronAPI.getWorkspaces();
      setWorkspaces(list);
      if (!currentWorkspace && list.length > 0) {
        setCurrentWorkspace(list[0]);
      }
    } catch (error) {
      setStatus(`错误: ${(error as Error).message}`);
    }
  };

  const onBrowse = async () => {
    if (!window.electronAPI) {
      setStatus("当前为网页模式，无法打开系统目录选择器。请用 Electron 启动。");
      return;
    }
    try {
      const selected = await window.electronAPI.selectDirectory();
      if (!selected) {
        setStatus("已取消选择目录");
        return;
      }
      setWorkspacePath(selected);
      setStatus(`已选择目录: ${selected}`);
      if (!workspaceName.trim()) {
        const parts = selected.replace(/[\\/]+$/, "").split(/[\\/]/);
        setWorkspaceName(parts[parts.length - 1] ?? "");
      }
    } catch (error) {
      setStatus(`错误: ${(error as Error).message}`);
    }
  };

  const onCreateWorkspace = async () => {
    if (!window.electronAPI) {
      setStatus("当前为网页模式，无法创建工作空间。请用 Electron 启动。");
      return;
    }
    if (!workspaceName.trim()) {
      alert("请输入工作空间名称");
      return;
    }
    if (!workspacePath.trim()) {
      alert("请选择源目录");
      return;
    }
    setStatus("创建工作空间中...");
    try {
      const created = await window.electronAPI.createWorkspace({
        name: workspaceName.trim(),
        source_path: workspacePath.trim(),
        model: workspaceModel,
        enableWebSearch
      });
      setCurrentWorkspace(created);
      setShowModal(false);
      setWorkspaceName("");
      setWorkspacePath("");
      setWorkspaceModel(DEFAULT_MODEL);
      setEnableWebSearch(false);
      await loadWorkspaces();
      const t = createEmptyThread();
      setThreads([t]);
      setActiveThreadId(t.id);
      setStatus("工作空间创建成功");
      chatRef.current?.focus();
    } catch (error) {
      setStatus(`错误: ${(error as Error).message}`);
    }
  };

  const updateThreadById = (threadId: string, updater: (thread: ChatThread) => ChatThread) => {
    setThreads((prev) => prev.map((t) => (t.id === threadId ? updater(t) : t)));
  };

  const ensureThreadExists = () => {
    if (threads.length > 0) return;
    const t = createEmptyThread();
    setThreads([t]);
    setActiveThreadId(t.id);
  };

  const onNewThread = () => {
    if (!currentWorkspace) return;
    const t = createEmptyThread();
    setThreads((prev) => [t, ...prev]);
    setActiveThreadId(t.id);
    setStatus("已创建新对话");
    chatRef.current?.focus();
  };

  const onRenameThread = (threadId: string) => {
    const current = threads.find((t) => t.id === threadId);
    if (!current) return;
    const next = prompt("重命名对话", current.title);
    if (!next || !next.trim()) return;
    updateThreadById(threadId, (t) => ({ ...t, title: next.trim(), updatedAt: Date.now() }));
  };

  const onDeleteThread = (threadId: string) => {
    const current = threads.find((t) => t.id === threadId);
    if (!current) return;
    const ok = confirm(`删除对话「${current.title}」？此操作不可撤销。`);
    if (!ok) return;
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== threadId);
      if (next.length === 0) {
        const t = createEmptyThread();
        setActiveThreadId(t.id);
        return [t];
      }
      if (activeThreadId === threadId) {
        setActiveThreadId(next[0]?.id ?? "");
      }
      return next;
    });
  };

  const onSync = async () => {
    if (!window.electronAPI || !currentWorkspace) return;
    setStatus("同步中...");
    try {
      const result = await window.electronAPI.syncWorkspace(currentWorkspace.name);
      setStatus(result.message);
      ensureThreadExists();
      if (activeThread) {
        const threadId = activeThread.id;
        updateThreadById(threadId, (t) => ({
          ...t,
          updatedAt: Date.now(),
          messages: [...t.messages, { id: uid(), role: "system" as const, content: result.message }].slice(-600)
        }));
      }
    } catch (error) {
      setStatus(`错误: ${(error as Error).message}`);
    }
  };

  const loadMirrorDir = async (relativeDir: string) => {
    if (!window.electronAPI || !currentWorkspace) return;
    if (typeof window.electronAPI.listMirrorDir !== "function") {
      setFileStatus("桌面端 API 未更新：缺少 listMirrorDir。请完全退出 Electron 后重新运行 `npm run electron`。");
      return;
    }
    setFileStatus("加载文件中...");
    try {
      const result = await window.electronAPI.listMirrorDir(currentWorkspace.name, relativeDir);
      setDirCache((prev) => ({ ...prev, [result.directory || "."]: result.entries }));
      setFileStatus("");
    } catch (error) {
      setFileStatus(`文件加载失败: ${(error as Error).message}`);
    }
  };

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = { ...prev, [dirPath]: !prev[dirPath] };
      return next;
    });
    if (!dirCache[dirPath]) {
      void loadMirrorDir(dirPath);
    }
  };

  const openFile = async (filePath: string) => {
    if (!window.electronAPI || !currentWorkspace) return;
    if (typeof window.electronAPI.readMirrorFile !== "function") {
      setFileStatus("桌面端 API 未更新：缺少 readMirrorFile。请完全退出 Electron 后重新运行 `npm run electron`。");
      return;
    }
    setSelectedFile(filePath);
    setFilePreview(null);
    setFileStatus("读取文件中...");
    try {
      const result = await window.electronAPI.readMirrorFile(currentWorkspace.name, filePath, 240_000);
      setFilePreview(result);
      setFileStatus(result.truncated ? "已截断预览（文件过大）" : "");
    } catch (error) {
      setFileStatus(`读取失败: ${(error as Error).message}`);
    }
  };

  const previewSourcePath = useMemo(() => {
    const text = filePreview?.content ?? "";
    const m = text.match(/^<!--\s*source:\s*(.*?)\s*-->/m);
    return m?.[1] ?? "";
  }, [filePreview?.content]);

  const onSend = async () => {
    if (!window.electronAPI || !currentWorkspace || isSending) return;
    if (!activeThread) {
      const t = createEmptyThread();
      setThreads([t]);
      setActiveThreadId(t.id);
      return;
    }
    const message = input.trim();
    if (!message) return;

    const userMsg: ChatMessage = { id: uid(), role: "user", content: message };
    const assistantId = uid();
    const threadId = activeThread.id;
    updateThreadById(threadId, (t) => ({
      ...t,
      updatedAt: Date.now(),
      messages: [...t.messages, userMsg].slice(-600)
    }));
    setInput("");
    setIsSending(true);
    setStatus("思考中...");

    let responseText = "";
    const thoughtTraces: string[] = [];
    let thinkingText = "";
    const sources: string[] = [];
    let streamCompleted = false;
    let streamErrored = false;

    // 监听流式数据
    const cleanupChunk = window.electronAPI.onChatStreamChunk((chunk: any) => {
      if (chunk.type === "text") {
        responseText += chunk.content;
        updateThreadById(threadId, (t) => {
          const prev = t.messages;
          const assistantIndex = prev.findIndex((item) => item.id === assistantId);
          const next =
            assistantIndex >= 0
              ? [
                  ...prev.slice(0, assistantIndex),
                  { ...prev[assistantIndex], content: responseText },
                  ...prev.slice(assistantIndex + 1)
                ]
              : [
                  ...prev,
                  {
                    id: assistantId,
                    role: "assistant" as const,
                    content: responseText,
                    sources: [],
                    thoughtTrace: [],
                    thinkingContent: ""
                  }
                ];
          return { ...t, updatedAt: Date.now(), messages: next.slice(-600) };
        });
      } else if (chunk.type === "thinking") {
        thinkingText += chunk.content;
        updateThreadById(threadId, (t) => {
          const prev = t.messages;
          const assistantIndex = prev.findIndex((item) => item.id === assistantId);
          const next =
            assistantIndex >= 0
              ? [
                  ...prev.slice(0, assistantIndex),
                  { ...prev[assistantIndex], thinkingContent: thinkingText },
                  ...prev.slice(assistantIndex + 1)
                ]
              : [
                  ...prev,
                  {
                    id: assistantId,
                    role: "assistant" as const,
                    content: responseText,
                    sources: [],
                    thoughtTrace: [],
                    thinkingContent: thinkingText
                  }
                ];
          return { ...t, updatedAt: Date.now(), messages: next.slice(-600) };
        });
      } else if (chunk.type === "thought") {
        thoughtTraces.push(...chunk.content);
        updateThreadById(threadId, (t) => {
          const prev = t.messages;
          const assistantIndex = prev.findIndex((item) => item.id === assistantId);
          const next =
            assistantIndex >= 0
              ? [
                  ...prev.slice(0, assistantIndex),
                  { ...prev[assistantIndex], thoughtTrace: [...thoughtTraces] },
                  ...prev.slice(assistantIndex + 1)
                ]
              : [
                  ...prev,
                  {
                    id: assistantId,
                    role: "assistant" as const,
                    content: responseText,
                    sources: [],
                    thoughtTrace: [...thoughtTraces],
                    thinkingContent: thinkingText
                  }
                ];
          return { ...t, updatedAt: Date.now(), messages: next.slice(-600) };
        });
      } else if (chunk.type === "tool") {
        const callId = String(chunk.callId ?? "");
        const name = String(chunk.name ?? "");
        const stage = String(chunk.stage ?? "");
        const title = String(chunk.title ?? (name ? `🔧 ${name}` : "🔧 工具调用"));
        const details = Array.isArray(chunk.details)
          ? chunk.details.map((x: unknown) => String(x))
          : [];
        const ok = chunk.ok === true ? true : chunk.ok === false ? false : undefined;
        const durationMs = typeof chunk.durationMs === "number" ? chunk.durationMs : undefined;
        const toolId = callId ? `tool:${callId}` : `tool:${uid()}`;

        updateThreadById(threadId, (t) => {
          const prev = t.messages;
          const idx = prev.findIndex((m) => m.id === toolId);
          const status: "running" | "success" | "error" =
            stage === "end" ? (ok === false ? "error" : "success") : "running";

          const nextMsg: ChatMessage = {
            id: toolId,
            role: "tool",
            content: "",
            tool: {
              callId: callId || toolId,
              name,
              status,
              title,
              details,
              durationMs,
              preview: prev[idx]?.tool?.preview
            }
          };

          const next =
            idx >= 0
              ? [...prev.slice(0, idx), { ...prev[idx], ...nextMsg }, ...prev.slice(idx + 1)]
              : [...prev, nextMsg];
          return { ...t, updatedAt: Date.now(), messages: next.slice(-600) };
        });
      } else if (chunk.type === "tool_args") {
        const callId = String(chunk.callId ?? "");
        const name = String(chunk.name ?? "");
        const toolId = callId ? `tool:${callId}` : `tool:${uid()}`;
        const preview = chunk.preview && typeof chunk.preview === "object" ? chunk.preview : null;
        const previewText = preview && typeof (preview as any).text === "string" ? String((preview as any).text) : "";
        const previewPath = preview && typeof (preview as any).path === "string" ? String((preview as any).path) : undefined;
        const previewField =
          preview && typeof (preview as any).field === "string"
            ? ((preview as any).field as "content" | "patch" | "arguments")
            : "arguments";
        const previewTruncated = preview && (preview as any).truncated === true ? true : false;
        const totalLen = typeof chunk.totalLen === "number" ? chunk.totalLen : undefined;

        updateThreadById(threadId, (t) => {
          const prev = t.messages;
          const idx = prev.findIndex((m) => m.id === toolId);
          const baseTool = idx >= 0 ? prev[idx]?.tool : undefined;
          const displayName = name === "patch_file" ? "增量更新" : name === "write_file" ? "写入文件" : name === "create_file" ? "创建文件" : name;
          const nextMsg: ChatMessage = {
            id: toolId,
            role: "tool",
            content: "",
            tool: {
              callId: callId || toolId,
              name,
              status: baseTool?.status ?? "running",
              title: baseTool?.title ?? `正在生成：${displayName}`,
              details: baseTool?.details ?? ["参数生成中..."],
              durationMs: baseTool?.durationMs,
              preview: {
                path: previewPath,
                field: previewField,
                text: previewText,
                truncated: previewTruncated,
                totalLen
              }
            }
          };
          const next =
            idx >= 0
              ? [...prev.slice(0, idx), { ...prev[idx], ...nextMsg }, ...prev.slice(idx + 1)]
              : [...prev, nextMsg];
          return { ...t, updatedAt: Date.now(), messages: next.slice(-600) };
        });
      } else if (chunk.type === "done") {
        streamCompleted = true;
        sources.push(...chunk.sources);
        thoughtTraces.push(...chunk.thought_trace);
        updateThreadById(threadId, (t) => {
          const prev = t.messages;
          const assistantIndex = prev.findIndex((item) => item.id === assistantId);
          const finalMsg = {
            id: assistantId,
            role: "assistant" as const,
            content: responseText || "已完成。",
            sources: [...new Set(sources)],
            thoughtTrace: [...new Set(thoughtTraces)],
            thinkingContent: thinkingText
          };
          const next =
            assistantIndex >= 0
              ? [
                  ...prev.slice(0, assistantIndex),
                  { ...(prev[assistantIndex] as ChatMessage), ...finalMsg },
                  ...prev.slice(assistantIndex + 1)
                ]
              : [...prev, finalMsg];
          return { ...t, updatedAt: Date.now(), messages: next.slice(-600) };
        });
        setStatus("就绪");
        setIsSending(false);
      }
    });

    const cleanupError = window.electronAPI.onChatStreamError((error) => {
      streamErrored = true;
      setStatus(`错误: ${error.message}`);
      setIsSending(false);
    });

    try {
      await window.electronAPI.chat({
        workspace_name: currentWorkspace.name,
        message,
        history: toConversationHistory(activeMessages)
      });
    } catch (error) {
      streamErrored = true;
      setStatus(`错误: ${(error as Error).message}`);
      setIsSending(false);
    } finally {
      cleanupChunk();
      cleanupError();
      // IPC 流式 done 事件偶发与监听清理发生竞态，这里做统一兜底，避免界面卡在发送中。
      if (!streamCompleted && !streamErrored) {
        setStatus("就绪");
      }
      setIsSending(false);
      chatRef.current?.focus();
    }
  };

  const onClear = async () => {
    if (!window.electronAPI || !currentWorkspace) return;
    await window.electronAPI.clearChat(currentWorkspace.name);
    if (activeThread) {
      const threadId = activeThread.id;
      updateThreadById(threadId, (t) => ({ ...t, updatedAt: Date.now(), messages: [] }));
    }
    setStatus("对话已清空");
  };

  const renderTree = (dirPath: string, depth: number): JSX.Element => {
    const entries = dirCache[dirPath] ?? [];
    const isRoot = dirPath === ".";
    const rootLabel = isRoot ? "docs（镜像）" : dirPath.split("/").pop() || dirPath;
    const expanded = expandedDirs[dirPath] ?? (isRoot ? true : false);

    const header = (
      <div
        className={`tree-item dir ${expanded ? "expanded" : ""}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => toggleDir(dirPath)}
        title={dirPath}
      >
        <span className="tree-caret">{expanded ? "▾" : "▸"}</span>
        <span className="tree-name">{rootLabel}</span>
      </div>
    );

    if (!expanded) {
      return <div className="tree-group">{header}</div>;
    }

    return (
      <div className="tree-group">
        {header}
        {entries.map((ent) => {
          if (ent.kind === "dir") {
            return (
              <div key={ent.path}>
                {renderTree(ent.path, depth + 1)}
              </div>
            );
          }
          const isActive = selectedFile === ent.path || filePreview?.path === ent.path;
          return (
            <div
              key={ent.path}
              className={`tree-item file ${isActive ? "active" : ""}`}
              style={{ paddingLeft: 10 + (depth + 1) * 14 }}
              onClick={() => void openFile(ent.path)}
              title={ent.path}
            >
              <span className="tree-icon">📄</span>
              <span className="tree-name">{ent.name}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true" />
          <div className="brand-text">
            <h1 className="title">MindWeave</h1>
            <p className="subtitle">把工作空间编织成可对话的知识网络</p>
          </div>
        </div>

        <div className="row toolbar-row">
          <button onClick={() => setShowModal(true)}>新建工作空间</button>
          <button onClick={loadWorkspaces}>刷新</button>
        </div>

        <div className="workspace-list">
          {workspaces.map((item) => (
            <div
              key={item.name}
              className={`workspace-item ${currentWorkspace?.name === item.name ? "active" : ""}`}
              onClick={() => {
                setCurrentWorkspace(item);
                setStatus(`已切换到 ${item.name}`);
              }}
            >
              <div className="workspace-head">
                <div className="workspace-name">{item.name}</div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <span className="chip" title={item.model}>
                    {modelLabel(item.model)}
                  </span>
                  {item.enableWebSearch ? (
                    <span className="chip" title="已启用联网搜索" style={{ backgroundColor: '#1e90ff' }}>
                      🌐
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="workspace-path">{item.source_path}</div>
            </div>
          ))}
        </div>

        <div className="section">
          <div className="section-head">
            <div className="section-title">对话</div>
            <div className="row">
              <button onClick={onNewThread} disabled={!hasWorkspace}>新对话</button>
            </div>
          </div>
          <div className="thread-list">
            {!hasWorkspace ? (
              <div className="muted">选择一个工作空间后可查看历史对话</div>
            ) : threads.length === 0 ? (
              <div className="muted">暂无对话</div>
            ) : (
              threads
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((t) => {
                  const last = [...t.messages].reverse().find((m) => m.role !== "system");
                  const preview = (last?.content ?? "").replace(/\s+/g, " ").slice(0, 60);
                  return (
                    <div
                      key={t.id}
                      className={`thread-item ${activeThread?.id === t.id ? "active" : ""}`}
                      onClick={() => {
                        setActiveThreadId(t.id);
                        setStatus(`已切换到对话：${t.title}`);
                        chatRef.current?.focus();
                      }}
                    >
                      <div className="thread-head">
                        <div className="thread-title">{t.title}</div>
                        <div className="thread-actions">
                          <button
                            className="icon-btn"
                            title="重命名"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRenameThread(t.id);
                            }}
                          >
                            ✎
                          </button>
                          <button
                            className="icon-btn danger"
                            title="删除"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteThread(t.id);
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div className="thread-preview">{preview || "（空）"}</div>
                      <div className="thread-meta">
                        <span className="chip subtle">{t.messages.length} 条</span>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>

        <div className="statusbar">
          <span className="status-dot" aria-hidden="true" />
          <p className="status-text">{status}</p>
        </div>
      </aside>

      <main className="content">
        <div className="toolbar row">
          <div className="toolbar-title">
            <strong className="workspace-title">
              {currentWorkspace ? currentWorkspace.name : "未选择工作空间"}
            </strong>
            {currentWorkspace ? (
              <span className="chip subtle" title={currentWorkspace.model}>
                {modelLabel(currentWorkspace.model)}
              </span>
            ) : null}
          </div>
          <span className="grow" />
          {currentWorkspace ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={currentWorkspace.enableWebSearch ?? false}
                onChange={async (e) => {
                  if (!window.electronAPI) return;
                  try {
                    const updated = await window.electronAPI.updateWorkspace(currentWorkspace.name, {
                      enableWebSearch: e.target.checked
                    });
                    setCurrentWorkspace(updated);
                    await loadWorkspaces();
                    setStatus(e.target.checked ? "已启用联网搜索" : "已禁用联网搜索");
                  } catch (error) {
                    setStatus(`错误: ${(error as Error).message}`);
                  }
                }}
              />
              <span>🌐 联网搜索</span>
            </label>
          ) : null}
          <button onClick={onSync} disabled={!hasWorkspace}>同步文件</button>
          <button onClick={onClear} disabled={!hasWorkspace}>清空对话</button>
        </div>

        <div className="chat-list">
          {!hasWorkspace ? (
            <div className="empty">
              <div className="empty-card">
                <div className="empty-kicker">开始之前</div>
                <div className="empty-title">创建一个工作空间</div>
                <div className="empty-desc">
                  选择你的源目录，MindWeave 会同步成可对话的镜像，并在此基础上执行任务。
                </div>
                <div className="row">
                  <button onClick={() => setShowModal(true)}>新建工作空间</button>
                  <button onClick={loadWorkspaces}>刷新列表</button>
                </div>
              </div>
            </div>
          ) : null}
          {activeMessages.map((msg) => (
            <div
              key={msg.id}
              className={`msg ${msg.role === "user" ? "user" : ""} ${msg.role === "tool" ? "tool" : ""}`}
            >
              <div className="bubble">
                {msg.role === "tool" && msg.tool ? (
                  <div className={`tool-card ${msg.tool.status}`}>
                    <div className="tool-head">
                      <span className="tool-icon">🔧</span>
                      <span className="tool-title">{msg.tool.title}</span>
                      <span className="grow" />
                      <span className="tool-meta">
                        {msg.tool.status === "running" ? "进行中" : msg.tool.status === "success" ? "成功" : "失败"}
                        {typeof msg.tool.durationMs === "number"
                          ? ` · ${Math.max(0, Math.round(msg.tool.durationMs))}ms`
                          : ""}
                      </span>
                    </div>
                    {msg.tool.details && msg.tool.details.length > 0 ? (
                      <ul className="tool-details">
                        {msg.tool.details.map((line, idx) => (
                          <li key={idx}>{line}</li>
                        ))}
                      </ul>
                    ) : null}
                    {msg.tool.preview && msg.tool.preview.text ? (
                      <details className="tool-preview" open>
                        <summary className="tool-preview-summary">
                          模型输出预览
                          {msg.tool.preview.field ? `（${msg.tool.preview.field}）` : ""}
                          {msg.tool.preview.truncated ? " · 已截断" : ""}
                        </summary>
                        {msg.tool.preview.path ? (
                          <div className="tool-preview-meta">路径: {msg.tool.preview.path}</div>
                        ) : null}
                        <pre className="tool-preview-pre">{msg.tool.preview.text}</pre>
                      </details>
                    ) : null}
                  </div>
                ) : null}
                {msg.role === "assistant" && msg.thinkingContent ? (
                  <details className="thought-panel" open>
                    <summary className="thought-summary">
                      <span className="thought-icon">💭</span>
                      <span>思考过程</span>
                    </summary>
                    <div className="thought-content">
                      <div className="thought-item">
                        <div className="thought-text">
                          {msg.thinkingContent.trim() ? msg.thinkingContent : "思考中..."}
                        </div>
                      </div>
                    </div>
                  </details>
                ) : null}
                {msg.role !== "tool" ? (
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                ) : null}
                {msg.sources && msg.sources.length > 0 ? (
                  <div className="muted">来源: {msg.sources.join(", ")}</div>
                ) : null}
                {msg.role === "assistant" && msg.thoughtTrace && msg.thoughtTrace.length > 0 ? (
                  <details className="thought-panel">
                    <summary className="thought-summary">
                      <span className="thought-icon">🧠</span>
                      <span>思考轨迹</span>
                      <span className="thought-count">({msg.thoughtTrace.length})</span>
                    </summary>
                    <div className="thought-content">
                      {msg.thoughtTrace.map((trace, idx) => {
                        const isToolCall = trace.includes("调用工具") || trace.startsWith("🔧");
                        const isComplete = trace.includes("✅") || trace.includes("完成");
                        const isRound = trace.includes("轮推理") || trace.startsWith("🔄");
                        
                        let icon = <span className="step-number">{idx + 1}</span>;
                        let className = "thought-item";
                        
                        if (isToolCall) {
                          icon = <span className="step-icon">🔧</span>;
                          className += " tool-call";
                        } else if (isComplete) {
                          icon = <span className="step-icon">✅</span>;
                          className += " complete";
                        } else if (isRound) {
                          icon = <span className="step-icon">🔄</span>;
                          className += " round";
                        }
                        
                        return (
                          <div key={idx} className={className}>
                            <div className="thought-step">{icon}</div>
                            <div className="thought-text">{trace}</div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="chat-input">
          <div className="row">
            <textarea
              ref={chatRef}
              className="grow"
              rows={3}
              placeholder="输入问题或修改指令...（Shift+Enter 换行）"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void onSend();
                }
              }}
              style={{
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
                resize: 'vertical',
                minHeight: '60px',
                maxHeight: '300px'
              }}
            />
            <button onClick={onSend} disabled={!hasWorkspace || isSending}>发送</button>
          </div>
        </div>
      </main>

      <aside className="files">
        <div className="files-toolbar row">
          <div className="files-title">
            <strong>文件</strong>
            <span className="chip subtle" title="仅展示镜像目录（mirror_path）">
              镜像
            </span>
          </div>
          <span className="grow" />
          <button onClick={() => void loadMirrorDir(".")} disabled={!hasWorkspace}>
            刷新
          </button>
        </div>

        <div className="files-body">
          {!hasWorkspace ? (
            <div className="files-empty">
              <div className="muted">选择工作空间后可查看镜像文件</div>
            </div>
          ) : (
            <div className="files-split">
              <div className="filetree">
                {fileStatus ? <div className="muted file-status">{fileStatus}</div> : null}
                {(dirCache["."] ?? []).length === 0 && !fileStatus ? (
                  <div className="muted">暂无镜像文件。你可以先点「同步文件」。</div>
                ) : null}
                <div className="tree-root">
                  {renderTree(".", 0)}
                </div>
              </div>

              <div className="filepreview">
                <div className="filepreview-head">
                  <div className="filepreview-path">{filePreview?.path || selectedFile || "未选择文件"}</div>
                  {previewSourcePath ? (
                    <div className="filepreview-source" title={previewSourcePath}>
                      源文件: {previewSourcePath}
                    </div>
                  ) : null}
                </div>
                <div className="filepreview-body">
                  {filePreview ? (
                    <pre className="filepreview-pre">{filePreview.content}</pre>
                  ) : (
                    <div className="muted">点击左侧文件以预览内容</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      {showModal ? (
        <div className="modal">
          <div className="modal-card">
            <h3>创建工作空间</h3>
            <div className="row">
              <input
                className="grow"
                placeholder="名称，例如 project-a"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
              />
            </div>
            <div className="row">
              <input className="grow" readOnly value={workspacePath} placeholder="选择目录" />
              <button
                onClick={onBrowse}
                disabled={!hasElectronApi}
                title={!hasElectronApi ? "请在 Electron 桌面端运行后再浏览目录" : undefined}
              >
                浏览
              </button>
            </div>
            <div className="row">
              <select
                className="grow"
                value={workspaceModel}
                onChange={(e) => setWorkspaceModel(e.target.value)}
              >
                <option value="doubao-seed-2-0-lite-260215">豆包 Seed 2.0 Lite</option>
                <option value="doubao-seed-1-8-251228">豆包 Seed 1.8</option>
                <option value="doubao-pro-32k">豆包 Pro 32K</option>
                <option value="doubao-pro-128k">豆包 Pro 128K</option>
                <option value="doubao-lite-32k">豆包 Lite 32K</option>
              </select>
            </div>
            <div className="row">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enableWebSearch}
                  onChange={(e) => setEnableWebSearch(e.target.checked)}
                />
                <span>启用联网搜索（豆包插件）</span>
              </label>
            </div>
            <div className="row">
              <span className="grow" />
              <button onClick={() => setShowModal(false)}>取消</button>
              <button
                onClick={() => void onCreateWorkspace()}
                disabled={!hasElectronApi}
                title={!hasElectronApi ? "请在 Electron 桌面端运行后再创建工作空间" : undefined}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
