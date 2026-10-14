import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const NEXT_DIR = path.join(ROOT_DIR, ".next");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const OUT_ASSETS_DIR = path.join(ROOT_DIR, ".cloudflare", "assets");

function copyDirectoryRecursive(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const srcPath = path.join(sourceDir, entry.name);
    const destPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyAppHtmlRecursive(appServerDir: string, targetBaseDir: string, relativeDir = ""): void {
  const currentDir = path.join(appServerDir, relativeDir);
  if (!fs.existsSync(currentDir)) {
    return;
  }

  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const relPath = path.join(relativeDir, entry.name);
    const fullPath = path.join(appServerDir, relPath);

    if (entry.isDirectory()) {
      if (!entry.name.endsWith(".segments")) {
        copyAppHtmlRecursive(appServerDir, targetBaseDir, relPath);
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".html")) {
      continue;
    }

    const normalizedName =
      entry.name === "[projectId].html" ? "__project_detail__.html" : entry.name;
    const destDir = path.join(targetBaseDir, relativeDir);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(fullPath, path.join(destDir, normalizedName));
  }
}

function main(): void {
  fs.rmSync(OUT_ASSETS_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_ASSETS_DIR, { recursive: true });

  // 1. Copy public/ assets
  copyDirectoryRecursive(PUBLIC_DIR, OUT_ASSETS_DIR);

  // 2. Copy .next/static -> .cloudflare/assets/_next/static
  const nextStaticDir = path.join(NEXT_DIR, "static");
  const outNextStaticDir = path.join(OUT_ASSETS_DIR, "_next", "static");
  copyDirectoryRecursive(nextStaticDir, outNextStaticDir);

  // 3. Copy generated HTML files from .next/server/app
  const appServerDir = path.join(NEXT_DIR, "server", "app");
  copyAppHtmlRecursive(appServerDir, OUT_ASSETS_DIR);

  // 4. Map _not-found.html -> 404.html and favicon.ico.body -> favicon.ico
  const notFoundHtml = path.join(appServerDir, "_not-found.html");
  if (fs.existsSync(notFoundHtml)) {
    fs.copyFileSync(notFoundHtml, path.join(OUT_ASSETS_DIR, "404.html"));
  }

  const faviconBody = path.join(appServerDir, "favicon.ico.body");
  if (fs.existsSync(faviconBody)) {
    fs.copyFileSync(faviconBody, path.join(OUT_ASSETS_DIR, "favicon.ico"));
  }

  console.log("[cloudflare] Prepared static assets in .cloudflare/assets");
}

main();
