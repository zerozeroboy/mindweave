import { ChatMessage, ChatThread } from '../types';
import { THREAD_STORAGE_VERSION } from './constants';

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments where crypto.randomUUID is not available (e.g. some older browsers or contexts)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function threadStorageKey(workspaceName: string) {
  return `agentos:threads:v${THREAD_STORAGE_VERSION}:${workspaceName}`;
}

export function createEmptyThread(title = "新对话"): ChatThread {
  const now = Date.now();
  return {
    id: uid(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

// Helper to sanitize/migrate threads from storage
export function clampThreads(input: unknown): { threads: ChatThread[]; activeThreadId: string } | null {
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

// Convert ProChat messages back to our history format for API calls
export function toConversationHistory(messages: any[]) {
  return messages
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        m.role === "user" || m.role === "assistant"
    )
    .map((m) => ({ role: m.role, content: m.content }));
}
