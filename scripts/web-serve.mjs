import { readFile } from "node:fs/promises";
// 本地静态服务：伺服 apps/miniapp/dist-web（Taro H5 产物），SPA 回退到 index.html。
// 用法：node scripts/web-serve.mjs [port]（默认 4173）
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath 才能正确处理中文/空格路径（URL.pathname 会保留百分号编码）。
const root = fileURLToPath(new URL("../apps/miniapp/dist-web/", import.meta.url));
const port = Number(process.argv[2] ?? 4173);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = normalize(join(root, pathname));
    if (!file.startsWith(normalize(root))) throw new Error("forbidden");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    try {
      const body = await readFile(join(root, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  }
}).listen(port, () => console.log(`serving dist-web at http://localhost:${port}`));
