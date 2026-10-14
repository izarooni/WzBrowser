// Tiny static server for build/client with SPA fallback - stands in for "any static host".
// Usage: node scripts/preview.mjs [port]
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "build", "client");
const port = Number(process.argv[2]) || 4173;
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json",
};

createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = normalize(join(root, pathname));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  res.writeHead(200, {
    "Content-Type": types[extname(file)] ?? "application/octet-stream",
    // The service worker must never be served stale.
    "Cache-Control": file.endsWith("sw.js") || file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
  });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`Serving build/client at http://localhost:${port}`));
