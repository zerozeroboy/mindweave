import fs from "node:fs/promises";
import path from "node:path";

export const DOC_TO_MARKDOWN_EXTS = new Set([".docx", ".pdf", ".pptx", ".xlsx"]);

export const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp"
]);

export const VIDEO_EXTS = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".avi"
]);

export const TEXT_EXTS = new Set([
  ".md",
  ".txt",
  ".mdx",
  ".csv",
  ".tsv",
  ".log",
  ".ini",
  ".cfg",
  ".conf",
  ".toml",
  ".xml",
  ".json",
  ".jsonc",
  ".jsonl",
  ".yaml",
  ".yml",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".sh",
  ".ps1",
  ".bat",
  ".cmd",
  ".sql",
  ".graphql",
  ".proto",
  ".dockerfile"
]);

export const DEFAULT_VISIBLE_EXTS = [...TEXT_EXTS, ...IMAGE_EXTS, ...VIDEO_EXTS];

export function getFileExt(filePathOrName: string): string {
  const name = path.basename(filePathOrName);
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return ".dockerfile";
  return path.extname(lower);
}

export function isImageExt(filePathOrName: string): boolean {
  return IMAGE_EXTS.has(getFileExt(filePathOrName));
}

export function isVideoExt(filePathOrName: string): boolean {
  return VIDEO_EXTS.has(getFileExt(filePathOrName));
}

export function isMediaExt(filePathOrName: string): boolean {
  const ext = getFileExt(filePathOrName);
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
}

export function getPreviewMimeFromPath(filePathOrName: string): string | null {
  const ext = getFileExt(filePathOrName);
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".avi") return "video/x-msvideo";
  return null;
}

function isLikelyUtf8Text(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  let zeroCount = 0;
  for (const b of buffer) {
    if (b === 0) zeroCount += 1;
  }
  if (zeroCount > 0) return false;

  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (!decoded) return true;
  const replacementCount = (decoded.match(/\uFFFD/g) ?? []).length;
  return replacementCount / decoded.length < 0.02;
}

export async function isTextFile(filePath: string): Promise<boolean> {
  const ext = getFileExt(filePath);
  if (TEXT_EXTS.has(ext)) return true;
  if (DOC_TO_MARKDOWN_EXTS.has(ext)) return false;
  if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) return false;

  const fh = await fs.open(filePath, "r");
  try {
    const stat = await fh.stat();
    const probeLen = Math.min(stat.size, 32 * 1024);
    if (probeLen <= 0) return true;
    const probe = Buffer.alloc(probeLen);
    const { bytesRead } = await fh.read(probe, 0, probeLen, 0);
    return isLikelyUtf8Text(probe.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}
