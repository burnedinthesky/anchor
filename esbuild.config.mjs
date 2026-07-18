// Build script: bundles extension sources into dist/ ready for web-ext.
// Agent A (viewer shell) owns the entry-point list and static-asset copying.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, existsSync } from "node:fs";

const outdir = "dist";
mkdirSync(outdir, { recursive: true });

const entryPoints = [
  { in: "src/background/intercept.ts", out: "background/intercept" },
  { in: "src/viewer/bootstrap.ts", out: "viewer/bootstrap" },
  { in: "src/options/options.ts", out: "options/options" },
].filter((e) => existsSync(e.in));

await esbuild.build({
  entryPoints,
  bundle: true,
  format: "esm",
  target: "es2022",
  outdir,
  sourcemap: true,
  logLevel: "info",
});

// Static assets (manifest, HTML pages, vendored pdf.js viewer) are copied by
// copyStatic(); Agent A extends this list.
const staticCopies = [
  ["src/manifest.json", `${outdir}/manifest.json`],
];
for (const [from, to] of staticCopies) {
  if (existsSync(from)) cpSync(from, to, { recursive: true });
}
