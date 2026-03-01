import { createStreamResponse } from "./doubao-client.js";
import { getConfig } from "./env.js";
import { runTool, toolSchemas } from "./tools.js";
import type { Workspace } from "./workspace-store.js";
import fs from "node:fs/promises";
import path from "node:path";

type HistoryItem = { role: "user" | "assistant"; content: string };

type ModelResponse = {
  output_text?: string;
  reasoning_content?: string;
  output?: Array<{
    type: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    content?: Array<{
      type: string;
      text?: string;
      reasoning_text?: string;
      content?: string;
    }>;
    summary?: Array<{
      type?: string;
      text?: string;
      content?: string;
    }>;
    [key: string]: unknown;
  }>;
};

type StreamEvent = {
  type?: string;
  delta?: unknown;
  text?: unknown;
  content?: unknown;
  reasoning_text?: unknown;
  item?: {
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  response?: ModelResponse;
};

type ToolStreamChunk = {
  type: "tool";
  stage: "start" | "end";
  callId: string;
  name: string;
  title: string;
  details: string[];
  ok?: boolean;
  durationMs?: number;
};

type ToolArgsStreamChunk = {
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
};

type SourceRef = {
  path: string;
  line?: number;
  quote?: string;
};

function normalizeQuote(text: unknown, maxLen = 180): string | undefined {
  if (typeof text !== "string") return undefined;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized;
}

function sourceRefKey(ref: SourceRef): string {
  return `${ref.path}#${ref.line ?? 0}#${ref.quote ?? ""}`;
}

const SYSTEM_PROMPT_RELATIVE_PATH = "electron/prompts/system-prompt.md";

async function loadSystemPrompt(rootDir: string): Promise<string> {
  const fullPath = path.join(rootDir, SYSTEM_PROMPT_RELATIVE_PATH);
  const text = (await fs.readFile(fullPath, "utf-8")).trim();
  if (!text) {
    throw new Error(`系统提示词文件为空: ${SYSTEM_PROMPT_RELATIVE_PATH}`);
  }
  return text;
}

function collectTextFromUnknown(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextFromUnknown(item));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = [
      "text",
      "content",
      "reasoning_text",
      "delta",
      "value",
      "output_text",
      "reasoning_content"
    ];
    return keys.flatMap((key) => collectTextFromUnknown(obj[key]));
  }
  return [];
}

function toModelResponse(chunk: ModelResponse | StreamEvent): ModelResponse {
  if (chunk && typeof chunk === "object" && "response" in chunk && chunk.response) {
    return chunk.response;
  }
  return chunk as ModelResponse;
}

function getTextDelta(chunk: ModelResponse | StreamEvent): string {
  const evt = chunk as StreamEvent;
  if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
    return evt.delta;
  }
  return "";
}

function getOutputText(response: ModelResponse): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  for (const item of response.output ?? []) {
    if (item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    const text = item.content
      .filter((part) => part.type === "output_text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("\n");
    if (text) {
      return text;
    }
  }
  return "";
}

function getToolCalls(response: ModelResponse) {
  return (response.output ?? [])
    .filter((item) => item.type === "function_call")
    .map((item) => ({
      call_id: item.call_id ?? "",
      name: item.name ?? "",
      arguments: item.arguments ?? "{}"
    }))
    .filter((item) => item.call_id && item.name);
}

function getToolCallsFromChunk(chunk: ModelResponse | StreamEvent) {
  const evt = chunk as StreamEvent;
  const fromEvent =
    evt.type === "response.output_item.done" && evt.item?.type === "function_call"
      ? [
          {
            call_id: evt.item.call_id ?? "",
            name: evt.item.name ?? "",
            arguments: evt.item.arguments ?? "{}"
          }
        ]
      : [];
  const fromResponse = getToolCalls(toModelResponse(chunk));
  return [...fromEvent, ...fromResponse]
    .filter((item) => item.call_id && item.name)
    .filter(
      (item, index, arr) =>
        arr.findIndex((x) => x.call_id === item.call_id && x.name === item.name) === index
    );
}

function getReasoningTrace(response: ModelResponse): string[] {
  const traces: string[] = [];

  if (typeof response.reasoning_content === "string" && response.reasoning_content.trim()) {
    traces.push(response.reasoning_content.trim());
  }

  for (const item of response.output ?? []) {
    const itemType = (item.type ?? "").toLowerCase();
    const contentList = Array.isArray(item.content) ? item.content : [];
    const fromParts = contentList
      .filter((part) => {
        const partType = (part.type ?? "").toLowerCase();
        return partType.includes("reasoning") || partType.includes("thinking");
      })
      .map((part) => [part.reasoning_text, part.text, part.content].filter(Boolean).join("\n"))
      .filter((text): text is string => typeof text === "string" && text.trim().length > 0);

    const itemText = typeof item.text === "string" ? item.text : "";
    const itemContent =
      typeof item.content === "string" ? item.content : "";
    const fromItem =
      itemType.includes("reasoning") || itemType.includes("thinking")
        ? [itemText, itemContent]
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];

    const fromSummary = (item.summary ?? [])
      .map((part) => [part.text, part.content].filter(Boolean).join("\n"))
      .filter((text): text is string => typeof text === "string" && text.trim().length > 0);

    traces.push(...fromParts, ...fromItem, ...fromSummary);
  }

  return traces.map((text) => text.trim()).filter((text) => text.length > 0);
}

function getReasoningDelta(chunk: ModelResponse | StreamEvent): string[] {
  const evt = chunk as StreamEvent;
  const eventType = (evt.type ?? "").toLowerCase();
  const isReasoningDelta =
    (eventType.includes("reasoning") || eventType.includes("thinking")) &&
    eventType.endsWith(".delta");
  if (!isReasoningDelta) return [];

  const candidates: string[] = [];
  if (typeof evt.delta === "string") {
    candidates.push(evt.delta);
  } else {
    candidates.push(...collectTextFromUnknown(evt.delta));
  }
  if (candidates.length === 0 && typeof evt.reasoning_text === "string") {
    candidates.push(evt.reasoning_text);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const text of candidates) {
    if (text.replace(/\s/g, "").length === 0) continue;
    const key = text.replace(/\s+/g, " ").trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function safeParseJsonObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

function unescapeJsonString(input: string): string {
  // 只做最常见的转义，够用且安全（不执行任意 escape）
  return input
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function extractJsonStringValue(rawArgs: string, key: string): { value: string; closed: boolean } | null {
  const idx = rawArgs.indexOf(`"${key}"`);
  if (idx < 0) return null;
  const afterKey = rawArgs.slice(idx + key.length + 2);
  const colonIdx = afterKey.indexOf(":");
  if (colonIdx < 0) return null;
  const afterColon = afterKey.slice(colonIdx + 1).trimStart();
  if (!afterColon.startsWith('"')) return null;

  let i = 1;
  let out = "";
  let escaped = false;
  while (i < afterColon.length) {
    const ch = afterColon[i];
    if (escaped) {
      out += `\\${ch}`;
      escaped = false;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      return { value: unescapeJsonString(out), closed: true };
    }
    out += ch;
    i += 1;
  }
  return { value: unescapeJsonString(out), closed: false };
}

function truncateTail(text: string, maxChars: number) {
  const t = String(text ?? "");
  if (t.length <= maxChars) return { text: t, truncated: false };
  return { text: t.slice(-maxChars), truncated: true };
}

function truncateHead(text: string, maxChars: number) {
  const t = String(text ?? "");
  if (t.length <= maxChars) return { text: t, truncated: false };
  return { text: t.slice(0, maxChars), truncated: true };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function getWebSearchQuery(raw: Record<string, unknown>) {
  const pick = (obj: Record<string, unknown>) => {
    if (typeof obj.query === "string" && obj.query.trim()) return obj.query.trim();
    const queries = obj.queries;
    if (Array.isArray(queries)) {
      const first = queries[0];
      if (typeof first === "string" && first.trim()) return first.trim();
      if (first && typeof first === "object") {
        const firstObj = first as Record<string, unknown>;
        if (typeof firstObj.query === "string" && firstObj.query.trim()) return firstObj.query.trim();
        if (typeof (firstObj as any).q === "string" && String((firstObj as any).q).trim()) return String((firstObj as any).q).trim();
      }
    }
    if (typeof (obj as any).search_query === "string" && String((obj as any).search_query).trim()) {
      return String((obj as any).search_query).trim();
    }
    if (typeof (obj as any).q === "string" && String((obj as any).q).trim()) {
      return String((obj as any).q).trim();
    }
    return "";
  };

  const direct = pick(raw);
  if (direct) return direct;

  const nestedKeys = ["input", "parameters", "args", "payload", "request"];
  for (const k of nestedKeys) {
    const nested = asRecord((raw as any)[k]);
    if (!nested) continue;
    const q = pick(nested);
    if (q) return q;
  }
  return "";
}

function getWebSearchCallId(raw: Record<string, unknown>, query: string) {
  const idCandidates = [
    raw.call_id,
    raw.id,
    (raw as any).search_id,
    (raw as any).tool_call_id
  ].filter((v) => typeof v === "string" && v.trim()) as string[];
  const id = idCandidates[0] ?? "";
  if (id) return `web_search:${id}`;
  if (query) {
    const enc = Buffer.from(query).toString("base64url").slice(0, 24);
    return `web_search:q:${enc}`;
  }
  return "";
}

function getWebSearchUrls(raw: Record<string, unknown>) {
  const out: string[] = [];
  const urlKeys = ["url", "link", "source_url", "sourceUrl", "href"];

  const collect = (value: unknown, depth: number) => {
    if (depth <= 0 || !value) return;
    if (typeof value === "string") return;
    if (Array.isArray(value)) {
      for (const v of value) collect(v, depth - 1);
      return;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const k of urlKeys) {
        const u = obj[k];
        if (typeof u === "string" && u.trim()) out.push(u.trim());
      }
      const containers = [
        (obj as any).results,
        (obj as any).search_results,
        (obj as any).items,
        (obj as any).data,
        (obj as any).output,
        (obj as any).result,
        (obj as any).documents
      ];
      for (const c of containers) collect(c, depth - 1);
    }
  };

  collect(raw, 3);
  return [...new Set(out)];
}

function getWebSearchSignalsFromChunk(chunk: ModelResponse | StreamEvent) {
  const signals: Array<{ callId: string; query: string; done: boolean; urls: string[] }> = [];
  const evt = chunk as StreamEvent;

  const addFromRaw = (raw: unknown, evtType: string) => {
    if (!raw || typeof raw !== "object") return;
    const obj = raw as Record<string, unknown>;
    const t = typeof obj.type === "string" ? obj.type.toLowerCase() : "";
    if (!t.includes("web_search")) return;

    const query = getWebSearchQuery(obj);
    const callId = getWebSearchCallId(obj, query);
    if (!callId) return;

    const status = typeof (obj as any).status === "string" ? String((obj as any).status).toLowerCase() : "";
    const done =
      evtType === "response.output_item.done" ||
      status === "completed" ||
      status === "succeeded" ||
      status === "success" ||
      t.includes("result");
    const urls = getWebSearchUrls(obj);
    signals.push({ callId, query, done, urls });
  };

  addFromRaw(evt.item, typeof evt.type === "string" ? evt.type : "");
  const resp = toModelResponse(chunk);
  for (const item of resp.output ?? []) {
    addFromRaw(item as any, typeof evt.type === "string" ? evt.type : "");
  }

  const byId = new Map<string, { callId: string; query: string; done: boolean; urls: string[] }>();
  for (const s of signals) {
    const prev = byId.get(s.callId);
    if (!prev) {
      byId.set(s.callId, s);
      continue;
    }
    byId.set(s.callId, {
      callId: s.callId,
      query: s.query || prev.query,
      done: s.done || prev.done,
      urls: [...new Set([...prev.urls, ...s.urls])]
    });
  }
  return [...byId.values()];
}

function toolDisplayName(toolName: string) {
  const map: Record<string, string> = {
    list_files: "列出文件",
    search_files: "搜索文件",
    read_file: "读取文件",
    write_file: "写入文件",
    create_file: "创建文件",
    patch_file: "增量更新",
    web_search: "联网搜索"
  };
  return map[toolName] ?? toolName;
}

function summarizeToolStart(toolName: string, args: Record<string, unknown>): { title: string; details: string[] } {
  const display = toolDisplayName(toolName);
  const details: string[] = [];
  if (toolName === "list_files") {
    details.push(`目录：${String(args.directory ?? ".")}`);
  } else if (toolName === "search_files") {
    details.push(`关键词：${String(args.query ?? "")}`);
    if (args.limit != null) details.push(`上限：${Number(args.limit)}`);
  } else if (toolName === "read_file") {
    details.push(`路径：${String(args.path ?? "")}`);
    const start = args.start_line != null ? Number(args.start_line) : null;
    const end = args.end_line != null ? Number(args.end_line) : null;
    if (start || end) details.push(`范围：${start ?? "?"}-${end ?? "?"} 行`);
  } else if (toolName === "write_file" || toolName === "create_file" || toolName === "patch_file") {
    details.push(`路径：${String(args.path ?? "")}`);
    if (toolName === "patch_file") {
      const len = typeof args.patch === "string" ? args.patch.length : String(args.patch ?? "").length;
      details.push(`补丁大小：${len} 字符`);
    } else {
      const len = typeof args.content === "string" ? args.content.length : String(args.content ?? "").length;
      details.push(`内容大小：${len} 字符`);
    }
  }
  return { title: `正在执行：${display}`, details };
}

function summarizeToolEnd(
  toolName: string,
  args: Record<string, unknown>,
  toolResult: Record<string, unknown>,
  ok: boolean,
  durationMs: number
): { title: string; details: string[] } {
  const display = toolDisplayName(toolName);
  const details: string[] = [];

  if (toolName === "list_files") {
    const files = Array.isArray(toolResult.files) ? toolResult.files : [];
    details.push(`目录：${String(args.directory ?? ".")}`);
    details.push(`返回：${files.length} 个文件`);
    if (files.length > 0 && files.length <= 20) {
      details.push(`文件列表：\n${files.map(f => `  - ${f}`).join('\n')}`);
    } else if (files.length > 20) {
      details.push(`文件列表（前20个）：\n${files.slice(0, 20).map(f => `  - ${f}`).join('\n')}\n  ... （共 ${files.length} 个）`);
    }
  } else if (toolName === "search_files") {
    const files = Array.isArray(toolResult.files) ? toolResult.files : [];
    const hits = Array.isArray(toolResult.hits) ? toolResult.hits : [];
    details.push(`关键词：${String(args.query ?? "")}`);
    const matchedCount = hits.length > 0 ? hits.length : files.length;
    details.push(`命中：${matchedCount} 个文件`);
    const examples =
      hits.length > 0
        ? hits
            .map((h) => (h && typeof h === "object" ? String((h as Record<string, unknown>).path ?? "") : ""))
            .filter((p) => p)
            .slice(0, 3)
        : files.slice(0, 3).map((f) => String(f));
    if (examples.length > 0) details.push(`示例：${examples.join("、")}`);
  } else if (toolName === "read_file") {
    details.push(`路径：${String(args.path ?? "")}`);
    const range = Array.isArray(toolResult.range) ? toolResult.range : null;
    if (range && range.length === 2) details.push(`范围：${range[0]}-${range[1]} 行`);
    const content = typeof toolResult.content === "string" ? toolResult.content : "";
    if (content) details.push(`读取：${content.length} 字符`);
  } else if (toolName === "write_file" || toolName === "create_file" || toolName === "patch_file") {
    details.push(`路径：${String(args.path ?? "")}`);
    if (toolName === "patch_file") {
      const len = typeof args.patch === "string" ? args.patch.length : String(args.patch ?? "").length;
      details.push(`补丁大小：${len} 字符`);
    } else {
      const len = typeof args.content === "string" ? args.content.length : String(args.content ?? "").length;
      details.push(`内容大小：${len} 字符`);
    }
    const action = typeof toolResult.action === "string" ? toolResult.action : "";
    if (action === "updated") details.push("结果：已更新");
    if (action === "created") details.push("结果：已创建");
    const backup = typeof (toolResult as any).backup === "string" ? String((toolResult as any).backup) : "";
    if (backup) details.push(`备份：${backup}`);
    const diff = typeof (toolResult as any).diff === "string" ? String((toolResult as any).diff) : "";
    if (diff) details.push(`差异预览：\n${diff}`);
  }

  // 失败时把真实错误原因带出来（否则只看到“工具执行失败”）
  if (!ok) {
    const err =
      typeof (toolResult as any).error === "string"
        ? String((toolResult as any).error)
        : "";
    if (err) details.push(`错误：${err}`);
  }

  details.push(`耗时：${Math.max(0, Math.round(durationMs))} ms`);
  return { title: ok ? `已完成：${display}` : `失败：${display}`, details };
}

// 流式聊天
export async function* runAgentChatStream(payload: {
  workspace: Workspace;
  message: string;
  history: HistoryItem[];
}) {
  const cfg = getConfig();
  const systemPrompt = await loadSystemPrompt(cfg.rootDir);
  const input: unknown[] = [];
  const sources = new Set<string>();
  const sourceRefs: SourceRef[] = [];
  const sourceRefSeen = new Set<string>();
  const thoughtTrace: string[] = [];
  const emittedThinkingFallback = new Set<string>();
  const toolArgsBuffers = new Map<string, string>();
  const toolStartEmitted = new Set<string>();
  const webSearchStartedAt = new Map<string, number>();
  const webSearchEnded = new Set<string>();
  let assistantText = "";
  const budget = { maxRounds: 12, maxToolCalls: 48, maxMs: 90_000, maxRepeatedToolCall: 4 };
  const startedAtAll = Date.now();
  let rounds = 0;
  let toolCalls = 0;
  const repeatedToolCalls = new Map<string, number>();

  // ModelArk Responses API: input item uses { type:"message", role, content:"..." }
  input.push({
    type: "message",
    role: "system",
    content: systemPrompt
  });

  for (const item of payload.history.slice(-12)) {
    input.push({
      type: "message",
      role: item.role,
      content: item.content
    });
  }
  input.push({
    type: "message",
    role: "user",
    content: payload.message
  });

  // 不限制轮次：只要模型持续触发工具调用，就继续下一轮
  // 注意：若模型陷入工具循环，这里不会主动熔断（按产品需要可后续再加）
  while (true) {
    rounds += 1;
    if (rounds > budget.maxRounds) {
      yield { type: "text", content: `\n\n[系统熔断] 工具轮次超过上限（${budget.maxRounds}）。请缩小问题范围后重试。` };
      yield { type: "done", sources: [...sources], source_refs: [...sourceRefs], thought_trace: [...new Set(thoughtTrace)] };
      return;
    }
    if (Date.now() - startedAtAll > budget.maxMs) {
      yield { type: "text", content: `\n\n[系统熔断] 对话耗时超过 ${Math.round(budget.maxMs / 1000)} 秒，请拆分任务后重试。` };
      yield { type: "done", sources: [...sources], source_refs: [...sourceRefs], thought_trace: [...new Set(thoughtTrace)] };
      return;
    }
    let hasProcessedChunk = false;
    let needNextRound = false;
    let hasOutputDelta = false;
    let thinkingSource: "none" | "delta" | "trace" = "none";
    let emittedReasoningText = "";

    // 根据工作空间配置决定是否启用联网搜索
    // 构建工具列表：包含文件操作工具 + 可选的联网搜索
    const tools: unknown[] = toolSchemas();
    
    if (payload.workspace.enableWebSearch) {
      // 添加豆包联网搜索工具（参考文档：https://www.volcengine.com/docs/82379/1338552）
      tools.push({ type: "web_search" });
    }

    for await (const chunk of createStreamResponse({
      model: payload.workspace.model || cfg.defaultModel,
      input,
      tools,
      tool_choice: "auto"
    })) {
      const chunkData = chunk as ModelResponse | StreamEvent;
      hasProcessedChunk = true;

      // 工具参数流（让 write_file/patch_file 的大参数可以提前可视化）
      const evt = chunkData as StreamEvent;
      const item = evt.item;
      if (item?.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string") {
        const callId = item.call_id;
        const name = item.name;
        const rawArgs = typeof item.arguments === "string" ? item.arguments : "";
        const prevArgs = toolArgsBuffers.get(callId) ?? "";
        const nextArgs = rawArgs.length >= prevArgs.length ? rawArgs : prevArgs;
        if (nextArgs && nextArgs !== prevArgs) {
          toolArgsBuffers.set(callId, nextArgs);
        }

        // 尽早发出工具卡片（不等待 arguments 完整）
        if (!toolStartEmitted.has(callId)) {
          toolStartEmitted.add(callId);
          const display = toolDisplayName(name);
          const toolStartChunk: ToolStreamChunk = {
            type: "tool",
            stage: "start",
            callId,
            name,
            title: `正在生成：${display}`,
            details: ["参数生成中..."]
          };
          yield toolStartChunk;
        }

        // 预览：尽量展示 content / patch；否则展示 arguments 尾部
        if (nextArgs) {
          const pathValue = extractJsonStringValue(nextArgs, "path")?.value;
          const contentValue = name === "write_file" || name === "create_file"
            ? extractJsonStringValue(nextArgs, "content")
            : null;
          const patchValue = name === "patch_file"
            ? extractJsonStringValue(nextArgs, "patch")
            : null;

          let field: "content" | "patch" | "arguments" = "arguments";
          let previewText = nextArgs;
          if (contentValue) {
            field = "content";
            previewText = contentValue.value;
          } else if (patchValue) {
            field = "patch";
            previewText = patchValue.value;
          }

          // 预览策略：patch 看头部（包含 diff header / hunk），arguments 看尾部（更接近最新生成部分）
          const { text, truncated } =
            field === "patch" ? truncateHead(previewText, 8000) : truncateTail(previewText, 8000);
          const argsChunk: ToolArgsStreamChunk = {
            type: "tool_args",
            callId,
            name,
            totalLen: nextArgs.length,
            preview: {
              path: pathValue,
              field,
              text,
              truncated
            }
          };
          yield argsChunk;
        }
      }

      const webSearchSignals = getWebSearchSignalsFromChunk(chunkData);
      if (webSearchSignals.length > 0) {
        for (const s of webSearchSignals) {
          if (!toolStartEmitted.has(s.callId)) {
            toolStartEmitted.add(s.callId);
            webSearchStartedAt.set(s.callId, Date.now());
            thoughtTrace.push(`🔧 调用工具: web_search`);
            const startDetails: string[] = [];
            if (s.query) startDetails.push(`查询：${s.query}`);
            const toolStartChunk: ToolStreamChunk = {
              type: "tool",
              stage: "start",
              callId: s.callId,
              name: "web_search",
              title: "正在执行：联网搜索",
              details: startDetails.length > 0 ? startDetails : ["发起搜索中..."]
            };
            yield toolStartChunk;
          }

          if (s.done && !webSearchEnded.has(s.callId)) {
            webSearchEnded.add(s.callId);
            const startedAt = webSearchStartedAt.get(s.callId) ?? Date.now();
            const durationMs = Date.now() - startedAt;
            const endDetails: string[] = [];
            if (s.query) endDetails.push(`查询：${s.query}`);
            if (s.urls.length > 0) {
              endDetails.push(`来源：${s.urls.length} 条`);
              if (s.urls.length <= 6) {
                endDetails.push(`链接：\n${s.urls.map((u) => `  - ${u}`).join("\n")}`);
              } else {
                endDetails.push(`链接（前6条）：\n${s.urls.slice(0, 6).map((u) => `  - ${u}`).join("\n")}\n  ... （共 ${s.urls.length} 条）`);
              }
            }
            endDetails.push(`耗时：${Math.max(0, Math.round(durationMs))} ms`);
            const toolEndChunk: ToolStreamChunk = {
              type: "tool",
              stage: "end",
              callId: s.callId,
              name: "web_search",
              title: "已完成：联网搜索",
              details: endDetails,
              ok: true,
              durationMs
            };
            yield toolEndChunk;
          }
        }
      }

      // 提取思考过程（与工具轨迹分离）
      const reasoningDeltas = getReasoningDelta(chunkData);
      if (reasoningDeltas.length > 0) {
        if (thinkingSource !== "trace") {
          for (const delta of reasoningDeltas) {
            if (delta.length === 0) continue;

            if (delta === emittedReasoningText) {
              continue;
            }

            if (delta.startsWith(emittedReasoningText)) {
              const suffix = delta.slice(emittedReasoningText.length);
              emittedReasoningText = delta;
              if (!suffix) continue;
              yield { type: "thinking", content: suffix, thinkingMode: "delta" as const };
              thinkingSource = "delta";
              continue;
            }

            if (emittedReasoningText.endsWith(delta)) {
              continue;
            }

            emittedReasoningText += delta;
            yield { type: "thinking", content: delta, thinkingMode: "delta" as const };
            thinkingSource = "delta";
          }
        }
      } else {
        // 某些模型仅在完成事件返回思考内容，作为降级补偿
        if (thinkingSource !== "delta") {
          const traces = getReasoningTrace(toModelResponse(chunkData));
          for (const trace of traces) {
            if (!emittedThinkingFallback.has(trace)) {
              emittedThinkingFallback.add(trace);
              yield { type: "thinking", content: trace, thinkingMode: "snapshot" as const };
              thinkingSource = "trace";
            }
          }
        }
      }
      
      // 提取输出文本
      const textDelta = getTextDelta(chunkData);
      if (textDelta) {
        hasOutputDelta = true;
        assistantText += textDelta;
        yield { type: "text", content: textDelta };
      }
      const text = !hasOutputDelta ? getOutputText(toModelResponse(chunkData)) : "";
      if (text) {
        assistantText += text;
        yield { type: "text", content: text };
      }

      // 处理工具调用
      const calls = getToolCallsFromChunk(chunkData);
      if (calls.length > 0) {
        for (const call of calls) {
          thoughtTrace.push(`🔧 调用工具: ${call.name}`);
          toolCalls += 1;
          if (toolCalls > budget.maxToolCalls) {
            yield { type: "text", content: `\n\n[系统熔断] 工具调用次数超过上限（${budget.maxToolCalls}）。` };
            yield { type: "done", sources: [...sources], source_refs: [...sourceRefs], thought_trace: [...new Set(thoughtTrace)] };
            return;
          }

          const toolCallKey = `${call.name}:${call.arguments}`;
          const repeatedCount = (repeatedToolCalls.get(toolCallKey) ?? 0) + 1;
          repeatedToolCalls.set(toolCallKey, repeatedCount);
          if (repeatedCount > budget.maxRepeatedToolCall) {
            yield { type: "text", content: `\n\n[系统熔断] 检测到重复工具调用（${call.name}）超过阈值，已停止。` };
            yield { type: "done", sources: [...sources], source_refs: [...sourceRefs], thought_trace: [...new Set(thoughtTrace)] };
            return;
          }

          const argsObj = safeParseJsonObject(call.arguments);
          const startSummary = summarizeToolStart(call.name, argsObj);
          if (!toolStartEmitted.has(call.call_id)) {
            toolStartEmitted.add(call.call_id);
            const toolStartChunk: ToolStreamChunk = {
              type: "tool",
              stage: "start",
              callId: call.call_id,
              name: call.name,
              title: startSummary.title,
              details: startSummary.details
            };
            yield toolStartChunk;
          }

          const startedAt = Date.now();
          let toolResult: any;
          let toolOk = false;
          try {
            toolResult = await runTool(payload.workspace, call.name, call.arguments);
            toolOk = true;
          } catch (error) {
            toolResult = { ok: false, error: (error as Error).message };
            toolOk = false;
          }
          const durationMs = Date.now() - startedAt;

          const toolResultObj =
            toolResult && typeof toolResult === "object"
              ? (toolResult as Record<string, unknown>)
              : { ok: toolOk, value: toolResult };
          const endSummary = summarizeToolEnd(call.name, argsObj, toolResultObj, toolOk, durationMs);
          const toolEndChunk: ToolStreamChunk = {
            type: "tool",
            stage: "end",
            callId: call.call_id,
            name: call.name,
            title: endSummary.title,
            details: endSummary.details,
            ok: toolOk,
            durationMs
          };
          yield toolEndChunk;

          // 无论成功失败，都将结果反馈给模型，让 AI 自己根据错误信息调整策略
          const resultForModel = JSON.stringify(toolResultObj);
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: resultForModel
          });

          // 收集来源信息（仅在成功时有意义）
          if (toolOk) {
            const toolPath = (toolResultObj as any).path;
            if (typeof toolPath === "string") {
              sources.add(toolPath);
              const lineRange = Array.isArray((toolResultObj as any).range) ? (toolResultObj as any).range : undefined;
              const startLine = Array.isArray(lineRange) && typeof lineRange[0] === "number" ? lineRange[0] : undefined;
              const ref: SourceRef = {
                path: toolPath,
                line: startLine,
                quote: normalizeQuote((toolResultObj as any).content)
              };
              const key = sourceRefKey(ref);
              if (!sourceRefSeen.has(key)) {
                sourceRefSeen.add(key);
                sourceRefs.push(ref);
              }
            }
            const toolHits = (toolResultObj as any).hits;
            if (Array.isArray(toolHits)) {
              for (const hit of toolHits) {
                if (hit && typeof hit === "object" && typeof (hit as any).path === "string") {
                  const hitPath = String((hit as any).path);
                  sources.add(hitPath);
                  const matches = Array.isArray((hit as any).matches) ? (hit as any).matches : [];
                  for (const match of matches.slice(0, 3)) {
                    const line = typeof (match as any).line === "number" ? (match as any).line : undefined;
                    const ref: SourceRef = {
                      path: hitPath,
                      line,
                      quote: normalizeQuote((match as any).text)
                    };
                    const key = sourceRefKey(ref);
                    if (!sourceRefSeen.has(key)) {
                      sourceRefSeen.add(key);
                      sourceRefs.push(ref);
                    }
                  }
                }
              }
            }
          }
        }
        needNextRound = true;
        break; // 需要下一轮
      }
    }

    // 如果没有处理任何 chunk 或者不需要下一轮，结束
    if (!hasProcessedChunk || !needNextRound) {
      for (const [callId, startedAt] of webSearchStartedAt.entries()) {
        if (webSearchEnded.has(callId)) continue;
        const durationMs = Date.now() - startedAt;
        const toolEndChunk: ToolStreamChunk = {
          type: "tool",
          stage: "end",
          callId,
          name: "web_search",
          title: "已完成：联网搜索",
          details: [`耗时：${Math.max(0, Math.round(durationMs))} ms`],
          ok: true,
          durationMs
        };
        yield toolEndChunk;
      }

      yield {
        type: "done",
        sources: [...sources],
        source_refs: [...sourceRefs],
        thought_trace: [...new Set(thoughtTrace)]
      };
      return;
    }
  }
}
