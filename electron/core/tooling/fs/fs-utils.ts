import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import type { SearchMatch } from "../types.js";

export interface GrepOptions {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWords?: boolean;
  contextLines?: number;
}

/**
 * 在文本内容中搜索匹配项，支持正则表达式和上下文行
 */
export function grepLike(content: string, options: GrepOptions): SearchMatch[] {
  const { query, regex = false, caseSensitive = false, wholeWords = false, contextLines = 0 } = options;
  
  if (!query) return [];
  
  const lines = content.split(/\r?\n/);
  const result: SearchMatch[] = [];
  const matchedLines = new Set<number>();
  
  // 构建匹配模式
  let pattern: RegExp;
  try {
    let patternStr: string;
    
    if (regex) {
      patternStr = query;
    } else {
      // 固定字符串模式：转义特殊字符
      patternStr = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    
    // 如果启用全词匹配，添加词边界
    if (wholeWords) {
      patternStr = `\\b${patternStr}\\b`;
    }
    
    // 行级匹配只需判断“是否命中”，不能使用全局 g，
    // 否则 RegExp.lastIndex 会在多行循环中造成漏匹配。
    const flags = caseSensitive ? "" : "i";
    pattern = new RegExp(patternStr, flags);
  } catch (err) {
    // 正则表达式无效，返回空结果
    return [];
  }
  
  // 查找所有匹配行
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      matchedLines.add(i);
    }
  }
  
  // 构建结果，包含上下文行
  for (const lineIndex of Array.from(matchedLines).sort((a, b) => a - b)) {
    const match: SearchMatch = {
      line: lineIndex + 1,
      text: lines[lineIndex]
    };
    
    if (contextLines > 0) {
      // 添加前文
      const beforeStart = Math.max(0, lineIndex - contextLines);
      match.beforeContext = lines.slice(beforeStart, lineIndex);
      
      // 添加后文
      const afterEnd = Math.min(lines.length, lineIndex + contextLines + 1);
      match.afterContext = lines.slice(lineIndex + 1, afterEnd);
    }
    
    result.push(match);
  }
  
  return result;
}

/**
 * 简单的 glob 模式匹配
 * 支持: *, ?, {a,b,c}
 */
export function matchGlob(filename: string, pattern: string): boolean {
  // 处理 {a,b,c} 形式的花括号展开
  if (pattern.includes("{") && pattern.includes("}")) {
    const braceStart = pattern.indexOf("{");
    const braceEnd = pattern.indexOf("}");
    const before = pattern.slice(0, braceStart);
    const after = pattern.slice(braceEnd + 1);
    const options = pattern.slice(braceStart + 1, braceEnd).split(",");
    
    return options.some(opt => matchGlob(filename, before + opt + after));
  }
  
  // 转换 glob 模式为正则表达式
  let regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  
  // 如果模式不包含路径分隔符，只匹配文件名
  if (!pattern.includes("/") && !pattern.includes("\\")) {
    regexPattern = "(?:^|[\\\\/])" + regexPattern + "$";
  } else {
    regexPattern = "^" + regexPattern + "$";
  }
  
  const regex = new RegExp(regexPattern, "i");
  return regex.test(filename);
}

async function cleanupBackups(targetPath: string, keep: number) {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const entries = await fs.readdir(dir).catch(() => []);
  const backups = entries
    .filter((name) => name.startsWith(`${base}.`) && name.endsWith(".bak"))
    .map((name) => ({ name, full: path.join(dir, name) }))
    .sort((a, b) => (a.name < b.name ? 1 : -1));

  for (let i = keep; i < backups.length; i += 1) {
    await fs.unlink(backups[i].full).catch(() => {});
  }
}

export async function atomicReplaceFile(params: {
  filePath: string;
  content: string;
  backup: boolean;
  backupKeep: number;
}): Promise<{ backupPath?: string }> {
  const { filePath, content, backup, backupKeep } = params;
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmpPath, content, "utf-8");

  const existed = fsSync.existsSync(filePath);
  let backupPath: string | undefined;

  if (existed) {
    const movedOldPath = `${filePath}.${Date.now()}.${backup ? "bak" : "old"}`;
    await fs.rename(filePath, movedOldPath);
    await fs.rename(tmpPath, filePath);
    if (backup) {
      backupPath = movedOldPath;
      await cleanupBackups(filePath, Math.max(0, Math.floor(backupKeep)));
    } else {
      await fs.unlink(movedOldPath).catch(() => {});
    }
  } else {
    await fs.rename(tmpPath, filePath);
  }

  return { backupPath };
}

export function createDiffPreview(params: { oldPath: string; newPath: string; oldContent: string; newContent: string }) {
  const patch = createTwoFilesPatch(params.oldPath, params.newPath, params.oldContent, params.newContent, "before", "after", {
    context: 2
  });
  return patch.split("\n").slice(0, 120).join("\n");
}
