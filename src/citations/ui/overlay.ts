/**
 * Stage 4 — marker overlay (spec §4.3 / §7.1).
 *
 * For each `PageTextReadyEvent`, runs detection and renders a transparent
 * `<button>` over every marker rect in a dedicated per-page layer div. The
 * layer is appended to the page element (the text layer's parent) AFTER
 * pdf.js's own layers and given a high z-index: PDFs with internal hyperref
 * links put an `.annotationLayer` <a> on top of each citation, and it would
 * swallow our clicks (jumping the reader to the references section) if the
 * buttons lived inside the text layer, which paints below it. The layer has
 * the same box as the text layer (inset: 0 of the page), so marker rects in
 * viewport coords need no adjustment and track zoom/scroll identically.
 * Same-`id` markers (line-wrapped matches) become multiple hit-targets that
 * open the one card. Re-emission for a page (pdf.js rebuilds text layers on
 * zoom) clears that page's previous layer first, so no duplicates accrue.
 */
import {
    HOVER_DWELL_MS,
    type CitationDetector,
    type CitationMarker,
    type PageTextReadyEvent,
} from "../types";

const STYLE_ID = "anchor-cite-overlay-style";
const BTN_CLASS = "anchor-cite-btn";
const LAYER_CLASS = "anchor-cite-layer";
/** Extra clickable padding around every marker rect. */
const HITBOX_PAD_PX = 2;

const OVERLAY_CSS = `
.${LAYER_CLASS} {
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* Above .annotationLayer link sections (inline z-index of small integers). */
  z-index: 1000;
}
.${BTN_CLASS} {
  position: absolute;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  box-sizing: border-box;
  border-bottom: 1px solid transparent;
  border-radius: 2px;
  pointer-events: auto;
}
.${BTN_CLASS}:hover,
.${BTN_CLASS}:focus-visible {
  border-bottom-color: currentColor;
  background: rgba(120, 170, 255, 0.18);
  outline: none;
}
`;

/** Callback fired when a marker is activated (click or hover-dwell). */
export type ActivateHandler = (
    markers: CitationMarker[],
    anchor: HTMLButtonElement
) => void;

export interface OverlayManagerOptions {
    detector: CitationDetector;
    onActivate: ActivateHandler;
    /** Open on hover after HOVER_DWELL_MS as well as on click. */
    hoverPreview?: boolean;
    doc?: Document;
}

/** Build the marker's accessible name from its fields (spec §7.4). */
export function markerLabel(marker: CitationMarker): string {
    const stripped = marker.rawText.replace(/^[\s[(]+|[\s\])]+$/g, "").trim();
    return `Citation ${stripped || marker.ordinal || ""}`.trim();
}

function groupById(markers: CitationMarker[]): Map<string, CitationMarker[]> {
    const groups = new Map<string, CitationMarker[]>();
    for (const m of markers) {
        const g = groups.get(m.id);
        if (g) g.push(m);
        else groups.set(m.id, [m]);
    }
    return groups;
}

export class OverlayManager {
    private readonly detector: CitationDetector;
    private readonly onActivate: ActivateHandler;
    private readonly hoverPreview: boolean;
    private readonly doc: Document;
    private readonly pageLayers = new Map<number, HTMLElement>();

    constructor(opts: OverlayManagerOptions) {
        this.detector = opts.detector;
        this.onActivate = opts.onActivate;
        this.hoverPreview = opts.hoverPreview ?? false;
        this.doc = opts.doc ?? document;
        this.injectStyle();
    }

    private injectStyle(): void {
        if (this.doc.getElementById(STYLE_ID)) return;
        const style = this.doc.createElement("style");
        style.id = STYLE_ID;
        style.textContent = OVERLAY_CSS;
        (this.doc.head ?? this.doc.documentElement).appendChild(style);
    }

    /**
     * Detect + render markers for one page, replacing any previous overlay.
     * Returns the mounted layer (null when the page has no markers).
     */
    renderPage(event: PageTextReadyEvent): HTMLElement | null {
        const { pageNumber, textContent, textLayerDiv, viewport } = event;
        this.clearPage(pageNumber, textLayerDiv);

        let markers: CitationMarker[];
        try {
            markers = this.detector.detect(pageNumber, textContent, viewport);
        } catch (err) {
            console.warn(
                `[anchor] detection failed for page ${pageNumber}:`,
                err
            );
            return null;
        }

        if (markers.length === 0) return null;

        const layer = this.doc.createElement("div");
        layer.className = LAYER_CLASS;
        layer.dataset.page = String(pageNumber);
        const pageEl = textLayerDiv.parentElement;
        for (const group of groupById(markers).values()) {
            for (const marker of group) {
                const rect = this.effectiveRect(
                    marker.rect,
                    pageEl,
                    textLayerDiv
                );
                layer.appendChild(this.createButton(marker, group, rect));
            }
        }
        // Sibling of (and DOM-after) pdf.js's text/annotation layers so it paints
        // above the PDF's own link annotations; falls back to the text layer
        // itself when it is detached (unit tests, unusual embeddings).
        (textLayerDiv.parentElement ?? textLayerDiv).appendChild(layer);
        this.pageLayers.set(pageNumber, layer);
        return layer;
    }

    private clearPage(pageNumber: number, textLayerDiv: HTMLElement): void {
        this.pageLayers.get(pageNumber)?.remove();
        this.pageLayers.delete(pageNumber);
        // Belt-and-braces: drop any stray layers left after a page rebuild. The
        // page element only ever hosts its own page's layer.
        textLayerDiv.parentElement
            ?.querySelectorAll(`.${LAYER_CLASS}`)
            .forEach((n) => n.remove());
        textLayerDiv
            .querySelectorAll(`.${LAYER_CLASS}`)
            .forEach((n) => n.remove());
    }

    /**
     * The button's final rect: the marker's glyph rect, expanded to fully
     * cover any intersecting internal-link annotation, plus a small pad.
     *
     * The PDF's own citation links (`.annotationLayer a[href^="#"]`) are
     * padded boxes, typically a few px taller and wider than the glyphs.
     * A button that covers only the glyphs leaves a strip where clicks fall
     * through to the link (jumping to the bibliography) and where the link's
     * own :hover style washes out the line — so wherever we overlap a link at
     * all, we must eclipse it completely.
     */
    private effectiveRect(
        rect: CitationMarker["rect"],
        pageEl: HTMLElement | null,
        textLayerDiv: HTMLElement
    ): CitationMarker["rect"] {
        const baseRight = rect.x + rect.w;
        const baseBottom = rect.y + rect.h;
        let { x, y } = rect;
        let right = baseRight;
        let bottom = baseBottom;

        if (pageEl) {
            // Origin for client->local conversion: the text layer, NOT the
            // page element — pdf.js gives .page a transparent border, and
            // absolutely-positioned layers (ours and the text layer) originate
            // at the padding box inside it.
            const originRect = textLayerDiv.getBoundingClientRect();
            for (const a of pageEl.querySelectorAll<HTMLAnchorElement>(
                '.annotationLayer a[href^="#"]'
            )) {
                const ar = a.getBoundingClientRect();
                if (ar.width <= 0 || ar.height <= 0) continue;
                // Skip non-text-line links (large destination boxes).
                if (ar.height > rect.h * 2.5 + 8) continue;
                const lx = ar.left - originRect.left;
                const ly = ar.top - originRect.top;
                const lr = lx + ar.width;
                const lb = ly + ar.height;
                // Overlap is measured against the ORIGINAL glyph rect — using
                // the growing union would cascade down a multi-cite line,
                // swallowing the neighbors' links (wrong-target clicks). And
                // it must be a substantial share of the link box: adjacent
                // cites brush each other's links by a sliver, which is not
                // ownership.
                const overlapX = Math.min(baseRight, lr) - Math.max(rect.x, lx);
                const overlapY =
                    Math.min(baseBottom, lb) - Math.max(rect.y, ly);
                if (overlapX <= 0 || overlapY <= 0) continue;
                const anchorArea = ar.width * ar.height;
                if (overlapX * overlapY < anchorArea * 0.25) continue;
                x = Math.min(x, lx);
                y = Math.min(y, ly);
                right = Math.max(right, lr);
                bottom = Math.max(bottom, lb);
            }
        }

        return {
            x: x - HITBOX_PAD_PX,
            y: y - HITBOX_PAD_PX,
            w: right - x + 2 * HITBOX_PAD_PX,
            h: bottom - y + 2 * HITBOX_PAD_PX,
        };
    }

    private createButton(
        marker: CitationMarker,
        group: CitationMarker[],
        rect: CitationMarker["rect"]
    ): HTMLButtonElement {
        const btn = this.doc.createElement("button");
        btn.type = "button";
        btn.className = BTN_CLASS;
        btn.setAttribute("aria-label", markerLabel(marker));
        btn.dataset.markerId = marker.id;
        const { x, y, w, h } = rect;
        btn.style.left = `${x}px`;
        btn.style.top = `${y}px`;
        btn.style.width = `${w}px`;
        btn.style.height = `${h}px`;

        btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.onActivate(group, btn);
        });

        if (this.hoverPreview) {
            let timer: ReturnType<typeof setTimeout> | null = null;
            btn.addEventListener("mouseenter", () => {
                timer = setTimeout(() => {
                    timer = null;
                    this.onActivate(group, btn);
                }, HOVER_DWELL_MS);
            });
            const cancel = (): void => {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
            };
            btn.addEventListener("mouseleave", cancel);
        }

        return btn;
    }

    /** Remove all overlay layers (feature teardown). */
    destroy(): void {
        for (const layer of this.pageLayers.values()) layer.remove();
        this.pageLayers.clear();
    }
}
