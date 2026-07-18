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
 * Redirect target: viewer/web/viewer.html?file=<encodeURIComponent(originalUrl)>
 */

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
    if (isOwnRequest(url) || !isHttp(url) || !pathLooksLikePdf(url)) {
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
    if (isOwnRequest(url) || !isHttp(url)) {
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
