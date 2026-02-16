import fs from "node:fs/promises";
import path from "node:path";
import { toUnixRelative } from "../../path-safe.js";
import { getMirrorVisibilityConfig, shouldIncludeMirrorFile, type MirrorVisibilityConfig } from "../../mirror-visibility.js";
import type { ToolDefinition, SearchHit, ToolResult } from "../types.js";
import { parseArgs } from "../types.js";
import { grepLike, matchGlob } from "./fs-utils.js";

const SEARCHABLE_TEXT_EXTS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yml",
  ".yaml",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".html"
]);

function isSearchableTextFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return SEARCHABLE_TEXT_EXTS.has(ext);
}

async function walkSearchableFiles(root: string, vis: MirrorVisibilityConfig): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  const dirs: string[] = [];

  for (const entry of entries) {
    if (entry.name === ".mindweave") continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isFile()) {
      if (!shouldIncludeMirrorFile(entry.name, vis)) continue;
      if (!isSearchableTextFile(entry.name)) continue;
      files.push(fullPath);
    } else if (entry.isDirectory()) {
      dirs.push(fullPath);
    }
  }

  const out = [...files];
  for (const dir of dirs) {
    out.push(...(await walkSearchableFiles(dir, vis)));
  }
  return out;
}

export const searchFilesTool: ToolDefinition = {
  schema: {
    type: "function",
    name: "search_files",
    description: "搜索镜像文件内容。支持3种模式：1) content-返回匹配内容和上下文(默认) 2) files_only-只返回文件路径列表 3) count-返回匹配统计。支持正则表达式(需设置regex=true)、多关键词OR匹配(用|分隔且regex=true)、全词匹配、glob过滤、排除模式等。建议先用files_only快速定位，再用content获取详情",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词或正则表达式。如需匹配多个关键词，使用 | 分隔并设置 regex=true，如 '联系方式|邮箱|email'"
        },
        regex: {
          type: "boolean",
          description: "是否启用正则表达式模式，默认 false。重要：当 query 包含 | 符号表示多个关键词OR匹配时，必须设置为 true"
        },
        case_sensitive: {
          type: "boolean",
          description: "是否大小写敏感，默认 false（不敏感）"
        },
        whole_words: {
          type: "boolean",
          description: "是否只匹配完整单词，默认 false。仅对英文关键词有效，如启用后 'email' 不会匹配 'emails' 或 'myemail'"
        },
        glob: {
          type: "string",
          description: "文件过滤模式，如 '*.ts' 或 '*.{ts,js}'"
        },
        exclude: {
          type: "array",
          items: { type: "string" },
          description: "排除的文件模式数组，如 ['backup/**', '*.bak', 'temp/**']。用于跳过备份文件、临时文件等"
        },
        context: {
          type: "number",
          description: "显示匹配行的上下文行数，默认 0"
        },
        mode: {
          type: "string",
          enum: ["content", "files_only", "count"],
          description: "输出模式：content=返回匹配内容和上下文(默认,用于获取详细信息), files_only=只返回包含匹配的文件路径列表(用于快速定位文件), count=返回匹配次数统计(用于了解分布情况)"
        },
        limit: {
          type: "number",
          description: "返回最多多少个文件的结果，默认 20"
        }
      },
      required: ["query"]
    }
  },
  async run(workspace, argsRaw) {
    const root = workspace.mirror_path;
    const args = parseArgs(argsRaw);
    const query = String(args.query ?? "");
    const regex = Boolean(args.regex ?? false);
    const caseSensitive = Boolean(args.case_sensitive ?? false);
    const wholeWords = Boolean(args.whole_words ?? false);
    const globPattern = args.glob ? String(args.glob) : undefined;
    const excludePatterns = Array.isArray(args.exclude) 
      ? args.exclude.map(p => String(p)) 
      : [];
    const contextLines = args.context ? Number(args.context) : 0;
    const mode = args.mode ? String(args.mode) : "content";
    const limit = Number(args.limit ?? 20);

    const result = await searchFiles({
      root,
      query,
      regex,
      caseSensitive,
      wholeWords,
      globPattern,
      excludePatterns,
      contextLines,
      mode: mode as "content" | "files_only" | "count",
      limit
    });

    return result;
  }
};

interface SearchOptions {
  root: string;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWords: boolean;
  globPattern?: string;
  excludePatterns: string[];
  contextLines: number;
  mode: "content" | "files_only" | "count";
  limit: number;
}

/**
 * 纯 TypeScript 实现的文件内容搜索
 */
async function searchFiles(options: SearchOptions): Promise<ToolResult> {
  const { root, query, regex, caseSensitive, wholeWords, globPattern, excludePatterns, contextLines, mode, limit } = options;
  
  const vis = getMirrorVisibilityConfig();
  const allFiles = await walkSearchableFiles(root, vis);
  
  // 过滤文件
  let targetFiles = allFiles;
  
  // 应用 glob 过滤
  if (globPattern) {
    targetFiles = targetFiles.filter(file => {
      const relativePath = toUnixRelative(root, file);
      return matchGlob(relativePath, globPattern);
    });
  }
  
  // 应用排除模式
  if (excludePatterns.length > 0) {
    targetFiles = targetFiles.filter(file => {
      const relativePath = toUnixRelative(root, file);
      return !excludePatterns.some(pattern => matchGlob(relativePath, pattern));
    });
  }

  // 根据模式执行不同的搜索
  if (mode === "count") {
    return await searchCount(targetFiles, root, query, regex, caseSensitive, wholeWords);
  } else if (mode === "files_only") {
    return await searchFilesOnly(targetFiles, root, query, regex, caseSensitive, wholeWords, limit);
  } else {
    return await searchContent(targetFiles, root, query, regex, caseSensitive, wholeWords, contextLines, limit);
  }
}

/**
 * 返回匹配内容
 */
async function searchContent(
  files: string[],
  root: string,
  query: string,
  regex: boolean,
  caseSensitive: boolean,
  wholeWords: boolean,
  contextLines: number,
  limit: number
): Promise<ToolResult> {
  const hits: SearchHit[] = [];
  
  for (const file of files) {
    if (hits.length >= limit) break;
    
    try {
      const stat = await fs.stat(file);
      if (stat.size > 5 * 1024 * 1024) continue;
      
      const content = await fs.readFile(file, "utf-8");
      const matches = grepLike(content, {
        query,
        regex,
        caseSensitive,
        wholeWords,
        contextLines
      });
      
      if (matches.length > 0) {
        hits.push({
          path: toUnixRelative(root, file),
          matches: matches.slice(0, 10)
        });
      }
    } catch (err) {
      continue;
    }
  }
  
  return { query, hits };
}

/**
 * 只返回包含匹配的文件路径
 */
async function searchFilesOnly(
  files: string[],
  root: string,
  query: string,
  regex: boolean,
  caseSensitive: boolean,
  wholeWords: boolean,
  limit: number
): Promise<ToolResult> {
  const matchedFiles: string[] = [];
  
  for (const file of files) {
    if (matchedFiles.length >= limit) break;
    
    try {
      const stat = await fs.stat(file);
      if (stat.size > 5 * 1024 * 1024) continue;
      
      const content = await fs.readFile(file, "utf-8");
      const matches = grepLike(content, {
        query,
        regex,
        caseSensitive,
        wholeWords,
        contextLines: 0
      });
      
      if (matches.length > 0) {
        matchedFiles.push(toUnixRelative(root, file));
      }
    } catch (err) {
      continue;
    }
  }
  
  return { query, files: matchedFiles };
}

/**
 * 返回匹配计数
 */
async function searchCount(
  files: string[],
  root: string,
  query: string,
  regex: boolean,
  caseSensitive: boolean,
  wholeWords: boolean
): Promise<ToolResult> {
  let totalMatches = 0;
  const fileMatches: Record<string, number> = {};
  
  for (const file of files) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > 5 * 1024 * 1024) continue;
      
      const content = await fs.readFile(file, "utf-8");
      const matches = grepLike(content, {
        query,
        regex,
        caseSensitive,
        wholeWords,
        contextLines: 0
      });
      
      if (matches.length > 0) {
        const relativePath = toUnixRelative(root, file);
        fileMatches[relativePath] = matches.length;
        totalMatches += matches.length;
      }
    } catch (err) {
      continue;
    }
  }
  
  return { 
    query, 
    content: JSON.stringify({
      total_matches: totalMatches,
      file_count: Object.keys(fileMatches).length,
      by_file: fileMatches
    }, null, 2)
  };
}
