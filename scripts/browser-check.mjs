/**
 * Real-browser verification of the citation-preview pipeline.
 *
 * Serves dist/ over localhost, loads the built viewer with a real PDF in
 * headless Chromium (the viewer is a plain web page — extension APIs all
 * degrade gracefully), and verifies: markers render, they sit ABOVE the PDF's
 * own link annotations, clicking opens the card without moving the reading
 * position, and Esc dismisses it.
 *
 *   node scripts/browser-check.mjs [path/to/paper.pdf]
 *     (defaults to test/fixtures/pdf/numeric.pdf)
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";

const pdfPath = resolve(process.argv[2] ?? "test/fixtures/pdf/numeric.pdf");
const MIME = {
    ".html": "text/html",
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".css": "text/css",
    ".pdf": "application/pdf",
    ".json": "application/json",
    ".ftl": "text/plain",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
};

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, "http://localhost");
        const file =
            url.pathname === "/paper.pdf"
                ? pdfPath
                : resolve("dist", "." + url.pathname);
        const body = await readFile(file);
        res.writeHead(200, {
            "content-type": MIME[extname(file)] ?? "application/octet-stream",
        });
        res.end(body);
    } catch {
        res.writeHead(404);
        res.end();
    }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const viewerUrl = `http://localhost:${port}/viewer/web/viewer.html?file=${encodeURIComponent(
    `http://localhost:${port}/paper.pdf`
)}`;

let failures = 0;
const check = (cond, msg) => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
    if (!cond) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => {
    if (m.type() === "error" || m.text().includes("[anchor]"))
        console.log(`  [console:${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

await page.goto(viewerUrl);
await page.waitForSelector(".textLayer", { timeout: 30000 });
// Let detection finish (needs all pages' text) and overlays mount.
await page
    .waitForSelector(".anchor-cite-btn", { timeout: 30000 })
    .catch(() => {});
const btnCount = await page.locator(".anchor-cite-btn").count();
check(btnCount > 0, `marker buttons rendered (${btnCount})`);

if (btnCount > 0) {
    // Pick the first visible marker button and ask the browser what element is
    // actually hit-tested at its center — this is the stacking-order truth.
    const btn = page.locator(".anchor-cite-btn").first();
    await btn.scrollIntoViewIfNeeded();
    const hit = await btn.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2
        );
        return {
            label: el.getAttribute("aria-label"),
            topIsButton: top === el || el.contains(top),
            topDesc: top ? `${top.tagName}.${top.className}` : "none",
        };
    });
    check(
        hit.topIsButton,
        `marker button is the hit-tested element at its center (top=${hit.topDesc}, label="${hit.label}")`
    );

    const scrollBefore = await page.evaluate(() => {
        const c = document.getElementById("viewerContainer");
        return { top: c.scrollTop, left: c.scrollLeft };
    });
    await btn.click();
    await page.waitForTimeout(300);

    const cardOpen = await page.evaluate(
        () =>
            !!document.querySelector(
                "[data-anchor-card-host], .anchor-card-host"
            )
    );
    check(cardOpen, "preview card host appears after click");

    const scrollAfter = await page.evaluate(() => {
        const c = document.getElementById("viewerContainer");
        return { top: c.scrollTop, left: c.scrollLeft };
    });
    check(
        scrollBefore.top === scrollAfter.top &&
            scrollBefore.left === scrollAfter.left,
        `reading position unchanged (before=${scrollBefore.top}, after=${scrollAfter.top})`
    );

    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const cardGone = await page.evaluate(
        () =>
            !document.querySelector(
                "[data-anchor-card-host], .anchor-card-host"
            )
    );
    check(cardGone, "Esc dismisses the card");
}

await browser.close();
server.close();
console.log(
    failures === 0
        ? "\nBROWSER CHECK PASS"
        : `\nBROWSER CHECK: ${failures} FAILURE(S)`
);
process.exit(failures === 0 ? 0 : 1);
