import { describe, it, expect } from "vitest";
import { findSuperscriptRuns } from "../../src/citations/detect/superscript";
import { concatPage } from "../../src/citations/detect/text";
import type { TextItem } from "../../src/citations/types";
import { fixtures } from "../fixtures/loader";

function item(str: string, x: number, y: number, size: number): TextItem {
  return {
    str,
    transform: [size, 0, 0, size, x, y],
    width: str.length * size * 0.5,
    height: size,
    fontName: size < 8 ? "sup" : "body",
    dir: "ltr",
  };
}

describe("superscript detection (fixture)", () => {
  const page = fixtures.superscript[0]!;
  const { itemStarts } = concatPage(page.items);
  const runs = findSuperscriptRuns(page.items, itemStarts);

  it("detects each superscript run and expands ordinals", () => {
    expect(runs.map((r) => r.ordinals)).toEqual([[1], [2, 3], [4]]);
  });

  it("groups adjacent digits/commas into one marker (2,3)", () => {
    const grouped = runs.find((r) => r.rawText === "2,3");
    expect(grouped).toBeTruthy();
    expect(grouped!.ordinals).toEqual([2, 3]);
  });

  it("rejects same-size body numbers (the '42')", () => {
    const all = runs.flatMap((r) => r.ordinals);
    expect(all).not.toContain(42);
  });
});

describe("superscript detection (synthetic geometry)", () => {
  it("rejects a small digit that is NOT raised above the body baseline", () => {
    const items: TextItem[] = [
      item("Body", 72, 700, 10),
      item("text", 110, 700, 10),
      item("5", 150, 700, 6), // small but same baseline → not superscript
    ];
    const { itemStarts } = concatPage(items);
    expect(findSuperscriptRuns(items, itemStarts)).toHaveLength(0);
  });

  it("accepts a small digit raised above the body baseline", () => {
    const items: TextItem[] = [
      item("Body", 72, 700, 10),
      item("text", 110, 700, 10),
      item("5", 150, 703, 6), // small + raised → superscript
    ];
    const { itemStarts } = concatPage(items);
    const runs = findSuperscriptRuns(items, itemStarts);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.ordinals).toEqual([5]);
  });

  it("rejects a raised same-size digit (not small enough)", () => {
    const items: TextItem[] = [
      item("Body", 72, 700, 10),
      item("9", 110, 703, 10), // raised but full size
    ];
    const { itemStarts } = concatPage(items);
    expect(findSuperscriptRuns(items, itemStarts)).toHaveLength(0);
  });
});
