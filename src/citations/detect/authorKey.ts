/**
 * Surname normalisation shared by Stage 1 (author-year detection) and Stage 2
 * (bibliography indexing): strip diacritics, lowercase, keep letters only.
 * e.g. "Gómez" → "gomez", "O'Brien" → "obrien".
 */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export function normalizeSurname(s: string): string {
  return s
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** First capitalised surname token in a fragment, or null. */
export function firstSurname(s: string): string | null {
  const m = s.match(/[A-ZÀ-Þ][A-Za-zÀ-ÿ'’\-]*/);
  return m ? m[0] : null;
}
