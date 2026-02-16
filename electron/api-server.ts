import http from "node:http";
import { URL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { listWorkspaces, createWorkspace, updateWorkspace } from "./core/workspace-store.js";
import { syncWorkspaceFiles } from "./core/sync.js";
import { ensureInside, toUnixRelative } from "./core/path-safe.js";
import { runAgentChatStream } from "./core/agent-runtime.js";

type MirrorDirEntry = {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
  mtimeMs?: number;
};

type MirrorListDirResult = {
  directory: string;
  entries: MirrorDirEntry[];
};

type MirrorReadFileResult = {
  path: string;
  content: string;
  truncated: boolean;
  bytes: number;
};

function truncateText(text: string, maxLen: number) {
  const t = String(text ?? "");
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}... [truncated ${t.length - maxLen} chars]`;
}

function sanitizeChunk(value: unknown, maxChars: number): unknown {
  if (value == null) return value;
  if (typeof value === "string") return truncateText(value, maxChars);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeChunk(item, maxChars));
  if (typeof value !== "object") return String(value);

  const obj = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (lower.includes("token") || lower.includes("secret") || lower.includes("authorization") || lower.includes("api_key")) {
      next[key] = "[REDACTED]";
      continue;
    }
    next[key] = sanitizeChunk(val, maxChars);
  }
  return next;
}

function logChunk(enabled: boolean, maxChars: number, requestId: string, chunk: unknown) {
  if (!enabled) return;
  const safe = sanitizeChunk(chunk, maxChars);
  const obj = chunk && typeof chunk === "object" ? (chunk as any) : null;
  const type = obj && typeof obj.type === "string" ? obj.type : "(unknown)";
  if (type === "text" && obj && typeof obj.content === "string") {
    console.log(`[DEBUG_CHUNK] ${requestId} type=text`, { len: obj.content.length, preview: truncateText(obj.content, Math.min(maxChars, 160)) });
    return;
  }
  if (type === "thinking" && obj && typeof obj.content === "string") {
    console.log(`[DEBUG_CHUNK] ${requestId} type=thinking`, { len: obj.content.length, preview: truncateText(obj.content, Math.min(maxChars, 160)) });
    return;
  }
  console.log(`[DEBUG_CHUNK] ${requestId} type=${type}`, safe);
}

function setCors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  setCors(res);
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

async function handleWorkspaces(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method === "GET") {
    const list = await listWorkspaces();
    sendJson(res, 200, list);
    return;
  }
  if (req.method === "POST") {
    const payload = await readJsonBody<{
      name: string;
      source_path: string;
      model: string;
      enableWebSearch?: boolean;
    }>(req);
    const created = await createWorkspace(payload);
    sendJson(res, 200, created);
    return;
  }
  sendJson(res, 405, { message: "Method not allowed" });
}

async function handleWorkspaceUpdate(url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "PATCH") {
    sendJson(res, 405, { message: "Method not allowed" });
    return;
  }
  const m = url.pathname.match(/^\/api\/workspaces\/([^/]+)$/);
  if (!m) {
    sendJson(res, 404, { message: "Not found" });
    return;
  }
  const workspaceName = decodeURIComponent(m[1]);
  const payload = await readJsonBody<{ model?: unknown; enableWebSearch?: unknown }>(req);
  const updates: { model?: string; enableWebSearch?: boolean } = {};
  if (typeof payload.model === "string") updates.model = payload.model;
  if (typeof payload.enableWebSearch === "boolean") updates.enableWebSearch = payload.enableWebSearch;
  const updated = await updateWorkspace(workspaceName, updates);
  sendJson(res, 200, updated);
}

async function handleSync(url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { message: "Method not allowed" });
    return;
  }
  const m = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/sync$/);
  if (!m) {
    sendJson(res, 404, { message: "Not found" });
    return;
  }
  const workspaceName = decodeURIComponent(m[1]);
  const list = await listWorkspaces();
  const workspace = list.find((w) => w.name === workspaceName);
  if (!workspace) {
    sendJson(res, 404, { message: "工作空间不存在" });
    return;
  }
  const result = await syncWorkspaceFiles(workspace);
  sendJson(res, 200, result);
}

async function handleMirrorListDir(url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "GET") {
    sendJson(res, 405, { message: "Method not allowed" });
    return;
  }
  const m = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/mirror\/listDir$/);
  if (!m) {
    sendJson(res, 404, { message: "Not found" });
    return;
  }
  const workspaceName = decodeURIComponent(m[1]);
  const relativeDir = url.searchParams.get("dir") ?? ".";
  const list = await listWorkspaces();
  const workspace = list.find((w) => w.name === workspaceName);
  if (!workspace) {
    sendJson(res, 404, { message: "工作空间不存在" });
    return;
  }
  const root = workspace.mirror_path;
  const safeDir = ensureInside(root, String(relativeDir));
  const dirents = await fs.readdir(safeDir, { withFileTypes: true });
  const entries: MirrorDirEntry[] = [];
  for (const ent of dirents) {
    const fullPath = path.join(safeDir, ent.name);
    if (ent.isDirectory()) {
      entries.push({
        name: ent.name,
        path: toUnixRelative(root, fullPath),
        kind: "dir"
      });
    } else if (ent.isFile()) {
      const stat = await fs.stat(fullPath);
      entries.push({
        name: ent.name,
        path: toUnixRelative(root, fullPath),
        kind: "file",
        size: stat.size,
        mtimeMs: stat.mtimeMs
      });
    }
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const result: MirrorListDirResult = {
    directory: toUnixRelative(root, safeDir) || ".",
    entries
  };
  sendJson(res, 200, result);
}

async function handleMirrorReadFile(url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "GET") {
    sendJson(res, 405, { message: "Method not allowed" });
    return;
  }
  const m = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/mirror\/readFile$/);
  if (!m) {
    sendJson(res, 404, { message: "Not found" });
    return;
  }
  const workspaceName = decodeURIComponent(m[1]);
  const relativePath = url.searchParams.get("path") ?? "";
  const maxBytesRaw = Number(url.searchParams.get("maxBytes") ?? 240_000);
  const maxBytes = Math.max(4_096, Math.min(2_000_000, Number.isFinite(maxBytesRaw) ? maxBytesRaw : 240_000));
  const list = await listWorkspaces();
  const workspace = list.find((w) => w.name === workspaceName);
  if (!workspace) {
    sendJson(res, 404, { message: "工作空间不存在" });
    return;
  }
  const root = workspace.mirror_path;
  const filePath = ensureInside(root, String(relativePath));
  const fh = await fs.open(filePath, "r");
  try {
    const stat = await fh.stat();
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    const truncated = stat.size > bytesRead;
    const content = buf.subarray(0, bytesRead).toString("utf-8");
    const result: MirrorReadFileResult = {
      path: toUnixRelative(root, filePath),
      content,
      truncated,
      bytes: stat.size
    };
    sendJson(res, 200, result);
  } finally {
    await fh.close();
  }
}

async function handleChat(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { message: "Method not allowed" });
    return;
  }
  const debugChunks = process.env.AGENTOS_DEBUG_CHUNKS === "1";
  const debugChunkMaxCharsRaw = Number(process.env.AGENTOS_DEBUG_CHUNK_MAX_CHARS ?? "2000");
  const debugChunkMaxChars = Number.isFinite(debugChunkMaxCharsRaw) && debugChunkMaxCharsRaw > 0 ? debugChunkMaxCharsRaw : 2000;
  const requestId = randomUUID();

  const payload = await readJsonBody<{
    workspace_name: string;
    message: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
  }>(req);
  const list = await listWorkspaces();
  const workspace = list.find((w) => w.name === payload.workspace_name);
  if (!workspace) {
    sendJson(res, 404, { message: "工作空间不存在" });
    return;
  }

  setCors(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  res.write("event: ready\ndata: {}\n\n");

  const writeEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    for await (const chunk of runAgentChatStream({
      workspace,
      message: String(payload.message ?? ""),
      history: Array.isArray(payload.history) ? payload.history : []
    })) {
      logChunk(debugChunks, debugChunkMaxChars, requestId, chunk);
      writeEvent("chunk", chunk);
    }
    res.end();
  } catch (error) {
    writeEvent("error", { message: (error as Error).message || String(error) });
    res.end();
  }
}

function handleOptions(_req: http.IncomingMessage, res: http.ServerResponse) {
  setCors(res);
  res.writeHead(204);
  res.end();
}

const portRaw = process.env.AGENTOS_API_PORT ?? "3189";
const port = Math.max(1, Math.min(65535, Number(portRaw) || 3189));
const host = process.env.AGENTOS_API_HOST ?? "127.0.0.1";

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      sendJson(res, 400, { message: "Bad request" });
      return;
    }
    if (req.method === "OPTIONS") {
      handleOptions(req, res);
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);
    if (url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/workspaces") {
      await handleWorkspaces(req, res);
      return;
    }
    if (url.pathname.match(/^\/api\/workspaces\/[^/]+$/)) {
      await handleWorkspaceUpdate(url, req, res);
      return;
    }
    if (url.pathname.match(/^\/api\/workspaces\/[^/]+\/sync$/)) {
      await handleSync(url, req, res);
      return;
    }
    if (url.pathname.match(/^\/api\/workspaces\/[^/]+\/mirror\/listDir$/)) {
      await handleMirrorListDir(url, req, res);
      return;
    }
    if (url.pathname.match(/^\/api\/workspaces\/[^/]+\/mirror\/readFile$/)) {
      await handleMirrorReadFile(url, req, res);
      return;
    }
    if (url.pathname === "/api/chat") {
      await handleChat(req, res);
      return;
    }
    sendJson(res, 404, { message: "Not found" });
  } catch (error) {
    sendJson(res, 500, { message: (error as Error).message || String(error) });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`AgentOS API listening on http://${host}:${port}\n`);
});
