import { describe, it, expect } from "vitest";
import {
    MemoryCacheStore,
    MetadataCache,
    createCacheStore,
} from "../../src/citations/metadata/cache";
import type { PaperRecord } from "../../src/citations/types";

const DAY = 24 * 60 * 60 * 1000;

function record(title: string): PaperRecord {
    return {
        title,
        authors: [],
        related: [],
        versions: [],
        scholarUrl: "https://scholar.google.com/scholar?q=x",
        sources: ["openalex"],
        completeness: "partial",
    };
}

describe("MetadataCache", () => {
    it("returns a fresh entry and expires past the TTL", async () => {
        let clock = 1_000_000;
        const cache = new MetadataCache(
            new MemoryCacheStore(),
            () => clock,
            30 * DAY
        );

        await cache.set("k", record("Cached"));
        expect((await cache.get("k"))?.title).toBe("Cached");

        // 29 days later: still fresh.
        clock += 29 * DAY;
        expect((await cache.get("k"))?.title).toBe("Cached");

        // 31 days total: expired.
        clock += 2 * DAY;
        expect(await cache.get("k")).toBeUndefined();
    });

    it("prunes an expired entry from the persistent store", async () => {
        let clock = 0;
        const store = new MemoryCacheStore();
        const cache = new MetadataCache(store, () => clock, DAY);
        await cache.set("k", record("X"));
        clock += 2 * DAY;
        expect(await cache.get("k")).toBeUndefined();
        // fresh cache (no memory tier) also sees it gone from the store
        const cache2 = new MetadataCache(store, () => clock, DAY);
        expect(await cache2.get("k")).toBeUndefined();
    });

    it("reads a persisted entry when the memory tier is cold", async () => {
        const clock = 5000;
        const store = new MemoryCacheStore();
        await new MetadataCache(store, () => clock, 30 * DAY).set(
            "k",
            record("Persisted")
        );
        const cold = new MetadataCache(store, () => clock, 30 * DAY);
        expect((await cold.get("k"))?.title).toBe("Persisted");
    });
});

describe("createCacheStore", () => {
    it("returns a MemoryCacheStore in Node (no browser global)", () => {
        expect(createCacheStore()).toBeInstanceOf(MemoryCacheStore);
    });
});
