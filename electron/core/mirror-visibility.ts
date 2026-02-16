import path from "node:path";
import { getConfig } from "./env.js";

export type MirrorVisibilityConfig = {
  visibleExts: string[] | "*";
  showBackups: boolean;
};

export function getMirrorVisibilityConfig(): MirrorVisibilityConfig {
  const cfg = getConfig() as any;
  const visibleExts = (cfg?.mirrorVisibleExts ?? [".md"]) as string[] | "*";
  const showBackups = Boolean(cfg?.mirrorShowBackups ?? false);
  return { visibleExts, showBackups };
}

export function isBackupLikeFilename(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith(".bak")) return true;
  if (lower.endsWith(".old")) return true;
  if (lower.includes(".tmp.")) return true;
  return false;
}

export function shouldIncludeMirrorFile(name: string, config: MirrorVisibilityConfig): boolean {
  if (!config.showBackups && isBackupLikeFilename(name)) return false;
  if (config.visibleExts === "*") return true;
  const ext = path.extname(name).toLowerCase();
  return config.visibleExts.includes(ext);
}

export function getImageMimeFromPath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".bmp") return "image/bmp";
  return null;
}
