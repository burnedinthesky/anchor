/**
 * Extension settings persisted in `browser.storage.local` under the key
 * `settings`. Shared by the options page (writer) and the viewer (reader).
 *
 * Guards for non-extension contexts (e.g. node/vitest, where `browser` is
 * undefined) by returning defaults, so this module is import-safe from unit
 * tests and from bundled viewer code that may run before the API is present.
 */
import { DEFAULT_MAILTO } from "../citations/types";

export interface Settings {
    /** Polite-pool contact email sent to OpenAlex/Crossref. */
    mailto: string;
    /** Open the preview card on hover (after a dwell) as well as on click. */
    hoverPreview: boolean;
    /**
     * Hostnames the extension is allowed to hijack PDF navigations on. A bare
     * registrable host (`arxiv.org`) also matches its subdomains
     * (`www.arxiv.org`, `export.arxiv.org`). An empty list disables
     * interception everywhere.
     */
    enabledSites: string[];
}

export const STORAGE_KEY = "settings";

export const DEFAULT_SETTINGS: Settings = {
    mailto: DEFAULT_MAILTO,
    hoverPreview: false,
    enabledSites: ["arxiv.org"],
};

/**
 * Clean a user- or storage-supplied site list: trim, lowercase, drop empties,
 * and dedupe while preserving order. Non-string members are discarded.
 */
export function normalizeSites(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const item of raw) {
        if (typeof item !== "string") continue;
        const host = item.trim().toLowerCase();
        if (host !== "" && !out.includes(host)) out.push(host);
    }
    return out;
}

/**
 * True when `url`'s hostname is covered by `sites`. A site entry matches its
 * exact host and any subdomain of it: `arxiv.org` covers `arxiv.org` and
 * `export.arxiv.org`, but not `notarxiv.org`.
 */
export function hostMatchesSites(url: string, sites: string[]): boolean {
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return false;
    }
    return sites.some((raw) => {
        const site = raw.toLowerCase();
        return host === site || host.endsWith("." + site);
    });
}

/** True when the WebExtension storage API is reachable in this context. */
function hasStorage(): boolean {
    return (
        typeof browser !== "undefined" &&
        browser.storage != null &&
        browser.storage.local != null
    );
}

/** Read settings, falling back to defaults for missing keys / non-ext contexts. */
export async function getSettings(): Promise<Settings> {
    if (!hasStorage()) {
        return { ...DEFAULT_SETTINGS };
    }
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const partial = (stored?.[STORAGE_KEY] ?? {}) as Partial<Settings>;
    return {
        mailto:
            typeof partial.mailto === "string" && partial.mailto.trim() !== ""
                ? partial.mailto
                : DEFAULT_SETTINGS.mailto,
        hoverPreview:
            typeof partial.hoverPreview === "boolean"
                ? partial.hoverPreview
                : DEFAULT_SETTINGS.hoverPreview,
        // Respect a stored empty list (interception off everywhere); only fall
        // back to the default when the key is absent or not an array.
        enabledSites: Array.isArray(partial.enabledSites)
            ? normalizeSites(partial.enabledSites)
            : [...DEFAULT_SETTINGS.enabledSites],
    };
}

/** Persist a full settings object. No-op in non-extension contexts. */
export async function saveSettings(settings: Settings): Promise<void> {
    if (!hasStorage()) {
        return;
    }
    await browser.storage.local.set({ [STORAGE_KEY]: settings });
}
