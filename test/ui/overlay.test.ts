// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OverlayManager, markerLabel } from "../../src/citations/ui/overlay";
import type { CitationDetector, CitationMarker } from "../../src/citations/types";
import { makeMarker, makeEvent } from "./helpers";

function detectorReturning(markers: CitationMarker[]): CitationDetector {
  return { detect: () => markers };
}

describe("markerLabel", () => {
  it("names numeric markers", () => {
    expect(markerLabel(makeMarker({ rawText: "[12]" }))).toBe("Citation 12");
  });
  it("names author-year markers", () => {
    expect(
      markerLabel(
        makeMarker({ scheme: "author-year", rawText: "(Smith et al., 2021)" })
      )
    ).toBe("Citation Smith et al., 2021");
  });
});

describe("OverlayManager", () => {
  let div: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    div = document.createElement("div");
    document.body.appendChild(div);
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

    const btn = div.querySelector("button.anchor-cite-btn") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.style.left).toBe("50px");
    expect(btn.style.top).toBe("60px");
    expect(btn.style.width).toBe("22px");
    expect(btn.style.height).toBe("14px");
    expect(btn.getAttribute("aria-label")).toBe("Citation 12");
  });

  it("does not duplicate buttons when a page re-emits (zoom re-render)", () => {
    const overlay = new OverlayManager({
      detector: detectorReturning([makeMarker()]),
      onActivate: vi.fn(),
    });
    overlay.renderPage(makeEvent(1, div));
    overlay.renderPage(makeEvent(1, div));
    overlay.renderPage(makeEvent(1, div));
    expect(div.querySelectorAll("button.anchor-cite-btn").length).toBe(1);
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

    const btns = div.querySelectorAll<HTMLButtonElement>("button.anchor-cite-btn");
    expect(btns.length).toBe(2);
    btns[0]!.click();
    btns[1]!.click();
    // Both buttons pass the same 2-marker group.
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(onActivate.mock.calls[0]![0]).toHaveLength(2);
    expect(onActivate.mock.calls[1]![0]).toHaveLength(2);
    expect(onActivate.mock.calls[0]![0]).toEqual(onActivate.mock.calls[1]![0]);
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
    const btn = div.querySelector("button.anchor-cite-btn")!;
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
