// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OverlayManager, markerLabel } from "../../src/citations/ui/overlay";
import type {
    CitationDetector,
    CitationMarker,
} from "../../src/citations/types";
import { makeMarker, makeEvent, makePageDom, rect } from "./helpers";

function detectorReturning(markers: CitationMarker[]): CitationDetector {
    return { detect: () => markers };
}

describe("markerLabel", () => {
    it("names numeric markers", () => {
        expect(markerLabel(makeMarker({ rawText: "[12]" }))).toBe(
            "Citation 12"
        );
    });
    it("names author-year markers", () => {
        expect(
            markerLabel(
                makeMarker({
                    scheme: "author-year",
                    rawText: "(Smith et al., 2021)",
                })
            )
        ).toBe("Citation Smith et al., 2021");
    });
});

describe("OverlayManager", () => {
    let div: HTMLElement;
    let page: HTMLElement;
    beforeEach(() => {
        document.body.innerHTML = "";
        ({ page, textLayer: div } = makePageDom());
    });
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders a button at each marker rect with an accessible name", () => {
        const marker = makeMarker({ rect: { x: 50, y: 60, w: 22, h: 14 } });
        const overlay = new OverlayManager({
            detector: detectorReturning([marker]),
            onActivate: vi.fn(),
        });
        overlay.renderPage(makeEvent(1, div));

        const btn = page.querySelector(
            "button.anchor-cite-btn"
        ) as HTMLButtonElement;
        expect(btn).not.toBeNull();
        // Marker rect (50,60,22,14) plus the 2px hitbox pad on every side.
        expect(btn.style.left).toBe("48px");
        expect(btn.style.top).toBe("58px");
        expect(btn.style.width).toBe("26px");
        expect(btn.style.height).toBe("18px");
        expect(btn.getAttribute("aria-label")).toBe("Citation 12");
    });

    it("mounts the layer as a later sibling of the text layer so it paints above PDF link annotations", () => {
        // Regression: arXiv/hyperref PDFs put an .annotationLayer <a> over each
        // citation; buttons inside the text layer would sit below it and never
        // receive the click (the reader would jump to the references instead).
        const annotationLayer = document.createElement("div");
        annotationLayer.className = "annotationLayer";
        page.appendChild(annotationLayer); // DOM-after textLayer, like pdf.js

        const overlay = new OverlayManager({
            detector: detectorReturning([makeMarker()]),
            onActivate: vi.fn(),
        });
        overlay.renderPage(makeEvent(1, div));

        const layer = page.querySelector(".anchor-cite-layer") as HTMLElement;
        expect(layer).not.toBeNull();
        expect(layer.parentElement).toBe(page);
        expect(div.contains(layer)).toBe(false);
        // Later sibling than the annotation layer -> paints above it.
        const order = [...page.children];
        expect(order.indexOf(layer)).toBeGreaterThan(
            order.indexOf(annotationLayer)
        );
        expect(layer.querySelector("button.anchor-cite-btn")).not.toBeNull();
    });

    it("expands buttons to eclipse intersecting PDF link annotations, plus padding (regression)", () => {
        // The PDF's cite-link boxes are padded beyond the glyph rect; an
        // uncovered strip lets clicks fall through (jump to bibliography) and
        // lets the link's own :hover wash out the text line.
        page.getBoundingClientRect = () => rect(0, 0, 800, 1000);
        const annotationLayer = document.createElement("div");
        annotationLayer.className = "annotationLayer";
        const link = document.createElement("a");
        link.setAttribute("href", "#cite.smith2021");
        link.getBoundingClientRect = () => rect(48, 58, 30, 18); // taller + wider than marker
        annotationLayer.appendChild(link);
        // A non-overlapping link elsewhere must not distort the button.
        const far = document.createElement("a");
        far.setAttribute("href", "#cite.other");
        far.getBoundingClientRect = () => rect(400, 400, 30, 18);
        annotationLayer.appendChild(far);
        page.appendChild(annotationLayer);

        const overlay = new OverlayManager({
            detector: detectorReturning([
                makeMarker({ rect: { x: 50, y: 60, w: 22, h: 14 } }),
            ]),
            onActivate: vi.fn(),
        });
        overlay.renderPage(makeEvent(1, div));

        const btn = page.querySelector(
            "button.anchor-cite-btn"
        ) as HTMLButtonElement;
        // Union of marker (50,60,22,14) and link (48,58,30,18) = (48,58,30,18),
        // then 2px pad on every side.
        expect(btn.style.left).toBe("46px");
        expect(btn.style.top).toBe("56px");
        expect(btn.style.width).toBe("34px");
        expect(btn.style.height).toBe("22px");
    });

    it("does not duplicate buttons when a page re-emits (zoom re-render)", () => {
        const overlay = new OverlayManager({
            detector: detectorReturning([makeMarker()]),
            onActivate: vi.fn(),
        });
        overlay.renderPage(makeEvent(1, div));
        overlay.renderPage(makeEvent(1, div));
        overlay.renderPage(makeEvent(1, div));
        expect(page.querySelectorAll("button.anchor-cite-btn").length).toBe(1);
    });

    it("same-id markers become multiple hit-targets that share one activation group", () => {
        const wrapped = [
            makeMarker({ id: "p1#5", rect: { x: 10, y: 20, w: 15, h: 12 } }),
            makeMarker({ id: "p1#5", rect: { x: 0, y: 34, w: 8, h: 12 } }),
        ];
        const onActivate = vi.fn();
        const overlay = new OverlayManager({
            detector: detectorReturning(wrapped),
            onActivate,
        });
        overlay.renderPage(makeEvent(1, div));

        const btns = page.querySelectorAll<HTMLButtonElement>(
            "button.anchor-cite-btn"
        );
        expect(btns.length).toBe(2);
        btns[0]!.click();
        btns[1]!.click();
        // Both buttons pass the same 2-marker group.
        expect(onActivate).toHaveBeenCalledTimes(2);
        expect(onActivate.mock.calls[0]![0]).toHaveLength(2);
        expect(onActivate.mock.calls[1]![0]).toHaveLength(2);
        expect(onActivate.mock.calls[0]![0]).toEqual(
            onActivate.mock.calls[1]![0]
        );
    });

    it("opens on hover-dwell only when hoverPreview is enabled", () => {
        vi.useFakeTimers();
        const onActivate = vi.fn();
        const overlay = new OverlayManager({
            detector: detectorReturning([makeMarker()]),
            onActivate,
            hoverPreview: true,
        });
        overlay.renderPage(makeEvent(1, div));
        const btn = page.querySelector("button.anchor-cite-btn")!;
        btn.dispatchEvent(new MouseEvent("mouseenter"));
        vi.advanceTimersByTime(200);
        btn.dispatchEvent(new MouseEvent("mouseleave")); // cancel before threshold
        vi.advanceTimersByTime(400);
        expect(onActivate).not.toHaveBeenCalled();

        btn.dispatchEvent(new MouseEvent("mouseenter"));
        vi.advanceTimersByTime(400);
        expect(onActivate).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });
});
