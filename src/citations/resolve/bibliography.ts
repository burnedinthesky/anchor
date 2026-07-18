/**
 * Stage 2 — reference resolution (spec §5).
 *
 *   const resolver = new BibliographyResolver(allPagesTextContent);
 *   const ref = resolver.resolve(marker); // ResolvedReference | null
 */
import type {
  PDFTextContent,
  CitationMarker,
  ReferenceResolver,
  ResolvedReference,
} from "../types";
import { assembleLines, type Line } from "../detect/text";
import { findReferencesSection } from "../detect/section";
import { firstSurname, normalizeSurname } from "../detect/authorKey";
import { extractDoi, extractTitle, extractAuthors, extractYear } from "./hints";

const NUMBERED_START = /^\s*(?:\[(\d+)\]|(\d+)[.)])\s+/;
const YEAR_SUFFIX = /(?:18|19|20)\d{2}([a-z])\b/;

interface AuthorYearEntry {
  text: string;
  surname: string;
  year: number;
  suffix: string | null;
}

export class BibliographyResolver implements ReferenceResolver {
  private readonly hasSection: boolean;
  private readonly numberedMap = new Map<number, string>();
  private numberedCount = 0;
  private readonly byKey = new Map<string, string[]>();
  private readonly bySuffix = new Map<string, string>();

  constructor(pages: PDFTextContent[]) {
    const rb = findReferencesSection(pages);
    this.hasSection = rb !== null;
    if (!rb) return;

    const refLines = this.collectRefLines(pages, rb.pageIndex, rb.firstItem);
    if (!this.segmentNumbered(refLines)) {
      this.segmentAuthorYear(refLines);
    }
  }

  /** Lines from the reference heading (exclusive) to the end of the document. */
  private collectRefLines(
    pages: PDFTextContent[],
    pageIndex: number,
    firstItem: number
  ): Line[] {
    const lines: Line[] = [];
    for (let p = pageIndex; p < pages.length; p++) {
      const page = pages[p];
      if (!page) continue;
      for (const line of assembleLines(page.items)) {
        if (p === pageIndex && line.firstItem <= firstItem) continue; // skip heading + preamble
        lines.push(line);
      }
    }
    return lines;
  }

  /** Returns true if the block is a numbered list and was consumed as such. */
  private segmentNumbered(lines: Line[]): boolean {
    const entries: { ordinal: number; text: string }[] = [];
    let cur: { ordinal: number; text: string } | null = null;
    for (const line of lines) {
      const t = line.text.trim();
      const m = t.match(NUMBERED_START);
      if (m) {
        const ord = Number(m[1] ?? m[2]);
        cur = { ordinal: ord, text: t.replace(NUMBERED_START, "") };
        entries.push(cur);
      } else if (cur) {
        cur.text += " " + t;
      }
    }
    if (entries.length < 2) return false;

    for (const e of entries) {
      this.numberedMap.set(e.ordinal, e.text.trim());
    }
    this.numberedCount = entries.length;
    return true;
  }

  /** Split unnumbered refs on hanging-indent boundaries and index by author/year. */
  private segmentAuthorYear(lines: Line[]): void {
    if (lines.length === 0) return;
    const flushX = Math.min(...lines.map((l) => l.x));
    const med = 10; // reference tolerance in PDF units
    const tol = med * 0.6;

    const blocks: string[] = [];
    let cur: string | null = null;
    for (const line of lines) {
      const isStart = line.x <= flushX + tol;
      if (isStart || cur === null) {
        cur = line.text.trim();
        blocks.push(cur);
      } else {
        cur += " " + line.text.trim();
        blocks[blocks.length - 1] = cur;
      }
    }

    for (const text of blocks) {
      const entry = this.parseAuthorYearEntry(text);
      if (!entry) continue;
      const key = `${entry.surname}|${entry.year}`;
      const arr = this.byKey.get(key);
      if (arr) arr.push(text);
      else this.byKey.set(key, [text]);
      if (entry.suffix) this.bySuffix.set(`${key}${entry.suffix}`, text);
    }
  }

  private parseAuthorYearEntry(text: string): AuthorYearEntry | null {
    const sn = firstSurname(text);
    const year = extractYear(text);
    if (!sn || year === undefined) return null;
    const sm = text.match(YEAR_SUFFIX);
    return {
      text,
      surname: normalizeSurname(sn),
      year,
      suffix: sm ? sm[1] ?? null : null,
    };
  }

  resolve(marker: CitationMarker): ResolvedReference | null {
    if (marker.scheme === "numeric" || marker.scheme === "superscript") {
      return this.resolveNumeric(marker);
    }
    return this.resolveAuthorYear(marker);
  }

  private resolveNumeric(marker: CitationMarker): ResolvedReference | null {
    if (!this.hasSection) return null;
    const ord = marker.ordinal;
    if (ord === undefined) return null;
    if (ord < 1 || ord > this.numberedCount) return null;
    const text = this.numberedMap.get(ord);
    if (text === undefined) return null;
    return this.build(marker, text);
  }

  private resolveAuthorYear(marker: CitationMarker): ResolvedReference | null {
    if (!this.hasSection) {
      // Fallback: build a reference from the marker text itself (spec §5.1).
      const authors = marker.authorKey ? [capitalize(marker.authorKey)] : undefined;
      return {
        markerId: marker.id,
        rawText: marker.rawText,
        hints: { ...(authors ? { authors } : {}), ...(marker.year ? { year: marker.year } : {}) },
      };
    }

    const key = `${marker.authorKey}|${marker.year}`;
    const suffix = markerSuffix(marker.rawText);
    if (suffix) {
      const e = this.bySuffix.get(`${key}${suffix}`);
      if (e) return this.build(marker, e);
    }
    const arr = this.byKey.get(key);
    if (arr && arr.length > 0) return this.build(marker, arr[0]!);
    return null;
  }

  private build(marker: CitationMarker, rawText: string): ResolvedReference {
    let doi: string | undefined;
    let title: string | undefined;
    let authors: string[] | undefined;
    let year: number | undefined;
    try {
      doi = extractDoi(rawText);
    } catch {
      /* hints are best-effort */
    }
    try {
      title = extractTitle(rawText);
    } catch {
      /* best-effort */
    }
    try {
      authors = extractAuthors(rawText);
    } catch {
      /* best-effort */
    }
    try {
      year = extractYear(rawText);
    } catch {
      /* best-effort */
    }
    if (year === undefined && marker.year !== undefined) year = marker.year;

    const hints: ResolvedReference["hints"] = {};
    if (title !== undefined) hints.title = title;
    if (authors !== undefined) hints.authors = authors;
    if (year !== undefined) hints.year = year;

    const ref: ResolvedReference = {
      markerId: marker.id,
      rawText: rawText.trim(),
      hints,
    };
    if (doi !== undefined) ref.doi = doi;
    return ref;
  }
}

function markerSuffix(rawText: string): string | null {
  const m = rawText.match(YEAR_SUFFIX);
  return m ? m[1] ?? null : null;
}

function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
