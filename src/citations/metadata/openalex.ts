/**
 * OpenAlex client (primary backend, spec §6.3).
 *
 * - DOI path:   GET /works/https://doi.org/{doi}
 * - Title path: GET /works?search={title}&per_page=1
 * - Related:    ONE batched GET /works?filter=openalex_id:{id1|id2|...}
 * - Every request carries `mailto` (polite pool).
 */
import { MAX_RELATED, buildScholarUrl } from "../types";
import type { RelatedPaper, PaperVersion } from "../types";
import type { HttpClient } from "./throttle";
import type { SourceResult } from "./internal";
import { MetadataLookupError } from "./errors";
import {
    withQuery,
    normDoi,
    normalizeTitle,
    shortId,
    hostOf,
    reconstructAbstract,
    capAbstract,
} from "./util";

const BASE = "https://api.openalex.org";

export interface OpenAlexClient {
    byDoi(doi: string): Promise<SourceResult | null>;
    byTitle(query: string): Promise<SourceResult | null>;
}

interface OaAuthorship {
    author?: { display_name?: string };
}
interface OaLocation {
    landing_page_url?: string | null;
    pdf_url?: string | null;
    source?: { display_name?: string } | null;
}
interface OaWork {
    id?: string;
    doi?: string | null;
    title?: string | null;
    display_name?: string | null;
    publication_year?: number | null;
    cited_by_count?: number | null;
    abstract_inverted_index?: Record<string, number[]> | null;
    authorships?: OaAuthorship[];
    primary_location?: { source?: { display_name?: string } | null } | null;
    best_oa_location?: { pdf_url?: string | null } | null;
    related_works?: string[];
    locations?: OaLocation[];
}

export function createOpenAlexClient(
    http: HttpClient,
    mailto: string
): OpenAlexClient {
    async function resolveRelated(work: OaWork): Promise<RelatedPaper[]> {
        const ids = (work.related_works ?? [])
            .map((u) => shortId(u))
            .filter((id): id is string => Boolean(id))
            .slice(0, MAX_RELATED);
        if (ids.length === 0) return [];

        const url = withQuery(`${BASE}/works`, {
            filter: `openalex_id:${ids.join("|")}`,
            select: "id,display_name,publication_year",
            mailto,
        });
        const res = await http.request(url);
        if (!res.ok) return []; // related is best-effort; never fail the record on it
        const data = (await res.json()) as { results?: OaWork[] };

        const ownId = shortId(work.id);
        const ownTitle = normalizeTitle(work.display_name ?? work.title ?? "");
        const seen = new Set<string>();
        const related: RelatedPaper[] = [];
        for (const w of data.results ?? []) {
            const title = w.display_name ?? w.title ?? undefined;
            if (!title) continue;
            if (shortId(w.id) === ownId) continue; // drop the paper itself if echoed
            const nt = normalizeTitle(title);
            if (nt === ownTitle || seen.has(nt)) continue; // dedupe by normalized title
            seen.add(nt);
            related.push({
                title,
                year: w.publication_year ?? undefined,
                scholarUrl: buildScholarUrl(title),
            });
            if (related.length >= MAX_RELATED) break;
        }
        return related;
    }

    function mapVersions(work: OaWork): PaperVersion[] {
        const out: PaperVersion[] = [];
        const seenHost = new Set<string>();
        for (const loc of work.locations ?? []) {
            const url = loc.landing_page_url ?? loc.pdf_url ?? undefined;
            const host = hostOf(url);
            if (host) {
                if (seenHost.has(host)) continue; // dedupe by host
                seenHost.add(host);
            }
            const label = loc.source?.display_name ?? host;
            if (!label && !url) continue;
            out.push({ label: label ?? "Version", url: url ?? undefined });
        }
        return out;
    }

    async function enrich(work: OaWork): Promise<SourceResult> {
        const title = work.title ?? work.display_name ?? undefined;
        const authors = (work.authorships ?? [])
            .map((a) => a.author?.display_name)
            .filter((n): n is string => Boolean(n));

        const inverted = work.abstract_inverted_index;
        const abstract =
            inverted && Object.keys(inverted).length > 0
                ? capAbstract(reconstructAbstract(inverted))
                : undefined;

        return {
            title: title ?? undefined,
            authors: authors.length ? authors : undefined,
            year: work.publication_year ?? undefined,
            venue: work.primary_location?.source?.display_name ?? undefined,
            abstract,
            citationCount: work.cited_by_count ?? undefined,
            related: await resolveRelated(work),
            versions: mapVersions(work),
            oaPdfUrl: work.best_oa_location?.pdf_url ?? undefined,
            doi: work.doi ? normDoi(work.doi) : undefined,
        };
    }

    return {
        async byDoi(doi: string): Promise<SourceResult | null> {
            const url = withQuery(
                `${BASE}/works/https://doi.org/${normDoi(doi)}`,
                {
                    mailto,
                }
            );
            const res = await http.request(url);
            if (res.status === 404) return null;
            if (!res.ok) {
                throw new MetadataLookupError(
                    `OpenAlex DOI lookup HTTP ${res.status}`,
                    {
                        status: res.status,
                    }
                );
            }
            const work = (await res.json()) as OaWork;
            return enrich(work);
        },

        async byTitle(query: string): Promise<SourceResult | null> {
            const url = withQuery(`${BASE}/works`, {
                search: query,
                per_page: 1,
                mailto,
            });
            const res = await http.request(url);
            if (res.status === 404) return null;
            if (!res.ok) {
                throw new MetadataLookupError(
                    `OpenAlex title search HTTP ${res.status}`,
                    { status: res.status }
                );
            }
            const data = (await res.json()) as { results?: OaWork[] };
            const work = data.results?.[0];
            if (!work) return null;
            return enrich(work);
        },
    };
}
