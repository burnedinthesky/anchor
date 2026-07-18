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
import { normalizeSurname } from "../detect/authorKey";
import { extractDoi, extractTitle, extractAuthors, extractYear } from "./hints";

const NUMBERED_START = /^\s*(?:\[(\d+)\]|(\d+)[.)])\s+/;
const YEAR_SUFFIX = /(?:18|19|20)\d{2}([a-z])\b/;

/** Connectives/particles that appear between author names but are not surnames. */
const AUTHOR_STOPWORDS = new Set(["and", "et", "al", "eds", "ed", "in", "the"]);

interface AuthorYearEntry {
    text: string;
    surnames: string[];
    year: number;
    suffix: string | null;
}

/** Cluster sorted values whose neighbors are within `gap`; return each cluster's minimum. */
function clusterMins(values: number[], gap: number): number[] {
    const sorted = [...values].sort((a, b) => a - b);
    const mins: number[] = [];
    let prev: number | null = null;
    for (const v of sorted) {
        if (prev === null || v - prev > gap) mins.push(v);
        prev = v;
    }
    return mins;
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

        const refLines = this.collectRefLines(
            pages,
            rb.pageIndex,
            rb.firstItem
        );
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
        // Sanity: genuine numbered bibliographies start at 1 and are dense.
        // Without this, author-year entries whose wrapped lines start with a
        // year ("2016. A sequence-to-sequence model...") masquerade as a
        // sparse numbered list with ordinals like 2016 and swallow the block.
        const ords = entries.map((e) => e.ordinal);
        const maxOrd = Math.max(...ords);
        if (
            Math.min(...ords) !== 1 ||
            maxOrd > 999 ||
            entries.length < maxOrd / 2
        ) {
            return false;
        }

        for (const e of entries) {
            this.numberedMap.set(e.ordinal, e.text.trim());
        }
        this.numberedCount = entries.length;
        return true;
    }

    /** Split unnumbered refs on hanging-indent boundaries and index by author/year. */
    private segmentAuthorYear(lines: Line[]): void {
        if (lines.length === 0) return;
        // Entry starts sit on a column's flush-left margin; continuations are
        // hanging-indented ~8-15 units right of it. Multi-column layouts have
        // one such margin pair per column, and trailing appendix content can
        // occupy arbitrary x positions, so margins cannot be found by
        // clustering or by taking minima. Instead: a margin is an x position
        // shared by MANY lines (flush margins and hanging indents both are),
        // minus those that lie a hanging-indent's distance right of another
        // frequent x (those are the continuation indents).
        const tol = 3;
        const counts = new Map<number, number>();
        for (const l of lines) {
            const r = Math.round(l.x);
            counts.set(r, (counts.get(r) ?? 0) + 1);
        }
        // Flush margins and hanging indents dominate the histogram (hundreds
        // of lines each); tables/appendix content contributes low-count noise
        // that must not qualify, or a noise x just left of a real margin
        // makes the margin itself look like a hanging indent below.
        const maxCount = Math.max(...counts.values());
        const threshold = Math.max(3, maxCount * 0.1);
        const frequent = [...counts.entries()]
            .filter(([, n]) => n >= threshold)
            .map(([x]) => x)
            .sort((a, b) => a - b);
        let margins = frequent.filter(
            (x) => !frequent.some((other) => x - other >= 4 && x - other <= 20)
        );
        if (margins.length === 0) {
            // Tiny bibliographies (fixtures, short docs): fall back to the
            // per-cluster minimum of all x positions.
            margins = clusterMins(
                lines.map((l) => Math.round(l.x)),
                40
            );
        }

        const blocks: string[] = [];
        let cur: string | null = null;
        for (const line of lines) {
            const isStart = margins.some((m) => Math.abs(line.x - m) <= tol);
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
            for (const surname of entry.surnames) {
                const key = `${surname}|${entry.year}`;
                const arr = this.byKey.get(key);
                if (arr) arr.push(text);
                else this.byKey.set(key, [text]);
                if (
                    entry.suffix &&
                    !this.bySuffix.has(`${key}${entry.suffix}`)
                ) {
                    this.bySuffix.set(`${key}${entry.suffix}`, text);
                }
            }
        }
    }

    /**
     * Index an entry under EVERY surname-looking token that precedes its year.
     * Bibliography styles disagree on name order ("Asri, L." vs "Layla El
     * Asri"), so keying only the first token misses "First Last" styles; the
     * in-text marker always cites a real surname, so indexing all candidate
     * tokens keeps recall without hurting precision (year + suffix still gate
     * the match).
     */
    private parseAuthorYearEntry(text: string): AuthorYearEntry | null {
        const ym = text.match(
            /(?<![A-Za-z0-9])((?:18|19|20)\d{2})([a-z])?(?![0-9])/
        );
        if (!ym || ym.index === undefined) return null;
        const year = Number(ym[1]);
        const suffix = ym[2] ?? null;

        const authorRegion = text.slice(0, ym.index);
        const tokens = authorRegion.match(/[A-ZÀ-Þ][A-Za-zÀ-ÿ'’-]+/g) ?? [];
        const surnames = [
            ...new Set(
                tokens
                    .filter(
                        (t) =>
                            t.length >= 2 &&
                            !AUTHOR_STOPWORDS.has(t.toLowerCase())
                    )
                    .map(normalizeSurname)
            ),
        ];
        if (surnames.length === 0) return null;
        return { text, surnames, year, suffix };
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

    private resolveAuthorYear(
        marker: CitationMarker
    ): ResolvedReference | null {
        if (!this.hasSection) {
            // Fallback: build a reference from the marker text itself (spec §5.1).
            const authors = marker.authorKey
                ? [capitalize(marker.authorKey)]
                : undefined;
            return {
                markerId: marker.id,
                rawText: marker.rawText,
                hints: {
                    ...(authors ? { authors } : {}),
                    ...(marker.year ? { year: marker.year } : {}),
                },
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
    return m ? (m[1] ?? null) : null;
}

function capitalize(s: string): string {
    return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
