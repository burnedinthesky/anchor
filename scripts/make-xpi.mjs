// Copies the web-ext build output for the current version to a matching .xpi.
// web-ext only emits a .zip; a Firefox-installable .xpi is the same archive
// under a different extension, so we copy rather than repackage. Run after
// `web-ext build` (the `package` script chains them).
import { readFileSync, readdirSync, copyFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("src/manifest.json", "utf8"));
const dir = "artifacts";

const zip = readdirSync(dir).find((f) => f.endsWith(`-${version}.zip`));
if (!zip) {
    console.error(
        `[make-xpi] no artifacts/*-${version}.zip found — run \`pnpm run build\` and \`web-ext build\` first (or \`pnpm run package\`).`
    );
    process.exit(1);
}

const xpi = zip.replace(/\.zip$/, ".xpi");
copyFileSync(`${dir}/${zip}`, `${dir}/${xpi}`);
console.log(`[make-xpi] ${zip} -> ${xpi}`);
