/**
 * Stage 4 — pipeline controller (spec §3, §7).
 *
 * Orchestrates detect -> resolve -> lookup -> card. Constructed with injected
 * factories so it is fully testable without pdf.js or the network:
 *
 *   - `getAllPagesText()` fetches every page's text once (references live at
 *     the end of the document); detector + resolver are built from it.
 *   - `onPageTextReady` streams per-page render events. Events that arrive
 *     before the full-text fetch resolves are queued, then flushed.
 *   - Marker activation opens the card in `loading` synchronously, then
 *     resolves the reference and looks up metadata, driving the card through
 *     success / partial / empty / error.
 *
 * Everything is wrapped so an unexpected exception disables the feature quietly
 * (console.warn) instead of breaking the viewer. Scanned PDFs emit no events,
 * so the feature is simply inert.
 */
import {
  buildScholarUrl,
  type CitationDetector,
  type CitationMarker,
  type MetadataProvider,
  type PageTextReadyEvent,
  type PDFTextContent,
  type ReferenceResolver,
} from "../types";
import { MetadataLookupError } from "../metadata";
import { OverlayManager } from "./overlay";
import { PreviewCard } from "./card";

export interface CitationControllerOptions {
  /** Fetch every page's text content in document order (index 0 = page 1). */
  getAllPagesText: () => Promise<PDFTextContent[]>;
  /** Subscribe to per-page text-ready events (bootstrap.onPageTextReady). */
  onPageTextReady: (listener: (e: PageTextReadyEvent) => void) => void;
  detectorFactory: (pages: PDFTextContent[]) => CitationDetector;
  resolverFactory: (pages: PDFTextContent[]) => ReferenceResolver;
  provider: MetadataProvider;
  hoverPreview: boolean;
  doc?: Document;
}

export class CitationController {
  private readonly opts: CitationControllerOptions;
  private readonly doc: Document;
  private resolver: ReferenceResolver | null = null;
  private overlay: OverlayManager | null = null;
  private ready = false;
  private readonly queue: PageTextReadyEvent[] = [];
  private card: PreviewCard | null = null;
  /** Bumped on every open so stale async results are ignored. */
  private requestSeq = 0;

  constructor(opts: CitationControllerOptions) {
    this.opts = opts;
    this.doc = opts.doc ?? document;
  }

  /** Begin subscribing to events and fetching full text. Never throws. */
  async start(): Promise<void> {
    try {
      this.opts.onPageTextReady((e) => this.handlePage(e));
      const pages = await this.opts.getAllPagesText();
      const detector = this.opts.detectorFactory(pages);
      this.resolver = this.opts.resolverFactory(pages);
      this.overlay = new OverlayManager({
        detector,
        hoverPreview: this.opts.hoverPreview,
        doc: this.doc,
        onActivate: (markers, anchor) => this.openCard(markers, anchor),
      });
      this.ready = true;
      for (const e of this.queue) this.renderPage(e);
      this.queue.length = 0;
    } catch (err) {
      console.warn("[anchor] citation pipeline disabled:", err);
    }
  }

  private handlePage(event: PageTextReadyEvent): void {
    if (!this.ready) {
      this.queue.push(event);
      return;
    }
    this.renderPage(event);
  }

  private renderPage(event: PageTextReadyEvent): void {
    try {
      this.overlay?.renderPage(event);
    } catch (err) {
      console.warn("[anchor] overlay render failed:", err);
    }
  }

  /** Open (or replace) the card for an activated marker group. */
  private openCard(markers: CitationMarker[], anchor: HTMLButtonElement): void {
    const marker = markers[0];
    if (!marker) return;

    // Single-card invariant: close any existing card first.
    this.card?.close();
    const seq = ++this.requestSeq;
    const card = new PreviewCard({
      doc: this.doc,
      onClose: () => {
        if (this.card === card) this.card = null;
      },
    });
    this.card = card;
    card.open(anchor); // loading skeleton, synchronous

    void this.load(marker, card, seq);
  }

  private isCurrent(card: PreviewCard, seq: number): boolean {
    return this.card === card && !card.isClosed() && seq === this.requestSeq;
  }

  private async load(
    marker: CitationMarker,
    card: PreviewCard,
    seq: number
  ): Promise<void> {
    const ref = this.resolver ? this.resolver.resolve(marker) : null;
    if (!ref) {
      if (this.isCurrent(card, seq)) {
        card.showEmpty(buildScholarUrl(marker.rawText));
      }
      return;
    }

    try {
      const record = await this.opts.provider.lookup(ref);
      if (!this.isCurrent(card, seq)) return;
      if (record.completeness === "empty") {
        card.showEmpty(record.scholarUrl);
      } else {
        card.showRecord(record); // success or partial
      }
    } catch (err) {
      if (!this.isCurrent(card, seq)) return;
      if (err instanceof MetadataLookupError) {
        card.showError(() => {
          if (this.isCurrent(card, seq)) {
            card.showLoading();
            void this.retry(ref, card, seq);
          }
        });
      } else {
        console.warn("[anchor] lookup failed unexpectedly:", err);
        card.showError(() => {
          if (this.isCurrent(card, seq)) {
            card.showLoading();
            void this.retry(ref, card, seq);
          }
        });
      }
    }
  }

  private async retry(
    ref: ReturnType<ReferenceResolver["resolve"]>,
    card: PreviewCard,
    seq: number
  ): Promise<void> {
    if (!ref) return;
    try {
      const record = await this.opts.provider.lookup(ref);
      if (!this.isCurrent(card, seq)) return;
      if (record.completeness === "empty") card.showEmpty(record.scholarUrl);
      else card.showRecord(record);
    } catch (err) {
      if (!this.isCurrent(card, seq)) return;
      card.showError(() => {
        if (this.isCurrent(card, seq)) {
          card.showLoading();
          void this.retry(ref, card, seq);
        }
      });
    }
  }

  /** Test / teardown hook. */
  destroy(): void {
    this.card?.close();
    this.card = null;
    this.overlay?.destroy();
  }
}
