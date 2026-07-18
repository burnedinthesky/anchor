import { describe, it, expect } from "vitest";
import { findAuthorYearMatches } from "../../src/citations/detect/authorYear";
import {
    normalizeSurname,
    firstSurname,
} from "../../src/citations/detect/authorKey";

const keys = (t: string) =>
    findAuthorYearMatches(t).map((m) => `${m.authorKey}|${m.year}`);

describe("author-year detection", () => {
    it("(Smith, 2021)", () => {
        expect(keys("as in (Smith, 2021).")).toEqual(["smith|2021"]);
    });

    it("(Smith et al., 2021)", () => {
        expect(keys("prior (Smith et al., 2021) work")).toEqual(["smith|2021"]);
    });

    it("(Smith and Jones 2021) without comma", () => {
        expect(keys("(Smith and Jones 2021)")).toEqual(["smith|2021"]);
    });

    it("(Smith & Jones, 2021)", () => {
        expect(keys("(Smith & Jones, 2021)")).toEqual(["smith|2021"]);
    });

    it("narrative Smith et al. (2021)", () => {
        expect(
            keys("As shown by Smith et al. (2021), results improve")
        ).toEqual(["smith|2021"]);
    });

    it("narrative Smith and Jones (2021)", () => {
        expect(keys("Smith and Jones (2021) argue")).toEqual(["smith|2021"]);
    });

    it("multi-cite (Smith, 2020; Jones, 2021) → two markers", () => {
        expect(keys("(Smith, 2020; Jones, 2021)")).toEqual([
            "smith|2020",
            "jones|2021",
        ]);
    });

    it("strips diacritics in the author key (Gómez)", () => {
        expect(keys("(Gómez and Jones, 2020)")).toEqual(["gomez|2020"]);
    });

    it("applies the year guard (rejects 3-digit / out-of-range)", () => {
        expect(findAuthorYearMatches("(Smith, 999)")).toHaveLength(0);
        expect(findAuthorYearMatches("(Smith, 1234)")).toHaveLength(0);
    });

    it("ignores a bare (2021) with no author", () => {
        expect(findAuthorYearMatches("see (2021) here")).toHaveLength(0);
    });

    it("does not treat grant/award identifiers as citations (regression)", () => {
        // From a real acknowledgments section: alphanumeric IDs embed
        // year-like digit runs and must not become markers.
        const m = findAuthorYearMatches(
            "supported by Grants (JCYJ20220818103001002), (C10120230151) and (RCBS20221008093330065)."
        );
        expect(m).toHaveLength(0);
        // ...while a real cite in the same sentence still matches.
        const mixed = findAuthorYearMatches(
            "funded under JCYJ20220818103001002 (Smith, 2021)."
        );
        expect(mixed).toHaveLength(1);
        expect(mixed[0]!.authorKey).toBe("smith");
    });

    it("recovers cites from parenthetical groups cut by a page break (regression)", () => {
        // Unclosed group at the end of a page: the Chen cite is complete
        // within the fragment and must match; the Leviathan cite's year is on
        // the next page and is (acceptably) lost.
        const tail = findAuthorYearMatches(
            "proprietary methods (Chen et al., 2023; Leviathan"
        );
        expect(tail.map((x) => `${x.authorKey}|${x.year}`)).toEqual([
            "chen|2023",
        ]);

        // Leading close on the next page: the fragment's own cite matches.
        const head = findAuthorYearMatches(
            "Leviathan et al., 2022) are compared"
        );
        expect(head.map((x) => `${x.authorKey}|${x.year}`)).toEqual([
            "leviathan|2022",
        ]);

        // Unclosed prose parens without a year stay ignored.
        expect(
            findAuthorYearMatches("as shown (see the appendix")
        ).toHaveLength(0);
    });

    it("rejects page furniture in boundary fragments (running header before a stray year)", () => {
        // Leading close-fragment on a page that starts with the paper's
        // running header: without an author phrase adjacent to the year this
        // must NOT become a marker (it produced a giant header-wide button).
        const m = findAuthorYearMatches(
            "MEDUSA: Simple LLM Inference Acceleration Framework with Multiple Decoding Heads 2022) rest of page"
        );
        expect(m).toHaveLength(0);
    });

    it("matches citations whose surname is hyphen-wrapped across lines", () => {
        // concatPage dehyphenates "Tou-\nvron" -> "Touvron"; this asserts the
        // downstream matcher sees the joined surname.
        const m = findAuthorYearMatches(
            "recent models (Touvron et al., 2023) show"
        );
        expect(m).toHaveLength(1);
        expect(m[0]!.authorKey).toBe("touvron");
    });

    it("keeps distinct year suffixes visible in rawText", () => {
        const m = findAuthorYearMatches("(Brown, 2020a) and (Brown, 2020b)");
        expect(m).toHaveLength(2);
        expect(m[0]!.rawText).toContain("2020a");
        expect(m[1]!.rawText).toContain("2020b");
        // both normalise to the same base key
        expect(m.map((x) => `${x.authorKey}|${x.year}`)).toEqual([
            "brown|2020",
            "brown|2020",
        ]);
    });
});

describe("surname normalisation", () => {
    it("lowercases and strips diacritics", () => {
        expect(normalizeSurname("Gómez")).toBe("gomez");
        expect(normalizeSurname("MÜLLER")).toBe("muller");
        expect(normalizeSurname("O'Brien")).toBe("obrien");
    });
    it("firstSurname picks the leading capitalised token", () => {
        expect(firstSurname("Smith et al.")).toBe("Smith");
        expect(firstSurname("  and then")).toBe(null);
    });
});
