import { describe, it, expect } from "vitest";
import { createCrossrefClient } from "../../src/citations/metadata/crossref";
import { routeFetch, jsonResponse, makeHttp, calledUrls } from "./helpers";

const MAILTO = "test@example.org";

function crossrefBody(item: Record<string, unknown>) {
    return { message: { items: [item] } };
}

describe("Crossref client", () => {
    it("extracts DOI, strips JATS abstract, maps authors/year/venue", async () => {
        const client = createCrossrefClient(
            makeHttp(
                routeFetch([
                    {
                        match: "api.crossref.org",
                        respond: jsonResponse(
                            crossrefBody({
                                DOI: "10.5555/Graph.Learning",
                                title: ["Graph Learning at Scale"],
                                author: [
                                    { given: "Ada", family: "Lovelace" },
                                    { family: "Turing" },
                                ],
                                issued: { "date-parts": [[2020, 5]] },
                                "is-referenced-by-count": 33,
                                "container-title": ["Proceedings of X"],
                                abstract:
                                    "<jats:p>We scale <jats:italic>graph</jats:italic> learning &amp; more.</jats:p>",
                            })
                        ),
                    },
                ])
            ),
            MAILTO
        );

        const r = await client.bibliographic(
            "Graph Learning at Scale, Lovelace 2020",
            {
                title: "Graph Learning at Scale",
                year: 2020,
            }
        );
        expect(r).not.toBeNull();
        expect(r!.doi).toBe("10.5555/graph.learning");
        expect(r!.title).toBe("Graph Learning at Scale");
        expect(r!.authors).toEqual(["Ada Lovelace", "Turing"]);
        expect(r!.year).toBe(2020);
        expect(r!.venue).toBe("Proceedings of X");
        expect(r!.citationCount).toBe(33);
        expect(r!.abstract).toBe("We scale graph learning & more.");
    });

    it("sends query.bibliographic, rows=1, select and mailto", async () => {
        const fetchMock = routeFetch([
            {
                match: "api.crossref.org",
                respond: jsonResponse(
                    crossrefBody({ DOI: "10.1/x", title: ["Graph Learning"] })
                ),
            },
        ]);
        const client = createCrossrefClient(makeHttp(fetchMock), MAILTO);
        await client.bibliographic("Graph Learning", {
            title: "Graph Learning",
        });
        const url = calledUrls(fetchMock)[0]!;
        expect(url).toContain("query.bibliographic=");
        expect(url).toContain("rows=1");
        expect(url).toContain("container-title");
        expect(decodeURIComponent(url)).toContain(`mailto=${MAILTO}`);
    });

    it("rejects an implausible top hit (no title overlap and no year match)", async () => {
        const client = createCrossrefClient(
            makeHttp(
                routeFetch([
                    {
                        match: "api.crossref.org",
                        respond: jsonResponse(
                            crossrefBody({
                                DOI: "10.9/wrong",
                                title: [
                                    "Completely Unrelated Marine Biology Survey",
                                ],
                                issued: { "date-parts": [[1999]] },
                            })
                        ),
                    },
                ])
            ),
            MAILTO
        );
        const r = await client.bibliographic("Graph Learning at Scale", {
            title: "Graph Learning at Scale",
            year: 2020,
        });
        expect(r).toBeNull();
    });

    it("accepts a hit when only the year matches", async () => {
        const client = createCrossrefClient(
            makeHttp(
                routeFetch([
                    {
                        match: "api.crossref.org",
                        respond: jsonResponse(
                            crossrefBody({
                                DOI: "10.9/yearonly",
                                title: ["A Totally Different Phrase"],
                                issued: { "date-parts": [[2020]] },
                            })
                        ),
                    },
                ])
            ),
            MAILTO
        );
        const r = await client.bibliographic("Graph Learning at Scale", {
            title: "Graph Learning at Scale",
            year: 2020,
        });
        expect(r!.doi).toBe("10.9/yearonly");
    });
});
