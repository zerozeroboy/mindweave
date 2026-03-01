import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_VISIBLE_EXTS } from "./file-support.js";

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

function getEnvValue(fileEnv: Record<string, string>, key: string): string {
  const fromProcess = process.env[key];
  if (typeof fromProcess === "string") return fromProcess;
  const fromFile = fileEnv[key];
  return typeof fromFile === "string" ? fromFile : "";
}

function parseBool(raw: string, defaultValue: boolean): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return defaultValue;
  if (v === "1" || v === "true" || v === "yes" || v === "y" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "n" || v === "off") return false;
  return defaultValue;
}

function parseVisibleExts(raw: string, defaultValue: string[]): string[] | "*" {
  const v = String(raw ?? "").trim();
  if (!v) return defaultValue;
  if (v === "*") return "*";
  const parts = v
    .split(/[,\s;]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith(".") ? item : `.${item}`))
    .map((item) => item.toLowerCase());
  return parts.length ? Array.from(new Set(parts)) : defaultValue;
}

export function getConfig() {
  const fileEnv = readEnvFile();
  const debugModelIoMaxCharsRaw = Number(getEnvValue(fileEnv, "DEBUG_MODEL_IO_MAX_CHARS"));
  const defaultMirrorVisibleExts = DEFAULT_VISIBLE_EXTS;
  return {
    rootDir: ROOT_DIR,
    arkApiKey: getEnvValue(fileEnv, "ARK_API_KEY"),
    arkBaseUrl: getEnvValue(fileEnv, "ARK_BASE_URL") || "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: getEnvValue(fileEnv, "DOUBAO_DEFAULT_MODEL") || "doubao-seed-2-0-lite-260215",
    debugModelIo: parseBool(getEnvValue(fileEnv, "DEBUG_MODEL_IO"), false),
    debugModelIoVerbose: parseBool(getEnvValue(fileEnv, "DEBUG_MODEL_IO_VERBOSE"), false),
    debugModelIoMaxChars:
      Number.isFinite(debugModelIoMaxCharsRaw) && debugModelIoMaxCharsRaw > 0 ? debugModelIoMaxCharsRaw : 2000
    ,
    mirrorVisibleExts: parseVisibleExts(getEnvValue(fileEnv, "MIRROR_VISIBLE_EXTS"), defaultMirrorVisibleExts),
    mirrorShowBackups: parseBool(getEnvValue(fileEnv, "MIRROR_SHOW_BACKUPS"), false)
  };
}
