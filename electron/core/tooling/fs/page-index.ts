import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "../types.js";
import { parseArgs } from "../types.js";
import { ensureInside, toUnixRelative } from "../../path-safe.js";
import {
  buildWorkspacePageIndex,
  getWorkspacePageIndexFile,
  loadWorkspacePageIndex,
  type PageIndexStoreV2,
  type PageIndexTreeNodeV2
} from "../../page-index.js";
import { matchGlob } from "./fs-utils.js";

function requireDoc(store: PageIndexStoreV2, docPath: string) {
  const doc = store.documents[docPath];
  if (!doc) {
    throw new Error("索引中不存在该文档，请先同步或重建索引");
  }
  return doc;
}

type FlatNode = {
  node_id: string;
  title: string;
  level: number;
  line_num: number;
  end_line_num: number;
  breadcrumb: string;
  summary?: string;
  prefix_summary?: string;
  hasChildren: boolean;
};

function flattenStructure(params: { docName: string; structure: PageIndexTreeNodeV2[] }) {
  const { docName, structure } = params;
  const list: FlatNode[] = [];
  const byId = new Map<string, FlatNode>();

  const walk = (nodes: PageIndexTreeNodeV2[], breadcrumbPrefix: string) => {
    for (const n of nodes) {
      const breadcrumb = `${breadcrumbPrefix} / ${n.title}`;
      const flat: FlatNode = {
        node_id: n.node_id,
        title: n.title,
        level: n.level,
        line_num: n.line_num,
        end_line_num: n.end_line_num,
        breadcrumb,
        summary: n.summary,
        prefix_summary: n.prefix_summary,
        hasChildren: Array.isArray(n.nodes) && n.nodes.length > 0
      };
      list.push(flat);
      byId.set(flat.node_id, flat);
      if (n.nodes && n.nodes.length > 0) walk(n.nodes, breadcrumb);
    }
  };

  walk(structure, docName);
  return { list, byId };
}

function limitTree(params: {
  docName: string;
  structure: PageIndexTreeNodeV2[];
  maxDepth: number;
  maxNodes: number;
  includeSummaries: boolean;
}) {
  const { docName, structure, maxDepth, maxNodes, includeSummaries } = params;
  let used = 0;
  let truncated = false;

  const walk = (nodes: PageIndexTreeNodeV2[], depth: number): any[] => {
    if (used >= maxNodes) {
      truncated = true;
      return [];
    }
    const out: any[] = [];
    for (const n of nodes) {
      if (used >= maxNodes) {
        truncated = true;
        break;
      }
      used += 1;
      const item: any = {
        title: n.title,
        node_id: n.node_id,
        line_num: n.line_num,
        end_line_num: n.end_line_num,
        level: n.level
      };
      if (includeSummaries) {
        if (n.summary) item.summary = n.summary;
        if (n.prefix_summary) item.prefix_summary = n.prefix_summary;
      }
      if (depth >= maxDepth) {
        if (n.nodes && n.nodes.length > 0) truncated = true;
        item.nodes = [];
      } else {
        item.nodes = n.nodes ? walk(n.nodes, depth + 1) : [];
        if (n.nodes && item.nodes.length < n.nodes.length) truncated = true;
      }
      out.push(item);
    }
    return out;
  };

  const limited = walk(structure, 1);
  return {
    root: { doc_name: docName, structure: limited },
    used,
    truncated
  };
}

function compileMatcher(params: { query: string; regex: boolean; caseSensitive: boolean }) {
  const { query, regex, caseSensitive } = params;
  if (!query) return null;
  if (regex) {
    try {
      return new RegExp(query, caseSensitive ? "" : "i");
    } catch (_error) {
      return null;
    }
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  return {
    test: (text: string) => {
      const hay = caseSensitive ? text : text.toLowerCase();
      return hay.includes(needle);
    }
  };
}

export const pageIndexListDocsTool: ToolDefinition = {
  schema: {
    type: "function",
    name: "page_index_list_docs",
    description: "列出当前工作空间中已建立 pageIndex 的文档",
    parameters: {
      type: "object",
      properties: {
        glob: { type: "string", description: "按路径过滤（glob）" },
        limit: { type: "number", description: "最多返回多少条（默认 200）" },
        offset: { type: "number", description: "从第几条开始返回（默认 0）" }
      }
    }
  },
  async run(workspace, argsRaw) {
    const args = parseArgs(argsRaw);
    const store = (await loadWorkspacePageIndex(workspace)) ?? (await (async () => {
      await buildWorkspacePageIndex({ workspace });
      const loaded = await loadWorkspacePageIndex(workspace);
      if (!loaded) throw new Error("索引加载失败");
      return loaded;
    })());

    const glob = typeof args.glob === "string" && args.glob.trim() ? String(args.glob) : null;
    const limitRaw = Number(args.limit ?? 200);
    const offsetRaw = Number(args.offset ?? 0);
    const limit = Math.max(1, Math.min(2000, Number.isFinite(limitRaw) ? limitRaw : 200));
    const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);

    const all = Object.values(store.documents)
      .filter((d) => (glob ? matchGlob(d.path, glob) : true))
      .sort((a, b) => a.path.localeCompare(b.path));

    const total = all.length;
    const page = all.slice(offset, offset + limit).map((d) => ({
      path: d.path,
      doc_name: d.doc_name,
      bytes: d.bytes,
      mtimeMs: d.mtimeMs,
      nodeCount: flattenStructure({ docName: d.doc_name, structure: d.structure }).list.length
    }));

    return { total, offset, limit, truncated: offset + limit < total, documents: page };
  }
};

export const pageIndexGetTreeTool: ToolDefinition = {
  schema: {
    type: "function",
    name: "page_index_get_tree",
    description: "获取某个文档的 PageIndex 树结构（按标题层级）",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "镜像文档相对路径（.md）" },
        maxDepth: { type: "number", description: "最大返回深度（默认 4）" },
        maxNodes: { type: "number", description: "最大返回节点数（默认 400）" },
        includeSummaries: { type: "boolean", description: "是否返回节点摘要（默认 true）" }
      },
      required: ["path"]
    }
  },
  async run(workspace, argsRaw) {
    const args = parseArgs(argsRaw);
    const docPath = String(args.path ?? "").replace(/\\/g, "/");
    if (!docPath) throw new Error("path 不能为空");

    let store = await loadWorkspacePageIndex(workspace);
    if (!store || !store.documents[docPath]) {
      await buildWorkspacePageIndex({ workspace, onlyPaths: [docPath] });
      store = await loadWorkspacePageIndex(workspace);
    }
    if (!store) throw new Error("索引加载失败");

    const doc = requireDoc(store, docPath);
    const maxDepthRaw = Number(args.maxDepth ?? 4);
    const maxNodesRaw = Number(args.maxNodes ?? 400);
    const maxDepth = Math.max(1, Math.min(20, Number.isFinite(maxDepthRaw) ? maxDepthRaw : 4));
    const maxNodes = Math.max(10, Math.min(5000, Number.isFinite(maxNodesRaw) ? maxNodesRaw : 400));
    const includeSummaries = args.includeSummaries === false ? false : true;

    const tree = limitTree({
      docName: doc.doc_name,
      structure: doc.structure,
      maxDepth,
      maxNodes,
      includeSummaries
    });

    return {
      path: doc.path,
      doc_name: doc.doc_name,
      nodeCount: flattenStructure({ docName: doc.doc_name, structure: doc.structure }).list.length,
      returnedNodes: tree.used,
      truncated: tree.truncated,
      tree: tree.root
    };
  }
};

export const pageIndexSearchNodesTool: ToolDefinition = {
  schema: {
    type: "function",
    name: "page_index_search_nodes",
    description: "在 PageIndex 节点（标题/面包屑/摘要）中搜索，返回候选 node_id",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词或正则" },
        regex: { type: "boolean", description: "是否按正则（默认 false）" },
        caseSensitive: { type: "boolean", description: "是否区分大小写（默认 false）" },
        glob: { type: "string", description: "限定文档路径（glob）" },
        limit: { type: "number", description: "最多返回多少条（默认 50）" }
      },
      required: ["query"]
    }
  },
  async run(workspace, argsRaw) {
    const args = parseArgs(argsRaw);
    const query = String(args.query ?? "");
    const regex = Boolean(args.regex ?? false);
    const caseSensitive = Boolean(args.caseSensitive ?? false);
    const matcher = compileMatcher({ query, regex, caseSensitive });
    if (!matcher) throw new Error("query 无效");

    const store = (await loadWorkspacePageIndex(workspace)) ?? (await (async () => {
      await buildWorkspacePageIndex({ workspace });
      const loaded = await loadWorkspacePageIndex(workspace);
      if (!loaded) throw new Error("索引加载失败");
      return loaded;
    })());

    const glob = typeof args.glob === "string" && args.glob.trim() ? String(args.glob) : null;
    const limitRaw = Number(args.limit ?? 50);
    const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 50));

    const results: Array<{
      score: number;
      path: string;
      node_id: string;
      title: string;
      breadcrumb: string;
      line_num: number;
      end_line_num: number;
      summary?: string;
    }> = [];

    for (const doc of Object.values(store.documents)) {
      if (glob && !matchGlob(doc.path, glob)) continue;
      const flat = flattenStructure({ docName: doc.doc_name, structure: doc.structure });
      for (const node of flat.list) {
        const titleHit = matcher.test(node.title);
        const breadHit = matcher.test(node.breadcrumb);
        const sumText = node.summary ?? node.prefix_summary;
        const sumHit = sumText ? matcher.test(sumText) : false;
        if (!titleHit && !breadHit && !sumHit) continue;
        const score = (titleHit ? 10 : 0) + (breadHit ? 5 : 0) + (sumHit ? 2 : 0);
        results.push({
          score,
          path: doc.path,
          node_id: node.node_id,
          title: node.title,
          breadcrumb: node.breadcrumb,
          line_num: node.line_num,
          end_line_num: node.end_line_num,
          summary: sumText
        });
      }
    }

    results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line_num - b.line_num);
    const page = results.slice(0, limit);

    return { total: results.length, limit, results: page };
  }
};

export const pageIndexListLeafNodesTool: ToolDefinition = {
  schema: {
    type: "function",
    name: "page_index_list_leaf_nodes",
    description: "列出某个文档的叶子节点（可直接用于 read_nodes 的 node_id）",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "镜像文档相对路径（.md）" },
        limit: { type: "number", description: "最多返回多少条（默认 50）" },
        offset: { type: "number", description: "从第几条开始返回（默认 0）" }
      },
      required: ["path"]
    }
  },
  async run(workspace, argsRaw) {
    const args = parseArgs(argsRaw);
    const docPath = String(args.path ?? "").replace(/\\/g, "/");
    if (!docPath) throw new Error("path 不能为空");

    let store = await loadWorkspacePageIndex(workspace);
    if (!store || !store.documents[docPath]) {
      await buildWorkspacePageIndex({ workspace, onlyPaths: [docPath] });
      store = await loadWorkspacePageIndex(workspace);
    }
    if (!store) throw new Error("索引加载失败");
    const doc = requireDoc(store, docPath);
    const flat = flattenStructure({ docName: doc.doc_name, structure: doc.structure });

    const limitRaw = Number(args.limit ?? 50);
    const offsetRaw = Number(args.offset ?? 0);
    const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 50));
    const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);

    const leaf = flat.list
      .filter((n) => !n.hasChildren)
      .sort((a, b) => a.line_num - b.line_num);

    const total = leaf.length;
    const page = leaf.slice(offset, offset + limit).map((n) => ({
      node_id: n.node_id,
      title: n.title,
      breadcrumb: n.breadcrumb,
      line_num: n.line_num,
      end_line_num: n.end_line_num,
      summary: n.summary ?? n.prefix_summary
    }));

    return { path: doc.path, doc_name: doc.doc_name, total, offset, limit, truncated: offset + limit < total, nodes: page };
  }
};

export const pageIndexReadNodesTool: ToolDefinition = {
  schema: {
    type: "function",
    name: "page_index_read_nodes",
    description: "读取 PageIndex 节点对应的正文（按行号范围截取）。nodeIds 需来自 get_tree/search 的 node_id。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "镜像文档相对路径（.md）" },
        nodeIds: { type: "array", items: { type: "string" }, description: "node_id 列表（不能为空）" },
        maxChars: { type: "number", description: "每个节点最大返回字符数（默认 12000）" }
      },
      required: ["path", "nodeIds"]
    }
  },
  async run(workspace, argsRaw) {
    const args = parseArgs(argsRaw);
    const docPath = String(args.path ?? "").replace(/\\/g, "/");
    const nodeIds = Array.isArray(args.nodeIds) ? (args.nodeIds as unknown[]).map((x) => String(x)) : [];
    const ids = nodeIds.map((x) => String(x)).filter(Boolean);
    if (!docPath) throw new Error("path 不能为空");
    if (ids.length === 0) {
      throw new Error("nodeIds 不能为空：请先用 page_index_get_tree 或 page_index_search_nodes 获取 node_id");
    }

    let store = await loadWorkspacePageIndex(workspace);
    if (!store || !store.documents[docPath]) {
      await buildWorkspacePageIndex({ workspace, onlyPaths: [docPath] });
      store = await loadWorkspacePageIndex(workspace);
    }
    if (!store) throw new Error("索引加载失败");
    const doc = requireDoc(store, docPath);
    const flat = flattenStructure({ docName: doc.doc_name, structure: doc.structure });

    const maxCharsRaw = Number(args.maxChars ?? 12000);
    const maxChars = Math.max(1000, Math.min(80_000, Number.isFinite(maxCharsRaw) ? maxCharsRaw : 12000));

    const root = workspace.mirror_path;
    const filePath = ensureInside(root, docPath);
    if (!fsSync.existsSync(filePath)) throw new Error("镜像文件不存在");

    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split(/\r?\n/);

    const nodesOut = ids.map((id) => {
      const node = flat.byId.get(id);
      if (!node) {
        return { node_id: id, error: "节点不存在" as const };
      }
      const start = Math.max(1, Math.min(lines.length, node.line_num));
      const end = Math.max(start, Math.min(lines.length, node.end_line_num));
      const slice = lines.slice(start - 1, end).join("\n");
      const text = slice.length > maxChars ? slice.slice(0, maxChars) : slice;
      return {
        node_id: node.node_id,
        title: node.title,
        breadcrumb: node.breadcrumb,
        startLine: start,
        endLine: end,
        truncated: slice.length > text.length,
        text
      };
    });

    return {
      path: toUnixRelative(root, filePath),
      indexFile: toUnixRelative(root, getWorkspacePageIndexFile(workspace).filePath),
      nodes: nodesOut
    };
  }
};
