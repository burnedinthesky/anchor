import { vi } from "vitest";
import type { ResolvedReference } from "../../src/citations/types";
import { createHttpClient, type HttpClient } from "../../src/citations/metadata/throttle";

/** An HttpClient with no-op sleep and fixed jitter, for direct client tests. */
export function makeHttp(fetchMock: (input: string, init?: RequestInit) => Promise<Response>): HttpClient {
  return createHttpClient({
    fetch: fetchMock,
    now: () => Date.now(),
    sleep: async () => undefined,
    random: () => 0.5,
  });
}

/** Build a JSON Response (uses the global `Response` from undici in Node). */
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Empty-body Response with a status (for 404/429/500 etc). */
export function statusResponse(
  status: number,
  headers: Record<string, string> = {}
): Response {
  return new Response(null, { status, headers });
}

export interface Route {
  /** Substring or predicate the request URL must match. */
  match: string | ((url: string) => boolean);
  /** Response, or a per-call factory (index = 0-based call count for this route). */
  respond: Response | ((callIndex: number) => Response);
}

/**
 * Router-style mock fetch. First matching route wins. Unmatched URLs throw.
 * The returned function is a vi mock so `.mock.calls` is available.
 */
export function routeFetch(routes: Route[]) {
  const perRoute = new Map<Route, number>();
  return vi.fn(async (input: string, _init?: RequestInit) => {
    const url = String(input);
    for (const route of routes) {
      const hit =
        typeof route.match === "string"
          ? url.includes(route.match)
          : route.match(url);
      if (hit) {
        const idx = perRoute.get(route) ?? 0;
        perRoute.set(route, idx + 1);
        return typeof route.respond === "function"
          ? route.respond(idx)
          : route.respond;
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

/** All URLs a mock fetch was called with. */
export function calledUrls(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

export function ref(partial: Partial<ResolvedReference> = {}): ResolvedReference {
  return {
    markerId: "m1",
    rawText: partial.rawText ?? "Some Reference (2021)",
    doi: partial.doi,
    hints: partial.hints ?? {},
  };
}

// --- fixtures ---------------------------------------------------------------

export function openAlexWork(overrides: Record<string, unknown> = {}) {
  return {
    id: "https://openalex.org/W1000",
    doi: "https://doi.org/10.1234/abc",
    title: "Deep Learning for Citation Graphs",
    display_name: "Deep Learning for Citation Graphs",
    publication_year: 2021,
    cited_by_count: 142,
    abstract_inverted_index: {
      Deep: [0],
      learning: [1],
      models: [2],
      the: [3, 6],
      citation: [4],
      of: [5],
      graph: [7],
    },
    authorships: [
      { author: { display_name: "Ada Lovelace" } },
      { author: { display_name: "Alan Turing" } },
    ],
    primary_location: { source: { display_name: "Journal of ML" } },
    best_oa_location: { pdf_url: "https://oa.example.org/paper.pdf" },
    related_works: [
      "https://openalex.org/W2001",
      "https://openalex.org/W2002",
    ],
    locations: [
      {
        landing_page_url: "https://journal.example.org/article/1",
        pdf_url: "https://journal.example.org/article/1.pdf",
        source: { display_name: "Journal of ML" },
      },
      {
        landing_page_url: "https://repo.example.org/1",
        pdf_url: null,
        source: { display_name: "Institutional Repo" },
      },
      {
        // duplicate host of the first location -> should be deduped away
        landing_page_url: "https://journal.example.org/article/1-mirror",
        pdf_url: null,
        source: { display_name: "Journal of ML (mirror)" },
      },
    ],
    ...overrides,
  };
}

export function openAlexRelatedBatch() {
  return {
    results: [
      { id: "https://openalex.org/W2001", display_name: "Related One", publication_year: 2019 },
      { id: "https://openalex.org/W2002", display_name: "Related Two", publication_year: 2020 },
    ],
  };
}
