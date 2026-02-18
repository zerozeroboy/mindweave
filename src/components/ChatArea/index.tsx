import { useState, useEffect, useMemo, useRef } from 'react';
import { ProChat } from '@ant-design/pro-chat';
import { Button } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { ChatMessage, ChatThread, ThinkingEvent } from '../../types';
import { uid, toConversationHistory, deriveTaskTitleFromMessage, ensureUniqueTaskTitle, isAutoTaskTitle } from '../../utils/chat';
import WelcomeScreen from './WelcomeScreen';
import ThinkingProcess from './ThinkingProcess';
import { getBackend } from '../../backend';
import styles from './chatUi.module.css';

interface ChatAreaProps {
  currentWorkspace: Workspace | null;
  activeThreadId: string;
  activeThread: ChatThread | null;
  setThreads: React.Dispatch<React.SetStateAction<ChatThread[]>>;
  onToggleWebSearch: (checked: boolean) => void;
}

export default function ChatArea({ 
  currentWorkspace, 
  activeThreadId, 
  activeThread, 
  setThreads,
  onToggleWebSearch
}: ChatAreaProps) {
  
  const chatRef = useRef<any>(null);
  const isEmptyThread = Boolean(activeThread && activeThread.messages.length === 0);
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const backend = useMemo(() => getBackend(), []);
  const itemShouldUpdate = useMemo(() => {
    return (prev: any, next: any) => {
      const p = prev?.originData ?? prev;
      const n = next?.originData ?? next;
      const pe = p?.extra;
      const ne = n?.extra;
      if (p?.content !== n?.content) return true;
      if (p?.updateAt !== n?.updateAt) return true;
      if (pe?.thinkingEvents !== ne?.thinkingEvents) return true;
      if (pe?.sources !== ne?.sources) return true;
      if (pe?.thoughtTrace !== ne?.thoughtTrace) return true;
      return false;
    };
  }, []);

  const handleWelcomeSend = (message: string) => {
    if (chatRef.current) {
      chatRef.current.sendMessage(message);
    }
  };

  const initialChats = useMemo(() => {
    return activeThread?.messages.map(m => ({
      id: m.id,
      role: m.role as any,
      content: m.content,
      createAt: m.createdAt || m.updatedAt || Date.now(),
      updateAt: m.updatedAt || Date.now(),
      extra: {
        thinkingEvents: m.thinkingEvents,
        sources: m.sources,
        thoughtTrace: m.thoughtTrace
      }
    })) || [];
  }, [activeThreadId]);

  useEffect(() => {
    setStreamingAssistantId(null);
  }, [activeThreadId]);

  const handleRequest = async (messages: any[]) => {
    if (!currentWorkspace || !activeThreadId) return new Response("Error: No workspace or thread active.");

    const latestUser = [...messages].reverse().find((m) => m?.role === 'user');
    const userId = latestUser?.id ? String(latestUser.id) : uid();
    const userContentRaw = latestUser?.content;
    const userContent = typeof userContentRaw === 'string' ? userContentRaw : String(userContentRaw ?? '');

    setThreads(prev => {
      const target = prev.find((t) => t.id === activeThreadId);
      if (!target) return prev;
      if (!isAutoTaskTitle(target.title)) return prev;

      const nextTitle = ensureUniqueTaskTitle(
        deriveTaskTitleFromMessage(userContent),
        prev.filter((t) => t.id !== activeThreadId).map((t) => t.title)
      );
      if (nextTitle === target.title) return prev;

      return prev.map((t) => (t.id === activeThreadId ? { ...t, title: nextTitle, updatedAt: Date.now() } : t));
    });

    const assistantId = `assistant_${userId}`;
    setStreamingAssistantId(assistantId);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        
        let accumulatedText = "";
        let accumulatedThinkingEvents: ThinkingEvent[] = [];
        let isThinking = false;
        const toolPreviews: Record<string, string> = {};
        let isClosed = false;

        const safeClose = () => {
          if (isClosed) return;
          isClosed = true;
          try {
            controller.close();
          } catch (_e) { }
          setStreamingAssistantId(null);
        };
        
        const updateAssistantExtra = (extraPatch: Record<string, any>) => {
          const inst = chatRef.current;
          if (!inst?.setMessageValue) return;
          let existing: any = undefined;
          try {
            existing = inst.getChatById ? inst.getChatById(assistantId) : undefined;
          } catch (_e) {
            existing = undefined;
          }
          const mergedExtra = { ...(existing?.extra || {}), ...extraPatch };
          inst.setMessageValue(assistantId, 'extra', mergedExtra);
        };

        const updateThinkingEvents = (events: ThinkingEvent[]) => {
          accumulatedThinkingEvents = [...events];
          const snapshot = accumulatedThinkingEvents.map((e) => ({
            ...e,
            toolDetails: e.toolDetails ? [...e.toolDetails] : undefined,
          }));
          updateAssistantExtra({ thinkingEvents: snapshot });
        };

        const handleChunk = (chunk: any) => {
          let textToAppend = "";
          
          if (chunk.type === "thinking") {
             if (!isThinking) isThinking = true;
             
             const lastEvent = accumulatedThinkingEvents[accumulatedThinkingEvents.length - 1];
             if (lastEvent && lastEvent.type === 'thought') {
                 lastEvent.content += chunk.content;
                 accumulatedThinkingEvents = [...accumulatedThinkingEvents];
             } else {
                 accumulatedThinkingEvents.push({
                     id: uid(),
                     type: 'thought',
                     content: chunk.content,
                     timestamp: Date.now()
                 });
             }
             updateThinkingEvents(accumulatedThinkingEvents);
             
          } else if (chunk.type === "thought") {
             if (!isThinking) isThinking = true;
             
             const content = Array.isArray(chunk.content)
               ? chunk.content.filter(Boolean).join('\n')
               : String(chunk.content ?? '');
             
             if (content) {
               accumulatedThinkingEvents.push({
                 id: uid(),
                 type: 'thought',
                 content,
                 timestamp: Date.now()
               });
               updateThinkingEvents(accumulatedThinkingEvents);
             }
             
          } else if (chunk.type === "tool") {
             if (!isThinking) isThinking = true;
             
             if (chunk.stage === "start") {
                 const callId = typeof chunk.callId === 'string' && chunk.callId ? chunk.callId : null;
                 let existingIndex = -1;
                 if (callId) {
                   for (let i = accumulatedThinkingEvents.length - 1; i >= 0; i--) {
                     const e = accumulatedThinkingEvents[i];
                     if (e.type === 'tool' && e.id === callId) {
                       existingIndex = i;
                       break;
                     }
                   }
                 }
                 
                 if (existingIndex !== -1) {
                   accumulatedThinkingEvents[existingIndex] = {
                     ...accumulatedThinkingEvents[existingIndex],
                     toolName: chunk.name,
                     toolTitle: chunk.title,
                     toolStatus: 'running',
                     toolDetails: chunk.details,
                   };
                   accumulatedThinkingEvents = [...accumulatedThinkingEvents];
                 } else {
                   accumulatedThinkingEvents.push({
                     id: callId || uid(),
                     type: 'tool',
                     content: '',
                     toolName: chunk.name,
                     toolTitle: chunk.title,
                     toolStatus: 'running',
                     toolDetails: chunk.details,
                     timestamp: Date.now()
                   });
                 }
             } else if (chunk.stage === "end") {
                 const callId = typeof chunk.callId === 'string' && chunk.callId ? chunk.callId : null;
                 let eventIndex = -1;
                 if (callId) {
                   for (let i = accumulatedThinkingEvents.length - 1; i >= 0; i--) {
                     const e = accumulatedThinkingEvents[i];
                     if (e.type === 'tool' && e.id === callId) {
                       eventIndex = i;
                       break;
                     }
                   }
                 }

                 const toolPreview = callId ? toolPreviews[callId] : undefined;
                 if (callId) delete toolPreviews[callId];
                 
                 if (eventIndex !== -1) {
                   accumulatedThinkingEvents[eventIndex] = {
                     ...accumulatedThinkingEvents[eventIndex],
                     toolStatus: chunk.ok ? 'success' : 'failed',
                     toolDetails: chunk.details,
                     toolPreview
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
                     timestamp: Date.now()
                   });
                 }
             }
             updateThinkingEvents(accumulatedThinkingEvents);
             
          } else if (chunk.type === "text") {
             if (isThinking) {
                isThinking = false;
             }
             textToAppend += chunk.content;
          } else if (chunk.type === "tool_args") {
             if (typeof chunk.callId === 'string' && chunk.callId && chunk.preview && typeof chunk.preview.text === 'string' && chunk.preview.text) {
               toolPreviews[chunk.callId] = chunk.preview.text;
             }
          } else if (chunk.type === "done") {
             safeClose();
             updateAssistantExtra({
               thinkingEvents: accumulatedThinkingEvents.map((e) => ({
                 ...e,
                 toolDetails: e.toolDetails ? [...e.toolDetails] : undefined,
               })),
               sources: Array.isArray(chunk.sources) ? [...chunk.sources] : chunk.sources,
               thoughtTrace: Array.isArray(chunk.thought_trace) ? [...chunk.thought_trace] : chunk.thought_trace
             });
             
             return;
          }
          
          if (textToAppend) {
            accumulatedText += textToAppend;
            controller.enqueue(encoder.encode(textToAppend));
          }
        };

        const handleError = (err: any) => {
          const msg = `\n\nError: ${err?.message ? String(err.message) : String(err)}`;
          controller.enqueue(encoder.encode(msg));
          safeClose();
        };

        try {
          const userIndex = messages.findIndex((m: any) => m?.id === userId);
          const historySlice = userIndex > 0 ? messages.slice(0, userIndex) : messages.slice(0, -1);
          await backend.chatStream({
            workspace_name: currentWorkspace.name,
            message: userContent,
            history: toConversationHistory(historySlice).map((h: any) => ({
              role: h.role,
              content: typeof h.content === 'string' ? h.content : String(h.content ?? '')
            }))
          }, { onChunk: handleChunk, onError: handleError });
          safeClose();
        } catch (e) {
          controller.enqueue(encoder.encode(`Error starting chat: ${(e as Error).message}`));
          safeClose();
        }
      }
    });

    return new Response(stream);
  };

  if (!activeThreadId) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#ccc' }}>
        请选择或创建一个任务
      </div>
    );
  }

  return (
    <div
      className="chat-stage"
      style={{ flex: 1, position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      {isEmptyThread && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'var(--mw-bg-page)' }}>
           <WelcomeScreen
             onSend={handleWelcomeSend}
             webSearchEnabled={Boolean(currentWorkspace?.enableWebSearch)}
             onToggleWebSearch={onToggleWebSearch}
           />
        </div>
      )}
      
      <div style={{ height: '100%', width: '100%', visibility: isEmptyThread ? 'hidden' : 'visible' }}>
        <ProChat
          chatRef={chatRef}
          key={activeThreadId}
          className={styles.proChatRoot}
          style={{ height: '100%', width: '100%' }}
          initialChats={initialChats}
          inputAreaRender={(defaultDom) => {
            const enabled = Boolean(currentWorkspace?.enableWebSearch);
            return (
              <div className={styles.inputAreaOuter}>
                <div className={styles.inputShell}>
                  {defaultDom}
                  <div className={styles.toolbox}>
                    <Button
                      type="text"
                      shape="circle"
                      icon={<GlobalOutlined />}
                      onClick={() => onToggleWebSearch(!enabled)}
                      disabled={!currentWorkspace}
                      className={`${styles.toolButton} ${enabled ? styles.toolButtonActive : ''}`}
                      aria-label="联网搜索"
                      aria-pressed={enabled}
                    />
                  </div>
                </div>
              </div>
            );
          }}
          request={handleRequest}
          itemShouldUpdate={itemShouldUpdate as any}
          genMessageId={async (_msgs: any[], parentId: string) => `assistant_${parentId}`}
          onChatsChange={(chats: any[]) => {
            setThreads(prev => prev.map(t => {
              if (t.id !== activeThreadId) return t;
              const nextMessages: ChatMessage[] = chats.map((c: any) => {
                const content = typeof c.content === 'string' ? c.content : String(c.content ?? '');
                const extra = c.extra && typeof c.extra === 'object' ? c.extra : {};
                return {
                  id: String(c.id),
                  role: c.role,
                  content,
                  createdAt: c.createAt,
                  updatedAt: c.updateAt,
                  thinkingEvents: extra.thinkingEvents,
                  sources: extra.sources,
                  thoughtTrace: extra.thoughtTrace
                };
              });
              return { ...t, updatedAt: Date.now(), messages: nextMessages };
            }));
          }}
          assistantMeta={{
            avatar: '',
            title: '',
            backgroundColor: "#111111",
          }}
          userMeta={{
            avatar: '',
            title: '',
          }}
          chatItemRenderConfig={{
            avatarRender: false,
            titleRender: false,
            contentRender: (item, defaultDom) => {
               const it = item as any;
               const origin = it.originData ?? it;
               const isAssistant = origin.role === 'assistant';
               const eventsToRender: ThinkingEvent[] | undefined = origin.extra?.thinkingEvents;
               const status = streamingAssistantId && origin.id === streamingAssistantId ? 'active' : 'completed';

               return (
                 <div style={{ width: '100%' }}>
                   {isAssistant && eventsToRender && eventsToRender.length > 0 && (
                     <ThinkingProcess 
                        events={eventsToRender} 
                        status={status as any}
                     />
                   )}
                   {defaultDom}
                 </div>
               );
            }
          }}
        />
      </div>
    </div>
  );
}
