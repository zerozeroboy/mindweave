export type ThinkingEvent = {
  id: string;
  type: 'thought' | 'tool';
  content: string; // For thought: text. For tool: args/output.
  toolName?: string;
  toolTitle?: string;
  toolStatus?: 'running' | 'success' | 'failed';
  toolDetails?: string[];
  toolPreview?: string;
  timestamp: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt?: number;
  updatedAt?: number;
  // Extra fields for our internal state
  sources?: string[];
  thoughtTrace?: string[]; // Deprecated?
  thinkingContent?: string; // Deprecated?
  thinkingEvents?: ThinkingEvent[]; // New structured thinking log
  tool?: any; // Legacy tool field
};

export type ChatThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};
