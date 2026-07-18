// Build script: bundles extension sources into dist/ ready for web-ext.
// Agent A (viewer shell) owns the entry-point list and static-asset copying.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";

const outdir = "dist";

// Clean rebuild so stale files never linger in the packaged extension.
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const entryPoints = [
  { in: "src/background/intercept.ts", out: "background/intercept" },
  // Bundled next to the vendored viewer so viewer.html can load ./bootstrap.js.
  { in: "src/viewer/bootstrap.ts", out: "viewer/web/bootstrap" },
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

// Static assets: manifest, HTML pages, and the vendored pdf.js generic viewer.
// The vendored tree keeps pdf.js's native web/ + build/ sibling layout, so the
// viewer's relative asset paths (../web/cmaps, ../build/pdf.worker.mjs) resolve
// unchanged. It lands at dist/viewer/{web,build}; the viewer page is therefore
// dist/viewer/web/viewer.html.
const staticCopies = [
  ["src/manifest.json", `${outdir}/manifest.json`],
  ["src/options/options.html", `${outdir}/options/options.html`],
  ["vendor/pdfjs", `${outdir}/viewer`],
];
for (const [from, to] of staticCopies) {
  if (existsSync(from)) {
    mkdirSync(to.substring(0, to.lastIndexOf("/")), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
}
