import { getConfig } from "./env.js";
import { randomUUID } from "node:crypto";

function truncateText(text: string, maxLen = 400) {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}... [truncated ${text.length - maxLen} chars]`;
}

function sanitizeForDebug(value: unknown, maxChars: number): unknown {
  if (value == null) return value;
  if (typeof value === "string") return truncateText(value, maxChars);
  if (Array.isArray(value)) return value.map((item) => sanitizeForDebug(item, maxChars));
  if (typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("authorization") ||
      lower.includes("api_key") ||
      lower.includes("apikey") ||
      lower.includes("token") ||
      lower.includes("secret") ||
      lower.includes("cookie")
    ) {
      next[key] = "[REDACTED]";
      continue;
    }
    next[key] = sanitizeForDebug(val, maxChars);
  }
  return next;
}

function debugLog(enabled: boolean, maxChars: number, label: string, payload: unknown) {
  if (!enabled) return;
  const safePayload = sanitizeForDebug(payload, maxChars);
  console.log(`[DEBUG_MODEL_IO] ${label}`, safePayload);
}

function extractTextSnippet(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const obj = event as Record<string, unknown>;
  const candidates = ["delta", "text", "content", "output_text", "outputText", "message"];
  for (const k of candidates) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  // 常见结构：{ data: { delta/text/content } }
  const data = obj.data;
  if (data && typeof data === "object") {
    const dataObj = data as Record<string, unknown>;
    for (const k of candidates) {
      const v = dataObj[k];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return null;
}

function parseSseFrame(frame: string) {
  let eventType = "";
  const dataLines: string[] = [];

  for (const rawLine of frame.split(/\r?\n/)) {
    if (!rawLine) continue;
    if (rawLine.startsWith(":")) continue;
    if (rawLine.startsWith("event:")) {
      eventType = rawLine.slice(6).trim();
      continue;
    }
    if (rawLine.startsWith("data:")) {
      dataLines.push(rawLine.slice(5).trimStart());
      continue;
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  const dataText = dataLines.join("\n");
  if (!dataText || dataText === "[DONE]") {
    return null;
  }

  try {
    const parsed = JSON.parse(dataText) as Record<string, unknown>;
    if (eventType && typeof parsed === "object" && parsed && typeof parsed.type !== "string") {
      parsed.type = eventType;
    }
    return parsed;
  } catch (error) {
    console.error("解析 SSE 事件失败:", { eventType, dataText, error });
    return null;
  }
}

// 流式响应
export async function* createStreamResponse(payload: Record<string, unknown> & { signal?: AbortSignal }) {
  const cfg = getConfig();
  if (!cfg.arkApiKey) {
    throw new Error("ARK_API_KEY 未配置");
  }

  const base = cfg.arkBaseUrl.replace(/\/+$/, "");
  const { signal, ...restPayload } = payload;
  const requestBody = { ...restPayload, stream: true };
  const requestId = randomUUID();
  const startedAt = Date.now();
  const enabled = cfg.debugModelIo;
  const maxChars = cfg.debugModelIoMaxChars;
  const verbose = cfg.debugModelIoVerbose;
  const url = `${base}/responses`;

  debugLog(enabled, maxChars, "request", {
    requestId,
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.arkApiKey}`
    },
    body: requestBody
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.arkApiKey}`
    },
    body: JSON.stringify(requestBody),
    signal
  });

  if (!response.ok) {
    const text = await response.text();
    debugLog(enabled, maxChars, "response_error", {
      requestId,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      bodyText: text
    });
    throw new Error(`豆包 responses 调用失败: ${response.status} ${text}`);
  }

  debugLog(enabled, maxChars, "response_meta", {
    requestId,
    status: response.status,
    elapsedMs: Date.now() - startedAt
  });

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法获取响应流");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
      } else {
        buffer += decoder.decode(value, { stream: true });
      }

      let boundaryIndex = buffer.search(/\r?\n\r?\n/);
      while (boundaryIndex >= 0) {
        const frame = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex).replace(/^\r?\n\r?\n/, "");

        const event = parseSseFrame(frame);
        if (event) {
          const eventObj = event as Record<string, unknown>;
          const type = typeof eventObj.type === "string" ? eventObj.type : "(unknown)";
          const snippet = extractTextSnippet(eventObj);
          if (snippet) {
            debugLog(enabled, maxChars, "sse_text", { requestId, type, text: snippet });
          }
          if (verbose) {
            debugLog(enabled, maxChars, "sse_event", { requestId, type, event: eventObj });
          }
          yield event;
        }

        boundaryIndex = buffer.search(/\r?\n\r?\n/);
      }

      if (done) {
        const rest = buffer.trim();
        if (rest) {
          const event = parseSseFrame(rest);
          if (event) {
            const eventObj = event as Record<string, unknown>;
            const type = typeof eventObj.type === "string" ? eventObj.type : "(unknown)";
            const snippet = extractTextSnippet(eventObj);
            if (snippet) {
              debugLog(enabled, maxChars, "sse_text", { requestId, type, text: snippet });
            }
            if (verbose) {
              debugLog(enabled, maxChars, "sse_event", { requestId, type, event: eventObj });
            }
            yield event;
          }
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
