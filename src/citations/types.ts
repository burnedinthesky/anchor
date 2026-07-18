/**
 * Shared contract for the citation-preview pipeline (spec §8).
 *
 * This file is the interface boundary between the four stages. It is written
 * first and owned by the orchestrator; stage implementations must code
 * against it and must not edit it without coordination.
 */

// ---------------------------------------------------------------------------
// pdf.js text-layer shapes (minimal subset we depend on)
// ---------------------------------------------------------------------------

/** One text item from pdf.js `page.getTextContent()`. */
export interface TextItem {
    str: string;
    /** 6-element matrix [a, b, c, d, e, f]; e/f are x/y in PDF user space. */
    transform: number[];
    width: number;
    height: number;
    fontName: string;
    dir: string;
    hasEOL?: boolean;
}

export interface PDFTextContent {
    items: TextItem[];
}

/** Minimal viewport interface (pdf.js PageViewport is structurally compatible). */
export interface ViewportLike {
    scale: number;
    convertToViewportPoint(x: number, y: number): [number, number];
}

/**
 * Emitted by the viewer shell (Agent A) once a page's text layer has rendered.
 * Stage 1 detection and the Stage 4 overlay subscribe to this.
 */
export interface PageTextReadyEvent {
    /** 1-based page number. */
    pageNumber: number;
    textContent: PDFTextContent;
    /** The rendered text-layer element the overlay should be mounted over. */
    textLayerDiv: HTMLElement;
    viewport: ViewportLike;
}

// ---------------------------------------------------------------------------
// Stage data model (spec §8)
// ---------------------------------------------------------------------------

export type CitationScheme = "numeric" | "superscript" | "author-year";

export interface CitationMarker {
    id: string; // stable per page+span
    page: number;
    scheme: CitationScheme;
    rawText: string; // e.g. "[12]" or "(Smith et al., 2021)"
    rect: { x: number; y: number; w: number; h: number }; // viewport coords
    ordinal?: number; // numeric schemes (first ordinal for ranges/lists)
    /** All ordinals covered by this marker, e.g. [3,4,5] for "[3-5]". */
    ordinals?: number[];
    authorKey?: string; // author-year, normalized surname
    year?: number; // author-year
}

export interface ResolvedReference {
    markerId: string;
    rawText: string;
    doi?: string;
    hints: { title?: string; authors?: string[]; year?: number };
}

export interface RelatedPaper {
    title: string;
    year?: number;
    scholarUrl: string;
}

export interface PaperVersion {
    label: string;
    url?: string;
}

export type MetadataSource = "openalex" | "crossref" | "semanticscholar";

export interface PaperRecord {
    title: string;
    authors: string[];
    year?: number;
    venue?: string;
    abstract?: string;
    citationCount?: number;
    related: RelatedPaper[];
    versions: PaperVersion[];
    oaPdfUrl?: string;
    scholarUrl: string;
    sources: MetadataSource[];
    completeness: "full" | "partial" | "empty";
}

// ---------------------------------------------------------------------------
// Stage interfaces — implement and test independently
// ---------------------------------------------------------------------------

export interface CitationDetector {
    detect(
        page: number,
        text: PDFTextContent,
        viewport: ViewportLike
    ): CitationMarker[];
}

export interface ReferenceResolver {
    resolve(marker: CitationMarker): ResolvedReference | null;
}

export interface MetadataProvider {
    lookup(ref: ResolvedReference): Promise<PaperRecord>;
}

// ---------------------------------------------------------------------------
// Config constants (spec §8)
// ---------------------------------------------------------------------------

export const MAX_RELATED = 5;
export const MAX_ABSTRACT_CHARS = 600;
export const CACHE_TTL_DAYS = 30;
export const HOVER_DWELL_MS = 400;
export const CARD_WIDTH_PX = 360;

/** Default polite-pool contact; overridable in extension options. */
export const DEFAULT_MAILTO = "andrew.kuo@datalab.to";

export function buildScholarUrl(query: string): string {
    return `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
}
