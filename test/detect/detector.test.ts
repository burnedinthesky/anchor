import { describe, it, expect } from "vitest";
import { DocumentCitationDetector } from "../../src/citations/detect/index";
import type { CitationMarker } from "../../src/citations/types";
import { fixtures, makeViewport } from "../fixtures/loader";

const vp = makeViewport();

function allMarkers(pages: (typeof fixtures)["numeric"]): CitationMarker[] {
  const det = new DocumentCitationDetector(pages);
  return pages.flatMap((pg, i) => det.detect(i + 1, pg, vp));
}

describe("DocumentCitationDetector — numeric fixture (acceptance row 1, local half)", () => {
  const det = new DocumentCitationDetector(fixtures.numeric);

  it("overlays numeric markers on the body page", () => {
    const m = det.detect(1, fixtures.numeric[0]!, vp);
    const ids = new Set(m.map((x) => x.id));
    expect(ids.size).toBe(4); // [1], [3,5-7], [3]-[5], [2]
    expect(m.every((x) => x.scheme === "numeric")).toBe(true);
  });

  it("excludes the references page from overlays", () => {
    expect(det.detect(2, fixtures.numeric[1]!, vp)).toHaveLength(0);
  });

  it("gives stable deterministic ids of the form p{page}#{startChar}", () => {
    const m = det.detect(1, fixtures.numeric[0]!, vp);
    expect(m[0]!.id).toMatch(/^p1#\d+$/);
    // re-running yields identical ids
    const again = det.detect(1, fixtures.numeric[0]!, vp);
    expect(again.map((x) => x.id)).toEqual(m.map((x) => x.id));
  });

  it("carries expanded ordinals through the marker", () => {
    const m = det.detect(1, fixtures.numeric[0]!, vp);
    const list = m.find((x) => x.rawText.includes("5"));
    expect(list!.ordinals).toEqual([3, 5, 6, 7]);
    expect(list!.ordinal).toBe(3);
  });
});

describe("DocumentCitationDetector — author-year fixture (acceptance row 2, local half)", () => {
  it("detects parenthetical, narrative and multi-cite markers", () => {
    const m = allMarkers(fixtures.authorYear);
    const keys = new Set(m.map((x) => `${x.authorKey}|${x.year}`));
    expect(keys.has("smith|2021")).toBe(true);
    expect(keys.has("gomez|2020")).toBe(true);
    expect(keys.has("jones|2021")).toBe(true);
    expect(keys.has("brown|2020")).toBe(true);
  });
});

describe("DocumentCitationDetector — superscript fixture (acceptance row 3, local half)", () => {
  it("detects superscript digit runs as markers", () => {
    const m = allMarkers(fixtures.superscript);
    expect(m.every((x) => x.scheme === "superscript")).toBe(true);
    expect(m.map((x) => x.ordinal)).toEqual([1, 2, 4]);
  });
});

describe("DocumentCitationDetector — multi-item / wrapped span", () => {
  it("emits multiple rects sharing one id for a line-wrapped cite", () => {
    const det = new DocumentCitationDetector(fixtures.wrap);
    const m = det.detect(1, fixtures.wrap[0]!, vp);
    const wrapped = m.filter((x) => x.authorKey === "smith" && x.year === 2021);
    expect(wrapped.length).toBe(2); // one rect per line segment
    expect(new Set(wrapped.map((x) => x.id)).size).toBe(1); // same id
    // the two rects sit on different visual lines (different y)
    expect(wrapped[0]!.rect.y).not.toBeCloseTo(wrapped[1]!.rect.y, 1);
  });
});
