// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    ensureHostAccess,
    hasHostAccess,
    originPattern,
} from "../../src/viewer/permission-guard";

type BrowserGlobal = { permissions: { contains: unknown; request: unknown } };
const g = globalThis as unknown as { browser?: BrowserGlobal };

function stubBrowser(granted: boolean) {
    const contains = vi.fn(async (_p: { origins: string[] }) => granted);
    const request = vi.fn(async (_p: { origins: string[] }) => true);
    g.browser = { permissions: { contains, request } };
    return { contains, request };
}

describe("permission guard", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });
    afterEach(() => {
        delete g.browser;
        document.body.innerHTML = "";
    });

    it("originPattern maps http(s) URLs to origin globs and rejects others", () => {
        expect(originPattern("https://arxiv.org/pdf/1706.03762")).toBe(
            "https://arxiv.org/*"
        );
        expect(originPattern("file:///tmp/x.pdf")).toBeNull();
        expect(originPattern("not a url")).toBeNull();
    });

    it("treats non-extension contexts (no browser global) as granted", async () => {
        expect(await hasHostAccess("https://arxiv.org/x.pdf")).toBe(true);
        expect(await ensureHostAccess("https://arxiv.org/x.pdf")).toBe(true);
        expect(
            document.querySelector("[data-anchor-permission-banner]")
        ).toBeNull();
    });

    it("checks API origins plus the file origin", async () => {
        const { contains } = stubBrowser(true);
        await hasHostAccess("https://arxiv.org/pdf/1.pdf");
        const origins = contains.mock.calls[0]![0]!.origins;
        expect(origins).toContain("https://api.openalex.org/*");
        expect(origins).toContain("https://api.crossref.org/*");
        expect(origins).toContain("https://api.semanticscholar.org/*");
        expect(origins).toContain("https://arxiv.org/*");
    });

    it("granted -> no banner", async () => {
        stubBrowser(true);
        expect(await ensureHostAccess("https://arxiv.org/x.pdf")).toBe(true);
        expect(
            document.querySelector("[data-anchor-permission-banner]")
        ).toBeNull();
    });

    it("missing grant -> banner with a Grant button that requests <all_urls>", async () => {
        const { request } = stubBrowser(false);
        expect(await ensureHostAccess("https://arxiv.org/x.pdf")).toBe(false);

        const banner = document.querySelector(
            "[data-anchor-permission-banner]"
        );
        expect(banner).not.toBeNull();

        const grant = [...banner!.querySelectorAll("button")].find(
            (b) => b.textContent === "Grant access"
        )!;
        grant.click();
        expect(request).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
    });

    it("is idempotent (second check adds no second banner) and dismissible", async () => {
        stubBrowser(false);
        await ensureHostAccess(null);
        await ensureHostAccess(null);
        const banners = document.querySelectorAll(
            "[data-anchor-permission-banner]"
        );
        expect(banners.length).toBe(1);

        const dismiss = [...banners[0]!.querySelectorAll("button")].find(
            (b) => b.getAttribute("aria-label") === "Dismiss"
        )!;
        dismiss.click();
        expect(
            document.querySelector("[data-anchor-permission-banner]")
        ).toBeNull();
    });
});
