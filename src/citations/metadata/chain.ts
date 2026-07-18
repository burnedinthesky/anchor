/**
 * Stage 3 resolution chain (spec §6.2). Wires the clients, cache, and throttle
 * together behind the `MetadataProvider` contract.
 *
 * Order:
 *   1. DOI known         -> OpenAlex exact (on clean 404 -> title search, §10)
 *   2. else              -> Crossref bibliographic -> DOI -> OpenAlex
 *                           (Crossref found no DOI -> OpenAlex title search)
 *   3. Semantic Scholar  -> fill still-missing abstract and/or empty related.
 *
 * Fields merge first-wins by priority (OpenAlex > Crossref > S2). `sources`
 * lists every backend that contributed. A lookup that resolves no title returns
 * completeness "empty" UNLESS every attempt failed with a transport/HTTP error,
 * in which case a `MetadataLookupError` is thrown.
 */
import {
  CACHE_TTL_DAYS,
  DEFAULT_MAILTO,
  buildScholarUrl,
} from "../types";
import type {
  MetadataProvider,
  MetadataSource,
  PaperRecord,
  ResolvedReference,
} from "../types";
import type { FetchFn, NowFn, SleepFn, RandomFn, SourceResult } from "./internal";
import { createHttpClient } from "./throttle";
import {
  MetadataCache,
  createCacheStore,
  type CacheStore,
} from "./cache";
import { createOpenAlexClient } from "./openalex";
import { createCrossrefClient } from "./crossref";
import { createSemanticScholarClient } from "./semanticscholar";
import { MetadataLookupError } from "./errors";
import { normDoi, normalizeTitle, hashString } from "./util";

const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCE_ORDER: MetadataSource[] = ["openalex", "crossref", "semanticscholar"];

export interface MetadataProviderOptions {
  /** Polite-pool contact appended to OpenAlex/Crossref requests. */
  mailto?: string;
  /** Fetch implementation (default `globalThis.fetch`). */
  fetch?: FetchFn;
  /** Persistence tier (default: browser.storage.local if present, else memory). */
  cacheStore?: CacheStore;
  /** Clock in ms (default `Date.now`), used for cache TTL, throttle, backoff. */
  now?: NowFn;
  // --- testing seams (optional; safe to ignore) ---
  /** Delay implementation (default `setTimeout`). */
  sleep?: SleepFn;
  /** Jitter source in [0,1) (default `Math.random`). */
  random?: RandomFn;
}

type Attempt<T> = { value: T | null; errored: boolean };

class ResolutionChain implements MetadataProvider {
  private readonly inflight = new Map<string, Promise<PaperRecord>>();

  constructor(
    private readonly openalex: ReturnType<typeof createOpenAlexClient>,
    private readonly crossref: ReturnType<typeof createCrossrefClient>,
    private readonly s2: ReturnType<typeof createSemanticScholarClient>,
    private readonly cache: MetadataCache
  ) {}

  lookup(ref: ResolvedReference): Promise<PaperRecord> {
    const key = cacheKey(ref);

    // In-flight dedupe: register synchronously (before any await) so two truly
    // concurrent calls share one promise (and therefore one network round-trip).
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.resolveWithCache(key, ref);
    this.inflight.set(key, promise);
    const clear = () => this.inflight.delete(key);
    promise.then(clear, clear); // never leaves an unhandled rejection on this chain
    return promise;
  }

  private async resolveWithCache(
    key: string,
    ref: ResolvedReference
  ): Promise<PaperRecord> {
    const cached = await this.cache.get(key);
    if (cached) return cached;

    // A throw here (transport/HTTP failure with no data) propagates and is NOT
    // cached, so a later retry re-fetches.
    const record = await this.doLookup(ref);
    await this.cache.set(key, record);
    return record;
  }

  private async attempt<T>(fn: () => Promise<T | null>): Promise<Attempt<T>> {
    try {
      return { value: await fn(), errored: false };
    } catch {
      return { value: null, errored: true };
    }
  }

  private async doLookup(ref: ResolvedReference): Promise<PaperRecord> {
    const titleQuery = ref.hints.title ?? ref.rawText;
    const acc: SourceResult = {};
    const sources: MetadataSource[] = [];
    let hadError = false;
    let doi = ref.doi ? normDoi(ref.doi) : undefined;

    let oa: SourceResult | null = null;
    let cr: SourceResult | null = null;
    // True when Crossref supplied a DOI that drove a successful OpenAlex lookup;
    // it contributed provenance (the linking DOI) even if OpenAlex won every field.
    let crossrefSuppliedDoi = false;

    if (doi) {
      // Step 1: exact DOI lookup in OpenAlex.
      const r = await this.attempt(() => this.openalex.byDoi(doi as string));
      hadError ||= r.errored;
      oa = r.value;
      // §10: a clean 404 (not an error) falls through to title search.
      if (!oa && !r.errored) {
        const t = await this.attempt(() => this.openalex.byTitle(titleQuery));
        hadError ||= t.errored;
        oa = t.value;
      }
    } else {
      // Step 2: bibliographic search via Crossref to obtain a DOI.
      const c = await this.attempt(() =>
        this.crossref.bibliographic(ref.rawText, ref.hints)
      );
      hadError ||= c.errored;
      cr = c.value;
      if (cr?.doi) {
        doi = normDoi(cr.doi);
        const r = await this.attempt(() => this.openalex.byDoi(doi as string));
        hadError ||= r.errored;
        oa = r.value;
        if (oa) {
          crossrefSuppliedDoi = true;
        } else if (!r.errored) {
          const t = await this.attempt(() => this.openalex.byTitle(titleQuery));
          hadError ||= t.errored;
          oa = t.value;
        }
      } else {
        // Step 3: OpenAlex title search using hints.title (else rawText).
        const t = await this.attempt(() => this.openalex.byTitle(titleQuery));
        hadError ||= t.errored;
        oa = t.value;
      }
    }

    if (oa) mergeSource(acc, oa, "openalex", sources);
    if (cr) mergeSource(acc, cr, "crossref", sources);
    if (crossrefSuppliedDoi && !sources.includes("crossref")) {
      sources.push("crossref");
    }

    // Step 4: Semantic Scholar fills a missing abstract and/or empty related.
    const needAbstract = !acc.abstract;
    const needRelated = !acc.related || acc.related.length === 0;
    if (needAbstract || needRelated) {
      const s = await this.attempt(() =>
        this.s2.enrich(
          { doi, title: acc.title ?? titleQuery },
          { needRelated }
        )
      );
      hadError ||= s.errored;
      if (s.value) mergeSource(acc, s.value, "semanticscholar", sources);
    }

    return finalize(ref, acc, sources, hadError);
  }
}

function cacheKey(ref: ResolvedReference): string {
  if (ref.doi) return normDoi(ref.doi);
  return "t:" + hashString(normalizeTitle(ref.hints.title ?? ref.rawText));
}

/** First-wins merge; records the source if it filled at least one field. */
function mergeSource(
  acc: SourceResult,
  src: SourceResult,
  source: MetadataSource,
  sources: MetadataSource[]
): void {
  let contributed = false;
  const fill = (cond: boolean, apply: () => void) => {
    if (cond) {
      apply();
      contributed = true;
    }
  };

  fill(!acc.title && !!src.title, () => (acc.title = src.title));
  fill(
    (!acc.authors || acc.authors.length === 0) && !!src.authors?.length,
    () => (acc.authors = src.authors)
  );
  fill(acc.year == null && src.year != null, () => (acc.year = src.year));
  fill(!acc.venue && !!src.venue, () => (acc.venue = src.venue));
  fill(!acc.abstract && !!src.abstract, () => (acc.abstract = src.abstract));
  fill(
    acc.citationCount == null && src.citationCount != null,
    () => (acc.citationCount = src.citationCount)
  );
  fill(
    (!acc.related || acc.related.length === 0) && !!src.related?.length,
    () => (acc.related = src.related)
  );
  fill(
    (!acc.versions || acc.versions.length === 0) && !!src.versions?.length,
    () => (acc.versions = src.versions)
  );
  fill(!acc.oaPdfUrl && !!src.oaPdfUrl, () => (acc.oaPdfUrl = src.oaPdfUrl));

  if (contributed && !sources.includes(source)) sources.push(source);
}

function finalize(
  ref: ResolvedReference,
  acc: SourceResult,
  sources: MetadataSource[],
  hadError: boolean
): PaperRecord {
  const title = acc.title ?? "";
  const hasTitle = title.length > 0;

  if (!hasTitle && hadError) {
    // No usable data AND a real failure occurred -> surface as an error state,
    // distinct from a clean "no match".
    throw new MetadataLookupError("metadata lookup failed for all sources");
  }

  const authors = acc.authors ?? [];
  const completeness: PaperRecord["completeness"] = !hasTitle
    ? "empty"
    : authors.length > 0 && !!acc.abstract && acc.citationCount != null
      ? "full"
      : "partial";

  return {
    title,
    authors,
    year: acc.year,
    venue: acc.venue,
    abstract: acc.abstract,
    citationCount: acc.citationCount,
    related: acc.related ?? [],
    versions: acc.versions ?? [],
    oaPdfUrl: acc.oaPdfUrl,
    // Always populated: title if known, else the raw reference text so the UI
    // can still offer a Scholar search.
    scholarUrl: buildScholarUrl(hasTitle ? title : ref.rawText),
    sources: SOURCE_ORDER.filter((s) => sources.includes(s)),
    completeness,
  };
}

/**
 * Build a `MetadataProvider`. Sane defaults for every option:
 *   mailto -> DEFAULT_MAILTO, fetch -> globalThis.fetch, now -> Date.now,
 *   cacheStore -> browser.storage.local if present else in-memory.
 */
export function createMetadataProvider(
  options: MetadataProviderOptions = {}
): MetadataProvider {
  const mailto = options.mailto ?? DEFAULT_MAILTO;
  const fetchFn: FetchFn =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now: NowFn = options.now ?? (() => Date.now());
  const sleep: SleepFn =
    options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const random: RandomFn = options.random ?? Math.random;

  const http = createHttpClient({ fetch: fetchFn, now, sleep, random });
  const openalex = createOpenAlexClient(http, mailto);
  const crossref = createCrossrefClient(http, mailto);
  const s2 = createSemanticScholarClient(http);

  const store = options.cacheStore ?? createCacheStore();
  const cache = new MetadataCache(store, now, CACHE_TTL_DAYS * DAY_MS);

  return new ResolutionChain(openalex, crossref, s2, cache);
}
