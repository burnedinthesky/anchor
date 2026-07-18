/**
 * Cheap, best-effort hint extraction from a raw reference string (spec §5.4).
 * These are hints only — never throw; a failed parse simply yields undefined.
 */

/** DOI via `10.\d{4,9}/\S+`, trailing punctuation stripped. */
export function extractDoi(text: string): string | undefined {
  const m = text.match(/10\.\d{4,9}\/\S+/);
  if (!m) return undefined;
  return m[0].replace(/[.,;:)\]}>'"]+$/, "");
}

export function extractYear(text: string): number | undefined {
  const m = text.match(/(?:18|19|20)\d{2}/);
  return m ? Number(m[0]) : undefined;
}

/** Title = longest quoted span, else longest multi-word sentence-cased span. */
export function extractTitle(text: string): string | undefined {
  const quoted = [...text.matchAll(/["“]([^"”]{4,})["”]/g)]
    .map((m) => m[1] ?? "")
    .filter(Boolean);
  if (quoted.length) {
    return quoted.sort((a, b) => b.length - a.length)[0];
  }
  const segs = text
    .split(/\.\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3);
  if (segs.length) {
    return segs.sort((a, b) => b.length - a.length)[0];
  }
  return undefined;
}

/** Leading `Surname, I.` author sequence → list of surnames. */
export function extractAuthors(text: string): string[] | undefined {
  const m = text.match(
    /^([A-ZÀ-Þ][A-Za-zÀ-ÿ'’\-]+,\s*(?:[A-Z]\.[-\s]*)+(?:(?:,\s*(?:and\s+|&\s+)?|\s+and\s+|;\s*)[A-ZÀ-Þ][A-Za-zÀ-ÿ'’\-]+,\s*(?:[A-Z]\.[-\s]*)+)*)/
  );
  if (!m) return undefined;
  const surnames = [...m[0].matchAll(/([A-ZÀ-Þ][A-Za-zÀ-ÿ'’\-]+),/g)]
    .map((x) => x[1] ?? "")
    .filter(Boolean);
  return surnames.length ? surnames : undefined;
}
