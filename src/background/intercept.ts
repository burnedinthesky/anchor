/**
 * Background PDF-navigation interception (Agent A / shell).
 *
 * Firefox MV3 event page. Redirects top-level PDF navigations to the bundled
 * pdf.js viewer so we can decorate the document with citation previews (content
 * scripts cannot be injected into Firefox's built-in pdf.js internal page).
 *
 * Two blocking webRequest hooks:
 *   1. onBeforeRequest    — URL path ends in `.pdf`            (fast path, pre-network)
 *   2. onHeadersReceived  — response `Content-Type: application/pdf`
 *                           and not an `attachment` download   (covers extensionless URLs)
 *
 * Both hooks only fire on hosts the user has enabled (configured from the
 * toolbar popup; defaults to arxiv.org only). The enabled-site list is cached
 * in memory because blocking webRequest listeners must decide synchronously.
 *
 * Redirect target: viewer/web/viewer.html?file=<encodeURIComponent(originalUrl)>
 */
import {
    DEFAULT_SETTINGS,
    STORAGE_KEY,
    getSettings,
    hostMatchesSites,
    normalizeSites,
    type Settings,
} from "../options/settings";

/**
 * In-memory copy of the enabled-site allowlist. Seeded with the defaults so
 * the very first requests (before `getSettings` resolves) still behave, then
 * refreshed from storage and kept live via `storage.onChanged`.
 */
let enabledSites: string[] = [...DEFAULT_SETTINGS.enabledSites];

void getSettings().then((s) => {
    enabledSites = s.enabledSites;
});

browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    const next = changes[STORAGE_KEY].newValue as Partial<Settings> | undefined;
    enabledSites = Array.isArray(next?.enabledSites)
        ? normalizeSites(next.enabledSites)
        : [...DEFAULT_SETTINGS.enabledSites];
});

/** Absolute moz-extension:// URL of the bundled viewer page. */
const VIEWER_PAGE = browser.runtime.getURL("viewer/web/viewer.html");
/** Our own extension origin, e.g. "moz-extension://<uuid>/". Used to break loops. */
const EXTENSION_BASE = browser.runtime.getURL("");

/** Build the viewer URL that renders `pdfUrl`. */
function toViewerUrl(pdfUrl: string): string {
    return `${VIEWER_PAGE}?file=${encodeURIComponent(pdfUrl)}`;
}

/**
 * True when a request should be left alone: our own extension pages/assets, or
 * anything already pointing at the viewer (prevents redirect loops).
 */
function isOwnRequest(url: string): boolean {
    return url.startsWith(EXTENSION_BASE) || url.startsWith(VIEWER_PAGE);
}

/** Only http(s) documents are candidates for interception. */
function isHttp(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://");
}

/** URL path (ignoring query/hash) ends in `.pdf`. */
function pathLooksLikePdf(url: string): boolean {
    try {
        return new URL(url).pathname.toLowerCase().endsWith(".pdf");
    } catch {
        return false;
    }
}

// --- Hook 1: obvious `.pdf` URLs, redirected before the network is hit -------
browser.webRequest.onBeforeRequest.addListener(
    (details): browser.webRequest.BlockingResponse | undefined => {
        const { url } = details;
        if (
            isOwnRequest(url) ||
            !isHttp(url) ||
            !hostMatchesSites(url, enabledSites) ||
            !pathLooksLikePdf(url)
        ) {
            return undefined;
        }
        return { redirectUrl: toViewerUrl(url) };
    },
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"]
);

// --- Hook 2: PDFs served without a `.pdf` extension, detected by header -------
browser.webRequest.onHeadersReceived.addListener(
    (details): browser.webRequest.BlockingResponse | undefined => {
        const { url } = details;
        if (
            isOwnRequest(url) ||
            !isHttp(url) ||
            !hostMatchesSites(url, enabledSites)
        ) {
            return undefined;
        }

        let contentType = "";
        let disposition = "";
        for (const header of details.responseHeaders ?? []) {
            const name = header.name.toLowerCase();
            if (name === "content-type") {
                contentType = (header.value ?? "").toLowerCase();
            } else if (name === "content-disposition") {
                disposition = (header.value ?? "").toLowerCase();
            }
        }

        const isPdf = contentType.split(";")[0]?.trim() === "application/pdf";
        // Respect explicit "download this" intent; don't hijack file downloads.
        const isAttachment = disposition.includes("attachment");
        if (!isPdf || isAttachment) {
            return undefined;
        }
        return { redirectUrl: toViewerUrl(url) };
    },
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking", "responseHeaders"]
);
