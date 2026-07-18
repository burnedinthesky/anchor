/**
 * Typed loader for the JSON TextItem fixtures + a synthetic viewport.
 */
import type { PDFTextContent, ViewportLike } from "../../src/citations/types";

import numericJson from "./numeric.json";
import authorYearJson from "./author-year.json";
import superscriptJson from "./superscript.json";
import noReferencesJson from "./no-references.json";
import wrapJson from "./wrap.json";
import mixedJson from "./mixed.json";

export const fixtures = {
    numeric: numericJson as unknown as PDFTextContent[],
    authorYear: authorYearJson as unknown as PDFTextContent[],
    superscript: superscriptJson as unknown as PDFTextContent[],
    noReferences: noReferencesJson as unknown as PDFTextContent[],
    wrap: wrapJson as unknown as PDFTextContent[],
    mixed: mixedJson as unknown as PDFTextContent[],
};

/**
 * pdf.js-compatible viewport: scales by `scale` and flips the y-axis
 * (PDF origin bottom-left → viewport top-left) using `pageHeight`.
 */
export function makeViewport(scale = 1.5, pageHeight = 792): ViewportLike {
    return {
        scale,
        convertToViewportPoint(x: number, y: number): [number, number] {
            return [x * scale, (pageHeight - y) * scale];
        },
    };
}
