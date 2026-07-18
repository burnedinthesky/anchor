/**
 * Internal shared types for the metadata layer. These are implementation
 * details and are NOT part of the cross-stage contract in `src/citations/types.ts`.
 */
import type { RelatedPaper, PaperVersion } from "../types";

/** Narrowed `fetch` signature we depend on. `globalThis.fetch` is assignable. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Injectable clock (ms since epoch). */
export type NowFn = () => number;

/** Injectable delay, so retry/throttle timing is controllable in tests. */
export type SleepFn = (ms: number) => Promise<void>;

/** Injectable [0,1) source, so jitter is deterministic in tests. */
export type RandomFn = () => number;

/**
 * Normalized fields produced by a single backend. The chain merges several of
 * these (first-wins by source priority) into a `PaperRecord`.
 */
export interface SourceResult {
    title?: string;
    authors?: string[];
    year?: number;
    venue?: string;
    abstract?: string;
    citationCount?: number;
    related?: RelatedPaper[];
    versions?: PaperVersion[];
    oaPdfUrl?: string;
    /** DOI discovered by this source (e.g. Crossref bibliographic search). */
    doi?: string;
}
