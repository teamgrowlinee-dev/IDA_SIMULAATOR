import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const simulatorDir = path.join(rootDir, "app/public/simulator");
const threeDir = path.join(rootDir, "node_modules/three");
const outDir = path.join(rootDir, "netlify-dist");

const normalizeApiBase = (value) => {
  const fallback = "https://ida-chatbot.onrender.com/api";
  const input = String(value ?? fallback).trim();

  try {
    const url = new URL(input);
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
};

const apiBase = normalizeApiBase(process.env.SIMULATOR_API_BASE);

const copyDir = async (sourceDir, targetDir) => {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
      continue;
    }

    await fs.copyFile(sourcePath, targetPath);
  }
};

const withConfigScript = (html) =>
  html.replace(
    "</head>",
    `  <script>window.__IDA_SIMULATOR_API_BASE__ = ${JSON.stringify(apiBase)};</script>\n</head>`
  );

const writePage = async (routeDir, sourceHtmlFile) => {
  const sourcePath = path.join(simulatorDir, sourceHtmlFile);
  const html = await fs.readFile(sourcePath, "utf8");
  const targetDir = path.join(outDir, routeDir);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, "index.html"), withConfigScript(html), "utf8");
};

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

await copyDir(simulatorDir, path.join(outDir, "simulator-assets"));
await copyDir(path.join(threeDir, "build"), path.join(outDir, "vendor/three/build"));
await copyDir(path.join(threeDir, "examples/jsm"), path.join(outDir, "vendor/three/examples/jsm"));

await writePage("planner", "planner-workspace.html");
await writePage("planner-legacy", "planner.html");
await writePage("simulator", "simulator.html");
await writePage("room", "room.html");
await writePage("local-cart", "local-cart.html");

await fs.writeFile(
  path.join(outDir, "index.html"),
  `<!doctype html>
<html lang="et">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0; url=/planner/" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>IDA Planner</title>
  </head>
  <body>
    <p>Suunan plannerisse… <a href="/planner/">Ava planner</a></p>
  </body>
</html>
`,
  "utf8"
);

console.log(`[netlify-simulator] Built static simulator to ${outDir}`);
console.log(`[netlify-simulator] API base: ${apiBase}`);
