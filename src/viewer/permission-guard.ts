/**
 * MV3 host-permission guard for the viewer page.
 *
 * Firefox treats MV3 `host_permissions` as opt-in: a permanently installed
 * extension starts with NO host access (the toolbar badge reads "Can't read
 * and change data on this site") even though the manifest lists
 * `<all_urls>`. Without that grant the viewer cannot fetch the PDF bytes or
 * the citation-metadata APIs, and everything fails silently.
 *
 * This module checks the grant and, when missing, renders a banner with a
 * "Grant access" button — `permissions.request` is valid here because a
 * click on an extension page counts as a user gesture. Granting reloads the
 * viewer so the PDF load restarts with access.
 */

const API_ORIGINS = [
    "https://api.openalex.org/*",
    "https://api.crossref.org/*",
    "https://api.semanticscholar.org/*",
];

const BANNER_ATTR = "data-anchor-permission-banner";

interface PermissionsApi {
    contains(p: { origins: string[] }): Promise<boolean>;
    request(p: { origins: string[] }): Promise<boolean>;
}

function permissionsApi(): PermissionsApi | null {
    // Plain-page harnesses and tests have no `browser` global — no gating.
    if (typeof browser === "undefined" || !browser.permissions) return null;
    return browser.permissions as unknown as PermissionsApi;
}

/** `https://arxiv.org/pdf/x.pdf` -> `https://arxiv.org/*` (null for non-http). */
export function originPattern(url: string): string | null {
    try {
        const u = new URL(url);
        if (u.protocol !== "http:" && u.protocol !== "https:") return null;
        return `${u.origin}/*`;
    } catch {
        return null;
    }
}

/**
 * True when the extension may fetch `fileUrl` and the metadata APIs.
 * Never throws; errs on the side of "granted" so the guard can only ever
 * add a banner, not break the viewer.
 */
export async function hasHostAccess(fileUrl: string | null): Promise<boolean> {
    const api = permissionsApi();
    if (!api) return true;
    const origins = [...API_ORIGINS];
    const file = fileUrl && originPattern(fileUrl);
    if (file) origins.push(file);
    try {
        return await api.contains({ origins });
    } catch (err) {
        console.warn("[anchor] permissions.contains failed:", err);
        return true;
    }
}

/**
 * Check host access for the viewer's PDF and the metadata APIs; when it is
 * missing, show a banner offering to grant `<all_urls>`. Returns the grant
 * state so callers can log it. Idempotent.
 */
export async function ensureHostAccess(
    fileUrl: string | null
): Promise<boolean> {
    if (await hasHostAccess(fileUrl)) return true;
    console.warn(
        "[anchor] host permissions NOT granted — PDF and citation lookups will fail. " +
            "Grant via the banner, or about:addons -> Anchor PDF Reader -> Permissions."
    );
    showBanner();
    return false;
}

function showBanner(doc: Document = document): void {
    if (doc.querySelector(`[${BANNER_ATTR}]`)) return;

    const banner = doc.createElement("div");
    banner.setAttribute(BANNER_ATTR, "");
    banner.setAttribute("role", "alert");
    banner.style.cssText = [
        "position: fixed",
        "top: 0",
        "left: 0",
        "right: 0",
        "z-index: 2147483001", // above the preview card
        "display: flex",
        "align-items: center",
        "justify-content: center",
        "gap: 12px",
        "padding: 10px 16px",
        "background: #b3261e",
        "color: #fff",
        "font: 13px/1.4 system-ui, sans-serif",
    ].join(";");

    const text = doc.createElement("span");
    text.textContent =
        "Anchor needs permission to load PDFs and citation data. " +
        "Firefox does not grant website access to extensions until you allow it.";

    const grant = doc.createElement("button");
    grant.textContent = "Grant access";
    grant.style.cssText =
        "padding: 4px 14px; border: none; border-radius: 4px; cursor: pointer;" +
        "background: #fff; color: #b3261e; font: inherit; font-weight: 600;";
    grant.addEventListener("click", () => {
        const api = permissionsApi();
        if (!api) return;
        // User gesture -> Firefox shows its permission prompt.
        void api
            .request({ origins: ["<all_urls>"] })
            .then((granted) => {
                if (granted) location.reload();
            })
            .catch((err) =>
                console.warn("[anchor] permissions.request failed:", err)
            );
    });

    const dismiss = doc.createElement("button");
    dismiss.textContent = "×";
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.style.cssText =
        "border: none; background: transparent; color: #fff; cursor: pointer; font-size: 16px;";
    dismiss.addEventListener("click", () => banner.remove());

    banner.append(text, grant, dismiss);
    (doc.body ?? doc.documentElement).appendChild(banner);
}
