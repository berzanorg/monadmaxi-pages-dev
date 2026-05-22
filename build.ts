import { $ } from "bun";
import { rm, mkdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";

const dist = "dist";

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const result = await Bun.build({
  entrypoints: ["src/index.html"],
  outdir: dist,
  minify: true,
  splitting: true,
  target: "browser",
  naming: {
    entry: "[name].[ext]",
    chunk: "[name]-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await cp("node_modules/@mediapipe/tasks-vision/wasm", `${dist}/wasm`, { recursive: true });
await cp("assets/models", `${dist}/models`, { recursive: true });

if (Bun.which("resvg")) {
  await $`resvg assets/og.svg ${dist}/og.png`.quiet();
} else if (existsSync("assets/og.png")) {
  await cp("assets/og.png", `${dist}/og.png`);
} else {
  console.warn("resvg not found and no assets/og.png — skipping og.png");
}

console.log(`built → ${dist}/  (index.html ${Bun.file(`${dist}/index.html`).size} B)`);
