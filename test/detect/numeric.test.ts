import { describe, it, expect } from "vitest";
import {
    findNumericMatches,
    expandOrdinals,
} from "../../src/citations/detect/numeric";

describe("bracketed numeric detection", () => {
    it("detects a simple [12]", () => {
        const m = findNumericMatches("see [12] for details");
        expect(m).toHaveLength(1);
        expect(m[0]!.rawText).toBe("[12]");
        expect(m[0]!.ordinal).toBe(12);
        expect(m[0]!.ordinals).toEqual([12]);
        expect(m[0]!.scheme).toBe("numeric");
    });

    it("expands a comma+range list [3, 5–7]", () => {
        const m = findNumericMatches("as in [3, 5–7].");
        expect(m).toHaveLength(1);
        expect(m[0]!.ordinal).toBe(3);
        expect(m[0]!.ordinals).toEqual([3, 5, 6, 7]);
    });

    it("expands hyphen ranges [3-5]", () => {
        expect(expandOrdinals("[3-5]")).toEqual([3, 4, 5]);
        expect(expandOrdinals("[3–5]")).toEqual([3, 4, 5]);
    });

    it("expands a plain list [1,2,4]", () => {
        expect(expandOrdinals("[1,2,4]")).toEqual([1, 2, 4]);
    });

    it("merges [3]–[5] into one range marker", () => {
        const m = findNumericMatches("compare [3]–[5] closely");
        expect(m).toHaveLength(1);
        expect(m[0]!.ordinals).toEqual([3, 4, 5]);
        expect(m[0]!.ordinal).toBe(3);
    });

    it("merges spaced [3] - [5] across separators", () => {
        const m = findNumericMatches("compare [3] - [5] here");
        expect(m).toHaveLength(1);
        expect(m[0]!.ordinals).toEqual([3, 4, 5]);
    });

    it("keeps separate non-adjacent brackets distinct", () => {
        const m = findNumericMatches("[1] and later [2]");
        expect(m.map((x) => x.ordinal)).toEqual([1, 2]);
    });

    it("does not match bracketed non-numeric text", () => {
        expect(findNumericMatches("[see appendix]")).toHaveLength(0);
    });

    it("records char offsets of the match span", () => {
        const m = findNumericMatches("xx [7] yy");
        expect(m[0]!.start).toBe(3);
        expect(m[0]!.end).toBe(6);
    });
});
