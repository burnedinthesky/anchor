/**
 * Stage 1 public API. Agent D (viewer overlay) uses:
 *
 *   const detector = new DocumentCitationDetector(allPagesTextContent);
 *   const markers  = detector.detect(pageNumber, pageTextContent, viewport);
 */
export { DocumentCitationDetector, voteScheme } from "./document-detector";
export { findReferencesSection } from "./section";
export type { RefBoundary } from "./section";
export { normalizeSurname, firstSurname } from "./authorKey";
export { concatPage, assembleLines, medianFontSize } from "./text";
export type { PageText, CharPos, Line } from "./text";
export { findNumericMatches, expandOrdinals } from "./numeric";
export type { RawMatch } from "./numeric";
export { findAuthorYearMatches } from "./authorYear";
export { findSuperscriptRuns } from "./superscript";
export type { SuperRun } from "./superscript";
export { rectsForSpan, rectForItemSpan, fontHeight } from "./geometry";
export type { Rect } from "./geometry";
