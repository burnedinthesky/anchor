import { describe, it, expect } from "vitest";
import { findAuthorYearMatches } from "../../src/citations/detect/authorYear";
import { normalizeSurname, firstSurname } from "../../src/citations/detect/authorKey";

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
    expect(keys("As shown by Smith et al. (2021), results improve")).toEqual([
      "smith|2021",
    ]);
  });

  it("narrative Smith and Jones (2021)", () => {
    expect(keys("Smith and Jones (2021) argue")).toEqual(["smith|2021"]);
  });

  it("multi-cite (Smith, 2020; Jones, 2021) → two markers", () => {
    expect(keys("(Smith, 2020; Jones, 2021)")).toEqual(["smith|2020", "jones|2021"]);
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

  it("keeps distinct year suffixes visible in rawText", () => {
    const m = findAuthorYearMatches("(Brown, 2020a) and (Brown, 2020b)");
    expect(m).toHaveLength(2);
    expect(m[0]!.rawText).toContain("2020a");
    expect(m[1]!.rawText).toContain("2020b");
    // both normalise to the same base key
    expect(m.map((x) => `${x.authorKey}|${x.year}`)).toEqual(["brown|2020", "brown|2020"]);
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
