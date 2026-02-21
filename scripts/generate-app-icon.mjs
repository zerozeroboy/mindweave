import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import pngToIco from "png-to-ico";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.join(__dirname, "..");
const svgPath = path.join(repoRoot, "src", "assets", "mw-logo.svg");
const outDir = path.join(repoRoot, "assets");
const icoPath = path.join(outDir, "app-icon.ico");
const pngPath = path.join(outDir, "app-icon.png");

if (!fs.existsSync(svgPath)) {
  throw new Error(`SVG not found: ${svgPath}`);
}

fs.mkdirSync(outDir, { recursive: true });

const svg = fs.readFileSync(svgPath, "utf8");
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = [];

for (const size of sizes) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size }
  });
  const pngData = resvg.render();
  pngBuffers.push(pngData.asPng());
  if (size === 256) {
    fs.writeFileSync(pngPath, pngData.asPng());
  }
}

const ico = await pngToIco(pngBuffers);
fs.writeFileSync(icoPath, ico);

process.stdout.write(`Wrote ${icoPath}\nWrote ${pngPath}\n`);
