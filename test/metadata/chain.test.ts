import { describe, it, expect, vi } from "vitest";
import { createMetadataProvider } from "../../src/citations/metadata/chain";
import { MetadataLookupError } from "../../src/citations/metadata/errors";
import { MemoryCacheStore } from "../../src/citations/metadata/cache";
import {
  routeFetch,
  jsonResponse,
  statusResponse,
  calledUrls,
  ref,
  openAlexWork,
  openAlexRelatedBatch,
} from "./helpers";

const MAILTO = "test@example.org";

/** Provider with all timing injected so tests are instant and deterministic. */
function provider(fetchMock: any, extra: Record<string, unknown> = {}) {
  return createMetadataProvider({
    mailto: MAILTO,
    fetch: fetchMock,
    cacheStore: new MemoryCacheStore(),
    now: () => 1_000,
    sleep: vi.fn(async (_ms: number) => undefined),
    random: () => 1,
    ...extra,
  });
}

describe("resolution chain", () => {
  it("row 4: DOI known -> exact OpenAlex hit, no title-search fallback", async () => {
    const fetchMock = routeFetch([
      { match: "/works/https://doi.org/", respond: jsonResponse(openAlexWork()) },
      { match: "filter=openalex_id", respond: jsonResponse(openAlexRelatedBatch()) },
    ]);
    const rec = await provider(fetchMock).lookup(ref({ doi: "10.1234/abc" }));

    expect(rec.title).toBe("Deep Learning for Citation Graphs");
    expect(rec.citationCount).toBe(142);
    expect(rec.sources).toEqual(["openalex"]);
    const urls = calledUrls(fetchMock);
    expect(urls.some((u) => u.includes("search="))).toBe(false); // no title search
    expect(urls.some((u) => u.includes("api.crossref.org"))).toBe(false);
  });

  it("row 5: no DOI -> Crossref bibliographic -> OpenAlex, card populated", async () => {
    const fetchMock = routeFetch([
      {
        match: "api.crossref.org",
        respond: jsonResponse({
          message: {
            items: [{ DOI: "10.1234/abc", title: ["Deep Learning for Citation Graphs"] }],
          },
        }),
      },
      { match: "/works/https://doi.org/", respond: jsonResponse(openAlexWork()) },
      { match: "filter=openalex_id", respond: jsonResponse(openAlexRelatedBatch()) },
    ]);
    const rec = await provider(fetchMock).lookup(
      ref({ rawText: "Deep Learning for Citation Graphs", hints: { title: "Deep Learning for Citation Graphs" } })
    );

    expect(rec.title).toBe("Deep Learning for Citation Graphs");
    expect(rec.sources).toEqual(["openalex", "crossref"]);
    const urls = calledUrls(fetchMock);
    expect(urls[0]).toContain("api.crossref.org"); // crossref first
    expect(urls.some((u) => u.includes("api.openalex.org"))).toBe(true);
  });

  it("row 8: second lookup is served from cache with zero new fetches", async () => {
    const fetchMock = routeFetch([
      { match: "/works/https://doi.org/", respond: jsonResponse(openAlexWork()) },
      { match: "filter=openalex_id", respond: jsonResponse(openAlexRelatedBatch()) },
    ]);
    const p = provider(fetchMock);
    await p.lookup(ref({ doi: "10.1234/abc" }));
    const afterFirst = fetchMock.mock.calls.length;
    const rec = await p.lookup(ref({ doi: "10.1234/abc" }));
    expect(rec.title).toBe("Deep Learning for Citation Graphs");
    expect(fetchMock.mock.calls.length).toBe(afterFirst);
  });

  it("row 12: HTTP 429 twice then 200 succeeds with growing backoff", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const fetchMock = routeFetch([
      {
        match: "/works/https://doi.org/",
        respond: (i) => (i < 2 ? statusResponse(429) : jsonResponse(openAlexWork())),
      },
      { match: "filter=openalex_id", respond: jsonResponse(openAlexRelatedBatch()) },
    ]);
    const rec = await provider(fetchMock, { sleep }).lookup(ref({ doi: "10.1234/abc" }));
    expect(rec.title).toBe("Deep Learning for Citation Graphs");
    expect(sleep).toHaveBeenCalledTimes(2);
    const d0 = sleep.mock.calls[0]![0] as number;
    const d1 = sleep.mock.calls[1]![0] as number;
    expect(d1).toBeGreaterThan(d0);
  });

  it("§10: DOI 404 in OpenAlex falls back to title search", async () => {
    const fetchMock = routeFetch([
      { match: "/works/https://doi.org/", respond: statusResponse(404) },
      { match: "search=", respond: jsonResponse({ results: [openAlexWork()] }) },
      { match: "filter=openalex_id", respond: jsonResponse(openAlexRelatedBatch()) },
    ]);
    const rec = await provider(fetchMock).lookup(
      ref({ doi: "10.0/missing", hints: { title: "Deep Learning for Citation Graphs" } })
    );
    expect(rec.title).toBe("Deep Learning for Citation Graphs");
    expect(calledUrls(fetchMock).some((u) => u.includes("search="))).toBe(true);
  });

  it("dedupes two concurrent identical lookups into one set of fetches", async () => {
    const fetchMock = routeFetch([
      { match: "/works/https://doi.org/", respond: jsonResponse(openAlexWork()) },
      { match: "filter=openalex_id", respond: jsonResponse(openAlexRelatedBatch()) },
    ]);
    const p = provider(fetchMock);
    const [a, b] = await Promise.all([
      p.lookup(ref({ doi: "10.1234/abc" })),
      p.lookup(ref({ doi: "10.1234/abc" })),
    ]);
    expect(a.title).toBe(b.title);
    // one byDoi + one related batch, not doubled
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it("does not cache a failed lookup; a retry re-fetches", async () => {
    let mode: "fail" | "ok" = "fail";
    const fetchImpl = vi.fn(async (input: string) => {
      if (mode === "fail") throw new TypeError("offline");
      if (input.includes("filter=openalex_id")) return jsonResponse(openAlexRelatedBatch());
      return jsonResponse(openAlexWork());
    });
    const p = provider(fetchImpl);
    await expect(p.lookup(ref({ doi: "10.1234/abc" }))).rejects.toBeInstanceOf(MetadataLookupError);
    mode = "ok";
    const rec = await p.lookup(ref({ doi: "10.1234/abc" }));
    expect(rec.title).toBe("Deep Learning for Citation Graphs");
  });

  it("completeness: full when title+authors+abstract+citationCount present", async () => {
    const fetchMock = routeFetch([
      { match: "/works/https://doi.org/", respond: jsonResponse(openAlexWork()) },
      { match: "filter=openalex_id", respond: jsonResponse(openAlexRelatedBatch()) },
    ]);
    const rec = await provider(fetchMock).lookup(ref({ doi: "10.1234/abc" }));
    expect(rec.completeness).toBe("full");
  });

  it("completeness: partial when a required field is missing", async () => {
    const work = openAlexWork({ authorships: [] }); // no authors -> not full
    const fetchMock = routeFetch([
      { match: "/works/https://doi.org/", respond: jsonResponse(work) },
      { match: "filter=openalex_id", respond: jsonResponse(openAlexRelatedBatch()) },
    ]);
    const rec = await provider(fetchMock).lookup(ref({ doi: "10.1234/abc" }));
    expect(rec.completeness).toBe("partial");
    expect(rec.authors).toEqual([]);
  });

  it("completeness: empty when nothing resolves; scholarUrl uses raw text", async () => {
    const fetchMock = routeFetch([
      { match: "api.crossref.org", respond: jsonResponse({ message: { items: [] } }) },
      { match: "search=", respond: jsonResponse({ results: [] }) },
      { match: "/graph/v1/paper/search", respond: jsonResponse({ data: [] }) },
    ]);
    const rec = await provider(fetchMock).lookup(ref({ rawText: "Totally unknown reference 1234" }));
    expect(rec.completeness).toBe("empty");
    expect(rec.title).toBe("");
    expect(rec.scholarUrl).toBe(
      "https://scholar.google.com/scholar?q=" + encodeURIComponent("Totally unknown reference 1234")
    );
  });

  it("throws a typed MetadataLookupError when offline (all sources fail)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await expect(provider(fetchImpl).lookup(ref({ doi: "10.1234/abc" }))).rejects.toBeInstanceOf(
      MetadataLookupError
    );
  });

  it("Semantic Scholar fills a missing abstract and empty related list", async () => {
    const work = openAlexWork({ abstract_inverted_index: null, related_works: [] });
    const fetchMock = routeFetch([
      { match: "/works/https://doi.org/", respond: jsonResponse(work) },
      {
        match: "/graph/v1/paper/DOI:",
        respond: jsonResponse({ paperId: "s2", abstract: "Filled by S2." }),
      },
      {
        match: "/recommendations/",
        respond: jsonResponse({ recommendedPapers: [{ title: "S2 Related", year: 2020 }] }),
      },
    ]);
    const rec = await provider(fetchMock).lookup(ref({ doi: "10.1234/abc" }));
    expect(rec.abstract).toBe("Filled by S2.");
    expect(rec.related.map((r) => r.title)).toEqual(["S2 Related"]);
    expect(rec.sources).toEqual(["openalex", "semanticscholar"]);
  });

  it("never fetches scholar.google.com and always sends mailto to OpenAlex/Crossref", async () => {
    const fetchMock = routeFetch([
      {
        match: "api.crossref.org",
        respond: jsonResponse({
          message: { items: [{ DOI: "10.1234/abc", title: ["Deep Learning for Citation Graphs"] }] },
        }),
      },
      { match: "/works/https://doi.org/", respond: jsonResponse(openAlexWork()) },
      { match: "filter=openalex_id", respond: jsonResponse(openAlexRelatedBatch()) },
    ]);
    await provider(fetchMock).lookup(
      ref({ rawText: "Deep Learning for Citation Graphs", hints: { title: "Deep Learning for Citation Graphs" } })
    );
    for (const u of calledUrls(fetchMock)) {
      expect(u).not.toContain("scholar.google.com");
      if (u.includes("api.openalex.org") || u.includes("api.crossref.org")) {
        expect(decodeURIComponent(u)).toContain(`mailto=${MAILTO}`);
      }
    }
  });
});
