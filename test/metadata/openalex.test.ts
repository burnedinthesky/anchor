import { describe, it, expect } from "vitest";
import { createOpenAlexClient } from "../../src/citations/metadata/openalex";
import {
    routeFetch,
    jsonResponse,
    statusResponse,
    makeHttp,
    calledUrls,
    openAlexWork,
    openAlexRelatedBatch,
} from "./helpers";

const MAILTO = "test@example.org";

describe("OpenAlex client", () => {
    it("maps every field from a DOI lookup and reconstructs the abstract", async () => {
        const fetchMock = routeFetch([
            {
                match: "/works/https://doi.org/",
                respond: jsonResponse(openAlexWork()),
            },
            {
                match: "filter=openalex_id",
                respond: jsonResponse(openAlexRelatedBatch()),
            },
        ]);
        const client = createOpenAlexClient(makeHttp(fetchMock), MAILTO);

        const r = await client.byDoi("10.1234/abc");
        expect(r).not.toBeNull();
        expect(r!.title).toBe("Deep Learning for Citation Graphs");
        expect(r!.authors).toEqual(["Ada Lovelace", "Alan Turing"]);
        expect(r!.year).toBe(2021);
        expect(r!.venue).toBe("Journal of ML");
        expect(r!.citationCount).toBe(142);
        expect(r!.oaPdfUrl).toBe("https://oa.example.org/paper.pdf");
        expect(r!.abstract).toBe(
            "Deep learning models the citation of the graph"
        );
        expect(r!.doi).toBe("10.1234/abc");
    });

    it("resolves related works with exactly ONE batched request containing all ids", async () => {
        const fetchMock = routeFetch([
            {
                match: "/works/https://doi.org/",
                respond: jsonResponse(openAlexWork()),
            },
            {
                match: "filter=openalex_id",
                respond: jsonResponse(openAlexRelatedBatch()),
            },
        ]);
        const client = createOpenAlexClient(makeHttp(fetchMock), MAILTO);
        const r = await client.byDoi("10.1234/abc");

        const batchCalls = calledUrls(fetchMock).filter((u) =>
            u.includes("filter=openalex_id")
        );
        expect(batchCalls).toHaveLength(1);
        expect(decodeURIComponent(batchCalls[0]!)).toContain("W2001|W2002");

        expect(r!.related!.map((x) => x.title)).toEqual([
            "Related One",
            "Related Two",
        ]);
        expect(r!.related![0]!.scholarUrl).toContain(
            "scholar.google.com/scholar?q="
        );
        expect(r!.related!.length).toBeLessThanOrEqual(5);
    });

    it("caps related at MAX_RELATED, dropping the paper itself and duplicate titles", async () => {
        const work = openAlexWork({
            id: "https://openalex.org/WSELF",
            related_works: Array.from(
                { length: 8 },
                (_, i) => `https://openalex.org/W${i}`
            ),
        });
        const batch = {
            results: [
                {
                    id: "https://openalex.org/WSELF",
                    display_name: "Self Echo",
                    publication_year: 2021,
                },
                {
                    id: "https://openalex.org/W1",
                    display_name: "Dup Title",
                    publication_year: 2019,
                },
                {
                    id: "https://openalex.org/W2",
                    display_name: "Dup Title",
                    publication_year: 2019,
                },
                {
                    id: "https://openalex.org/W3",
                    display_name: "Unique A",
                    publication_year: 2018,
                },
                {
                    id: "https://openalex.org/W4",
                    display_name: "Unique B",
                    publication_year: 2017,
                },
            ],
        };
        // The paper's own title must match the echoed related item to be dropped.
        work.title = "Self Echo";
        work.display_name = "Self Echo";
        const fetchMock = routeFetch([
            { match: "/works/https://doi.org/", respond: jsonResponse(work) },
            { match: "filter=openalex_id", respond: jsonResponse(batch) },
        ]);
        const client = createOpenAlexClient(makeHttp(fetchMock), MAILTO);
        const r = await client.byDoi("10.1234/abc");

        const titles = r!.related!.map((x) => x.title);
        expect(titles).toEqual(["Dup Title", "Unique A", "Unique B"]); // self dropped, dup deduped
        // only 5 ids sent even though 8 related_works exist
        const batchUrl = calledUrls(fetchMock).find((u) =>
            u.includes("filter=openalex_id")
        )!;
        expect(decodeURIComponent(batchUrl)).toContain("W0|W1|W2|W3|W4");
    });

    it("dedupes versions by host", async () => {
        const client = createOpenAlexClient(
            makeHttp(
                routeFetch([
                    {
                        match: "/works/https://doi.org/",
                        respond: jsonResponse(openAlexWork()),
                    },
                    {
                        match: "filter=openalex_id",
                        respond: jsonResponse(openAlexRelatedBatch()),
                    },
                ])
            ),
            MAILTO
        );
        const r = await client.byDoi("10.1234/abc");
        const hosts = r!.versions!.map((v) => new URL(v.url!).host);
        expect(hosts).toEqual(["journal.example.org", "repo.example.org"]);
    });

    it("returns null on 404 (no match)", async () => {
        const client = createOpenAlexClient(
            makeHttp(
                routeFetch([
                    {
                        match: "/works/https://doi.org/",
                        respond: statusResponse(404),
                    },
                ])
            ),
            MAILTO
        );
        expect(await client.byDoi("10.0/none")).toBeNull();
    });

    it("uses the title-search endpoint with per_page=1", async () => {
        const fetchMock = routeFetch([
            {
                match: "search=",
                respond: jsonResponse({ results: [openAlexWork()] }),
            },
            {
                match: "filter=openalex_id",
                respond: jsonResponse(openAlexRelatedBatch()),
            },
        ]);
        const client = createOpenAlexClient(makeHttp(fetchMock), MAILTO);
        const r = await client.byTitle("deep learning citation");
        expect(r!.title).toBe("Deep Learning for Citation Graphs");
        const url = calledUrls(fetchMock).find((u) => u.includes("search="))!;
        expect(url).toContain("per_page=1");
    });

    it("appends mailto to every OpenAlex request", async () => {
        const fetchMock = routeFetch([
            {
                match: "/works/https://doi.org/",
                respond: jsonResponse(openAlexWork()),
            },
            {
                match: "filter=openalex_id",
                respond: jsonResponse(openAlexRelatedBatch()),
            },
        ]);
        const client = createOpenAlexClient(makeHttp(fetchMock), MAILTO);
        await client.byDoi("10.1234/abc");
        for (const u of calledUrls(fetchMock)) {
            expect(decodeURIComponent(u)).toContain(`mailto=${MAILTO}`);
        }
    });
});
