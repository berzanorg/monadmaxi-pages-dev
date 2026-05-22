import { file } from "bun";
import { join, extname } from "node:path";
import { existsSync, statSync } from "node:fs";

const root = "dist";
const port = Number(process.env.PORT ?? 5173);

if (!existsSync(root)) {
  console.error(`No ${root}/ directory — run 'bun run build' first.`);
  process.exit(1);
}

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".wasm": "application/wasm",
  ".tflite": "application/octet-stream",
  ".json": "application/json; charset=utf-8",
};

Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const abs = join(root, pathname);
    if (!abs.startsWith(root)) return new Response("Bad path", { status: 400 });
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      return new Response("Not found", { status: 404 });
    }
    const f = file(abs);
    const headers = new Headers();
    const ct = types[extname(abs).toLowerCase()];
    if (ct) headers.set("Content-Type", ct);
    return new Response(f, { headers });
  },
});

console.log(`preview → http://localhost:${port}  (LAN: same port on your machine's IP)`);
