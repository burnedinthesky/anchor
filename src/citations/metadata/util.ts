/**
 * Small pure helpers shared by the API clients, cache and chain. No I/O, no
 * side effects, safe to import in any context.
 */
import { MAX_ABSTRACT_CHARS } from "../types";

/** Build `base?k=v&...`, URL-encoding values only. Empty/undefined dropped. */
export function withQuery(
  base: string,
  params: Record<string, string | number | undefined>
): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return qs ? `${base}?${qs}` : base;
}

/** Normalize a DOI: lowercase, strip resolver prefixes. */
export function normDoi(doi: string): string {
  return doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "");
}

/** Lowercase + strip non-alphanumerics, for stable title comparison/keys. */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Stable, dependency-free string hash (djb2), returned as base36. */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0; // h * 33 + c, keep uint32
  }
  return h.toString(36);
}

/** Significant title tokens (>= 4 chars) for a coarse overlap check. */
export function titleTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4)
  );
}

/** Extract the short OpenAlex id (e.g. `W123`) from an id URL or bare id. */
export function shortId(idUrl: string | undefined): string | undefined {
  if (!idUrl) return undefined;
  const seg = idUrl.split("/").filter(Boolean).pop();
  return seg || undefined;
}

/** Host of a URL, or undefined if unparseable. */
export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/** Decode the handful of HTML/XML entities that appear in JATS abstracts. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16))
    )
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // last, so we don't double-decode
}

/** Strip JATS/XML tags and decode entities into plain text. */
export function stripJats(xml: string): string {
  const noTags = xml.replace(/<[^>]+>/g, " ");
  return decodeEntities(noTags).replace(/\s+/g, " ").trim();
}

/**
 * Rebuild an abstract from OpenAlex's `abstract_inverted_index`
 * (word -> [positions]) by placing each word at each of its positions and
 * joining in position order.
 */
export function reconstructAbstract(
  inverted: Record<string, number[]>
): string {
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const p of positions) {
      slots[p] = word;
    }
  }
  return slots.filter((w) => w !== undefined).join(" ");
}

/** Cap text at `max` chars, cutting on a word boundary and appending an ellipsis. */
export function capAbstract(text: string, max = MAX_ABSTRACT_CHARS): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return cut.replace(/\s+$/, "") + "…";
}
