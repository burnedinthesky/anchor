/**
 * Superscript-numeric citation detection (spec §4.2 scheme 2).
 * A run is superscript when its glyphs are notably smaller than the local body
 * font (< ~0.8× median) AND its baseline is raised above the nearest body
 * baseline. Adjacent superscript digit/comma items merge into one marker.
 */
import type { TextItem } from "../types";
import { fontHeight } from "./geometry";
import { medianFontSize } from "./text";
import { expandOrdinals } from "./numeric";

export interface SuperRun {
  /** Char index (in concatenated page text) where the run begins. */
  start: number;
  /** Char index where the run ends (exclusive). */
  end: number;
  itemIndices: number[];
  ordinals: number[];
  rawText: string;
}

const DIGITS_ONLY = /^[\d.,\s]+$/;

export function findSuperscriptRuns(
  items: TextItem[],
  itemStarts: number[]
): SuperRun[] {
  const med = medianFontSize(items) || 10;

  // Distinct body baselines (from full-size, non-empty items).
  const bodyBaselines = [
    ...new Set(
      items
        .filter((it) => fontHeight(it) >= 0.85 * med && it.str.trim().length > 0)
        .map((it) => it.transform[5] ?? 0)
    ),
  ].sort((a, b) => a - b);

  const isCand = (it: TextItem): boolean => {
    const s = it.str;
    if (!/\d/.test(s)) return false;
    if (!DIGITS_ONLY.test(s)) return false;
    if (fontHeight(it) >= 0.8 * med) return false;
    const f = it.transform[5] ?? 0;
    let base = -Infinity;
    for (const b of bodyBaselines) {
      if (b <= f) base = b;
      else break;
    }
    if (base === -Infinity) return false;
    const d = f - base;
    return d > 0.1 * med && d < 0.9 * med;
  };

  const runs: SuperRun[] = [];
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (!it || !isCand(it)) {
      i++;
      continue;
    }
    const indices: number[] = [i];
    let combined = it.str;
    let baseline = it.transform[5] ?? 0;
    let j = i + 1;
    while (j < items.length) {
      const nxt = items[j];
      if (!nxt || !isCand(nxt)) break;
      if (Math.abs((nxt.transform[5] ?? 0) - baseline) > 0.5 * med) break;
      indices.push(j);
      combined += nxt.str;
      baseline = nxt.transform[5] ?? 0;
      j++;
    }
    const ordinals = expandOrdinals(combined);
    if (ordinals.length > 0) {
      const firstIdx = indices[0] ?? i;
      const lastIdx = indices[indices.length - 1] ?? i;
      const lastItem = items[lastIdx];
      const start = itemStarts[firstIdx] ?? 0;
      const end = (itemStarts[lastIdx] ?? 0) + (lastItem ? lastItem.str.length : 0);
      runs.push({ start, end, itemIndices: indices, ordinals, rawText: combined.trim() });
    }
    i = j;
  }
  return runs;
}
