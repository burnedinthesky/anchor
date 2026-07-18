/**
 * Semantic Scholar client (spec §6.3, §6.2 step 4). Fallback only: used to fill
 * a still-missing abstract and/or an empty related list.
 *
 * - Paper:  /graph/v1/paper/DOI:{doi}  or  /graph/v1/paper/search?query={title}
 * - Related: /recommendations/v1/papers/forpaper/{id}
 */
import { buildScholarUrl } from "../types";
import type { RelatedPaper } from "../types";
import type { HttpClient } from "./throttle";
import type { SourceResult } from "./internal";
import { withQuery, normalizeTitle } from "./util";

const BASE = "https://api.semanticscholar.org";
const PAPER_FIELDS =
    "title,authors,year,venue,abstract,citationCount,externalIds,openAccessPdf";

export interface S2EnrichInput {
    doi?: string;
    title?: string;
}
export interface S2EnrichNeeds {
    needRelated: boolean;
}

export interface SemanticScholarClient {
    enrich(
        input: S2EnrichInput,
        needs: S2EnrichNeeds
    ): Promise<SourceResult | null>;
}

interface S2Paper {
    paperId?: string;
    title?: string;
    authors?: { name?: string }[];
    year?: number;
    venue?: string;
    abstract?: string;
    citationCount?: number;
    openAccessPdf?: { url?: string } | null;
}

function mapPaper(p: S2Paper): SourceResult {
    const authors = (p.authors ?? [])
        .map((a) => a.name)
        .filter((n): n is string => Boolean(n));
    return {
        title: p.title || undefined,
        authors: authors.length ? authors : undefined,
        year: p.year ?? undefined,
        venue: p.venue || undefined,
        abstract: p.abstract || undefined,
        citationCount: p.citationCount ?? undefined,
        oaPdfUrl: p.openAccessPdf?.url ?? undefined,
    };
}

export function createSemanticScholarClient(
    http: HttpClient
): SemanticScholarClient {
    async function fetchPaper(input: S2EnrichInput): Promise<S2Paper | null> {
        if (input.doi) {
            const url = withQuery(`${BASE}/graph/v1/paper/DOI:${input.doi}`, {
                fields: PAPER_FIELDS,
            });
            const res = await http.request(url);
            if (res.ok) return (await res.json()) as S2Paper;
            if (res.status !== 404) return null;
            // fall through to title search on 404
        }
        if (input.title) {
            const url = withQuery(`${BASE}/graph/v1/paper/search`, {
                query: input.title,
                limit: 1,
                fields: PAPER_FIELDS,
            });
            const res = await http.request(url);
            if (!res.ok) return null;
            const data = (await res.json()) as { data?: S2Paper[] };
            return data.data?.[0] ?? null;
        }
        return null;
    }

    async function fetchRelated(
        input: S2EnrichInput,
        paperId: string | undefined,
        ownTitle: string | undefined
    ): Promise<RelatedPaper[]> {
        const idPart = input.doi ? `DOI:${input.doi}` : paperId;
        if (!idPart) return [];
        const url = withQuery(
            `${BASE}/recommendations/v1/papers/forpaper/${idPart}`,
            { limit: 5, fields: "title,year" }
        );
        const res = await http.request(url);
        if (!res.ok) return [];
        const data = (await res.json()) as {
            recommendedPapers?: { title?: string; year?: number }[];
        };
        const own = ownTitle ? normalizeTitle(ownTitle) : "";
        const seen = new Set<string>();
        const related: RelatedPaper[] = [];
        for (const r of data.recommendedPapers ?? []) {
            if (!r.title) continue;
            const nt = normalizeTitle(r.title);
            if (nt === own || seen.has(nt)) continue;
            seen.add(nt);
            related.push({
                title: r.title,
                year: r.year,
                scholarUrl: buildScholarUrl(r.title),
            });
        }
        return related;
    }

    return {
        async enrich(
            input: S2EnrichInput,
            needs: S2EnrichNeeds
        ): Promise<SourceResult | null> {
            const paper = await fetchPaper(input);
            if (!paper) return null;
            const result = mapPaper(paper);
            if (needs.needRelated) {
                result.related = await fetchRelated(
                    input,
                    paper.paperId,
                    result.title ?? input.title
                );
            }
            return result;
        },
    };
}
