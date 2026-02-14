import path from "node:path";

export function ensureInside(rootPath: string, relativePath: string): string {
  const normalized = String(relativePath || ".").replace(/\\/g, "/").replace(/^\/+/, "");
  const finalPath = path.resolve(rootPath, normalized);
  const safeRoot = path.resolve(rootPath);
  if (!finalPath.startsWith(safeRoot)) {
    throw new Error("非法路径，超出工作空间范围");
  }
  return finalPath;
}

export function toUnixRelative(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).replace(/\\/g, "/");
}
