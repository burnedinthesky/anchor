/**
 * Author-year citation detection (spec §4.2 scheme 3).
 * Covers parenthetical `(Smith, 2021)`, `(Smith et al., 2021)`,
 * `(Smith and Jones 2021)`, `(Smith & Jones, 2021)`, multi-cite
 * `(Smith, 2020; Jones, 2021)`, and narrative `Smith et al. (2021)`.
 * Emits one marker per individual cite so each is independently resolvable.
 */
import { firstSurname, normalizeSurname } from "./authorKey";
import type { RawMatch } from "./numeric";

const YEAR = /(?:18|19|20)\d{2}/;
const YEAR_G = /(18|19|20)\d{2}/;

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

export function findAuthorYearMatches(text: string): RawMatch[] {
  const out: RawMatch[] = [];

  // Parenthetical groups (no nested parens): (... year ...)
  const PAREN = /\(([^()]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = PAREN.exec(text))) {
    const inner = m[1] ?? "";
    if (!YEAR.test(inner)) continue;
    const innerStart = m.index + 1; // offset of `inner` in `text`
    for (const cite of splitCites(inner)) {
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

  // Narrative: Author et al. (2021) / Author and Author (2021) / Author (2021)
  const NAR =
    /([A-ZÀ-Þ][A-Za-zÀ-ÿ'’\-]+(?:\s+(?:and|&)\s+[A-ZÀ-Þ][A-Za-zÀ-ÿ'’\-]+)*)(?:\s+et\s+al\.?)?\s*\(((?:18|19|20)\d{2})[a-z]?\)/g;
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
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: RawMatch[] = [];
  for (const cand of sorted) {
    const contained = kept.some(
      (k) => cand.start >= k.start && cand.end <= k.end
    );
    if (!contained) kept.push(cand);
  }
  return kept;
}
