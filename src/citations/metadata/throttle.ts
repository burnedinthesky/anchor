/**
 * Provider-global request throttling + retry/backoff.
 *
 * - Token bucket limits to <= `requestsPerSecond` across ALL hosts combined.
 * - HTTP 429 / 503: jittered exponential backoff, up to `maxRetries` retries,
 *   honoring `Retry-After` when present.
 * - Other 5xx: a single retry, then fail.
 * - 404 (and any other non-retryable status) is returned to the caller as-is;
 *   the chain treats 404 as a "no match" signal, not an error.
 * - A rejected `fetch` (offline) throws immediately (no retry) so callers fail
 *   fast; the chain converts it into a `MetadataLookupError`.
 *
 * All timing (`now`, `sleep`) and jitter (`random`) are injected so tests are
 * fully deterministic.
 */
import type { FetchFn, NowFn, SleepFn, RandomFn } from "./internal";
import { MetadataLookupError } from "./errors";

export interface HttpClientOptions {
    fetch: FetchFn;
    now: NowFn;
    sleep: SleepFn;
    random: RandomFn;
    requestsPerSecond?: number;
    maxRetries?: number;
    baseDelayMs?: number;
    factor?: number;
}

export interface HttpClient {
    request(url: string, init?: RequestInit): Promise<Response>;
}

/** Serialized token bucket. `acquire()` resolves once a token is available. */
class TokenBucket {
    private tokens: number;
    private last: number;
    private tail: Promise<void> = Promise.resolve();

    constructor(
        private readonly capacity: number,
        private readonly ratePerMs: number,
        private readonly now: NowFn,
        private readonly sleep: SleepFn
    ) {
        this.tokens = capacity;
        this.last = now();
    }

    acquire(): Promise<void> {
        // Chain acquisitions so only one `take()` runs at a time; this prevents two
        // concurrent callers from both seeing a token that only one should get.
        const run = this.tail.then(() => this.take());
        this.tail = run.catch(() => undefined);
        return run;
    }

    private refill(): void {
        const t = this.now();
        const elapsed = Math.max(0, t - this.last);
        this.last = t;
        this.tokens = Math.min(
            this.capacity,
            this.tokens + elapsed * this.ratePerMs
        );
    }

    private async take(): Promise<void> {
        this.refill();
        while (this.tokens < 1) {
            const deficit = 1 - this.tokens;
            const wait = Math.max(1, Math.ceil(deficit / this.ratePerMs));
            await this.sleep(wait);
            this.refill();
        }
        this.tokens -= 1;
    }
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
    const {
        fetch,
        now,
        sleep,
        random,
        requestsPerSecond = 5,
        maxRetries = 3,
        baseDelayMs = 1000,
        factor = 2,
    } = options;

    const bucket = new TokenBucket(
        requestsPerSecond,
        requestsPerSecond / 1000,
        now,
        sleep
    );

    function backoffDelay(attempt: number, res: Response): number {
        const retryAfter = res.headers.get("retry-after");
        if (retryAfter) {
            const seconds = Number(retryAfter);
            if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
        }
        // Full jitter: random in [0, cap], where cap grows exponentially.
        const cap = baseDelayMs * Math.pow(factor, attempt);
        return random() * cap;
    }

    return {
        async request(url: string, init?: RequestInit): Promise<Response> {
            let attempt = 0;

            while (true) {
                await bucket.acquire();

                let res: Response;
                try {
                    res = await fetch(url, init);
                } catch (cause) {
                    throw new MetadataLookupError(
                        `network error requesting ${url}`,
                        {
                            cause,
                        }
                    );
                }

                const status = res.status;

                if (status === 429 || status === 503) {
                    if (attempt >= maxRetries) {
                        throw new MetadataLookupError(
                            `giving up after ${attempt} retries (HTTP ${status}) for ${url}`,
                            { status }
                        );
                    }
                    await sleep(backoffDelay(attempt, res));
                    attempt++;
                    continue;
                }

                if (status >= 500) {
                    // Other 5xx: a single retry, then fail.
                    if (attempt >= 1) {
                        throw new MetadataLookupError(
                            `HTTP ${status} for ${url}`,
                            {
                                status,
                            }
                        );
                    }
                    await sleep(backoffDelay(attempt, res));
                    attempt++;
                    continue;
                }

                // 2xx, 3xx, 404 and other 4xx are returned as-is.
                return res;
            }
        },
    };
}
