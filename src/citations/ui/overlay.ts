/**
 * Stage 4 — marker overlay (spec §4.3 / §7.1).
 *
 * For each `PageTextReadyEvent`, runs detection and renders a transparent
 * `<button>` over every marker rect INSIDE the event's `textLayerDiv` (which
 * shares the text layer's transform, so overlays track zoom/scroll for free).
 * Same-`id` markers (line-wrapped matches) become multiple hit-targets that
 * open the one card. Re-emission for a page (pdf.js rebuilds text layers on
 * zoom) clears that page's previous buttons first, so no duplicates accrue.
 */
import {
  HOVER_DWELL_MS,
  type CitationDetector,
  type CitationMarker,
  type PageTextReadyEvent,
} from "../types";

const STYLE_ID = "anchor-cite-overlay-style";
const BTN_CLASS = "anchor-cite-btn";

const OVERLAY_CSS = `
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
  z-index: 5;
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
  private readonly pageNodes = new Map<number, HTMLButtonElement[]>();

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

  /** Detect + render markers for one page, replacing any previous overlay. */
  renderPage(event: PageTextReadyEvent): void {
    const { pageNumber, textContent, textLayerDiv, viewport } = event;
    this.clearPage(pageNumber, textLayerDiv);

    let markers: CitationMarker[];
    try {
      markers = this.detector.detect(pageNumber, textContent, viewport);
    } catch (err) {
      console.warn(`[anchor] detection failed for page ${pageNumber}:`, err);
      return;
    }

    const nodes: HTMLButtonElement[] = [];
    for (const group of groupById(markers).values()) {
      for (const marker of group) {
        const btn = this.createButton(marker, group);
        textLayerDiv.appendChild(btn);
        nodes.push(btn);
      }
    }
    this.pageNodes.set(pageNumber, nodes);
  }

  private clearPage(pageNumber: number, textLayerDiv: HTMLElement): void {
    for (const node of this.pageNodes.get(pageNumber) ?? []) node.remove();
    this.pageNodes.delete(pageNumber);
    // Belt-and-braces: drop any strays left in the (possibly rebuilt) div.
    textLayerDiv
      .querySelectorAll(`.${BTN_CLASS}`)
      .forEach((n) => n.remove());
  }

  private createButton(
    marker: CitationMarker,
    group: CitationMarker[]
  ): HTMLButtonElement {
    const btn = this.doc.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.setAttribute("aria-label", markerLabel(marker));
    btn.dataset.markerId = marker.id;
    const { x, y, w, h } = marker.rect;
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

  /** Remove all overlay buttons (feature teardown). */
  destroy(): void {
    for (const nodes of this.pageNodes.values()) {
      for (const n of nodes) n.remove();
    }
    this.pageNodes.clear();
  }
}
