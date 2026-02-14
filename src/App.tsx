import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: string[];
  thoughtTrace?: string[];
  thinkingContent?: string;
};

const DEFAULT_MODEL = "doubao-seed-1-8-251228";

function uid() {
  return crypto.randomUUID();
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceModel, setWorkspaceModel] = useState(DEFAULT_MODEL);
  const [input, setInput] = useState("");

  const chatRef = useRef<HTMLTextAreaElement | null>(null);
  const hasWorkspace = useMemo(() => Boolean(currentWorkspace), [currentWorkspace]);
  const hasElectronApi = Boolean(window.electronAPI);

  useEffect(() => {
    void loadWorkspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        model: workspaceModel
      });
      setCurrentWorkspace(created);
      setShowModal(false);
      setWorkspaceName("");
      setWorkspacePath("");
      setWorkspaceModel(DEFAULT_MODEL);
      await loadWorkspaces();
      setMessages([]);
      setStatus("工作空间创建成功");
      chatRef.current?.focus();
    } catch (error) {
      setStatus(`错误: ${(error as Error).message}`);
    }
  };

  const onSync = async () => {
    if (!window.electronAPI || !currentWorkspace) return;
    setStatus("同步中...");
    try {
      const result = await window.electronAPI.syncWorkspace(currentWorkspace.name);
      setStatus(result.message);
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "system", content: result.message }
      ]);
    } catch (error) {
      setStatus(`错误: ${(error as Error).message}`);
    }
  };

  const onSend = async () => {
    if (!window.electronAPI || !currentWorkspace || isSending) return;
    const message = input.trim();
    if (!message) return;

    const userMsg: ChatMessage = { id: uid(), role: "user", content: message };
    const assistantId = uid();
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
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
    const cleanupChunk = window.electronAPI.onChatStreamChunk((chunk) => {
      if (chunk.type === "text") {
        responseText += chunk.content;
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.id === assistantId) {
            return [
              ...prev.slice(0, -1),
              { ...lastMsg, content: responseText }
            ];
          } else {
            return [
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
          }
        });
      } else if (chunk.type === "thinking") {
        thinkingText += chunk.content;
        setMessages((prev) => {
          const assistantIndex = prev.findIndex((item) => item.id === assistantId);
          if (assistantIndex >= 0) {
            const assistantMsg = prev[assistantIndex];
            return [
              ...prev.slice(0, assistantIndex),
              { ...assistantMsg, thinkingContent: thinkingText },
              ...prev.slice(assistantIndex + 1)
            ];
          }
          return [
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
        });
      } else if (chunk.type === "thought") {
        thoughtTraces.push(...chunk.content);
        setMessages((prev) => {
          const assistantIndex = prev.findIndex((item) => item.id === assistantId);
          if (assistantIndex >= 0) {
            const assistantMsg = prev[assistantIndex];
            return [
              ...prev.slice(0, assistantIndex),
              { ...assistantMsg, thoughtTrace: [...thoughtTraces] },
              ...prev.slice(assistantIndex + 1)
            ];
          }
          return [
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
        });
      } else if (chunk.type === "done") {
        streamCompleted = true;
        sources.push(...chunk.sources);
        thoughtTraces.push(...chunk.thought_trace);
        setMessages((prev) => {
          const assistantIndex = prev.findIndex((item) => item.id === assistantId);
          if (assistantIndex >= 0) {
            const assistantMsg = prev[assistantIndex];
            return [
              ...prev.slice(0, assistantIndex),
              {
                ...assistantMsg,
                content: responseText || "已完成。",
                sources: [...new Set(sources)],
                thoughtTrace: [...new Set(thoughtTraces)],
                thinkingContent: thinkingText
              },
              ...prev.slice(assistantIndex + 1)
            ];
          }
          return [
            ...prev,
            {
              id: assistantId,
              role: "assistant" as const,
              content: responseText || "已完成。",
              sources: [...new Set(sources)],
              thoughtTrace: [...new Set(thoughtTraces)],
              thinkingContent: thinkingText
            }
          ];
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
        history: toConversationHistory(messages)
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
    setMessages([]);
    setStatus("对话已清空");
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <h1 className="title">AgentOS</h1>
        <div className="row">
          <button onClick={() => setShowModal(true)}>新建工作空间</button>
          <button onClick={loadWorkspaces}>刷新</button>
        </div>
        <div style={{ marginTop: 12 }}>
          {workspaces.map((item) => (
            <div
              key={item.name}
              className={`workspace-item ${currentWorkspace?.name === item.name ? "active" : ""}`}
              onClick={() => {
                setCurrentWorkspace(item);
                setMessages([]);
                setStatus(`已切换到 ${item.name}`);
              }}
            >
              <div>{item.name}</div>
              <div className="muted">{item.source_path}</div>
            </div>
          ))}
        </div>
        <p className="muted">{status}</p>
      </aside>

      <main className="content">
        <div className="toolbar row">
          <strong>{currentWorkspace ? currentWorkspace.name : "未选择工作空间"}</strong>
          <span className="grow" />
          <button onClick={onSync} disabled={!hasWorkspace}>同步文件</button>
          <button onClick={onClear} disabled={!hasWorkspace}>清空对话</button>
        </div>

        <div className="chat-list">
          {!hasWorkspace ? <p className="muted">请先创建或选择工作空间</p> : null}
          {messages.map((msg) => (
            <div key={msg.id} className={`msg ${msg.role === "user" ? "user" : ""}`}>
              <div className="bubble">
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
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
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
              placeholder="输入问题或修改指令..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void onSend();
                }
              }}
            />
            <button onClick={onSend} disabled={!hasWorkspace || isSending}>发送</button>
          </div>
        </div>
      </main>

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
                <option value="doubao-seed-1-8-251228">豆包 Seed 1.8</option>
                <option value="doubao-pro-32k">豆包 Pro 32K</option>
                <option value="doubao-pro-128k">豆包 Pro 128K</option>
                <option value="doubao-lite-32k">豆包 Lite 32K</option>
              </select>
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
