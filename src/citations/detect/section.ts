/**
 * References-section locator (spec §5.1). Owned here because Stage 1 must
 * exclude the reference block from the dominant-scheme vote and from overlays,
 * and Stage 2 uses the same boundary to segment entries.
 */
import type { PDFTextContent } from "../types";
import { assembleLines } from "./text";

/** Heading line, allowing leading arabic ("7.") or roman ("VII.") numbering. */
const HEADING =
    /^\s*(?:\d+\.?\s+|[ivxlcdm]+\.?\s+)?(references|bibliography|works cited|literature cited)\s*$/i;

export interface RefBoundary {
    /** 0-based index into the pages array. */
    pageIndex: number;
    /** Global item index (within that page) of the heading's first item. */
    firstItem: number;
}

export function findReferencesSection(
    pages: PDFTextContent[]
): RefBoundary | null {
    for (let p = 0; p < pages.length; p++) {
        const page = pages[p];
        if (!page) continue;
        for (const line of assembleLines(page.items)) {
            if (HEADING.test(line.text.trim())) {
                return { pageIndex: p, firstItem: line.firstItem };
            }
        }
    }
    return null;
}
