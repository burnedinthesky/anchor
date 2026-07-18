import { describe, it, expect } from "vitest";
import { concatPage } from "../../src/citations/detect/text";
import {
    rectsForSpan,
    rectForItemSpan,
} from "../../src/citations/detect/geometry";
import { findNumericMatches } from "../../src/citations/detect/numeric";
import type { TextItem } from "../../src/citations/types";
import { makeViewport } from "../fixtures/loader";

const vp = makeViewport(1.5, 792);

describe("concatenation dehyphenation", () => {
    it('joins hyphen-wrapped words across lines ("Tou-" + "vron" -> "Touvron") with a valid map', () => {
        const items: TextItem[] = [
            {
                str: "models (Tou-",
                transform: [10, 0, 0, 10, 100, 730],
                width: 60,
                height: 10,
                fontName: "b",
                dir: "ltr",
                hasEOL: true,
            },
            {
                str: "vron et al., 2023) show",
                transform: [10, 0, 0, 10, 72, 712],
                width: 115,
                height: 10,
                fontName: "b",
                dir: "ltr",
            },
        ];
        const { text, map } = concatPage(items);
        expect(text).toContain("Touvron et al., 2023");
        // The map stays aligned: every char of "vron" points at item 1.
        const v = text.indexOf("vron");
        expect(map[v]).toEqual({ itemIndex: 1, offsetInItem: 0 });
        expect(map.length).toBe(text.length);
    });

    it("keeps the hyphen when the continuation starts uppercase (real compound)", () => {
        const items: TextItem[] = [
            {
                str: "the Wilson-",
                transform: [10, 0, 0, 10, 100, 730],
                width: 55,
                height: 10,
                fontName: "b",
                dir: "ltr",
                hasEOL: true,
            },
            {
                str: "Cowan model",
                transform: [10, 0, 0, 10, 72, 712],
                width: 55,
                height: 10,
                fontName: "b",
                dir: "ltr",
            },
        ];
        const { text } = concatPage(items);
        expect(text).toContain("Wilson-\nCowan");
    });
});

describe("geometry mapping (§4.3)", () => {
    it("maps a single-item [1] rect with correct y-flip and size", () => {
        // "[1]" 3 chars, size 10, baseline y=730, x=100.
        const items: TextItem[] = [
            {
                str: "[1]",
                transform: [10, 0, 0, 10, 100, 730],
                width: 15,
                height: 10,
                fontName: "b",
                dir: "ltr",
            },
        ];
        const { text, map } = concatPage(items);
        const m = findNumericMatches(text)[0]!;
        const rects = rectsForSpan(m.start, m.end, map, items, vp);
        expect(rects).toHaveLength(1);
        const r = rects[0]!;
        // x = 100*1.5 = 150; width = 15*1.5 = 22.5
        expect(r.x).toBeCloseTo(150, 5);
        expect(r.w).toBeCloseTo(22.5, 5);
        // y-flip: top corner = (792-(730+10))*1.5 = 78; h = 10*1.5 = 15
        expect(r.y).toBeCloseTo(78, 5);
        expect(r.h).toBeCloseTo(15, 5);
    });

    it("produces a top-left rect with positive w/h regardless of PDF y-up", () => {
        const item: TextItem = {
            str: "abc",
            transform: [10, 0, 0, 10, 50, 500],
            width: 15,
            height: 10,
            fontName: "b",
            dir: "ltr",
        };
        const r = rectForItemSpan(item, 0, 3, vp);
        expect(r.w).toBeGreaterThan(0);
        expect(r.h).toBeGreaterThan(0);
        // Higher PDF-y ⇒ smaller viewport-y (flip).
        const low = rectForItemSpan(
            { ...item, transform: [10, 0, 0, 10, 50, 100] },
            0,
            3,
            vp
        );
        expect(r.y).toBeLessThan(low.y);
    });

    it("emits one rect per item for a span crossing multiple items", () => {
        const items: TextItem[] = [
            {
                str: "[3]",
                transform: [10, 0, 0, 10, 100, 700],
                width: 15,
                height: 10,
                fontName: "b",
                dir: "ltr",
            },
            {
                str: "–",
                transform: [10, 0, 0, 10, 120, 700],
                width: 5,
                height: 10,
                fontName: "b",
                dir: "ltr",
            },
            {
                str: "[5]",
                transform: [10, 0, 0, 10, 130, 700],
                width: 15,
                height: 10,
                fontName: "b",
                dir: "ltr",
            },
        ];
        const { text, map } = concatPage(items);
        const m = findNumericMatches(text)[0]!;
        expect(m.ordinals).toEqual([3, 4, 5]);
        const rects = rectsForSpan(m.start, m.end, map, items, vp);
        expect(rects.length).toBe(3);
    });

    it("computes a fractional sub-span rect within one item", () => {
        // "AB[7]" — the "[7]" occupies the last 3 of 5 chars.
        const items: TextItem[] = [
            {
                str: "AB[7]",
                transform: [10, 0, 0, 10, 0, 700],
                width: 50,
                height: 10,
                fontName: "b",
                dir: "ltr",
            },
        ];
        const { text, map } = concatPage(items);
        const m = findNumericMatches(text)[0]!;
        const rects = rectsForSpan(m.start, m.end, map, items, vp);
        // offset 2..5 of width 50 ⇒ x from (2/5*50)=20 to 50, scaled ×1.5.
        expect(rects[0]!.x).toBeCloseTo(30, 5);
        expect(rects[0]!.w).toBeCloseTo(45, 5);
    });
});
