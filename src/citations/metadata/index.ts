/**
 * Public surface of the Stage 3 (networked metadata) layer.
 *
 * Typical use from the viewer or a Node smoke script:
 *
 *   import { createMetadataProvider } from "./citations/metadata";
 *   const provider = createMetadataProvider();               // sane defaults
 *   const record = await provider.lookup(resolvedReference);
 *
 * Inject a custom fetch / mailto (e.g. in a live smoke test):
 *
 *   const provider = createMetadataProvider({
 *     mailto: "you@example.com",
 *     fetch: myFetch,        // (url, init?) => Promise<Response>
 *   });
 */
export { createMetadataProvider } from "./chain";
export type { MetadataProviderOptions } from "./chain";
export { MetadataLookupError } from "./errors";
export {
  MemoryCacheStore,
  BrowserStorageCacheStore,
  createCacheStore,
} from "./cache";
export type { CacheStore, CacheEntry } from "./cache";
