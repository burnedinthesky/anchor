import { describe, it, expect } from "vitest";
import {
  reconstructAbstract,
  capAbstract,
  stripJats,
  normDoi,
  normalizeTitle,
  hashString,
  withQuery,
  shortId,
  hostOf,
} from "../../src/citations/metadata/util";

describe("reconstructAbstract", () => {
  it("orders words by position and handles multi-position words", () => {
    // "the" appears at positions 3 and 6.
    const inv = {
      Deep: [0],
      learning: [1],
      models: [2],
      the: [3, 6],
      citation: [4],
      of: [5],
      graph: [7],
    };
    expect(reconstructAbstract(inv)).toBe(
      "Deep learning models the citation of the graph"
    );
  });

  it("respects position even when word map is unordered", () => {
    const inv = { world: [1], hello: [0], again: [2] };
    expect(reconstructAbstract(inv)).toBe("hello world again");
  });
});

describe("capAbstract", () => {
  it("cuts at a word boundary and appends an ellipsis", () => {
    const text = "alpha beta gamma delta epsilon";
    const capped = capAbstract(text, 12); // "alpha beta g" -> cut at last space
    expect(capped).toBe("alpha beta…");
    expect(capped.endsWith("…")).toBe(true);
    expect(capped.slice(0, -1).length).toBeLessThanOrEqual(12);
  });

  it("returns text unchanged when under the cap", () => {
    expect(capAbstract("short", 100)).toBe("short");
  });
});

describe("stripJats", () => {
  it("removes tags and decodes entities", () => {
    const jats =
      "<jats:p>We study <jats:italic>graphs</jats:italic> &amp; edges &lt;v&gt;.</jats:p>";
    expect(stripJats(jats)).toBe("We study graphs & edges <v>.");
  });

  it("decodes numeric entities", () => {
    expect(stripJats("<p>a&#8211;b</p>")).toBe("a–b");
  });
});

describe("normDoi", () => {
  it("strips resolver prefixes and lowercases", () => {
    expect(normDoi("https://doi.org/10.1/AbC")).toBe("10.1/abc");
    expect(normDoi("doi:10.1/x")).toBe("10.1/x");
    expect(normDoi("  10.1/Y  ")).toBe("10.1/y");
  });
});

describe("normalizeTitle / hashString", () => {
  it("normalizes titles ignoring punctuation/case", () => {
    expect(normalizeTitle("The Study, Revisited!")).toBe("thestudyrevisited");
  });
  it("hash is stable and differs for different inputs", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});

describe("withQuery / shortId / hostOf", () => {
  it("encodes values but not keys", () => {
    expect(withQuery("https://x/works", { "query.bibliographic": "a b", rows: 1 })).toBe(
      "https://x/works?query.bibliographic=a%20b&rows=1"
    );
  });
  it("drops empty params", () => {
    expect(withQuery("https://x", { a: "", b: undefined, c: "1" })).toBe(
      "https://x?c=1"
    );
  });
  it("extracts the short OpenAlex id", () => {
    expect(shortId("https://openalex.org/W123")).toBe("W123");
    expect(shortId("W123")).toBe("W123");
    expect(shortId(undefined)).toBeUndefined();
  });
  it("returns the host of a url", () => {
    expect(hostOf("https://a.example.org/x")).toBe("a.example.org");
    expect(hostOf("not a url")).toBeUndefined();
  });
});
