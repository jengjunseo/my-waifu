import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT || 5173);
const root = new URL("../dist/", import.meta.url).pathname;
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json; charset=utf-8" };

const server = http.createServer(async (req, res) => {
  try {
    const raw = decodeURIComponent((req.url || "/").split("?")[0]);
    const safe = normalize(raw).replace(/^(\.\.(\/|\\|$))+/, "");
    let path = join(root, safe === "/" ? "index.html" : safe);
    try { if ((await stat(path)).isDirectory()) path = join(path, "index.html"); } catch { path = join(root, "index.html"); }
    const body = await readFile(path);
    res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Chara dev server: http://127.0.0.1:${port}`));
