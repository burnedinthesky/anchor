import { describe, it, expect } from "vitest";
import {
    voteScheme,
    DocumentCitationDetector,
} from "../../src/citations/detect/index";
import { fixtures } from "../fixtures/loader";

describe("dominant-scheme vote (unit)", () => {
    it("picks numeric when it dominates", () => {
        expect(voteScheme(20, 0, 0)).toBe("numeric");
    });
    it("picks superscript when it dominates", () => {
        expect(voteScheme(1, 15, 0)).toBe("superscript");
    });
    it("picks author-year only above the minimum count", () => {
        expect(voteScheme(1, 0, 2)).toBe("numeric"); // 2 < MIN(3): author-year rejected
        expect(voteScheme(1, 0, 8)).toBe("author-year");
    });
    it("tie breaks toward numeric (precision over recall)", () => {
        expect(voteScheme(5, 5, 0)).toBe("numeric");
    });
    it("returns null when nothing meets threshold", () => {
        expect(voteScheme(0, 0, 2)).toBe(null);
    });
});

describe("dominant-scheme vote (fixtures)", () => {
    it("IEEE numeric paper → numeric", () => {
        expect(
            new DocumentCitationDetector(fixtures.numeric).dominantScheme
        ).toBe("numeric");
    });
    it("ACM author-year paper → author-year", () => {
        expect(
            new DocumentCitationDetector(fixtures.authorYear).dominantScheme
        ).toBe("author-year");
    });
    it("superscript paper → superscript", () => {
        expect(
            new DocumentCitationDetector(fixtures.superscript).dominantScheme
        ).toBe("superscript");
    });
    it("references-section bracket labels do NOT distort the vote", () => {
        // 4 author-year body cites vs 8 bracketed reference labels (excluded).
        expect(
            new DocumentCitationDetector(fixtures.mixed).dominantScheme
        ).toBe("author-year");
    });
});
