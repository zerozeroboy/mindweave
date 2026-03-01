import { getConfig } from "./env.js";
import { getFileExt, getPreviewMimeFromPath } from "./file-support.js";

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
  const ext = getFileExt(name);
  return config.visibleExts.includes(ext);
}

export function getImageMimeFromPath(filePath: string): string | null {
  return getPreviewMimeFromPath(filePath);
}
