/**
 * Crossref client (spec §6.3). Primary role: turn a raw bibliographic string
 * into a DOI. Applies a precision-first plausibility guard so a confidently
 * wrong top hit is rejected rather than propagated.
 */
import type { ResolvedReference } from "../types";
import type { HttpClient } from "./throttle";
import type { SourceResult } from "./internal";
import { MetadataLookupError } from "./errors";
import { withQuery, normDoi, stripJats, titleTokens } from "./util";

const BASE = "https://api.crossref.org";

export interface CrossrefClient {
  bibliographic(
    rawText: string,
    hints: ResolvedReference["hints"]
  ): Promise<SourceResult | null>;
}

interface CrAuthor {
  given?: string;
  family?: string;
}
interface CrItem {
  DOI?: string;
  title?: string[];
  author?: CrAuthor[];
  issued?: { "date-parts"?: number[][] };
  "is-referenced-by-count"?: number;
  abstract?: string;
  "container-title"?: string[];
}

function mapItem(item: CrItem): SourceResult {
  const authors = (item.author ?? [])
    .map((a) => [a.given, a.family].filter(Boolean).join(" ").trim())
    .filter((n) => n.length > 0);
  const year = item.issued?.["date-parts"]?.[0]?.[0];
  return {
    doi: item.DOI ? normDoi(item.DOI) : undefined,
    title: item.title?.[0],
    authors: authors.length ? authors : undefined,
    year: typeof year === "number" ? year : undefined,
    venue: item["container-title"]?.[0],
    citationCount: item["is-referenced-by-count"],
    abstract: item.abstract ? stripJats(item.abstract) : undefined,
  };
}

/**
 * Accept the hit only if it shares a significant title token with the query OR
 * matches the hinted year. Otherwise reject (avoid confidently-wrong matches).
 */
function isPlausible(
  result: SourceResult,
  rawText: string,
  hints: ResolvedReference["hints"]
): boolean {
  const hintedYear = hints.year;
  if (hintedYear !== undefined && result.year === hintedYear) return true;

  const queryTokens = titleTokens(hints.title ?? rawText);
  const resultTokens = titleTokens(result.title ?? "");
  for (const t of resultTokens) {
    if (queryTokens.has(t)) return true;
  }
  return false;
}

export function createCrossrefClient(
  http: HttpClient,
  mailto: string
): CrossrefClient {
  return {
    async bibliographic(
      rawText: string,
      hints: ResolvedReference["hints"]
    ): Promise<SourceResult | null> {
      const url = withQuery(`${BASE}/works`, {
        "query.bibliographic": rawText,
        rows: 1,
        select:
          "DOI,title,author,issued,is-referenced-by-count,abstract,container-title",
        mailto,
      });
      const res = await http.request(url);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new MetadataLookupError(`Crossref HTTP ${res.status}`, {
          status: res.status,
        });
      }
      const data = (await res.json()) as { message?: { items?: CrItem[] } };
      const item = data.message?.items?.[0];
      if (!item) return null;

      const result = mapItem(item);
      if (!result.title && !result.doi) return null;
      if (!isPlausible(result, rawText, hints)) return null;
      return result;
    },
  };
}
