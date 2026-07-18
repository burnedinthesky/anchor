/**
 * Author-year citation detection (spec §4.2 scheme 3).
 * Covers parenthetical `(Smith, 2021)`, `(Smith et al., 2021)`,
 * `(Smith and Jones 2021)`, `(Smith & Jones, 2021)`, multi-cite
 * `(Smith, 2020; Jones, 2021)`, and narrative `Smith et al. (2021)`.
 * Emits one marker per individual cite so each is independently resolvable.
 */
import { firstSurname, normalizeSurname } from "./authorKey";
import type { RawMatch } from "./numeric";

// Standalone-token guard: `\b` is not enough because letter->digit is a word
// boundary, so grant/award identifiers like "JCYJ20220818103001002" would
// otherwise yield a "year". A year must not be glued to a letter or digit.
const YEAR = /(?<![A-Za-z0-9])(?:18|19|20)\d{2}(?![0-9])/;
const YEAR_G = /(?<![A-Za-z0-9])((?:18|19|20)\d{2})(?![0-9])/;

function parseCite(text: string): { authorKey: string; year: number } | null {
    const ym = text.match(YEAR_G);
    if (!ym || ym.index === undefined) return null;
    const before = text.slice(0, ym.index);
    const sn = firstSurname(before);
    if (!sn) return null;
    return { authorKey: normalizeSurname(sn), year: Number(ym[0]) };
}

/** Split `inner` on ';' keeping each part's offset within `inner`. */
function splitCites(inner: string): { text: string; offset: number }[] {
    const out: { text: string; offset: number }[] = [];
    let offset = 0;
    for (const part of inner.split(";")) {
        out.push({ text: part, offset });
        offset += part.length + 1; // +1 for the ';'
    }
    return out;
}

/**
 * Strict cite parse for page-boundary fragments: the author phrase must sit
 * IMMEDIATELY before the year. An unclosed fragment can start with arbitrary
 * page furniture (a running header, the previous sentence), so the lax
 * "first surname anywhere before the year" rule would produce huge, wrongly
 * keyed markers there.
 */
function parseCiteTight(
    text: string
): { authorKey: string; year: number; start: number; end: number } | null {
    const ym = YEAR_G.exec(text);
    YEAR_G.lastIndex = 0;
    if (!ym || ym.index === undefined) return null;
    const before = text.slice(0, ym.index);
    const pm = before.match(
        /([A-ZÀ-Þ][A-Za-zÀ-ÿ'’-]+(?:\s+(?:and|&)\s+[A-ZÀ-Þ][A-Za-zÀ-ÿ'’-]+)*(?:\s+et\s+al\.?)?)[\s,]*$/
    );
    if (!pm || pm.index === undefined) return null;
    const phrase = pm[1] ?? "";
    // A bare capitalized word right before a year is usually prose ("...
    // Decoding Heads 2022"); real cites have "Author," or an et-al/and chain.
    if (!/,\s*$/.test(before) && !/\b(?:et\s+al|and|&)\b/.test(phrase)) {
        return null;
    }
    const sn = firstSurname(phrase);
    if (!sn) return null;
    let end = ym.index + ym[0].length;
    if (/[a-z]/.test(text.charAt(end))) end++; // 2020a-style suffix
    return {
        authorKey: normalizeSurname(sn),
        year: Number(ym[1]),
        start: pm.index,
        end,
    };
}

function collectParenGroup(
    inner: string,
    innerStart: number,
    out: RawMatch[],
    boundary = false
): void {
    if (!YEAR.test(inner)) return;
    for (const cite of splitCites(inner)) {
        if (boundary) {
            const tight = parseCiteTight(cite.text);
            if (!tight) continue;
            const abs = innerStart + cite.offset;
            out.push({
                start: abs + tight.start,
                end: abs + tight.end,
                rawText: cite.text.slice(tight.start, tight.end).trim(),
                scheme: "author-year",
                authorKey: tight.authorKey,
                year: tight.year,
            });
            continue;
        }
        const parsed = parseCite(cite.text);
        if (!parsed) continue;
        const abs = innerStart + cite.offset;
        // Trim leading whitespace from the reported span so the rect hugs text.
        const leadWs = cite.text.length - cite.text.replace(/^\s+/, "").length;
        out.push({
            start: abs + leadWs,
            end: abs + cite.text.replace(/\s+$/, "").length,
            rawText: cite.text.trim(),
            scheme: "author-year",
            authorKey: parsed.authorKey,
            year: parsed.year,
        });
    }
}

export function findAuthorYearMatches(text: string): RawMatch[] {
    const out: RawMatch[] = [];

    // Parenthetical groups (no nested parens): (... year ...)
    const PAREN = /\(([^()]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = PAREN.exec(text))) {
        collectParenGroup(m[1] ?? "", m.index + 1, out);
    }

    // Page-boundary fragments: detection runs per page, so a parenthetical
    // group cut by a page break leaves an unclosed "(..." at the end of one
    // page and a leading "...)" on the next. Cites whose surname AND year are
    // complete within a fragment are recoverable; the cite straddling the
    // break itself is not (precision over recall).
    const lastOpen = text.lastIndexOf("(");
    if (lastOpen !== -1 && !text.includes(")", lastOpen)) {
        collectParenGroup(text.slice(lastOpen + 1), lastOpen + 1, out, true);
    }
    const firstClose = text.indexOf(")");
    if (firstClose !== -1 && !text.slice(0, firstClose).includes("(")) {
        collectParenGroup(text.slice(0, firstClose), 0, out, true);
    }

    // Narrative: Author et al. (2021) / Author and Author (2021) / Author (2021)
    const NAR =
        /([A-ZÀ-Þ][A-Za-zÀ-ÿ'’-]+(?:\s+(?:and|&)\s+[A-ZÀ-Þ][A-Za-zÀ-ÿ'’-]+)*)(?:\s+et\s+al\.?)?\s*\(((?:18|19|20)\d{2})[a-z]?\)/g;
    while ((m = NAR.exec(text))) {
        const phrase = m[1] ?? "";
        const first = firstSurname(phrase);
        if (!first) continue;
        out.push({
            start: m.index,
            end: m.index + m[0].length,
            rawText: m[0],
            scheme: "author-year",
            authorKey: normalizeSurname(first),
            year: Number(m[2]),
        });
    }

    return dedupe(out);
}

/** Drop matches fully contained within another match (keep the longer span). */
function dedupe(matches: RawMatch[]): RawMatch[] {
    const sorted = [...matches].sort(
        (a, b) => a.start - b.start || b.end - a.end
    );
    const kept: RawMatch[] = [];
    for (const cand of sorted) {
        const contained = kept.some(
            (k) => cand.start >= k.start && cand.end <= k.end
        );
        if (!contained) kept.push(cand);
    }
    return kept;
}
