/**
 * Viewer bootstrap (Agent A / shell).
 *
 * Loaded as `<script type="module">` into the vendored pdf.js generic viewer
 * (see vendor/pdfjs/web/viewer.html — a `bootstrap.js` tag is injected there,
 * and esbuild emits this file to dist/viewer/web/bootstrap.js).
 *
 * Responsibilities:
 *   - Wait for `PDFViewerApplication.initializedPromise`.
 *   - On each `textlayerrendered` eventBus event, gather the page's 1-based
 *     number, `textContent`, text-layer div, and viewport, and emit a
 *     `PageTextReadyEvent` to registered listeners (spec §8 / src/citations/types.ts).
 *   - Buffer emitted events so listeners that register late still see pages
 *     that already rendered (replay buffer).
 *   - Degrade gracefully on scanned/image-only PDFs (no text layer): no errors.
 *
 * The citation pipeline (Agents C/D) consumes this module:
 *   import { onPageTextReady, getViewerContainer } from ".../bootstrap";
 * This file deliberately contains NO citation logic — it is the clean seam.
 */
import type {
    PageTextReadyEvent,
    PDFTextContent,
    ViewportLike,
} from "../citations/types";
import { ensureHostAccess } from "./permission-guard";

// ---------------------------------------------------------------------------
// Minimal structural types for the pdf.js globals we read (no pdfjs import).
// ---------------------------------------------------------------------------

interface EventBus {
    on(
        name: "textlayerrendered",
        listener: (evt: TextLayerRenderedEvent) => void
    ): void;
    on(name: string, listener: (evt: unknown) => void): void;
}

interface PDFPageProxy {
    getTextContent(): Promise<PDFTextContent>;
}

interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
}

/** The `source` of a `textlayerrendered` event is the PDFPageView. */
interface PDFPageView {
    /** 1-based page number (pdf.js `PDFPageView#id`). */
    id: number;
    pdfPage?: PDFPageProxy;
    viewport: ViewportLike;
    /** TextLayerBuilder; `.div` is the rendered text-layer element. Null on scanned PDFs. */
    textLayer?: { div: HTMLElement | null } | null;
    /** The page container div. */
    div: HTMLElement;
}

interface TextLayerRenderedEvent {
    source: PDFPageView;
    pageNumber: number;
    error?: unknown;
}

interface PDFViewerApplication {
    initializedPromise: Promise<void>;
    eventBus: EventBus;
    pdfDocument?: PDFDocumentProxy | null;
    pdfViewer?: { container?: HTMLElement; viewer?: HTMLElement } | null;
    appConfig?: { appContainer?: HTMLElement } | null;
}

declare global {
    interface Window {
        PDFViewerApplication?: PDFViewerApplication;
    }
}

// ---------------------------------------------------------------------------
// Listener registry + replay buffer
// ---------------------------------------------------------------------------

type Listener = (e: PageTextReadyEvent) => void;

const listeners = new Set<Listener>();
/** Every event we have emitted this session, keyed by page number (latest wins). */
const emittedByPage = new Map<number, PageTextReadyEvent>();

function safeInvoke(listener: Listener, event: PageTextReadyEvent): void {
    try {
        listener(event);
    } catch (err) {
        console.error("[anchor] onPageTextReady listener threw:", err);
    }
}

/**
 * Register a listener for page-text-ready events. The listener is immediately
 * replayed for every page whose text layer has ALREADY rendered, then called
 * for each subsequent page. Idempotent per page (latest event per page wins).
 */
export function onPageTextReady(listener: Listener): void {
    listeners.add(listener);
    for (const event of emittedByPage.values()) {
        safeInvoke(listener, event);
    }
}

/** Remove a previously registered listener. */
export function offPageTextReady(listener: Listener): void {
    listeners.delete(listener);
}

/** Snapshot of events for pages whose text layer has already rendered. */
export function getRenderedPageEvents(): PageTextReadyEvent[] {
    return [...emittedByPage.values()];
}

function emit(event: PageTextReadyEvent): void {
    emittedByPage.set(event.pageNumber, event);
    for (const listener of listeners) {
        safeInvoke(listener, event);
    }
}

// ---------------------------------------------------------------------------
// Viewer container access (for Agent D's overlay / card mounting)
// ---------------------------------------------------------------------------

/**
 * The scrollable viewer container (`#viewerContainer`). Overlay/card DOM should
 * be mounted here (or on document.body) rather than inside a `.page`, so it is
 * not clipped or rebuilt when pages recycle. See the notes in the final report
 * for stacking-context guidance.
 */
export function getViewerContainer(): HTMLElement {
    const app = window.PDFViewerApplication;
    return (
        app?.pdfViewer?.container ??
        app?.appConfig?.appContainer ??
        document.getElementById("viewerContainer") ??
        document.body
    );
}

// ---------------------------------------------------------------------------
// Full-document text access (for Agent D's controller)
// ---------------------------------------------------------------------------

/** Keep only real TextItems (drop any TextMarkedContent), matching event shape. */
function sanitizeTextContent(tc: PDFTextContent): PDFTextContent {
    if (!tc?.items) return { items: [] };
    return {
        items: tc.items.filter(
            (it): it is (typeof tc.items)[number] =>
                typeof (it as { str?: unknown }).str === "string"
        ),
    };
}

/**
 * Fetch every page's text content once, in document order (index 0 = page 1).
 * References live at the end of the document, so Stages 1–2 need all pages up
 * front. Resolves to `[]` if the document is unavailable. Never throws.
 */
export async function getAllPagesText(): Promise<PDFTextContent[]> {
    const app = window.PDFViewerApplication;
    const pdfDoc = app?.pdfDocument;
    if (!pdfDoc || typeof pdfDoc.numPages !== "number") return [];
    // Fetch pages in parallel: every millisecond here is a window in which a
    // rendered page is clickable without marker overlays (the pdf.js worker
    // serializes internally, but avoiding round-trip latency per page still
    // cuts multi-second startups on long documents).
    return Promise.all(
        Array.from({ length: pdfDoc.numPages }, async (_, i) => {
            try {
                const page = await pdfDoc.getPage(i + 1);
                return sanitizeTextContent(await page.getTextContent());
            } catch (err) {
                console.warn(
                    `[anchor] getAllPagesText: page ${i + 1} failed:`,
                    err
                );
                return { items: [] };
            }
        })
    );
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

async function handleTextLayerRendered(
    evt: TextLayerRenderedEvent
): Promise<void> {
    const pageView = evt.source;
    const textLayerDiv = pageView?.textLayer?.div;
    const pdfPage = pageView?.pdfPage;

    // Scanned / image-only pages (and any render error) have no usable text
    // layer — stay inert, never throw.
    if (!pageView || !textLayerDiv || !pdfPage || evt.error) {
        return;
    }

    let textContent: PDFTextContent;
    try {
        textContent = await pdfPage.getTextContent();
    } catch (err) {
        console.warn(
            `[anchor] getTextContent failed for page ${evt.pageNumber}:`,
            err
        );
        return;
    }

    if (!textContent.items || textContent.items.length === 0) {
        // Nothing to overlay; treat as inert.
        return;
    }

    emit({
        pageNumber: pageView.id, // 1-based
        textContent,
        textLayerDiv,
        viewport: pageView.viewport,
    });
}

async function main(): Promise<void> {
    const app = window.PDFViewerApplication;
    if (!app) {
        console.error(
            "[anchor] PDFViewerApplication not found; citation bootstrap disabled."
        );
        return;
    }
    await app.initializedPromise;

    // Firefox MV3 host permissions are opt-in: without the grant, neither the
    // PDF fetch nor the citation APIs work. Surface a grant banner if missing.
    const fileUrl = new URLSearchParams(location.search).get("file");
    void ensureHostAccess(fileUrl);

    app.eventBus.on("textlayerrendered", (evt) => {
        void handleTextLayerRendered(evt);
    });

    // The document loads asynchronously AFTER app init — pdfDocument is null
    // until the eventBus fires "documentloaded". Starting the pipeline earlier
    // would fetch zero pages of text and silently detect nothing.
    let started = false;
    const start = () => {
        if (started) return;
        started = true;
        emittedByPage.clear(); // no stale pages from a previous document
        void startCitationPipeline();
    };
    if (app.pdfDocument) start();
    else app.eventBus.on("documentloaded", start);
}

/**
 * Construct and start the Stage 4 controller with the real detector, resolver,
 * metadata provider, and settings. Isolated in a try/catch so any failure
 * disables the feature quietly instead of breaking the viewer.
 */
async function startCitationPipeline(): Promise<void> {
    try {
        const [
            { DocumentCitationDetector },
            { BibliographyResolver },
            { createMetadataProvider },
            { CitationController },
            { getSettings },
        ] = await Promise.all([
            import("../citations/detect"),
            import("../citations/resolve"),
            import("../citations/metadata"),
            import("../citations/ui/controller"),
            import("../options/settings"),
        ]);
        const settings = await getSettings();
        let detector: { dominantScheme?: string | null } | undefined;
        const controller = new CitationController({
            getAllPagesText,
            onPageTextReady,
            detectorFactory: (pages) =>
                (detector = new DocumentCitationDetector(pages)),
            resolverFactory: (pages) => new BibliographyResolver(pages),
            provider: createMetadataProvider({ mailto: settings.mailto }),
            hoverPreview: settings.hoverPreview,
        });
        await controller.start();
        // Milestone log so field failures are diagnosable from the console.
        console.info(
            `[anchor] citation pipeline ready — dominant scheme: ${detector?.dominantScheme ?? "none detected"}`
        );
    } catch (err) {
        console.warn("[anchor] citation pipeline failed to start:", err);
    }
}

void main();
