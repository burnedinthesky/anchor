/**
 * Document-level dominant-scheme detector (spec §4).
 *
 * Constructed with ALL pages' text content. It counts citation matches per
 * scheme across the document (excluding the reference block so bracketed
 * reference labels don't skew the vote), picks the single dominant scheme
 * (precision over recall), then `detect()` returns only that scheme's markers
 * for a given page.
 */
import type {
  CitationDetector,
  CitationMarker,
  CitationScheme,
  PDFTextContent,
  ViewportLike,
} from "../types";
import { concatPage } from "./text";
import { rectsForSpan } from "./geometry";
import { findNumericMatches, type RawMatch } from "./numeric";
import { findAuthorYearMatches } from "./authorYear";
import { findSuperscriptRuns } from "./superscript";
import { findReferencesSection } from "./section";

/** author-year needs at least this many hits to beat numeric noise. */
const MIN_AUTHOR_YEAR = 3;

const PRIORITY: Record<CitationScheme, number> = {
  numeric: 0,
  superscript: 1,
  "author-year": 2,
};

export function voteScheme(
  numeric: number,
  superscript: number,
  authorYear: number
): CitationScheme | null {
  const cands: [CitationScheme, number][] = [];
  if (numeric > 0) cands.push(["numeric", numeric]);
  if (superscript > 0) cands.push(["superscript", superscript]);
  if (authorYear >= MIN_AUTHOR_YEAR) cands.push(["author-year", authorYear]);
  if (cands.length === 0) return null;
  cands.sort((a, b) => b[1] - a[1] || PRIORITY[a[0]] - PRIORITY[b[0]]);
  return cands[0]![0];
}

export class DocumentCitationDetector implements CitationDetector {
  private readonly scheme: CitationScheme | null;
  private readonly refBoundary: { pageNumber: number; charIndex: number } | null;

  constructor(pages: PDFTextContent[]) {
    const rb = findReferencesSection(pages);
    if (rb) {
      const refPage = pages[rb.pageIndex];
      const pt = refPage ? concatPage(refPage.items) : null;
      this.refBoundary = {
        pageNumber: rb.pageIndex + 1,
        charIndex: pt ? pt.itemStarts[rb.firstItem] ?? pt.text.length : 0,
      };
    } else {
      this.refBoundary = null;
    }

    let numeric = 0;
    let superscript = 0;
    let authorYear = 0;
    for (let p = 0; p < pages.length; p++) {
      const page = pages[p];
      if (!page) continue;
      const pageNumber = p + 1;
      const { text, itemStarts } = concatPage(page.items);
      const limit = this.charLimit(pageNumber, text.length);
      if (limit <= 0) continue;
      numeric += findNumericMatches(text).filter((m) => m.start < limit).length;
      authorYear += findAuthorYearMatches(text).filter((m) => m.start < limit).length;
      superscript += findSuperscriptRuns(page.items, itemStarts).filter(
        (r) => r.start < limit
      ).length;
    }
    this.scheme = voteScheme(numeric, superscript, authorYear);
  }

  /** The scheme chosen for the whole document (null if none met threshold). */
  get dominantScheme(): CitationScheme | null {
    return this.scheme;
  }

  private charLimit(pageNumber: number, textLen: number): number {
    if (!this.refBoundary) return textLen;
    if (pageNumber < this.refBoundary.pageNumber) return textLen;
    if (pageNumber === this.refBoundary.pageNumber) return this.refBoundary.charIndex;
    return 0;
  }

  detect(page: number, text: PDFTextContent, viewport: ViewportLike): CitationMarker[] {
    if (!this.scheme) return [];
    const items = text.items;
    const { text: concat, map, itemStarts } = concatPage(items);
    const limit = this.charLimit(page, concat.length);
    if (limit <= 0) return [];

    const markers: CitationMarker[] = [];

    if (this.scheme === "superscript") {
      for (const run of findSuperscriptRuns(items, itemStarts)) {
        if (run.start >= limit) continue;
        const id = `p${page}#${run.start}`;
        const rects = rectsForSpan(run.start, run.end, map, items, viewport);
        for (const rect of rects) {
          markers.push({
            id,
            page,
            scheme: "superscript",
            rawText: run.rawText,
            rect,
            ordinal: run.ordinals[0],
            ordinals: run.ordinals,
          });
        }
      }
      return markers;
    }

    const raw: RawMatch[] =
      this.scheme === "numeric"
        ? findNumericMatches(concat)
        : findAuthorYearMatches(concat);

    for (const rm of raw) {
      if (rm.start >= limit) continue;
      const id = `p${page}#${rm.start}`;
      const rects = rectsForSpan(rm.start, rm.end, map, items, viewport);
      for (const rect of rects) {
        const marker: CitationMarker = {
          id,
          page,
          scheme: rm.scheme,
          rawText: rm.rawText,
          rect,
        };
        if (rm.ordinal !== undefined) marker.ordinal = rm.ordinal;
        if (rm.ordinals !== undefined) marker.ordinals = rm.ordinals;
        if (rm.authorKey !== undefined) marker.authorKey = rm.authorKey;
        if (rm.year !== undefined) marker.year = rm.year;
        markers.push(marker);
      }
    }
    return markers;
  }
}
