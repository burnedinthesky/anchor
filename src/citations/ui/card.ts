/**
 * Stage 4 — the preview card (spec §7).
 *
 * A shadow-DOM overlay appended to `document.body`, `position: fixed`, so page
 * CSS cannot leak in and the card can never shift the document's layout or
 * reading position. Renders the five states (loading / success / partial /
 * empty / error), anchors near the marker (flipping to stay on screen), is a
 * focus-trapped `role="dialog"`, and is dismissed by outside pointerdown, Esc
 * (restoring focus to the marker), the marker scrolling out of view, or another
 * card opening.
 */
import { CARD_WIDTH_PX, buildScholarUrl, type PaperRecord } from "../types";

/** Gap between the marker and the card, and margin from the viewport edge. */
const GAP_PX = 6;
const EDGE_MARGIN_PX = 8;
/** Authors shown before collapsing the rest into "+N more". */
const AUTHOR_LIMIT = 3;

export interface CardPoint {
    left: number;
    top: number;
}
export interface RectLike {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

/**
 * Pure anchoring math (unit-tested directly). Prefers below-right of the
 * marker; flips above / left to stay within the viewport; never overlaps the
 * marker rect vertically.
 */
export function computeCardPosition(
    anchor: RectLike,
    card: { w: number; h: number },
    viewportW: number,
    viewportH: number,
    gap = GAP_PX,
    margin = EDGE_MARGIN_PX
): CardPoint {
    // Horizontal: prefer left-aligned to the marker (card extends rightward).
    let left = anchor.left;
    if (left + card.w + margin > viewportW) {
        // Flip: align the card's right edge to the marker's right edge.
        left = anchor.right - card.w;
        if (left < margin) left = viewportW - card.w - margin;
    }
    if (left < margin) left = margin;

    // Vertical: prefer below the marker, else above; never overlap the marker.
    const spaceBelow = viewportH - anchor.bottom - gap;
    const spaceAbove = anchor.top - gap;
    let top: number;
    if (card.h <= spaceBelow) {
        top = anchor.bottom + gap;
    } else if (card.h <= spaceAbove) {
        top = anchor.top - gap - card.h;
    } else if (spaceBelow >= spaceAbove) {
        // Neither side fits fully; more room below. Stays below the marker.
        top = anchor.bottom + gap;
    } else {
        // More room above; clamp to the margin (top+h <= anchor.top, no overlap).
        top = Math.max(margin, anchor.top - gap - card.h);
    }
    return { left, top };
}

const CARD_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.card {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  width: 100%;
  max-height: 60vh;
  overflow-y: auto;
  background: var(--anchor-card-bg, #ffffff);
  color: var(--anchor-card-fg, #1a1a1a);
  border: 1px solid var(--anchor-card-border, #d5d5d5);
  border-radius: 10px;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.22);
  padding: 14px 16px;
  font-size: 13px;
  line-height: 1.45;
  transition: opacity 120ms ease;
}
@media (prefers-reduced-motion: reduce) { .card { transition: none; } }
.card a { color: var(--anchor-card-link, #1a5fb4); text-decoration: none; }
.card a:hover { text-decoration: underline; }
.title { font-size: 15px; font-weight: 600; margin: 0 0 6px; line-height: 1.3; }
.title a { color: var(--anchor-card-fg, #1a1a1a); }
.meta { color: var(--anchor-card-muted, #666); margin: 0 0 8px; }
.authors { margin: 0 0 8px; }
.abstract { margin: 0 0 8px; white-space: pre-wrap; }
.abstract.clamped {
  display: -webkit-box; -webkit-line-clamp: 12; -webkit-box-orient: vertical;
  overflow: hidden;
}
.toggle, .btn {
  font: inherit; cursor: pointer; background: none; border: none; padding: 0;
  color: var(--anchor-card-link, #1a5fb4);
}
.toggle:hover { text-decoration: underline; }
.metrics { margin: 0; color: var(--anchor-card-muted, #666); white-space: nowrap; }
.info {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px;
  min-width: 0; color: var(--anchor-card-muted, #666);
}
.versions-label { font-weight: 600; }
.buttons { display: flex; gap: 8px; flex-wrap: wrap; }
/* Footer: additional info (cited by, versions) shares a row with the actions. */
.actions {
  display: flex; gap: 10px 14px; flex-wrap: wrap; margin-top: 12px;
  align-items: center; justify-content: space-between;
}
.actions .btn, .actions a.btn {
  border: 1px solid var(--anchor-card-border, #d5d5d5);
  border-radius: 6px; padding: 5px 10px; text-decoration: none;
  color: var(--anchor-card-fg, #1a1a1a); background: var(--anchor-card-btn, #f6f6f6);
  display: inline-block;
}
.actions .btn.primary, .actions a.btn.primary {
  background: var(--anchor-card-accent, #1a5fb4);
  border-color: var(--anchor-card-accent, #1a5fb4); color: #fff;
}
.note { color: var(--anchor-card-muted, #888); font-style: italic; margin: 8px 0 0; }
.empty, .error { margin: 4px 0 12px; }
/* Loading skeleton */
.sk { background: var(--anchor-card-skeleton, #e9e9e9); border-radius: 4px; }
.sk-title { height: 16px; width: 80%; margin-bottom: 10px; }
.sk-line { height: 10px; margin-bottom: 7px; }
.sk-line.short { width: 55%; }
@keyframes anchor-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
.sk { animation: anchor-pulse 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .sk { animation: none; } }

@media (prefers-color-scheme: dark) {
  .card {
    --anchor-card-bg: #26282c; --anchor-card-fg: #e8e8e8;
    --anchor-card-border: #45484d; --anchor-card-muted: #a6a6a6;
    --anchor-card-link: #7cb0ff; --anchor-card-btn: #33363b;
    --anchor-card-accent: #3584e4; --anchor-card-skeleton: #3a3d42;
  }
}
/* Explicit theme attribute on the host wins in both directions. */
:host([data-theme="light"]) .card {
  --anchor-card-bg: #ffffff; --anchor-card-fg: #1a1a1a;
  --anchor-card-border: #d5d5d5; --anchor-card-muted: #666666;
  --anchor-card-link: #1a5fb4; --anchor-card-btn: #f6f6f6;
  --anchor-card-accent: #1a5fb4; --anchor-card-skeleton: #e9e9e9;
}
:host([data-theme="dark"]) .card {
  --anchor-card-bg: #26282c; --anchor-card-fg: #e8e8e8;
  --anchor-card-border: #45484d; --anchor-card-muted: #a6a6a6;
  --anchor-card-link: #7cb0ff; --anchor-card-btn: #33363b;
  --anchor-card-accent: #3584e4; --anchor-card-skeleton: #3a3d42;
}
`;

export interface PreviewCardOptions {
    doc?: Document;
    /** Called whenever the card closes (by any route) so the owner can clear it. */
    onClose?: () => void;
}

export class PreviewCard {
    private readonly doc: Document;
    private readonly win: Window;
    private readonly onClose?: () => void;
    private readonly host: HTMLElement;
    private readonly root: ShadowRoot;
    private readonly card: HTMLElement;
    private anchor: HTMLElement | null = null;
    private io: IntersectionObserver | null = null;
    private closed = false;

    private readonly onDocPointerDown = (ev: Event): void => {
        if (!this.host.contains(ev.target as Node)) this.close();
    };
    private readonly onKeyDown = (ev: KeyboardEvent): void => {
        if (ev.key === "Escape") {
            ev.stopPropagation();
            this.close();
        } else if (ev.key === "Tab") {
            this.trapTab(ev);
        }
    };
    private readonly onReposition = (): void => this.reposition();

    constructor(opts: PreviewCardOptions = {}) {
        this.doc = opts.doc ?? document;
        this.win = this.doc.defaultView ?? window;
        this.onClose = opts.onClose;

        this.host = this.doc.createElement("div");
        this.host.setAttribute("data-anchor-card-host", "");
        // Fixed overlay above pdf.js chrome (which tops out near 100001).
        this.host.style.cssText = `position: fixed; top: 0; left: 0; width: ${CARD_WIDTH_PX}px; z-index: 2147483000; margin: 0; padding: 0;`;
        this.root = this.host.attachShadow({ mode: "open" });

        const style = this.doc.createElement("style");
        style.textContent = CARD_CSS;
        this.root.appendChild(style);

        this.card = this.doc.createElement("div");
        this.card.className = "card";
        this.card.setAttribute("role", "dialog");
        this.card.setAttribute("aria-modal", "true");
        this.card.setAttribute("aria-label", "Citation preview");
        this.card.tabIndex = -1;
        this.root.appendChild(this.card);
    }

    /** Mount the card, anchored to `anchor`, and show the loading skeleton. */
    open(anchor: HTMLElement): void {
        this.anchor = anchor;
        this.doc.body.appendChild(this.host);
        this.showLoading();
        this.reposition();

        this.doc.addEventListener("pointerdown", this.onDocPointerDown, true);
        this.doc.addEventListener("keydown", this.onKeyDown, true);
        this.win.addEventListener("resize", this.onReposition);
        this.observeAnchor();

        this.card.focus({ preventScroll: true });
    }

    private observeAnchor(): void {
        if (!this.anchor || typeof IntersectionObserver === "undefined") return;
        this.io = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (!e.isIntersecting) {
                        this.close();
                        return;
                    }
                }
            },
            { threshold: 0 }
        );
        this.io.observe(this.anchor);
    }

    /** Re-anchor within the viewport (called after mount and after state change). */
    reposition(): void {
        if (this.closed || !this.anchor) return;
        const a = this.anchor.getBoundingClientRect();
        const c = this.card.getBoundingClientRect();
        const pos = computeCardPosition(
            a,
            { w: c.width || CARD_WIDTH_PX, h: c.height },
            this.win.innerWidth,
            this.win.innerHeight
        );
        this.host.style.left = `${pos.left}px`;
        this.host.style.top = `${pos.top}px`;
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.doc.removeEventListener(
            "pointerdown",
            this.onDocPointerDown,
            true
        );
        this.doc.removeEventListener("keydown", this.onKeyDown, true);
        this.win.removeEventListener("resize", this.onReposition);
        this.io?.disconnect();
        this.io = null;
        this.host.remove();
        // Restore focus without scrolling the document (spec §7.4 / acceptance 11).
        this.anchor?.focus({ preventScroll: true });
        this.onClose?.();
    }

    isClosed(): boolean {
        return this.closed;
    }

    // -- state renderers ------------------------------------------------------

    showLoading(): void {
        this.clear();
        const sk = (cls: string): HTMLElement => this.el("div", `sk ${cls}`);
        this.card.appendChild(sk("sk-title"));
        this.card.appendChild(sk("sk-line"));
        this.card.appendChild(sk("sk-line"));
        this.card.appendChild(sk("sk-line short"));
        this.refocusIfNeeded();
        this.reposition();
    }

    showRecord(record: PaperRecord): void {
        this.clear();
        const partial = record.completeness === "partial";

        // Title -> Scholar deep link.
        const title = this.el("h2", "title");
        title.appendChild(
            this.link(record.title || "Untitled", record.scholarUrl)
        );
        this.card.appendChild(title);

        // year · venue
        const metaBits = [
            record.year != null ? String(record.year) : "",
            record.venue ?? "",
        ].filter((s) => s !== "");
        if (metaBits.length) {
            const meta = this.el("p", "meta");
            meta.textContent = metaBits.join(" · ");
            this.card.appendChild(meta);
        }

        // Authors, truncated with "+N more".
        if (record.authors.length) {
            const authors = this.el("p", "authors");
            const shown = record.authors.slice(0, AUTHOR_LIMIT);
            let text = shown.join(", ");
            const extra = record.authors.length - shown.length;
            if (extra > 0) text += `, +${extra} more`;
            authors.textContent = text;
            this.card.appendChild(authors);
        }

        // Abstract, clamped to a fixed number of lines with a "Show more"
        // toggle — but only when the clamp actually truncates the text.
        if (record.abstract) {
            const abs = this.el("p", "abstract");
            abs.textContent = record.abstract;
            abs.classList.add("clamped");
            this.card.appendChild(abs);
            if (this.isOverflowing(abs)) {
                const toggle = this.el("button", "toggle") as HTMLButtonElement;
                toggle.type = "button";
                toggle.textContent = "Show more";
                toggle.addEventListener("click", () => {
                    const clamped = abs.classList.toggle("clamped");
                    toggle.textContent = clamped ? "Show more" : "Show less";
                    this.reposition();
                });
                this.card.appendChild(toggle);
            } else {
                // Already fits within the clamp — show it whole, no toggle.
                abs.classList.remove("clamped");
            }
        }

        // Footer row: additional info (cited by, versions) sits on the same
        // row as the action buttons, info left / buttons right.
        const footer = this.el("div", "actions");

        const info = this.el("div", "info");
        if (record.citationCount != null) {
            const m = this.el("span", "metrics");
            m.textContent = `Cited by ${record.citationCount}`;
            info.appendChild(m);
        }
        if (record.versions.length) {
            // A single link rather than the host list — Scholar's version
            // cluster is the useful destination, not our enumeration.
            const versions = this.el("span", "versions");
            versions.appendChild(
                this.link(
                    `Versions (${record.versions.length})`,
                    record.scholarUrl
                )
            );
            info.appendChild(versions);
        }
        if (info.childNodes.length) footer.appendChild(info);

        const buttons = this.el("div", "buttons");
        if (record.oaPdfUrl) {
            buttons.appendChild(
                this.link("Open PDF", record.oaPdfUrl, "btn primary")
            );
        }
        buttons.appendChild(
            this.link("View on Google Scholar", record.scholarUrl, "btn")
        );
        footer.appendChild(buttons);

        this.card.appendChild(footer);

        if (partial) {
            const note = this.el("p", "note");
            note.textContent = "Some details unavailable.";
            this.card.appendChild(note);
        }

        this.refocusIfNeeded();
        this.reposition();
    }

    showEmpty(scholarUrl: string): void {
        this.clear();
        const msg = this.el("p", "empty");
        msg.textContent = "Couldn't resolve this reference.";
        this.card.appendChild(msg);
        const actions = this.el("div", "actions");
        actions.appendChild(
            this.link("Search on Google Scholar", scholarUrl, "btn primary")
        );
        this.card.appendChild(actions);
        this.refocusIfNeeded();
        this.reposition();
    }

    showError(onRetry: () => void): void {
        this.clear();
        const msg = this.el("p", "error");
        msg.textContent = "Couldn't load reference details.";
        this.card.appendChild(msg);
        const actions = this.el("div", "actions");
        const retry = this.el("button", "btn primary") as HTMLButtonElement;
        retry.type = "button";
        retry.textContent = "Retry";
        retry.addEventListener("click", () => onRetry());
        actions.appendChild(retry);
        this.card.appendChild(actions);
        this.refocusIfNeeded();
        this.reposition();
    }

    /** Static helper for the empty state when only raw text is available. */
    static scholarUrlFor(record: PaperRecord | null, rawText: string): string {
        return record?.scholarUrl ?? buildScholarUrl(rawText);
    }

    // -- DOM helpers ----------------------------------------------------------

    private clear(): void {
        this.card.textContent = "";
    }

    private el(tag: string, className?: string): HTMLElement {
        const e = this.doc.createElement(tag);
        if (className) e.className = className;
        return e;
    }

    /** True when the element's content is taller than its (clamped) box. */
    private isOverflowing(el: HTMLElement): boolean {
        return el.scrollHeight - el.clientHeight > 1;
    }

    private link(text: string, href: string, className?: string): HTMLElement {
        const a = this.doc.createElement("a");
        a.textContent = text;
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        if (className) a.className = className;
        return a;
    }

    /** Keep focus inside the dialog if the previously focused node was removed. */
    private refocusIfNeeded(): void {
        const active = this.root.activeElement ?? this.doc.activeElement;
        if (!active || !this.card.contains(active)) {
            this.card.focus({ preventScroll: true });
        }
    }

    private focusable(): HTMLElement[] {
        return Array.from(
            this.card.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
        );
    }

    private trapTab(ev: KeyboardEvent): void {
        const nodes = this.focusable();
        if (nodes.length === 0) {
            ev.preventDefault();
            this.card.focus({ preventScroll: true });
            return;
        }
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        const active = (this.root.activeElement ??
            this.doc.activeElement) as HTMLElement | null;
        if (ev.shiftKey) {
            if (active === first || active === this.card) {
                ev.preventDefault();
                last.focus({ preventScroll: true });
            }
        } else if (active === last) {
            ev.preventDefault();
            first.focus({ preventScroll: true });
        }
    }
}
