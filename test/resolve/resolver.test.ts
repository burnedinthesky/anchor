import { describe, it, expect } from "vitest";
import { DocumentCitationDetector } from "../../src/citations/detect/index";
import { BibliographyResolver } from "../../src/citations/resolve/index";
import { findReferencesSection } from "../../src/citations/detect/section";
import type { CitationMarker, PDFTextContent } from "../../src/citations/types";
import { fixtures, makeViewport } from "../fixtures/loader";

const vp = makeViewport();

function markers(pages: PDFTextContent[]): CitationMarker[] {
    const det = new DocumentCitationDetector(pages);
    return pages.flatMap((pg, i) => det.detect(i + 1, pg, vp));
}

function numericMarker(ordinal: number): CitationMarker {
    return {
        id: `test#${ordinal}`,
        page: 1,
        scheme: "numeric",
        rawText: `[${ordinal}]`,
        rect: { x: 0, y: 0, w: 1, h: 1 },
        ordinal,
        ordinals: [ordinal],
    };
}

describe("heading location (§5.1)", () => {
    const variants = [
        "References",
        "REFERENCES",
        "Bibliography",
        "Works Cited",
        "Literature Cited",
        "7. References",
        "VII. References",
    ];
    for (const h of variants) {
        it(`locates "${h}"`, () => {
            const pages: PDFTextContent[] = [
                {
                    items: [
                        {
                            str: h,
                            transform: [10, 0, 0, 10, 72, 700],
                            width: h.length * 5,
                            height: 10,
                            fontName: "b",
                            dir: "ltr",
                            hasEOL: true,
                        },
                        {
                            str: "[1] Some Author. A title. Venue, 2020.",
                            transform: [10, 0, 0, 10, 72, 680],
                            width: 200,
                            height: 10,
                            fontName: "b",
                            dir: "ltr",
                            hasEOL: true,
                        },
                    ],
                },
            ];
            expect(findReferencesSection(pages)).not.toBeNull();
        });
    }
    it("returns null when no heading present", () => {
        expect(findReferencesSection(fixtures.noReferences)).toBeNull();
    });
});

describe("numeric resolution (acceptance row 1 local half)", () => {
    const resolver = new BibliographyResolver(fixtures.numeric);

    it("resolves [1] to reference entry 1", () => {
        const r = resolver.resolve(numericMarker(1));
        expect(r).not.toBeNull();
        expect(r!.rawText).toContain("Smith and B. Jones");
        expect(r!.hints.year).toBe(2019);
    });

    it("resolves a range marker to its FIRST ordinal", () => {
        const m = {
            ...numericMarker(3),
            rawText: "[3, 5–7]",
            ordinals: [3, 5, 6, 7],
        };
        const r = resolver.resolve(m);
        expect(r!.rawText).toContain("E. Roe");
    });

    it("extracts a DOI hint from the entry", () => {
        const r = resolver.resolve(numericMarker(2));
        expect(r!.doi).toBe("10.1109/5.771073");
    });

    it("validates the ordinal: [99] with 8 entries → null", () => {
        expect(resolver.resolve(numericMarker(99))).toBeNull();
    });

    it("rejects ordinal 0", () => {
        expect(resolver.resolve(numericMarker(0))).toBeNull();
    });
});

describe("superscript resolution (acceptance row 3 local half)", () => {
    it("resolves superscript ordinals against the numbered list", () => {
        const resolver = new BibliographyResolver(fixtures.superscript);
        const m = markers(fixtures.superscript);
        const first = m.find((x) => x.ordinal === 1)!;
        const r = resolver.resolve(first);
        expect(r).not.toBeNull();
        expect(r!.rawText).toContain("A. One");
    });
});

describe("author-year resolution (acceptance row 2 local half)", () => {
    const resolver = new BibliographyResolver(fixtures.authorYear);
    const m = markers(fixtures.authorYear);
    const find = (ak: string, yr: number) =>
        m.find((x) => x.authorKey === ak && x.year === yr)!;

    it("resolves (Smith et al., 2021) to the Smith entry", () => {
        const r = resolver.resolve(find("smith", 2021));
        expect(r!.rawText).toContain("Smith, J., Doe, K.");
        expect(r!.hints.title).toContain("Establishing the method");
    });

    it("resolves a diacritic author (Gómez → gomez)", () => {
        const r = resolver.resolve(find("gomez", 2020));
        expect(r!.rawText).toContain("Gómez, M.");
    });

    it("disambiguates 2020a vs 2020b via the marker suffix", () => {
        const a = m.find((x) => x.rawText.includes("2020a"))!;
        const b = m.find((x) => x.rawText.includes("2020b"))!;
        expect(resolver.resolve(a)!.rawText).toContain("first study");
        expect(resolver.resolve(b)!.rawText).toContain("second study");
    });

    it("returns null when no matching entry exists (Smith 2020)", () => {
        const smith2020 = m.find(
            (x) => x.authorKey === "smith" && x.year === 2020
        )!;
        expect(resolver.resolve(smith2020)).toBeNull();
    });
});

describe("missing references section (§5.1 fallback)", () => {
    const resolver = new BibliographyResolver(fixtures.noReferences);

    it("confirms the fixture has no reference section", () => {
        expect(findReferencesSection(fixtures.noReferences)).toBeNull();
    });

    it("author-year still resolves from the marker text itself", () => {
        const ay: CitationMarker = {
            id: "p1#7",
            page: 1,
            scheme: "author-year",
            rawText: "(Smith, 2021)",
            rect: { x: 0, y: 0, w: 1, h: 1 },
            authorKey: "smith",
            year: 2021,
        };
        const r = resolver.resolve(ay);
        expect(r).not.toBeNull();
        expect(r!.rawText).toBe("(Smith, 2021)");
        expect(r!.hints.year).toBe(2021);
        expect(r!.hints.authors).toEqual(["Smith"]);
    });

    it("numeric returns null with no section", () => {
        expect(resolver.resolve(numericMarker(1))).toBeNull();
    });
});
