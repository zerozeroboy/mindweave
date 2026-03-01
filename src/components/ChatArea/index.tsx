import { useState, useEffect, useMemo, useRef } from 'react';
import { Bubble } from '@ant-design/x';
import { ChatMessage, ChatThread, ThinkingEvent } from '../../types';
import { uid, toConversationHistory, deriveTaskTitleFromMessage, ensureUniqueTaskTitle, isAutoTaskTitle, createEmptyThread } from '../../utils/chat';
import WelcomeScreen from './WelcomeScreen';
import ChatComposer from './ChatComposer';
import ThinkingProcess from './ThinkingProcess';
import { getBackend } from '../../backend';
import styles from './chatUi.module.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatAreaProps {
  currentWorkspace: Workspace | null;
  activeThreadId: string;
  activeThread: ChatThread | null;
  threads: ChatThread[];
  setActiveThreadId: (id: string) => void;
  setThreads: React.Dispatch<React.SetStateAction<ChatThread[]>>;
  onToggleWebSearch: (checked: boolean) => void;
  onOpenSourceFile: (path: string) => void;
  suggestedPrompts?: string[];
}

export default function ChatArea({ 
  currentWorkspace, 
  activeThreadId, 
  activeThread, 
  threads,
  setActiveThreadId,
  setThreads,
  onToggleWebSearch,
  onOpenSourceFile,
  suggestedPrompts = []
}: ChatAreaProps) {
  const isEmptyThread = !activeThread || activeThread.messages.length === 0;
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [draft, setDraft] = useState('');
  const skipResetOnNextThreadChangeRef = useRef(false);
  const backend = useMemo(() => getBackend(), []);

  const updateThreadMessages = (
    threadId: string,
    updater: (messages: ChatMessage[]) => ChatMessage[]
  ) => {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId ? { ...t, updatedAt: Date.now(), messages: updater(t.messages) } : t
      )
    );
  };

  const [abortController, setAbortController] = useState<AbortController | null>(null);

  useEffect(() => {
    // 新建会话后会主动切换 activeThreadId，这种切换不应触发中止
    if (skipResetOnNextThreadChangeRef.current) {
      skipResetOnNextThreadChangeRef.current = false;
      return;
    }
    setStreamingAssistantId(null);
    setIsStreaming(false);
    setDraft('');
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
  }, [activeThreadId]);

  const handleStop = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setStreamingAssistantId(null);
    setIsStreaming(false);
  };

  const handleSubmit = async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return;
    if (!currentWorkspace) return;

    const createdThread = !activeThread
      ? createEmptyThread(
          ensureUniqueTaskTitle(
            deriveTaskTitleFromMessage(message),
            threads.map((t) => t.title)
          )
        )
      : null;
    const threadId = createdThread?.id ?? activeThreadId;
    const userId = uid();
    const assistantId = `assistant_${userId}`;
    const userContent = message;

    setThreads(prev => {
      let next = prev;

      if (createdThread) {
        next = [createdThread, ...next];
      } else {
        const target = next.find((t) => t.id === threadId);
        if (!target) return next;
        if (isAutoTaskTitle(target.title)) {
          const nextTitle = ensureUniqueTaskTitle(
            deriveTaskTitleFromMessage(userContent),
            next.filter((t) => t.id !== threadId).map((t) => t.title)
          );
          if (nextTitle !== target.title) {
            next = next.map((t) => (t.id === threadId ? { ...t, title: nextTitle, updatedAt: Date.now() } : t));
          }
        }
      }

      return next.map((t) =>
        t.id === threadId
          ? {
              ...t,
              updatedAt: Date.now(),
              messages: [
                ...t.messages,
                {
                  id: userId,
                  role: 'user',
                  content: userContent,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                },
                {
                  id: assistantId,
                  role: 'assistant',
                  content: '',
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  thinkingEvents: [],
                },
              ],
            }
          : t
      );
    });

    if (createdThread) {
      skipResetOnNextThreadChangeRef.current = true;
      setActiveThreadId(createdThread.id);
    }

    setDraft('');
    setStreamingAssistantId(assistantId);
    setIsStreaming(true);

    let accumulatedText = '';
    let accumulatedThinkingEvents: ThinkingEvent[] = [];
    const toolPreviews: Record<string, string> = {};
    let lastThinkingChunkKey: string | null = null;
    let closed = false;

    const safeFinish = () => {
      if (closed) return;
      closed = true;
      setStreamingAssistantId((prev) => (prev === assistantId ? null : prev));
      setIsStreaming(false);
    };

    const updateAssistant = (patch: Partial<ChatMessage>) => {
      updateThreadMessages(threadId, (messages) =>
        messages.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                ...patch,
                updatedAt: Date.now(),
              }
            : msg
        )
      );
    };

    const updateThinkingEvents = (events: ThinkingEvent[]) => {
      accumulatedThinkingEvents = [...events];
      updateAssistant({
        thinkingEvents: accumulatedThinkingEvents.map((event) => ({
          ...event,
          toolDetails: event.toolDetails ? [...event.toolDetails] : undefined,
        })),
      });
    };

    const historySlice = [...(activeThread?.messages || []), { role: 'user', content: userContent }].slice(0, -1);

    const ac = new AbortController();
    setAbortController(ac);
    const isAbortError = (message: string) => /aborted|aborterror/i.test(message);

    try {
      await backend.chatStream(
        {
          workspace_name: currentWorkspace.name,
          message: userContent,
          history: toConversationHistory(historySlice).map((h: any) => ({
            role: h.role,
            content: typeof h.content === 'string' ? h.content : String(h.content ?? ''),
          })),
        },
        {
          signal: ac.signal,
          onChunk: (chunk: StreamChunk) => {
            if (chunk.type === 'thinking') {
              const mode = chunk.thinkingMode ?? 'delta';
              const content = String(chunk.content ?? '');
              if (!content) return;
              const chunkKey = `${mode}:${content}`;
              if (lastThinkingChunkKey === chunkKey) return;
              lastThinkingChunkKey = chunkKey;

              const lastEvent = accumulatedThinkingEvents[accumulatedThinkingEvents.length - 1];
              if (mode === 'snapshot') {
                if (lastEvent && lastEvent.type === 'thought') {
                  lastEvent.content = content;
                  accumulatedThinkingEvents = [...accumulatedThinkingEvents];
                } else {
                  accumulatedThinkingEvents.push({
                    id: uid(),
                    type: 'thought',
                    content,
                    timestamp: Date.now(),
                  });
                }
              } else if (lastEvent && lastEvent.type === 'thought') {
                lastEvent.content += content;
                accumulatedThinkingEvents = [...accumulatedThinkingEvents];
              } else {
                accumulatedThinkingEvents.push({
                  id: uid(),
                  type: 'thought',
                  content,
                  timestamp: Date.now(),
                });
              }
              updateThinkingEvents(accumulatedThinkingEvents);
              return;
            }

            if (chunk.type === 'thought') {
              const content = Array.isArray(chunk.content)
                ? chunk.content.filter(Boolean).join('\n')
                : String(chunk.content ?? '');
              if (!content) return;
              accumulatedThinkingEvents.push({
                id: uid(),
                type: 'thought',
                content,
                timestamp: Date.now(),
              });
              updateThinkingEvents(accumulatedThinkingEvents);
              return;
            }

            if (chunk.type === 'tool') {
              const callId = typeof chunk.callId === 'string' && chunk.callId ? chunk.callId : null;
              if (chunk.stage === 'start') {
                let existingIndex = -1;
                if (callId) {
                  for (let i = accumulatedThinkingEvents.length - 1; i >= 0; i -= 1) {
                    const event = accumulatedThinkingEvents[i];
                    if (event.type === 'tool' && event.id === callId) {
                      existingIndex = i;
                      break;
                    }
                  }
                }
                if (existingIndex >= 0) {
                  accumulatedThinkingEvents[existingIndex] = {
                    ...accumulatedThinkingEvents[existingIndex],
                    toolName: chunk.name,
                    toolTitle: chunk.title,
                    toolStatus: 'running',
                    toolDetails: chunk.details,
                  };
                } else {
                  accumulatedThinkingEvents.push({
                    id: callId || uid(),
                    type: 'tool',
                    content: '',
                    toolName: chunk.name,
                    toolTitle: chunk.title,
                    toolStatus: 'running',
                    toolDetails: chunk.details,
                    timestamp: Date.now(),
                  });
                }
              } else if (chunk.stage === 'end') {
                let eventIndex = -1;
                if (callId) {
                  for (let i = accumulatedThinkingEvents.length - 1; i >= 0; i -= 1) {
                    const event = accumulatedThinkingEvents[i];
                    if (event.type === 'tool' && event.id === callId) {
                      eventIndex = i;
                      break;
                    }
                  }
                }
                const toolPreview = callId ? toolPreviews[callId] : undefined;
                if (callId) delete toolPreviews[callId];
                if (eventIndex >= 0) {
                  accumulatedThinkingEvents[eventIndex] = {
                    ...accumulatedThinkingEvents[eventIndex],
                    toolStatus: chunk.ok ? 'success' : 'failed',
                    toolDetails: chunk.details,
                    toolPreview,
                  };
                } else if (callId) {
                  accumulatedThinkingEvents.push({
                    id: callId,
                    type: 'tool',
                    content: '',
                    toolName: chunk.name,
                    toolTitle: chunk.title,
                    toolStatus: chunk.ok ? 'success' : 'failed',
                    toolDetails: chunk.details,
                    toolPreview,
                    timestamp: Date.now(),
                  });
                }
              }
              updateThinkingEvents(accumulatedThinkingEvents);
              return;
            }

            if (chunk.type === 'tool_args') {
              if (typeof chunk.callId === 'string' && chunk.callId && chunk.preview?.text) {
                toolPreviews[chunk.callId] = chunk.preview.text;
              }
              return;
            }

            if (chunk.type === 'text') {
              accumulatedText += chunk.content;
              updateAssistant({ content: accumulatedText });
              return;
            }

            if (chunk.type === 'done') {
              updateAssistant({
                thinkingEvents: accumulatedThinkingEvents.map((event) => ({
                  ...event,
                  toolDetails: event.toolDetails ? [...event.toolDetails] : undefined,
                })),
                sources: Array.isArray(chunk.sources) ? [...chunk.sources] : chunk.sources,
                thoughtTrace: Array.isArray(chunk.thought_trace) ? [...chunk.thought_trace] : chunk.thought_trace,
              });
              safeFinish();
            }
          },
          onError: (err: { message?: string } | string) => {
            const msg = typeof err === 'string' ? err : err?.message || String(err);
            if (isAbortError(msg)) {
              safeFinish();
              return;
            }
            accumulatedText += `\n\nError: ${msg}`;
            updateAssistant({ content: accumulatedText });
            safeFinish();
          },
        }
      );
      safeFinish();
    } catch (error) {
      const message = (error as Error).message;
      if (isAbortError(message)) {
        safeFinish();
        return;
      }
      accumulatedText += `\n\nError starting chat: ${message}`;
      updateAssistant({ content: accumulatedText });
      safeFinish();
    }
  };

  const bubbleItems = useMemo(() => {
    return (activeThread?.messages || []).map((message) => {
      const isAssistant = message.role === 'assistant';
      const thinkingEvents = isAssistant ? message.thinkingEvents : undefined;
      return {
        key: message.id,
        role: isAssistant ? 'assistant' : 'user',
        content: isAssistant ? (
          <div>
            <div className="mw-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || ''}</ReactMarkdown>
            </div>
            <SourceList sources={message.sources || []} onOpenSourceFile={onOpenSourceFile} />
          </div>
        ) : message.content,
        header:
          isAssistant && thinkingEvents && thinkingEvents.length > 0 ? (
            <ThinkingProcess
              events={thinkingEvents}
              status={streamingAssistantId && message.id === streamingAssistantId ? 'active' : 'completed'}
            />
          ) : undefined,
      };
    });
  }, [activeThread?.messages, onOpenSourceFile, streamingAssistantId]);

  const roles = useMemo(
    () => ({
      assistant: {
        placement: 'start' as const,
        variant: 'borderless' as const,
        messageRender: (content: any) => content,
      },
      user: {
        placement: 'end' as const,
        variant: 'filled' as const,
      },
    }),
    []
  );

  return (
    <div
      className="chat-stage"
      style={{ flex: 1, position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      {isEmptyThread && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'var(--mw-bg-page)' }}>
           <WelcomeScreen
             value={draft}
             onChange={setDraft}
             onSend={handleSubmit}
             onStop={handleStop}
             disabled={!currentWorkspace}
             loading={isStreaming}
             webSearchEnabled={Boolean(currentWorkspace?.enableWebSearch)}
             onToggleWebSearch={onToggleWebSearch}
             suggestedPrompts={suggestedPrompts}
           />
        </div>
      )}

      <div style={{ height: '100%', width: '100%', visibility: isEmptyThread ? 'hidden' : 'visible' }}>
        <div className={styles.chatRoot}>
          <div className={styles.messageViewport}>
            <Bubble.List
              className={styles.bubbleList}
              autoScroll
              items={bubbleItems}
              roles={roles}
            />
          </div>

          <div className={styles.inputAreaOuter}>
            <div className={styles.inputShell}>
              <ChatComposer
                value={draft}
                onChange={setDraft}
                onSubmit={handleSubmit}
                onStop={handleStop}
                disabled={!currentWorkspace}
                loading={isStreaming}
                webSearchEnabled={Boolean(currentWorkspace?.enableWebSearch)}
                onToggleWebSearch={onToggleWebSearch}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceList({ sources, onOpenSourceFile }: { sources: string[]; onOpenSourceFile: (path: string) => void }) {
  const uniqueSources = Array.from(new Set(sources));

  return (
    <div style={{ marginTop: 10, borderTop: '1px dashed #e8e8e8', paddingTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ fontSize: 12 }}>Sources</strong>
        <button
          type="button"
          style={{ border: 0, background: 'transparent', color: '#666', cursor: 'pointer', fontSize: 12 }}
          onClick={() => navigator.clipboard.writeText(uniqueSources.length > 0 ? uniqueSources.join('\n') : '(none)')}
        >
          复制
        </button>
      </div>
      {uniqueSources.length === 0 ? (
        <div style={{ fontSize: 12, color: '#999' }}>Sources: (none)</div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {uniqueSources.map((source) => (
            <li key={source} style={{ fontSize: 12, marginBottom: 2 }}>
              <button
                type="button"
                onClick={() => onOpenSourceFile(source)}
                style={{ border: 0, background: 'transparent', color: '#1677ff', cursor: 'pointer', textAlign: 'left', padding: 0 }}
              >
                {source}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
