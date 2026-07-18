/**
 * Stage 2 public API.
 *
 *   const resolver = new BibliographyResolver(allPagesTextContent);
 *   const ref = resolver.resolve(marker); // ResolvedReference | null
 */
export { BibliographyResolver } from "./bibliography";
export { extractDoi, extractTitle, extractAuthors, extractYear } from "./hints";
