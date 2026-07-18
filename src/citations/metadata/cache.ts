/**
 * Two-tier cache: an in-memory Map in front of a pluggable `CacheStore`.
 *
 * - Entries carry `storedAt`; anything older than the TTL is ignored and pruned.
 * - The persistent tier is abstracted so the same code runs in the extension
 *   viewer (browser.storage.local) and in plain Node (memory). The factory
 *   picks automatically and NOTHING touches `browser` at import time.
 */
import type { PaperRecord } from "../types";
import type { NowFn } from "./internal";

export interface CacheEntry {
  record: PaperRecord;
  /** ms since epoch when this entry was written. */
  storedAt: number;
}

/** Persistence boundary. Implementations must be safe to construct lazily. */
export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
}

/** In-memory store; used in Node/tests and as the default fallback. */
export class MemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, CacheEntry>();

  async get(key: string): Promise<CacheEntry | undefined> {
    return this.map.get(key);
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    this.map.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/**
 * Persists to `browser.storage.local`. `browser` is only referenced inside
 * methods, so importing this module never throws in Node. Only instantiated by
 * the factory when a `browser.storage.local` is actually present.
 */
export class BrowserStorageCacheStore implements CacheStore {
  private readonly prefix: string;

  constructor(prefix = "anchor:meta:") {
    this.prefix = prefix;
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const k = this.prefix + key;
    const bag = await browser.storage.local.get(k);
    const value = (bag as Record<string, unknown>)[k];
    return (value as CacheEntry | undefined) ?? undefined;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    await browser.storage.local.set({ [this.prefix + key]: entry });
  }

  async delete(key: string): Promise<void> {
    await browser.storage.local.remove(this.prefix + key);
  }
}

/** Pick a persistence tier without touching `browser` unless it exists. */
export function createCacheStore(): CacheStore {
  if (
    typeof browser !== "undefined" &&
    browser?.storage?.local !== undefined
  ) {
    return new BrowserStorageCacheStore();
  }
  return new MemoryCacheStore();
}

export class MetadataCache {
  private readonly mem = new Map<string, CacheEntry>();

  constructor(
    private readonly store: CacheStore,
    private readonly now: NowFn,
    private readonly ttlMs: number
  ) {}

  private fresh(entry: CacheEntry): boolean {
    return this.now() - entry.storedAt < this.ttlMs;
  }

  async get(key: string): Promise<PaperRecord | undefined> {
    const local = this.mem.get(key);
    if (local) {
      if (this.fresh(local)) return local.record;
      this.mem.delete(key);
      await this.store.delete(key);
      return undefined;
    }

    const persisted = await this.store.get(key);
    if (!persisted) return undefined;
    if (!this.fresh(persisted)) {
      await this.store.delete(key);
      return undefined;
    }
    this.mem.set(key, persisted);
    return persisted.record;
  }

  async set(key: string, record: PaperRecord): Promise<void> {
    const entry: CacheEntry = { record, storedAt: this.now() };
    this.mem.set(key, entry);
    await this.store.set(key, entry);
  }
}
