import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Workspace } from "./workspace-store.js";
import { walkFiles } from "./sync.js";
import { atomicReplaceFile } from "./tooling/fs/fs-utils.js";
import { toUnixRelative } from "./path-safe.js";

export type PageIndexStoreV2 = {
  version: 2;
  generatedAt: number;
  documents: Record<string, PageIndexDocumentV2>;
};

export type PageIndexDocumentV2 = {
  path: string;
  mtimeMs: number;
  bytes: number;
  contentHash: string;
  doc_name: string;
  doc_description?: string;
  structure: PageIndexTreeNodeV2[];
};

export type PageIndexTreeNodeV2 = {
  title: string;
  node_id: string;
  line_num: number;
  end_line_num: number;
  level: number;
  summary?: string;
  prefix_summary?: string;
  nodes?: PageIndexTreeNodeV2[];
};

export function getWorkspacePageIndexFile(workspace: Workspace) {
  const dir = path.join(workspace.mirror_path, ".mindweave");
  const filePath = path.join(dir, "page-index.v2.json");
  return { dir, filePath };
}

function getWorkspacePageIndexFileV1(workspace: Workspace) {
  const dir = path.join(workspace.mirror_path, ".mindweave");
  const filePath = path.join(dir, "page-index.v1.json");
  return { dir, filePath };
}

export async function loadWorkspacePageIndex(workspace: Workspace): Promise<PageIndexStoreV2 | null> {
  const { filePath } = getWorkspacePageIndexFile(workspace);
  const v2Path = fsSync.existsSync(filePath) ? filePath : null;
  const v1Path = !v2Path && fsSync.existsSync(getWorkspacePageIndexFileV1(workspace).filePath)
    ? getWorkspacePageIndexFileV1(workspace).filePath
    : null;
  if (!v2Path && !v1Path) return null;

  const text = await fs.readFile(v2Path ?? v1Path!, "utf-8");
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const store = parsed as any;
    if (store.version === 2 && store.documents && typeof store.documents === "object") {
      return store as PageIndexStoreV2;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function sha256(content: string) {
  return `sha256:${crypto.createHash("sha256").update(content, "utf-8").digest("hex")}`;
}

function isFenceLine(line: string) {
  const trimmed = line.trimStart();
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
}

function normalizeTitle(titleRaw: string) {
  return titleRaw.trim().replace(/\s+/g, " ");
}

function computeSummary(lines: string[], startLine: number, endLine: number, maxChars: number) {
  const picked: string[] = [];
  let inFence = false;
  for (let i = startLine - 1; i < Math.min(lines.length, endLine); i += 1) {
    const line = lines[i] ?? "";
    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) continue;
    picked.push(t);
    if (picked.join(" ").length >= maxChars) break;
  }
  const text = picked.join(" ").slice(0, maxChars).trim();
  return text || undefined;
}

function writeNodeIdPreorder(nodes: PageIndexTreeNodeV2[], start = 0) {
  let id = start;
  const walk = (list: PageIndexTreeNodeV2[]) => {
    for (const n of list) {
      n.node_id = String(id).padStart(4, "0");
      id += 1;
      if (n.nodes && n.nodes.length > 0) walk(n.nodes);
    }
  };
  walk(nodes);
  return id;
}

function buildMarkdownStructureLikePageIndex(params: { content: string }) {
  const lines = params.content.split(/\r?\n/);
  const headerPattern = /^(#{1,6})\s+(.+)$/;
  let inFence = false;

  const flat: Array<{ title: string; line_num: number; level: number; end_line_num: number }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (isFenceLine(line.trim())) {
      inFence = !inFence;
      continue;
    }
    const stripped = line.trim();
    if (!stripped) continue;
    if (inFence) continue;
    const m = stripped.match(headerPattern);
    if (!m) continue;
    const level = m[1].length;
    const title = normalizeTitle(m[2] ?? "");
    if (!title) continue;
    flat.push({ title, line_num: i + 1, level, end_line_num: lines.length });
  }

  if (flat.length === 0) {
    const totalLines = Math.max(1, lines.length);
    return [
      {
        title: "段落 1",
        node_id: "",
        line_num: 1,
        end_line_num: totalLines,
        level: 1,
        nodes: []
      }
    ] as PageIndexTreeNodeV2[];
  }

  for (let i = 0; i < flat.length; i += 1) {
    const cur = flat[i]!;
    const next = flat[i + 1];
    cur.end_line_num = next ? Math.max(cur.line_num, next.line_num - 1) : lines.length;
  }

  const root: PageIndexTreeNodeV2[] = [];
  const stack: Array<{ node: PageIndexTreeNodeV2; level: number }> = [];

  for (const h of flat) {
    const node: PageIndexTreeNodeV2 = {
      title: h.title,
      node_id: "",
      line_num: h.line_num,
      end_line_num: h.end_line_num,
      level: h.level,
      nodes: []
    };
    while (stack.length > 0 && stack[stack.length - 1]!.level >= h.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1]!.node.nodes!.push(node);
    }
    stack.push({ node, level: h.level });
  }

  writeNodeIdPreorder(root, 0);

  const attachSummaries = (list: PageIndexTreeNodeV2[]) => {
    for (const n of list) {
      const summary = computeSummary(lines, n.line_num + 1, n.end_line_num, 280);
      if (summary) {
        if (n.nodes && n.nodes.length > 0) n.prefix_summary = summary;
        else n.summary = summary;
      }
      if (n.nodes && n.nodes.length > 0) attachSummaries(n.nodes);
    }
  };
  attachSummaries(root);

  return root;
}

async function listMirrorMarkdownFiles(mirrorRoot: string) {
  const all = await walkFiles(mirrorRoot);
  return all.filter((fullPath) => {
    const rel = toUnixRelative(mirrorRoot, fullPath);
    if (!rel) return false;
    if (rel.startsWith(".mindweave/")) return false;
    return rel.toLowerCase().endsWith(".md");
  });
}

export async function buildWorkspacePageIndex(params: {
  workspace: Workspace;
  onlyPaths?: string[];
}): Promise<{ updated: number; total: number; filePath: string }> {
  const { workspace, onlyPaths } = params;
  const { dir, filePath } = getWorkspacePageIndexFile(workspace);
  await fs.mkdir(dir, { recursive: true });

  const prev = (await loadWorkspacePageIndex(workspace)) ?? { version: 2 as const, generatedAt: 0, documents: {} };

  const targetFullPaths = onlyPaths
    ? onlyPaths.map((p) => path.join(workspace.mirror_path, p.replace(/\\/g, "/")))
    : await listMirrorMarkdownFiles(workspace.mirror_path);

  const seenRelPaths = onlyPaths
    ? null
    : new Set(
        targetFullPaths
          .map((fullPath) => toUnixRelative(workspace.mirror_path, fullPath))
          .filter((rel) => rel && !rel.startsWith(".mindweave/") && rel.toLowerCase().endsWith(".md"))
      );

  let updated = 0;

  for (const fullPath of targetFullPaths) {
    const rel = toUnixRelative(workspace.mirror_path, fullPath);
    if (!rel) continue;
    if (rel.startsWith(".mindweave/")) continue;
    if (!rel.toLowerCase().endsWith(".md")) continue;

    let stat: { mtimeMs: number; size: number };
    try {
      const s = await fs.stat(fullPath);
      stat = { mtimeMs: s.mtimeMs, size: s.size };
    } catch (_error) {
      delete prev.documents[rel];
      updated += 1;
      continue;
    }

    const content = await fs.readFile(fullPath, "utf-8");
    const contentHash = sha256(content);
    const existed = prev.documents[rel];
    if (existed && existed.mtimeMs === stat.mtimeMs && existed.bytes === stat.size && existed.contentHash === contentHash) {
      continue;
    }

    const docName = path.basename(rel, path.extname(rel));
    const structure = buildMarkdownStructureLikePageIndex({ content });
    prev.documents[rel] = {
      path: rel,
      mtimeMs: stat.mtimeMs,
      bytes: stat.size,
      contentHash,
      doc_name: docName,
      structure
    };
    updated += 1;
  }

  if (seenRelPaths) {
    for (const rel of Object.keys(prev.documents)) {
      if (!seenRelPaths.has(rel)) {
        delete prev.documents[rel];
        updated += 1;
      }
    }
  }

  const store: PageIndexStoreV2 = {
    version: 2,
    generatedAt: Date.now(),
    documents: prev.documents
  };

  await atomicReplaceFile({
    filePath,
    content: JSON.stringify(store, null, 2),
    backup: true,
    backupKeep: 3
  });

  return { updated, total: Object.keys(store.documents).length, filePath };
}
