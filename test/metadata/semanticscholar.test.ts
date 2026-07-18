import { describe, it, expect } from "vitest";
import { createSemanticScholarClient } from "../../src/citations/metadata/semanticscholar";
import {
    routeFetch,
    jsonResponse,
    statusResponse,
    makeHttp,
    calledUrls,
} from "./helpers";

describe("Semantic Scholar client", () => {
    it("fetches a paper by DOI and maps abstract + recommendations", async () => {
        const fetchMock = routeFetch([
            {
                match: "/graph/v1/paper/DOI:",
                respond: jsonResponse({
                    paperId: "s2id",
                    title: "Graph Learning",
                    authors: [{ name: "Ada Lovelace" }],
                    year: 2020,
                    venue: "S2 Venue",
                    abstract: "An S2 abstract.",
                    citationCount: 7,
                    openAccessPdf: { url: "https://s2.example.org/p.pdf" },
                }),
            },
            {
                match: "/recommendations/",
                respond: jsonResponse({
                    recommendedPapers: [
                        { title: "Rec One", year: 2018 },
                        { title: "Rec Two", year: 2019 },
                    ],
                }),
            },
        ]);
        const client = createSemanticScholarClient(makeHttp(fetchMock));
        const r = await client.enrich({ doi: "10.1/x" }, { needRelated: true });

        expect(r!.abstract).toBe("An S2 abstract.");
        expect(r!.oaPdfUrl).toBe("https://s2.example.org/p.pdf");
        expect(r!.related!.map((x) => x.title)).toEqual(["Rec One", "Rec Two"]);
        expect(r!.related![0]!.scholarUrl).toContain("scholar.google.com");
        const recUrl = calledUrls(fetchMock).find((u) =>
            u.includes("/recommendations/")
        )!;
        expect(recUrl).toContain("forpaper/DOI:10.1/x");
    });

    it("falls back to title search when the DOI lookup 404s", async () => {
        const fetchMock = routeFetch([
            { match: "/graph/v1/paper/DOI:", respond: statusResponse(404) },
            {
                match: "/graph/v1/paper/search",
                respond: jsonResponse({
                    data: [
                        {
                            paperId: "p2",
                            title: "Found By Title",
                            abstract: "abs",
                        },
                    ],
                }),
            },
        ]);
        const client = createSemanticScholarClient(makeHttp(fetchMock));
        const r = await client.enrich(
            { doi: "10.1/missing", title: "Found By Title" },
            { needRelated: false }
        );
        expect(r!.title).toBe("Found By Title");
        expect(r!.abstract).toBe("abs");
    });

    it("does not require mailto and skips recommendations when not needed", async () => {
        const fetchMock = routeFetch([
            {
                match: "/graph/v1/paper/search",
                respond: jsonResponse({
                    data: [{ title: "T", abstract: "a" }],
                }),
            },
        ]);
        const client = createSemanticScholarClient(makeHttp(fetchMock));
        await client.enrich({ title: "T" }, { needRelated: false });
        expect(
            calledUrls(fetchMock).some((u) => u.includes("/recommendations/"))
        ).toBe(false);
    });
});
