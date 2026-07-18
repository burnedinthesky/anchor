/**
 * Real-Firefox end-to-end verification (the authoritative check).
 *
 * Installs the built extension into headless Firefox as a temporary add-on
 * (same as about:debugging / web-ext run), serves a real PDF over localhost,
 * navigates to it, and verifies the complete flow: webRequest redirect to the
 * moz-extension viewer, PDF rendering, marker overlays, card open/close, and
 * scroll invariance. Also reports the extension's actual granted permissions.
 *
 *   node scripts/firefox-check.mjs [path/to/paper.pdf]
 *       (defaults to test/fixtures/pdf/numeric.pdf)
 *   GRANT=0 node scripts/firefox-check.mjs   # simulate host permissions NOT granted
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { Builder, By, Key, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const pdfPath = resolve(process.argv[2] ?? "test/fixtures/pdf/numeric.pdf");
const grantHostPermissions = process.env.GRANT !== "0";
const xpi = "artifacts/anchor_pdf_reader-0.2.0.zip";
if (!existsSync(xpi)) {
    console.log("building package first...");
    execSync("pnpm package", { stdio: "ignore" });
}

// --- tiny static server for the PDF ---------------------------------------
const server = createServer(async (req, res) => {
    try {
        const body = await readFile(pdfPath);
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end(body);
    } catch {
        res.writeHead(404);
        res.end();
    }
});
await new Promise((r) => server.listen(0, r));
const pdfUrl = `http://127.0.0.1:${server.address().port}/paper.pdf`;

let failures = 0;
const check = (cond, msg) => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
    if (!cond) failures++;
};

// --- launch Firefox with the extension -------------------------------------
const options = new firefox.Options()
    .setBinary("/Applications/Firefox.app/Contents/MacOS/firefox")
    .addArguments("-headless")
    // Test seam for MV3 opt-in host permissions: grant-by-default ON models a
    // user who accepted access; OFF models a fresh install (the badge state
    // "Can't read and change data on this site").
    .setPreference(
        "extensions.originControls.grantByDefault",
        grantHostPermissions
    );

const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .build();

try {
    await driver.installAddon(resolve(xpi), /* temporary */ true);
    console.log(
        `installed temporary add-on; host permissions granted: ${grantHostPermissions}`
    );

    await driver.get(pdfUrl);
    // The blocking webRequest listener should redirect to the viewer.
    await driver.wait(
        async () =>
            (await driver.getCurrentUrl()).startsWith("moz-extension://"),
        15000,
        "no redirect to moz-extension viewer"
    );
    const viewerUrl = await driver.getCurrentUrl();
    check(
        viewerUrl.includes("/viewer/web/viewer.html?file="),
        `redirected to extension viewer (${viewerUrl.slice(0, 60)}...)`
    );

    // Report what the extension itself thinks it may access.
    const perms = await driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        browser.permissions.getAll().then((p) => done(JSON.stringify(p))).catch((e) => done("ERR " + e.message));
    `);
    console.log(`  permissions.getAll(): ${perms}`);

    // PDF actually renders (text layer appears)?
    let pdfRendered = true;
    try {
        await driver.wait(until.elementLocated(By.css(".textLayer")), 20000);
    } catch {
        pdfRendered = false;
    }
    check(pdfRendered, "PDF renders (text layer present)");

    if (!pdfRendered) {
        const bodyText = await driver.executeScript(
            "return document.body.innerText.slice(0, 400)"
        );
        console.log(`  viewer body text: ${JSON.stringify(bodyText)}`);
        const banner = await driver.executeScript(
            "return !!document.querySelector('[data-anchor-permission-banner]')"
        );
        check(banner, "permission banner shown when host access is missing");
    } else {
        // Citation pipeline: overlays appear.
        let btns = 0;
        try {
            await driver.wait(
                until.elementLocated(By.css(".anchor-cite-btn")),
                20000
            );
            btns = (await driver.findElements(By.css(".anchor-cite-btn")))
                .length;
        } catch {
            /* none */
        }
        check(btns > 0, `marker buttons rendered (${btns})`);

        if (btns > 0) {
            const scrollBefore = await driver.executeScript(
                "const c = document.getElementById('viewerContainer'); return [c.scrollTop, c.scrollLeft];"
            );
            const btn = await driver.findElement(By.css(".anchor-cite-btn"));
            await driver.executeScript(
                "arguments[0].scrollIntoView({block: 'center'});",
                btn
            );
            const scrollMid = await driver.executeScript(
                "const c = document.getElementById('viewerContainer'); return [c.scrollTop, c.scrollLeft];"
            );
            await btn.click();
            await driver.sleep(400);

            const cardOpen = await driver.executeScript(
                "return !!document.querySelector('[data-anchor-card-host]')"
            );
            check(cardOpen, "preview card opens on click");

            const scrollAfter = await driver.executeScript(
                "const c = document.getElementById('viewerContainer'); return [c.scrollTop, c.scrollLeft];"
            );
            check(
                scrollMid[0] === scrollAfter[0] &&
                    scrollMid[1] === scrollAfter[1],
                `reading position unchanged by card (before=${scrollMid}, after=${scrollAfter})`
            );
            void scrollBefore;

            await driver.actions().sendKeys(Key.ESCAPE).perform();
            await driver.sleep(200);
            const cardGone = await driver.executeScript(
                "return !document.querySelector('[data-anchor-card-host]')"
            );
            check(cardGone, "Esc dismisses the card");
        }
    }
} finally {
    await driver.quit();
    server.close();
}

console.log(
    failures === 0
        ? "\nFIREFOX CHECK PASS"
        : `\nFIREFOX CHECK: ${failures} FAILURE(S)`
);
process.exit(failures === 0 ? 0 : 1);
