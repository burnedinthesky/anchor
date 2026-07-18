/**
 * Stage 1 geometry helpers (spec §4.3).
 *
 * Maps a matched character span (in the per-page concatenated text) back to
 * one or more viewport-space rectangles sitting over the actual glyphs.
 */
import type { TextItem, ViewportLike } from "../types";
import type { CharPos } from "./text";

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Font size (glyph height) of an item, derived from its transform scale. */
export function fontHeight(item: TextItem): number {
    const b = item.transform[1] ?? 0;
    const d = item.transform[3] ?? 0;
    const h = Math.hypot(b, d);
    if (h > 0) return h;
    return item.height && item.height > 0 ? item.height : 0;
}

/** Horizontal (x-axis) scale magnitude of an item's transform. */
export function fontWidthScale(item: TextItem): number {
    const a = item.transform[0] ?? 0;
    const c = item.transform[2] ?? 0;
    const w = Math.hypot(a, c);
    return w > 0 ? w : fontHeight(item);
}

/**
 * Compute the viewport rect for a single item substring [offStart, offEnd)
 * (character offsets within `item.str`). Handles the PDF→viewport y-flip by
 * transforming two opposite corners and normalising to a top-left rect with
 * positive width/height.
 */
export function rectForItemSpan(
    item: TextItem,
    offStart: number,
    offEnd: number,
    viewport: ViewportLike
): Rect {
    const len = item.str.length || 1;
    const e = item.transform[4] ?? 0;
    const f = item.transform[5] ?? 0;
    const width = item.width;
    const size = fontHeight(item);
    const h = item.height && item.height > 0 ? item.height : size;

    // Per-char advance ≈ width / str.length (spec §4.3).
    const x0 = e + (offStart / len) * width;
    const x1 = e + (offEnd / len) * width;
    // Baseline is at f; glyphs extend up by the font height (PDF y grows up).
    const yBottom = f;
    const yTop = f + h;

    const [ax, ay] = viewport.convertToViewportPoint(x0, yBottom);
    const [bx, by] = viewport.convertToViewportPoint(x1, yTop);

    return {
        x: Math.min(ax, bx),
        y: Math.min(ay, by),
        w: Math.abs(bx - ax),
        h: Math.abs(by - ay),
    };
}

/**
 * Compute viewport rects for a char span [start,end) of the concatenated page
 * text. A span that crosses multiple items (line wrap / split tokens) yields
 * one rect per contiguous run of characters within the same item. Synthetic
 * separator characters (itemIndex < 0) are skipped.
 */
export function rectsForSpan(
    start: number,
    end: number,
    map: CharPos[],
    items: TextItem[],
    viewport: ViewportLike
): Rect[] {
    const rects: Rect[] = [];
    let curItem = -1;
    let segStart = -1;
    let segEnd = -1;

    const flush = () => {
        if (curItem < 0) return;
        const item = items[curItem];
        if (!item) return;
        rects.push(rectForItemSpan(item, segStart, segEnd, viewport));
    };

    for (let i = start; i < end; i++) {
        const cp = map[i];
        if (!cp || cp.itemIndex < 0) continue;
        if (cp.itemIndex === curItem && cp.offsetInItem === segEnd) {
            segEnd = cp.offsetInItem + 1;
        } else {
            flush();
            curItem = cp.itemIndex;
            segStart = cp.offsetInItem;
            segEnd = cp.offsetInItem + 1;
        }
    }
    flush();
    return rects;
}
