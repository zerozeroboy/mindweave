import type { ToolDefinition } from "../types.js";
import { parseArgs } from "../types.js";

// 简单的 HTML 转文本函数
function htmlToText(html: string): string {
  let text = html;
  
  // 移除 script 和 style 标签及其内容
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  
  // 移除注释
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  
  // 标题标签转换
  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n");
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n");
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n");
  text = text.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "\n#### $1\n");
  
  // 段落和换行
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");
  
  // 移除所有剩余的 HTML 标签
  text = text.replace(/<[^>]+>/g, "");
  
  // 解码 HTML 实体
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");
  
  // 清理多余空白
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]+/g, " ");
  
  return text.trim();
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRetryableStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

function shouldUseJinaFallback(url: string, errorMessage: string): boolean {
  if (url.startsWith("https://r.jina.ai/")) {
    return false;
  }
  if (errorMessage.includes("fetch failed")) {
    return true;
  }
  const match = errorMessage.match(/HTTP\s+(\d+)/i);
  if (!match) {
    return false;
  }
  const status = Number(match[1]);
  return Number.isFinite(status) && isRetryableStatus(status);
}

function toJinaReaderUrl(url: string): string {
  return `https://r.jina.ai/${url}`;
}

function extractTitleFromText(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("# ")) {
      return line.slice(2).trim();
    }
  }
  return lines[0] ?? "";
}

async function fetchDirect(url: string): Promise<{ contentType: string; title: string; text: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error(`不支持的内容类型: ${contentType}，仅支持 HTML 或纯文本`);
  }

  const raw = await response.text();
  const text = contentType.includes("text/plain") ? raw : htmlToText(raw);
  const title = contentType.includes("text/plain") ? extractTitleFromText(text) : extractTitle(raw);
  return { contentType, title, text };
}

async function fetchViaJina(url: string): Promise<{ contentType: string; title: string; text: string }> {
  const jinaUrl = toJinaReaderUrl(url);
  const response = await fetch(jinaUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "text/plain";
  const raw = await response.text();
  const text = raw.trim();
  const title = extractTitleFromText(text);
  return { contentType, title, text };
}

export const fetchWebpageTool: ToolDefinition = {
  schema: {
    type: "function",
    name: "fetch_webpage",
    description: "读取网页内容并转换为文本格式，可用于保存或分析网页信息",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "要读取的网页 URL，必须是完整的 http:// 或 https:// 地址"
        },
        max_length: {
          type: "number",
          description: "返回内容的最大字符数，默认 50000"
        }
      },
      required: ["url"]
    }
  },
  async run(_workspace, argsRaw) {
    const args = parseArgs(argsRaw);
    const url = String(args.url ?? "");
    const maxLength = Math.min(200_000, Math.max(1000, Number(args.max_length ?? 50_000)));

    if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
      throw new Error("无效的 URL，必须以 http:// 或 https:// 开头");
    }

    let directErrorMessage = "";
    try {
      const direct = await fetchDirect(url);
      const truncated = direct.text.length > maxLength;
      const content = truncated ? direct.text.slice(0, maxLength) : direct.text;
      return {
        url,
        title: direct.title,
        content,
        length: direct.text.length,
        truncated,
        contentType: direct.contentType,
        source: "direct"
      };
    } catch (error) {
      directErrorMessage = normalizeErrorMessage(error);
    }

    if (!shouldUseJinaFallback(url, directErrorMessage)) {
      throw new Error(`读取网页失败: ${directErrorMessage}`);
    }

    let fallbackErrorMessage = "";
    try {
      const fallback = await fetchViaJina(url);
      const truncated = fallback.text.length > maxLength;
      const content = truncated ? fallback.text.slice(0, maxLength) : fallback.text;
      return {
        url,
        title: fallback.title,
        content,
        length: fallback.text.length,
        truncated,
        contentType: fallback.contentType,
        source: "jina_reader_fallback",
        direct_error: directErrorMessage,
        fetched_url: toJinaReaderUrl(url)
      };
    } catch (error) {
      fallbackErrorMessage = normalizeErrorMessage(error);
    }

    throw new Error(`读取网页失败: ${directErrorMessage}；Jina fallback 失败: ${fallbackErrorMessage}`);
  }
};

// 提取网页标题
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (match && match[1]) {
    return match[1]
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();
  }
  return "";
}
