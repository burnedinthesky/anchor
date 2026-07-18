/**
 * Live-API smoke test for the Stage 3 metadata chain (run by the orchestrator,
 * not CI): exercises OpenAlex/Crossref against the real network and asserts
 * the acceptance-matrix behaviors that mocks can't prove.
 *
 *   npx tsx scripts/live-smoke.ts
 */
import { createMetadataProvider } from "../src/citations/metadata/index.js";
import type { ResolvedReference } from "../src/citations/types.js";

const requests: string[] = [];
const countingFetch = (url: string, init?: RequestInit) => {
    requests.push(url);
    return globalThis.fetch(url, init);
};

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

const provider = createMetadataProvider({ fetch: countingFetch });

// --- 1. DOI path (acceptance row 4): exact OpenAlex hit, no search fallback.
const doiRef: ResolvedReference = {
    markerId: "smoke-1",
    rawText:
        "J. P. A. Ioannidis, “Why most published research findings are false,” PLoS Medicine, vol. 2, no. 8, e124, 2005.",
    doi: "10.1371/journal.pmed.0020124",
    hints: { year: 2005 },
};
const r1 = await provider.lookup(doiRef);
console.log(
    `[1] DOI lookup: "${r1.title}" (${r1.year}) cited_by=${r1.citationCount}`
);
console.log(
    `    completeness=${r1.completeness} sources=${r1.sources} related=${r1.related.length} versions=${r1.versions.length}`
);
assert(
    /published research findings/i.test(r1.title),
    `title mismatch: ${r1.title}`
);
assert(
    r1.authors.some((a) => /ioannidis/i.test(a)),
    `authors missing Ioannidis: ${r1.authors}`
);
assert(
    (r1.citationCount ?? 0) > 1000,
    `implausible citation count: ${r1.citationCount}`
);
assert(r1.abstract && r1.abstract.length > 50, "abstract missing/too short");
assert(
    r1.related.length > 0 && r1.related.length <= 5,
    `related count: ${r1.related.length}`
);
assert(
    r1.related.every((p) =>
        p.scholarUrl.startsWith("https://scholar.google.com/scholar?q=")
    ),
    "related scholarUrl malformed"
);
assert(
    /scholar\.google\.com\/scholar\?q=.*research/i.test(
        decodeURIComponent(r1.scholarUrl)
    ),
    "scholarUrl not title-based"
);
assert(
    !requests.some((u) => /query\.bibliographic|search=/.test(u)),
    "row 4 violated: search fallback was hit despite DOI"
);
const relatedBatches = requests.filter((u) =>
    decodeURIComponent(u).includes("openalex_id:")
);
assert(
    relatedBatches.length === 1,
    `row 6 violated: ${relatedBatches.length} related batch calls`
);

// --- 2. No-DOI path (row 5): Crossref bibliographic -> DOI -> OpenAlex.
const before2 = requests.length;
const rawRef: ResolvedReference = {
    markerId: "smoke-2",
    rawText:
        "K. He, X. Zhang, S. Ren, and J. Sun, “Deep residual learning for image recognition,” in Proc. IEEE Conf. Comput. Vis. Pattern Recognit. (CVPR), 2016, pp. 770–778.",
    hints: {
        title: "Deep residual learning for image recognition",
        year: 2016,
    },
};
const r2 = await provider.lookup(rawRef);
console.log(
    `[2] raw-ref lookup: "${r2.title}" (${r2.year}) cited_by=${r2.citationCount} sources=${r2.sources}`
);
assert(/deep residual learning/i.test(r2.title), `title mismatch: ${r2.title}`);
assert(
    requests.slice(before2).some((u) => u.includes("api.crossref.org")),
    "row 5: Crossref never queried"
);

// --- 3. Cache (row 8): repeat of #1 must issue zero new requests.
const before3 = requests.length;
const r3 = await provider.lookup(doiRef);
assert(
    requests.length === before3,
    `row 8 violated: ${requests.length - before3} new requests on repeat lookup`
);
assert(r3.title === r1.title, "cached record differs");
console.log("[3] repeat lookup served from cache (0 new requests)");

// --- Global invariants.
assert(
    !requests.some((u) => u.includes("scholar.google.com")),
    "scholar.google.com was fetched (forbidden)"
);
const politeHosts = requests.filter((u) =>
    /api\.(openalex|crossref)\.org/.test(u)
);
assert(
    politeHosts.length > 0 && politeHosts.every((u) => u.includes("mailto=")),
    "mailto missing on a polite-pool request"
);

console.log(
    `\nSMOKE PASS — ${requests.length} total requests, all invariants hold.`
);
