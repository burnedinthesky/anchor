// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PreviewCard, computeCardPosition } from "../../src/citations/ui/card";
import { buildScholarUrl } from "../../src/citations/types";
import { makeRecord, cardHost, cardRoot, rect } from "./helpers";

function anchorButton(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = "[12]";
    document.body.appendChild(btn);
    // Give it a stable rect for anchoring.
    btn.getBoundingClientRect = () => rect(100, 200, 20, 12);
    return btn;
}

describe("computeCardPosition (anchoring)", () => {
    const card = { w: 360, h: 300 };
    const VW = 1000;
    const VH = 800;

    it("defaults to below-right of the marker", () => {
        const p = computeCardPosition(rect(100, 100, 20, 12), card, VW, VH);
        expect(p.left).toBe(100); // left-aligned to marker
        expect(p.top).toBe(118); // bottom(112) + gap(6)
    });

    it("flips left when the card would overflow the right edge", () => {
        const p = computeCardPosition(rect(900, 100, 20, 12), card, VW, VH);
        // right edge (920) - width (360) = 560
        expect(p.left).toBe(560);
        expect(p.left + card.w).toBeLessThanOrEqual(VW);
    });

    it("flips above when the card would overflow the bottom edge", () => {
        const marker = rect(100, 750, 20, 12);
        const p = computeCardPosition(marker, card, VW, VH);
        expect(p.top).toBe(750 - 6 - 300); // above the marker
        // never overlaps the marker rect
        expect(p.top + card.h).toBeLessThanOrEqual(marker.top);
    });

    it("never overlaps the marker vertically in the default case", () => {
        const marker = rect(100, 100, 20, 12);
        const p = computeCardPosition(marker, card, VW, VH);
        expect(p.top).toBeGreaterThanOrEqual(marker.bottom);
    });
});

describe("PreviewCard states", () => {
    let card: PreviewCard;
    let anchor: HTMLButtonElement;

    beforeEach(() => {
        document.body.innerHTML = "";
        anchor = anchorButton();
        card = new PreviewCard({ doc: document });
        // Stable dialog size for reposition math.
        card["card"].getBoundingClientRect = () => rect(0, 0, 360, 300);
    });
    afterEach(() => {
        card.close();
        document.body.innerHTML = "";
    });

    it("loading shows a skeleton synchronously on open", () => {
        card.open(anchor);
        const root = cardRoot();
        expect(root.querySelectorAll(".sk").length).toBeGreaterThan(0);
        expect(root.querySelector(".sk-title")).not.toBeNull();
    });

    it("success renders title, authors, and a footer row with metrics + versions beside the actions", () => {
        card.open(anchor);
        card.showRecord(makeRecord());
        const root = cardRoot();

        const title = root.querySelector(".title a") as HTMLAnchorElement;
        expect(title.textContent).toContain("Deep Learning");
        expect(title.href).toContain("scholar.google.com");
        expect(title.target).toBe("_blank");
        expect(title.rel).toContain("noopener");

        expect(root.querySelector(".authors")!.textContent).toContain(
            "+2 more"
        );
        expect(root.querySelector(".meta")!.textContent).toBe("2021 · NeurIPS");

        // Metrics, versions, and the actions all share one footer row.
        const footer = root.querySelector(".actions")!;
        expect(footer.querySelector(".metrics")!.textContent).toBe(
            "Cited by 142"
        );
        // Versions is a single Scholar hyperlink, not an enumerated host list.
        const versions = footer.querySelector(".versions")!;
        const vLink = versions.querySelector("a") as HTMLAnchorElement;
        expect(versions.querySelectorAll("a").length).toBe(1);
        expect(vLink.textContent).toBe("Versions (2)");
        expect(vLink.href).toContain("scholar.google.com");
        expect(versions.textContent).not.toContain("arxiv.org");

        // Related articles are hidden and versions is inline — no ul list.
        expect(root.querySelector("ul.list")).toBeNull();

        const buttonLabels = Array.from(
            footer.querySelectorAll(".buttons a")
        ).map((a) => a.textContent);
        expect(buttonLabels).toContain("Open PDF");
        expect(buttonLabels).toContain("View on Google Scholar");
    });

    it("abstract Show more toggles clamp when the text overflows", () => {
        card.open(anchor);
        // jsdom reports no layout; force the overflow branch.
        vi.spyOn(card as never, "isOverflowing").mockReturnValue(true);
        card.showRecord(makeRecord());
        const root = cardRoot();
        const abs = root.querySelector(".abstract")!;
        const toggle = root.querySelector(".toggle") as HTMLButtonElement;
        expect(abs.classList.contains("clamped")).toBe(true);
        expect(toggle.textContent).toBe("Show more");
        toggle.click();
        expect(abs.classList.contains("clamped")).toBe(false);
        expect(toggle.textContent).toBe("Show less");
    });

    it("abstract that fits is shown unclamped with no toggle", () => {
        card.open(anchor);
        vi.spyOn(card as never, "isOverflowing").mockReturnValue(false);
        card.showRecord(makeRecord());
        const root = cardRoot();
        expect(
            root.querySelector(".abstract")!.classList.contains("clamped")
        ).toBe(false);
        expect(root.querySelector(".toggle")).toBeNull();
    });

    it("author truncation omitted when few authors", () => {
        card.open(anchor);
        card.showRecord(makeRecord({ authors: ["Solo Author"] }));
        expect(cardRoot().querySelector(".authors")!.textContent).toBe(
            "Solo Author"
        );
    });

    it("partial hides empty sections and shows the note", () => {
        card.open(anchor);
        card.showRecord(
            makeRecord({
                completeness: "partial",
                abstract: undefined,
                citationCount: undefined,
                related: [],
                versions: [],
                oaPdfUrl: undefined,
                venue: undefined,
            })
        );
        const root = cardRoot();
        expect(root.querySelector(".abstract")).toBeNull();
        expect(root.querySelector(".metrics")).toBeNull();
        expect(root.querySelector("ul.list")).toBeNull();
        expect(root.querySelector(".note")!.textContent).toContain(
            "unavailable"
        );
        // Open PDF omitted; Scholar link still present.
        const labels = Array.from(root.querySelectorAll(".actions a")).map(
            (a) => a.textContent
        );
        expect(labels).not.toContain("Open PDF");
        expect(labels).toContain("View on Google Scholar");
    });

    it("empty state links Search on Google Scholar to the scholar url", () => {
        card.open(anchor);
        const url = buildScholarUrl("Some raw ref text");
        card.showEmpty(url);
        const root = cardRoot();
        expect(root.querySelector(".empty")!.textContent).toContain(
            "Couldn't resolve"
        );
        const link = root.querySelector(".actions a") as HTMLAnchorElement;
        expect(link.textContent).toBe("Search on Google Scholar");
        expect(link.href).toBe(url);
    });

    it("error state Retry invokes the callback", () => {
        card.open(anchor);
        const onRetry = vi.fn();
        card.showError(onRetry);
        const root = cardRoot();
        expect(root.querySelector(".error")!.textContent).toContain(
            "Couldn't load"
        );
        const retry = root.querySelector(".btn.primary") as HTMLButtonElement;
        expect(retry.textContent).toBe("Retry");
        retry.click();
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

describe("PreviewCard dismissal & focus", () => {
    let card: PreviewCard;
    let anchor: HTMLButtonElement;
    let onClose: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        document.body.innerHTML = "";
        anchor = anchorButton();
        onClose = vi.fn();
        card = new PreviewCard({ doc: document, onClose });
        card["card"].getBoundingClientRect = () => rect(0, 0, 360, 300);
    });
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("closes on Escape and restores focus to the marker", () => {
        anchor.focus();
        card.open(anchor);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(cardHost()).toBeNull();
        expect(document.activeElement).toBe(anchor);
        expect(onClose).toHaveBeenCalled();
    });

    it("closes on outside pointerdown", () => {
        card.open(anchor);
        document.body.dispatchEvent(
            new MouseEvent("pointerdown", { bubbles: true })
        );
        expect(cardHost()).toBeNull();
    });

    it("does not close on pointerdown inside the card", () => {
        card.open(anchor);
        card.showRecord(makeRecord());
        const link = cardRoot().querySelector(".title a")!;
        link.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        expect(cardHost()).not.toBeNull();
    });

    it("open + close leaves document scroll position unchanged (acceptance 11)", () => {
        // jsdom does not implement scrollIntoView; install a spy to detect calls.
        const scrollIntoView = vi.fn();
        HTMLElement.prototype.scrollIntoView = scrollIntoView;
        const focusSpy = vi.spyOn(anchor, "focus");
        const beforeTop = document.documentElement.scrollTop;
        const beforeLeft = document.documentElement.scrollLeft;

        card.open(anchor);
        card.showRecord(makeRecord());
        card.close();

        expect(document.documentElement.scrollTop).toBe(beforeTop);
        expect(document.documentElement.scrollLeft).toBe(beforeLeft);
        expect(scrollIntoView).not.toHaveBeenCalled();
        // focus restore must not scroll the document
        expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    });
});
