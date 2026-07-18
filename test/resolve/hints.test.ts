import { describe, it, expect } from "vitest";
import {
    extractDoi,
    extractYear,
    extractTitle,
    extractAuthors,
} from "../../src/citations/resolve/hints";

describe("hint extraction (§5.4)", () => {
    it("extracts a DOI and strips trailing punctuation", () => {
        expect(extractDoi("... doi:10.1109/5.771073.")).toBe(
            "10.1109/5.771073"
        );
        expect(extractDoi("https://doi.org/10.1145/1234567.8901234")).toBe(
            "10.1145/1234567.8901234"
        );
    });
    it("returns undefined when no DOI present", () => {
        expect(extractDoi("no identifier here")).toBeUndefined();
    });
    it("extracts a plausible year", () => {
        expect(extractYear("Published in 2019 somewhere")).toBe(2019);
        expect(extractYear("no year")).toBeUndefined();
    });
    it("prefers a quoted title", () => {
        expect(extractTitle('Smith, J. "A great result" Journal 2020')).toBe(
            "A great result"
        );
    });
    it("falls back to the longest sentence-cased span", () => {
        const t = "Smith, J. Establishing the method with rigor. ACM 2021.";
        expect(extractTitle(t)).toBe("Establishing the method with rigor");
    });
    it("extracts leading Surname, I. author sequences", () => {
        const authors = extractAuthors(
            "Smith, J., Doe, K., and Roe, L. (2021). Title."
        );
        expect(authors).toEqual(["Smith", "Doe", "Roe"]);
    });
    it("returns undefined when no leading author sequence", () => {
        expect(
            extractAuthors("A wild sentence with no authors.")
        ).toBeUndefined();
    });
});
