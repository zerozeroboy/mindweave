import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");

function readEnvFile(): Record<string, string> {
  const envPath = path.join(ROOT_DIR, ".env");
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const content = fs.readFileSync(envPath, "utf-8");
  const env: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

export function getConfig() {
  const env = readEnvFile();
  return {
    rootDir: ROOT_DIR,
    arkApiKey: env.ARK_API_KEY || "",
    arkBaseUrl: env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: env.DOUBAO_DEFAULT_MODEL || "doubao-seed-1-8-251228"
  };
}
