import { createStreamResponse } from "./doubao-client.js";
import { getConfig } from "./env.js";
import { runTool, toolSchemas } from "./tools.js";
import fs from "node:fs/promises";
import path from "node:path";

type HistoryItem = { role: "user" | "assistant"; content: string };
type Workspace = { name: string; source_path: string; mirror_path: string; model: string };

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
  if (eventType.includes("reasoning") || eventType.includes("thinking")) {
    return [...collectTextFromUnknown(evt.delta), ...collectTextFromUnknown(evt.text), ...collectTextFromUnknown(evt.content), ...collectTextFromUnknown(evt.reasoning_text)]
      .map((text) => text)
      .filter((text) => text.replace(/\s/g, "").length > 0);
  }
  return [];
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
  const thoughtTrace: string[] = [];
  const emittedThinkingFallback = new Set<string>();

  input.push({
    role: "system",
    content: [
      {
        type: "input_text",
        text: systemPrompt
      }
    ]
  });

  for (const item of payload.history.slice(-12)) {
    input.push({
      role: item.role,
      content: [{ type: "input_text", text: item.content }]
    });
  }
  input.push({
    role: "user",
    content: [{ type: "input_text", text: payload.message }]
  });

  for (let round = 0; round < 4; round += 1) {
    let hasProcessedChunk = false;
    let needNextRound = false;
    let hasOutputDelta = false;

    for await (const chunk of createStreamResponse({
      model: payload.workspace.model || cfg.defaultModel,
      input,
      tools: toolSchemas(),
      tool_choice: "auto"
    })) {
      const chunkData = chunk as ModelResponse | StreamEvent;
      hasProcessedChunk = true;

      // 提取思考过程（与工具轨迹分离）
      const reasoningDeltas = getReasoningDelta(chunkData);
      if (reasoningDeltas.length > 0) {
        for (const delta of reasoningDeltas) {
          if (delta.length > 0) {
            yield { type: "thinking", content: delta };
          }
        }
      } else {
        // 某些模型仅在完成事件返回思考内容，作为降级补偿
        const traces = getReasoningTrace(toModelResponse(chunkData));
        for (const trace of traces) {
          if (!emittedThinkingFallback.has(trace)) {
            emittedThinkingFallback.add(trace);
            yield { type: "thinking", content: trace };
          }
        }
      }
      
      // 提取输出文本
      const textDelta = getTextDelta(chunkData);
      if (textDelta) {
        hasOutputDelta = true;
        yield { type: "text", content: textDelta };
      }
      const text = !hasOutputDelta ? getOutputText(toModelResponse(chunkData)) : "";
      if (text) {
        yield { type: "text", content: text };
      }

      // 处理工具调用
      const calls = getToolCallsFromChunk(chunkData);
      if (calls.length > 0) {
        for (const call of calls) {
          thoughtTrace.push(`🔧 调用工具: ${call.name}`);
          yield { type: "thought", content: [`🔧 调用工具: ${call.name}`] };
          
          const toolResult = await runTool(payload.workspace, call.name, call.arguments);
          if (typeof toolResult.path === "string") {
            sources.add(toolResult.path);
          }
          if (Array.isArray(toolResult.hits)) {
            for (const hit of toolResult.hits) {
              if (typeof hit.path === "string") {
                sources.add(hit.path);
              }
            }
          }
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(toolResult)
          });
        }
        needNextRound = true;
        break; // 需要下一轮
      }
    }

    // 如果没有处理任何 chunk 或者不需要下一轮，结束
    if (!hasProcessedChunk || !needNextRound) {
      yield {
        type: "done",
        sources: [...sources],
        thought_trace: [...new Set(thoughtTrace)]
      };
      return;
    }
  }

  // 达到最大轮数，强制结束
  yield {
    type: "done",
    sources: [...sources],
    thought_trace: [...new Set(thoughtTrace)]
  };
}
