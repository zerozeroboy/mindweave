import fs from "node:fs";
import fsp from "node:fs/promises";
import { ensureInside, toUnixRelative } from "../../path-safe.js";
import type { ToolDefinition } from "../types.js";
import { parseArgs } from "../types.js";
import { atomicReplaceFile, createDiffPreview } from "./fs-utils.js";

interface ReplacementResult {
  newContent: string;
  occurrences: number;
  strategy: "exact" | "flexible" | "regex" | "none";
}

/**
 * 安全的字面量替换（处理 $ 符号）
 */
function safeLiteralReplace(text: string, search: string, replace: string): string {
  return text.split(search).join(replace);
}

/**
 * 检测换行符类型
 */
function detectLineEnding(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * 规范化为 LF
 */
function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 恢复尾部换行符
 */
function restoreTrailingNewline(original: string, modified: string): string {
  const hadTrailingNewline = original.endsWith("\n");
  if (hadTrailingNewline && !modified.endsWith("\n")) {
    return modified + "\n";
  } else if (!hadTrailingNewline && modified.endsWith("\n")) {
    return modified.replace(/\n$/, "");
  }
  return modified;
}

/**
 * 第1层：精确匹配
 */
function calculateExactReplacement(
  content: string,
  oldString: string,
  newString: string
): ReplacementResult | null {
  const normalized = normalizeToLf(content);
  const searchNormalized = normalizeToLf(oldString);
  const replaceNormalized = normalizeToLf(newString);

  const occurrences = normalized.split(searchNormalized).length - 1;
  if (occurrences > 0) {
    let modified = safeLiteralReplace(normalized, searchNormalized, replaceNormalized);
    modified = restoreTrailingNewline(normalized, modified);
    return {
      newContent: modified,
      occurrences,
      strategy: "exact"
    };
  }
  return null;
}

/**
 * 第2层：灵活匹配（忽略空白，保留缩进）
 */
function calculateFlexibleReplacement(
  content: string,
  oldString: string,
  newString: string
): ReplacementResult | null {
  const normalized = normalizeToLf(content);
  const searchNormalized = normalizeToLf(oldString);
  const replaceNormalized = normalizeToLf(newString);

  const sourceLines = normalized.match(/.*(?:\n|$)/g)?.slice(0, -1) ?? [];
  const searchLinesStripped = searchNormalized.split("\n").map(line => line.trim());
  const replaceLines = replaceNormalized.split("\n");

  let occurrences = 0;
  let i = 0;
  
  while (i <= sourceLines.length - searchLinesStripped.length) {
    const window = sourceLines.slice(i, i + searchLinesStripped.length);
    const windowStripped = window.map(line => line.trim());
    
    const isMatch = windowStripped.every(
      (line, index) => line === searchLinesStripped[index]
    );

    if (isMatch) {
      occurrences++;
      // 检测缩进
      const firstLineInMatch = window[0];
      const indentMatch = firstLineInMatch.match(/^([ \t]*)/);
      const indent = indentMatch ? indentMatch[1] : "";
      
      // 应用缩进到新内容
      const newBlockWithIndent = replaceLines.map(line => `${indent}${line}`);
      sourceLines.splice(i, searchLinesStripped.length, newBlockWithIndent.join("\n"));
      i += replaceLines.length;
    } else {
      i++;
    }
  }

  if (occurrences > 0) {
    let modified = sourceLines.join("");
    modified = restoreTrailingNewline(normalized, modified);
    return {
      newContent: modified,
      occurrences,
      strategy: "flexible"
    };
  }
  return null;
}

/**
 * 第3层：正则匹配（最宽松）
 */
function calculateRegexReplacement(
  content: string,
  oldString: string,
  newString: string
): ReplacementResult | null {
  const searchNormalized = normalizeToLf(oldString);
  const replaceNormalized = normalizeToLf(newString);

  // 分隔符列表
  const delimiters = ["(", ")", ":", "[", "]", "{", "}", ">", "<", "="];
  
  let processed = searchNormalized;
  for (const delim of delimiters) {
    processed = processed.split(delim).join(` ${delim} `);
  }

  const tokens = processed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const escapedTokens = tokens.map(escapeRegex);
  const pattern = escapedTokens.join("\\s*");
  const finalPattern = `^([ \t]*)${pattern}`;
  const regex = new RegExp(finalPattern, "m");

  const match = regex.exec(content);
  if (!match) return null;

  const indent = match[1] || "";
  const newLines = replaceNormalized.split("\n");
  const newBlockWithIndent = newLines.map(line => `${indent}${line}`).join("\n");

  const modified = content.replace(regex, newBlockWithIndent);
  
  return {
    newContent: restoreTrailingNewline(content, modified),
    occurrences: 1,
    strategy: "regex"
  };
}

/**
 * 三层智能匹配
 */
function calculateReplacement(
  content: string,
  oldString: string,
  newString: string
): ReplacementResult {
  if (oldString === "") {
    return { newContent: content, occurrences: 0, strategy: "none" };
  }

  // 第1层：精确匹配
  const exactResult = calculateExactReplacement(content, oldString, newString);
  if (exactResult) return exactResult;

  // 第2层：灵活匹配
  const flexibleResult = calculateFlexibleReplacement(content, oldString, newString);
  if (flexibleResult) return flexibleResult;

  // 第3层：正则匹配
  const regexResult = calculateRegexReplacement(content, oldString, newString);
  if (regexResult) return regexResult;

  // 所有匹配失败
  return { newContent: content, occurrences: 0, strategy: "none" };
}

/**
 * 诊断失败原因
 */
function diagnoseMatchFailure(content: string, oldString: string): string {
  const normalized = normalizeToLf(content);
  const searchNormalized = normalizeToLf(oldString);

  const parts: string[] = [];
  parts.push("期望找到的内容：");
  parts.push(`"${searchNormalized.slice(0, 100)}${searchNormalized.length > 100 ? "..." : ""}"`);
  parts.push("");

  // 检查是否存在（精确）
  if (normalized.includes(searchNormalized)) {
    const idx = normalized.indexOf(searchNormalized);
    const before = normalized.slice(Math.max(0, idx - 50), idx);
    const after = normalized.slice(idx + searchNormalized.length, Math.min(normalized.length, idx + searchNormalized.length + 50));
    parts.push("→ ✓ 找到（精确匹配）");
    parts.push(`  位置: 第 ${normalized.slice(0, idx).split("\n").length} 行附近`);
    parts.push(`  周边: ...${before}【搜索内容】${after}...`);
  } else {
    parts.push("→ ✗ 未找到（精确匹配）");
    
    // 尝试模糊匹配
    const searchTrimmed = searchNormalized.trim().replace(/\s+/g, " ");
    const contentTrimmed = normalized.replace(/\s+/g, " ");
    if (contentTrimmed.includes(searchTrimmed)) {
      parts.push("  但找到相似内容（忽略空白差异）");
    } else {
      // 尝试找前面几个字符
      const searchHead = searchNormalized.slice(0, Math.min(20, searchNormalized.length));
      if (normalized.includes(searchHead)) {
        const idx = normalized.indexOf(searchHead);
        parts.push(`  找到部分匹配（前${searchHead.length}字符）`);
        parts.push(`  实际内容: "${normalized.slice(idx, idx + searchNormalized.length + 20)}"`);
      } else {
        parts.push("  完全找不到匹配内容");
      }
    }
  }

  return parts.join("\n");
}

export const patchFileTool: ToolDefinition = {
  schema: {
    type: "function",
    name: "patch_file",
    description:
      "对文件进行精确的搜索替换操作（自动备份，智能容错）。通过 old_string/new_string 指定要替换的内容",
    parameters: {
      type: "object",
      properties: {
        path: { 
          type: "string",
          description: "文件路径（相对于文档库根目录）"
        },
        old_string: {
          type: "string",
          description: "要替换的原始内容（必须与文件中的内容完全一致，包括空格和换行）。空字符串表示创建新文件"
        },
        new_string: {
          type: "string",
          description: "替换后的新内容"
        },
        expected_replacements: {
          type: "number",
          description: "期望替换的次数（默认 1）。用于验证替换是否符合预期"
        },
        backup: { 
          type: "boolean", 
          description: "是否保留备份（默认 true）" 
        },
        backup_keep: { 
          type: "number", 
          description: "最多保留多少份备份（默认 3）" 
        }
      },
      required: ["path", "old_string", "new_string"]
    }
  },
  async run(workspace, argsRaw) {
    const root = workspace.mirror_path;
    const args = parseArgs(argsRaw);
    const relativePath = String(args.path ?? "");
    const filePath = ensureInside(root, relativePath);
    const oldString = String(args.old_string ?? "");
    const newString = String(args.new_string ?? "");
    const expectedReplacements = Number.isFinite(Number(args.expected_replacements)) 
      ? Number(args.expected_replacements) 
      : 1;

    const backup = args.backup === false ? false : true;
    const backupKeep = Number.isFinite(Number(args.backup_keep)) ? Number(args.backup_keep) : 3;

    // 处理创建新文件的情况
    if (oldString === "") {
      const existed = fs.existsSync(filePath);
      if (existed) {
        throw new Error("文件已存在，无法创建。如需修改请提供 old_string");
      }
      
      const { backupPath } = await atomicReplaceFile({
        filePath,
        content: newString,
        backup,
        backupKeep
      });
      
      return {
        ok: true,
        action: "created",
        path: relativePath,
        backup: backupPath ? toUnixRelative(root, backupPath) : undefined,
        diff: createDiffPreview({ oldPath: relativePath, newPath: relativePath, oldContent: "", newContent: newString })
      };
    }

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error("文件不存在。如需创建新文件，请将 old_string 设为空字符串");
    }

    // 读取文件
    const originalContent = await fsp.readFile(filePath, "utf-8");
    const lineEnding = detectLineEnding(originalContent);

    // 执行智能替换
    const result = calculateReplacement(originalContent, oldString, newString);

    // 验证结果
    if (result.occurrences === 0) {
      const diagnostic = diagnoseMatchFailure(originalContent, oldString);
      throw new Error(
        [
          "替换失败：未找到要替换的内容",
          "",
          "📋 诊断信息：",
          diagnostic,
          "",
          "💡 建议：",
          "1. 使用 read_file 重新读取文件，确保 old_string 与文件内容完全一致",
          "2. 注意空格、缩进、换行符必须完全匹配",
          "3. 从 read_file 的结果中直接复制要替换的内容",
          "4. 如果是简单的单行替换，可以包含更多上下文以提高匹配准确性"
        ].join("\n")
      );
    }

    if (result.occurrences !== expectedReplacements) {
      throw new Error(
        `替换次数不符合预期：期望 ${expectedReplacements} 次，实际 ${result.occurrences} 次。` +
        `请检查 old_string 是否正确，或调整 expected_replacements 参数`
      );
    }

    if (oldString === newString) {
      throw new Error("old_string 和 new_string 相同，无需替换");
    }

    // 恢复原始换行符
    let finalContent = result.newContent;
    if (lineEnding === "\r\n") {
      finalContent = finalContent.replace(/\n/g, "\r\n");
    }

    // 写入文件
    const { backupPath } = await atomicReplaceFile({
      filePath,
      content: finalContent,
      backup,
      backupKeep
    });

    return {
      ok: true,
      action: "updated",
      path: relativePath,
      occurrences: result.occurrences,
      strategy: result.strategy,
      backup: backupPath ? toUnixRelative(root, backupPath) : undefined,
      diff: createDiffPreview({ oldPath: relativePath, newPath: relativePath, oldContent: originalContent, newContent: finalContent })
    };
  }
};
