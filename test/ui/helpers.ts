/** Shared stubs/factories for the Stage 4 UI tests (no pdf.js, no network). */
import type {
    CitationMarker,
    PageTextReadyEvent,
    PaperRecord,
    ViewportLike,
} from "../../src/citations/types";

export function makeMarker(over: Partial<CitationMarker> = {}): CitationMarker {
    return {
        id: "p1#10",
        page: 1,
        scheme: "numeric",
        rawText: "[12]",
        rect: { x: 100, y: 200, w: 20, h: 12 },
        ordinal: 12,
        ordinals: [12],
        ...over,
    };
}

export function makeRecord(over: Partial<PaperRecord> = {}): PaperRecord {
    return {
        title: "Deep Learning for Citation Graphs",
        authors: ["A. Smith", "B. Jones", "C. Lee", "D. Park", "E. Kim"],
        year: 2021,
        venue: "NeurIPS",
        abstract: "A".repeat(400),
        citationCount: 142,
        related: [
            {
                title: "Related One",
                scholarUrl: "https://scholar.google.com/scholar?q=r1",
            },
            {
                title: "Related Two",
                scholarUrl: "https://scholar.google.com/scholar?q=r2",
            },
        ],
        versions: [
            { label: "arxiv.org", url: "https://arxiv.org/abs/1" },
            { label: "publisher (no link)" },
        ],
        oaPdfUrl: "https://example.org/paper.pdf",
        scholarUrl: "https://scholar.google.com/scholar?q=deep+learning",
        sources: ["openalex"],
        completeness: "full",
        ...over,
    };
}

const viewport: ViewportLike = {
    scale: 1,
    convertToViewportPoint: (x, y) => [x, y],
};

export function makeEvent(
    pageNumber: number,
    textLayerDiv: HTMLElement
): PageTextReadyEvent {
    return {
        pageNumber,
        textContent: { items: [] },
        textLayerDiv,
        viewport,
    };
}

/** Rect object shaped like getBoundingClientRect(). */
export function rect(
    left: number,
    top: number,
    width: number,
    height: number
): DOMRect {
    return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        toJSON() {},
    } as DOMRect;
}

/**
 * pdf.js-like page DOM: a `.page` element containing a `.textLayer` child.
 * The overlay mounts its layer as a sibling of the text layer, inside `page`.
 */
export function makePageDom(): { page: HTMLElement; textLayer: HTMLElement } {
    const page = document.createElement("div");
    page.className = "page";
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    page.appendChild(textLayer);
    document.body.appendChild(page);
    return { page, textLayer };
}

/** Flush pending microtasks. */
export function flush(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0));
}

export function cardHost(): HTMLElement | null {
    return document.querySelector<HTMLElement>("[data-anchor-card-host]");
}

export function cardRoot(): ShadowRoot {
    const host = cardHost();
    if (!host?.shadowRoot) throw new Error("no card mounted");
    return host.shadowRoot;
}
