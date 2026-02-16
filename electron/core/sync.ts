import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { Workspace } from "./workspace-store.js";
import { buildWorkspacePageIndex } from "./page-index.js";

function ensureDirSync(target: string) {
  if (!fsSync.existsSync(target)) {
    fsSync.mkdirSync(target, { recursive: true });
  }
}

export async function walkFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function getMirrorPath(sourceFile: string, sourceRoot: string, mirrorRoot: string) {
  const relative = path.relative(sourceRoot, sourceFile);
  const ext = path.extname(relative).toLowerCase();
  const relativeNoExt = relative.slice(0, relative.length - ext.length);
  return {
    ext,
    relativeSourcePath: relative.replace(/\\/g, "/"),
    mirrorPath: path.join(mirrorRoot, `${relativeNoExt}.md`)
  };
}

async function convertSourceFile(filePath: string, ext: string, relativeSourcePath: string) {
  if (ext === ".md" || ext === ".txt") {
    return fs.readFile(filePath, "utf-8");
  }
  if ([".docx", ".pdf", ".pptx", ".xlsx"].includes(ext)) {
    return [
      `# ${path.basename(filePath)}`,
      "",
      `原始文件: ${relativeSourcePath}`,
      "",
      "> 当前版本未接入该格式转换器，已创建镜像占位文件。"
    ].join("\n");
  }
  return null;
}

export async function syncWorkspaceFiles(workspace: Workspace) {
  ensureDirSync(workspace.mirror_path);
  const sourceFiles = await walkFiles(workspace.source_path);
  let filesConverted = 0;

  for (const sourceFile of sourceFiles) {
    const { ext, relativeSourcePath, mirrorPath } = getMirrorPath(
      sourceFile,
      workspace.source_path,
      workspace.mirror_path
    );
    const content = await convertSourceFile(sourceFile, ext, relativeSourcePath);
    if (content === null) {
      continue;
    }

    ensureDirSync(path.dirname(mirrorPath));
    await fs.writeFile(mirrorPath, content, "utf-8");
    filesConverted += 1;
  }

  let indexUpdated = 0;
  let indexTotal = 0;
  try {
    const r = await buildWorkspacePageIndex({ workspace });
    indexUpdated = r.updated;
    indexTotal = r.total;
  } catch (_error) {
    indexUpdated = -1;
    indexTotal = -1;
  }

  return {
    success: true,
    files_converted: filesConverted,
    page_index: { updated: indexUpdated, total: indexTotal },
    message: `同步完成: ${filesConverted} 个文件`
  };
}
