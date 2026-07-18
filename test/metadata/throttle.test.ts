import { describe, it, expect, vi } from "vitest";
import { createHttpClient } from "../../src/citations/metadata/throttle";
import { MetadataLookupError } from "../../src/citations/metadata/errors";
import { jsonResponse, statusResponse } from "./helpers";

function client(fetchImpl: any, sleep = vi.fn(async (_ms: number) => undefined), random = () => 1) {
  return {
    http: createHttpClient({ fetch: fetchImpl, now: () => Date.now(), sleep, random }),
    sleep,
  };
}

describe("HttpClient retry/backoff", () => {
  it("retries 429 twice then succeeds, with growing backoff (injected timing)", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      if (n <= 2) return statusResponse(429);
      return jsonResponse({ ok: true });
    });
    const { http, sleep } = client(fetchImpl);
    const res = await http.request("https://api.openalex.org/works");
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // full jitter with random()===1 => delay === base * factor^attempt
    expect(sleep).toHaveBeenCalledTimes(2);
    const d0 = sleep.mock.calls[0]![0] as number;
    const d1 = sleep.mock.calls[1]![0] as number;
    expect(d0).toBe(1000);
    expect(d1).toBe(2000);
    expect(d1).toBeGreaterThan(d0);
  });

  it("honors Retry-After when present", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      return n === 1 ? statusResponse(503, { "retry-after": "2" }) : jsonResponse({});
    });
    const { http, sleep } = client(fetchImpl);
    await http.request("https://api.openalex.org/works");
    expect(sleep.mock.calls[0]![0]).toBe(2000);
  });

  it("gives up after maxRetries on persistent 429", async () => {
    const fetchImpl = vi.fn(async () => statusResponse(429));
    const { http } = client(fetchImpl);
    await expect(http.request("https://x")).rejects.toBeInstanceOf(MetadataLookupError);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it("retries other 5xx exactly once then fails", async () => {
    const fetchImpl = vi.fn(async () => statusResponse(500));
    const { http } = client(fetchImpl);
    await expect(http.request("https://x")).rejects.toBeInstanceOf(MetadataLookupError);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("returns 404 without retrying (no-match signal)", async () => {
    const fetchImpl = vi.fn(async () => statusResponse(404));
    const { http } = client(fetchImpl);
    const res = await http.request("https://x");
    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws MetadataLookupError immediately when fetch rejects (offline)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { http } = client(fetchImpl);
    await expect(http.request("https://x")).rejects.toBeInstanceOf(MetadataLookupError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("limits throughput to <=5 requests per second across hosts", async () => {
    // 6th request within the same second must wait for a token.
    let t = 0;
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });
    const http = createHttpClient({
      fetch: async () => jsonResponse({}),
      now: () => t,
      sleep,
      random: () => 1,
    });
    for (let i = 0; i < 6; i++) await http.request(`https://h${i}/x`);
    // first 5 tokens are free; the 6th triggers a wait
    expect(sleep).toHaveBeenCalled();
  });
});
