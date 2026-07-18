// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CitationController } from "../../src/citations/ui/controller";
import { MetadataLookupError } from "../../src/citations/metadata";
import type {
    CitationDetector,
    CitationMarker,
    MetadataProvider,
    PageTextReadyEvent,
    ReferenceResolver,
    ResolvedReference,
} from "../../src/citations/types";
import {
    makeMarker,
    makeRecord,
    makeEvent,
    cardHost,
    cardRoot,
    flush,
    rect,
    makePageDom,
} from "./helpers";

interface Harness {
    controller: CitationController;
    emit: (e: PageTextReadyEvent) => void;
    resolvePages: () => void;
    div: HTMLElement;
    page: HTMLElement;
    provider: { lookup: ReturnType<typeof vi.fn> };
    resolver: { resolve: ReturnType<typeof vi.fn> };
}

function harness(
    opts: {
        markers?: CitationMarker[];
        resolve?: (m: CitationMarker) => ResolvedReference | null;
        lookup?: () => Promise<ReturnType<typeof makeRecord>>;
    } = {}
): Harness {
    const { page, textLayer: div } = makePageDom();

    const markers = opts.markers ?? [makeMarker()];
    const detector: CitationDetector = { detect: () => markers };
    const resolver = {
        resolve: vi.fn(
            opts.resolve ??
                ((m: CitationMarker): ResolvedReference => ({
                    markerId: m.id,
                    rawText: m.rawText,
                    hints: {},
                }))
        ),
    };
    const provider = {
        lookup: vi.fn(opts.lookup ?? (async () => makeRecord())),
    };

    let listener: (e: PageTextReadyEvent) => void = () => {};
    let resolvePagesFn: () => void = () => {};
    const getAllPagesText = (): Promise<[]> =>
        new Promise((res) => {
            resolvePagesFn = () => res([]);
        });

    const controller = new CitationController({
        getAllPagesText,
        onPageTextReady: (l) => {
            listener = l;
        },
        detectorFactory: () => detector,
        resolverFactory: () => resolver as unknown as ReferenceResolver,
        provider: provider as unknown as MetadataProvider,
        hoverPreview: false,
        doc: document,
    });

    return {
        controller,
        emit: (e) => listener(e),
        resolvePages: () => resolvePagesFn(),
        div,
        page,
        provider,
        resolver,
    };
}

function firstButton(div: HTMLElement): HTMLButtonElement {
    const btn = div.querySelector(
        "button.anchor-cite-btn"
    ) as HTMLButtonElement;
    btn.getBoundingClientRect = () => rect(100, 200, 20, 12);
    return btn;
}

function stubCardSize(): void {
    const host = cardHost();
    const inner = host?.shadowRoot?.querySelector(
        ".card"
    ) as HTMLElement | null;
    if (inner) inner.getBoundingClientRect = () => rect(0, 0, 360, 300);
}

describe("CitationController wiring", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("queues events before full-text fetch resolves, then flushes", async () => {
        const h = harness();
        const startP = h.controller.start();
        h.emit(makeEvent(1, h.div)); // arrives before pages resolve
        expect(h.page.querySelectorAll("button.anchor-cite-btn").length).toBe(
            0
        );

        h.resolvePages();
        await startP;
        expect(h.page.querySelectorAll("button.anchor-cite-btn").length).toBe(
            1
        );
    });

    it("click -> loading then success", async () => {
        const h = harness();
        const startP = h.controller.start();
        h.emit(makeEvent(1, h.div));
        h.resolvePages();
        await startP;

        firstButton(h.page).click();
        // Loading synchronously.
        expect(cardRoot().querySelector(".sk")).not.toBeNull();
        stubCardSize();
        await flush();
        expect(cardRoot().querySelector(".title")).not.toBeNull();
        expect(h.provider.lookup).toHaveBeenCalledTimes(1);
    });

    it("null resolution -> empty state with Scholar search on rawText", async () => {
        const h = harness({ resolve: () => null });
        const startP = h.controller.start();
        h.emit(makeEvent(1, h.div));
        h.resolvePages();
        await startP;

        firstButton(h.page).click();
        await flush();
        const link = cardRoot().querySelector(
            ".actions a"
        ) as HTMLAnchorElement;
        expect(link.textContent).toBe("Search on Google Scholar");
        expect(link.href).toContain(encodeURIComponent("[12]"));
        expect(h.provider.lookup).not.toHaveBeenCalled();
    });

    it("completeness empty -> empty state", async () => {
        const h = harness({
            lookup: async () =>
                makeRecord({
                    completeness: "empty",
                    scholarUrl: "https://scholar.google.com/scholar?q=x",
                }),
        });
        const startP = h.controller.start();
        h.emit(makeEvent(1, h.div));
        h.resolvePages();
        await startP;

        firstButton(h.page).click();
        await flush();
        expect(cardRoot().querySelector(".empty")).not.toBeNull();
    });

    it("MetadataLookupError -> error, Retry re-fetches and transitions to success", async () => {
        const lookup = vi
            .fn()
            .mockRejectedValueOnce(
                new MetadataLookupError("boom", { status: 500 })
            )
            .mockResolvedValueOnce(makeRecord());
        const h = harness({ lookup: lookup as never });
        const startP = h.controller.start();
        h.emit(makeEvent(1, h.div));
        h.resolvePages();
        await startP;

        firstButton(h.page).click();
        await flush();
        const retry = cardRoot().querySelector(
            ".btn.primary"
        ) as HTMLButtonElement;
        expect(retry.textContent).toBe("Retry");

        retry.click();
        await flush();
        expect(cardRoot().querySelector(".title")).not.toBeNull();
        expect(lookup).toHaveBeenCalledTimes(2);
    });

    it("single-card invariant: opening a second card closes the first", async () => {
        const markers = [
            makeMarker({ id: "p1#1", rect: { x: 10, y: 10, w: 10, h: 10 } }),
            makeMarker({ id: "p1#2", rect: { x: 40, y: 10, w: 10, h: 10 } }),
        ];
        const h = harness({ markers });
        const startP = h.controller.start();
        h.emit(makeEvent(1, h.div));
        h.resolvePages();
        await startP;

        const btns = h.page.querySelectorAll<HTMLButtonElement>(
            "button.anchor-cite-btn"
        );
        btns[0]!.click();
        btns[1]!.click();
        await flush();
        expect(
            document.querySelectorAll("[data-anchor-card-host]").length
        ).toBe(1);
    });

    it("stays inert when no pages/markers (scanned PDF)", async () => {
        const h = harness({ markers: [] });
        const startP = h.controller.start();
        h.emit(makeEvent(1, h.div));
        h.resolvePages();
        await startP;
        expect(h.page.querySelectorAll("button.anchor-cite-btn").length).toBe(
            0
        );
        expect(cardHost()).toBeNull();
    });
});
