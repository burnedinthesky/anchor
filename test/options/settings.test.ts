import { describe, it, expect } from "vitest";
import {
    DEFAULT_SETTINGS,
    hostMatchesSites,
    normalizeSites,
} from "../../src/options/settings";

describe("enabled-site allowlist", () => {
    describe("normalizeSites", () => {
        it("trims, lowercases, drops empties, and dedupes in order", () => {
            expect(
                normalizeSites([
                    "  ArXiv.org ",
                    "arxiv.org",
                    "",
                    "OpenReview.net",
                ])
            ).toEqual(["arxiv.org", "openreview.net"]);
        });

        it("discards non-string members and non-arrays", () => {
            expect(normalizeSites(["a.com", 3, null, "b.com"])).toEqual([
                "a.com",
                "b.com",
            ]);
            expect(normalizeSites("arxiv.org")).toEqual([]);
            expect(normalizeSites(undefined)).toEqual([]);
        });
    });

    describe("hostMatchesSites", () => {
        const sites = ["arxiv.org", "openreview.net"];

        it("matches the exact host", () => {
            expect(
                hostMatchesSites("https://arxiv.org/pdf/2401.1.pdf", sites)
            ).toBe(true);
        });

        it("matches subdomains of a listed host", () => {
            expect(
                hostMatchesSites("https://export.arxiv.org/pdf/x.pdf", sites)
            ).toBe(true);
            expect(hostMatchesSites("https://www.arxiv.org/a.pdf", sites)).toBe(
                true
            );
        });

        it("does not match a suffix that is not a subdomain boundary", () => {
            expect(hostMatchesSites("https://notarxiv.org/x.pdf", sites)).toBe(
                false
            );
            expect(hostMatchesSites("https://example.com/x.pdf", sites)).toBe(
                false
            );
        });

        it("is case-insensitive on the host", () => {
            expect(hostMatchesSites("https://ArXiv.org/x.pdf", sites)).toBe(
                true
            );
        });

        it("returns false for unparseable or non-http URLs' bad input", () => {
            expect(hostMatchesSites("not a url", sites)).toBe(false);
            expect(hostMatchesSites("https://arxiv.org/x.pdf", [])).toBe(false);
        });
    });

    it("defaults to arxiv.org only", () => {
        expect(DEFAULT_SETTINGS.enabledSites).toEqual(["arxiv.org"]);
    });
});
