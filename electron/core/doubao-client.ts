import { getConfig } from "./env.js";

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
export async function* createStreamResponse(payload: Record<string, unknown>) {
  const cfg = getConfig();
  if (!cfg.arkApiKey) {
    throw new Error("ARK_API_KEY 未配置");
  }

  const base = cfg.arkBaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.arkApiKey}`
    },
    body: JSON.stringify({ ...payload, stream: true })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`豆包 responses 调用失败: ${response.status} ${text}`);
  }

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
          yield event;
        }

        boundaryIndex = buffer.search(/\r?\n\r?\n/);
      }

      if (done) {
        const rest = buffer.trim();
        if (rest) {
          const event = parseSseFrame(rest);
          if (event) {
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
