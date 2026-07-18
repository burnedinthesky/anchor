/**
 * Per-page text concatenation and line assembly (spec §4.3 step 1).
 *
 * Concatenation rules (deliberate, documented so regexes behave predictably):
 *   - Characters of every TextItem.str are appended in item order; a parallel
 *     `map` records, for each output character, which item it came from and the
 *     offset within that item's str. Synthetic separators map to
 *     {itemIndex:-1, offsetInItem:-1} and are ignored by geometry.
 *   - Separator inserted BETWEEN two consecutive items:
 *       • prev.hasEOL              → "\n"
 *       • baseline delta > 0.5·med → "\n"   (new visual line even without EOL)
 *       • prev ends / next starts with whitespace → ""   (already spaced)
 *       • horizontal gap > 0.25·med → " "   (word boundary within a line)
 *       • otherwise                → ""     (glyphs abut, e.g. "[" "12" "]")
 *   where `med` is the page's median font size. Newlines keep unrelated lines
 *   (and, in practice, most multi-column runs) from fusing into one token while
 *   still letting `\s`-tolerant citation regexes span a genuine line wrap.
 */
import type { TextItem, PDFTextContent } from "../types";
import { fontHeight } from "./geometry";

export interface CharPos {
  itemIndex: number;
  offsetInItem: number;
}

export interface PageText {
  /** Concatenated page text. */
  text: string;
  /** map[i] describes the source of text[i]. */
  map: CharPos[];
  /** itemStarts[k] = char index at which items[k] begins in `text`. */
  itemStarts: number[];
}

/** Median font size over "body-ish" items (str length ≥ 2); falls back to all. */
export function medianFontSize(items: TextItem[]): number {
  const pick = (filter: (it: TextItem) => boolean) =>
    items
      .filter(filter)
      .map(fontHeight)
      .filter((h) => h > 0)
      .sort((a, b) => a - b);
  let sizes = pick((it) => it.str.trim().length >= 2);
  if (sizes.length === 0) sizes = pick(() => true);
  if (sizes.length === 0) return 0;
  const mid = Math.floor(sizes.length / 2);
  if (sizes.length % 2 === 1) return sizes[mid] ?? 0;
  return ((sizes[mid - 1] ?? 0) + (sizes[mid] ?? 0)) / 2;
}

function separatorBetween(prev: TextItem, cur: TextItem, med: number): string {
  if (prev.hasEOL) return "\n";
  const pf = prev.transform[5] ?? 0;
  const cf = cur.transform[5] ?? 0;
  if (Math.abs(pf - cf) > 0.5 * med) return "\n";
  if (/\s$/.test(prev.str) || /^\s/.test(cur.str)) return "";
  const pRight = (prev.transform[4] ?? 0) + prev.width;
  const cLeft = cur.transform[4] ?? 0;
  if (cLeft - pRight > 0.25 * med) return " ";
  return "";
}

export function concatPage(items: TextItem[]): PageText {
  let text = "";
  const map: CharPos[] = [];
  const itemStarts: number[] = new Array(items.length).fill(0);
  const med = medianFontSize(items) || 10;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    if (i > 0) {
      const prev = items[i - 1];
      if (prev) {
        const sep = separatorBetween(prev, item, med);
        for (let s = 0; s < sep.length; s++) {
          text += sep.charAt(s);
          map.push({ itemIndex: -1, offsetInItem: -1 });
        }
      }
    }
    itemStarts[i] = text.length;
    const str = item.str;
    for (let k = 0; k < str.length; k++) {
      text += str.charAt(k);
      map.push({ itemIndex: i, offsetInItem: k });
    }
  }
  return { text, map, itemStarts };
}

export interface Line {
  /** Assembled (space-joined) text of the line. */
  text: string;
  /** Global item indices comprising the line, in order. */
  itemIndices: number[];
  /** Left edge (min x) of the line in PDF user space. */
  x: number;
  /** Baseline y of the line in PDF user space. */
  y: number;
  /** Index of the first item on the line. */
  firstItem: number;
}

/** Group items into visual lines using the same break rule as concatenation. */
export function assembleLines(items: TextItem[]): Line[] {
  const med = medianFontSize(items) || 10;
  const lines: Line[] = [];
  let cur: Line | null = null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const f = item.transform[5] ?? 0;
    const x = item.transform[4] ?? 0;

    let brk = cur === null;
    if (cur) {
      const prevIdx = cur.itemIndices[cur.itemIndices.length - 1];
      const prev = prevIdx === undefined ? undefined : items[prevIdx];
      if (prev) {
        if (prev.hasEOL) brk = true;
        else if (Math.abs((prev.transform[5] ?? 0) - f) > 0.5 * med) brk = true;
      }
    }

    if (brk || !cur) {
      cur = { text: "", itemIndices: [], x, y: f, firstItem: i };
      lines.push(cur);
    } else {
      const prevIdx = cur.itemIndices[cur.itemIndices.length - 1];
      const prev = prevIdx === undefined ? undefined : items[prevIdx];
      if (prev) {
        const sep = separatorBetween(prev, item, med);
        cur.text += sep === "\n" ? " " : sep;
      }
      cur.x = Math.min(cur.x, x);
    }
    cur.text += item.str;
    cur.itemIndices.push(i);
  }

  return lines;
}
