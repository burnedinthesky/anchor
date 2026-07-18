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
    /** Pages whose overlay is currently mounted. */
    private readonly mountedPages = new Set<number>();
    /** A citation-link click swallowed while its page's overlay was pending. */
    private pendingClick: {
        page: number;
        x: number;
        y: number;
        at: number;
    } | null = null;

    constructor(opts: CitationControllerOptions) {
        this.opts = opts;
        this.doc = opts.doc ?? document;
    }

    /** Begin subscribing to events and fetching full text. Never throws. */
    async start(): Promise<void> {
        try {
            this.installClickGuard();
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
            const layer = this.overlay?.renderPage(event) ?? null;
            this.mountedPages.add(event.pageNumber);
            this.replayPendingClick(event.pageNumber, layer);
        } catch (err) {
            console.warn("[anchor] overlay render failed:", err);
        }
    }

    /**
     * First-click race guard. A page becomes clickable (with the PDF's own
     * citation link annotations) before detection finishes and the overlay
     * mounts — most visibly right after the document opens, while the
     * full-document text fetch is still running. A click in that window used
     * to activate the underlying `#cite.*` link and jump the reader to the
     * bibliography. Capture such clicks, block the jump, and replay them
     * against the marker buttons once the page's overlay mounts.
     */
    private installClickGuard(): void {
        this.doc.addEventListener(
            "click",
            (ev) => this.guardCiteLinkClick(ev),
            true
        );
    }

    private guardCiteLinkClick(ev: MouseEvent): void {
        const target = ev.target as Element | null;
        const link = target?.closest?.(
            'a[href*="#cite"], a[href*="#bib"]'
        ) as HTMLAnchorElement | null;
        if (!link) return;
        const pageDiv = link.closest(".page");
        const pageNumber = Number(
            pageDiv?.getAttribute("data-page-number") ?? NaN
        );
        if (!Number.isFinite(pageNumber)) return;
        // Overlay live: a click that still reached the link means no marker
        // covers it (detection miss) — the PDF's own jump is the right
        // fallback there.
        if (this.mountedPages.has(pageNumber)) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.pendingClick = {
            page: pageNumber,
            x: ev.clientX,
            y: ev.clientY,
            at: Date.now(),
        };
    }

    private replayPendingClick(page: number, layer: HTMLElement | null): void {
        const pc = this.pendingClick;
        if (!pc || pc.page !== page || !layer) return;
        this.pendingClick = null;
        if (Date.now() - pc.at > 5000) return; // stale; user moved on
        for (const btn of layer.querySelectorAll<HTMLButtonElement>("button")) {
            const r = btn.getBoundingClientRect();
            if (
                pc.x >= r.left &&
                pc.x <= r.right &&
                pc.y >= r.top &&
                pc.y <= r.bottom
            ) {
                btn.click();
                return;
            }
        }
    }

    /** Open (or replace) the card for an activated marker group. */
    private openCard(
        markers: CitationMarker[],
        anchor: HTMLButtonElement
    ): void {
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
        return (
            this.card === card && !card.isClosed() && seq === this.requestSeq
        );
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
            if (record.completeness === "empty")
                card.showEmpty(record.scholarUrl);
            else card.showRecord(record);
        } catch {
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
