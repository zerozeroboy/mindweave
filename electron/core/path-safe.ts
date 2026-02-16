import path from "node:path";

export function ensureInside(rootPath: string, relativePath: string): string {
  const normalized = String(relativePath || ".").replace(/\\/g, "/").replace(/^\/+/, "");
  const safeRoot = path.resolve(rootPath);
  const finalPath = path.resolve(safeRoot, normalized);
  const rel = path.relative(safeRoot, finalPath);
  const outside =
    rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  if (outside) {
    throw new Error("非法路径，超出工作空间范围");
  }
  return finalPath;
}

export function toUnixRelative(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).replace(/\\/g, "/");
}
