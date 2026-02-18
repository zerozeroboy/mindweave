import { ChatMessage, ChatThread } from '../types';
import { THREAD_STORAGE_VERSION } from './constants';

export const UNTITLED_TASK_TITLE = '未命名任务';

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

export function createEmptyThread(title = UNTITLED_TASK_TITLE): ChatThread {
  const now = Date.now();
  return {
    id: uid(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildUntitledTaskTitle(existingTitles: string[]): string {
  const normalized = new Set(existingTitles.map(normalizeTitle));
  if (!normalized.has(UNTITLED_TASK_TITLE)) return UNTITLED_TASK_TITLE;
  let n = 2;
  while (normalized.has(`${UNTITLED_TASK_TITLE}-${n}`)) n += 1;
  return `${UNTITLED_TASK_TITLE}-${n}`;
}

export function isAutoTaskTitle(title: string): boolean {
  const t = normalizeTitle(title);
  return (
    new RegExp(`^${escapeRegExp(UNTITLED_TASK_TITLE)}(?:-\\d+)?$`).test(t) ||
    /^新对话(?:-\d+)?$/.test(t) ||
    /^新任务(?:-\d+)?$/.test(t)
  );
}

export function deriveTaskTitleFromMessage(content: string, maxLength = 18): string {
  const normalized = normalizeTitle(content)
    .replace(/[“”"'`]/g, '')
    .replace(/[。！？!?；;,.，、]+$/g, '');
  if (!normalized) return UNTITLED_TASK_TITLE;
  return normalized.slice(0, maxLength);
}

export function ensureUniqueTaskTitle(base: string, existingTitles: string[]): string {
  const normalizedBase = normalizeTitle(base) || UNTITLED_TASK_TITLE;
  const normalized = new Set(existingTitles.map(normalizeTitle));
  if (!normalized.has(normalizedBase)) return normalizedBase;
  let n = 2;
  while (normalized.has(`${normalizedBase}-${n}`)) n += 1;
  return `${normalizedBase}-${n}`;
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
