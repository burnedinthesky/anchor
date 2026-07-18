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
    // Hitbox coverage: any PDF cite-link annotation a button overlaps must be
    // fully eclipsed by it (else clicks near its edges jump to the bib and its
    // :hover style washes out the text line). Untouched links = detection
    // misses, which are allowed to keep working as normal PDF links.
    await page.waitForTimeout(1200); // let annotation layers land + re-render
    const partial = await page.evaluate(() => {
        const btns = [...document.querySelectorAll(".anchor-cite-btn")].map(
            (b) => b.getBoundingClientRect()
        );
        const bad = [];
        for (const a of document.querySelectorAll(
            '.annotationLayer a[href*="#cite"], .annotationLayer a[href*="#bib"]'
        )) {
            const ar = a.getBoundingClientRect();
            if (ar.width <= 0) continue;
            const overlapping = btns.filter(
                (r) =>
                    Math.min(ar.right, r.right) - Math.max(ar.left, r.left) >
                        0 &&
                    Math.min(ar.bottom, r.bottom) - Math.max(ar.top, r.top) > 0
            );
            if (overlapping.length === 0) continue; // detection miss: allowed
            const covered = overlapping.some(
                (r) =>
                    r.left <= ar.left + 0.5 &&
                    r.right >= ar.right - 0.5 &&
                    r.top <= ar.top + 0.5 &&
                    r.bottom >= ar.bottom - 0.5
            );
            if (!covered) bad.push(a.getAttribute("href"));
        }
        return bad.slice(0, 5);
    });
    check(
        partial.length === 0,
        `no cite-link annotation is partially covered (bad: ${partial.join(", ") || "none"})`
    );

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
