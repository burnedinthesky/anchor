// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Drives the toolbar popup module end-to-end against a mocked WebExtension
 * `browser` (in-memory storage + a stubbed active tab). Verifies the allowlist
 * renders, the add/remove controls persist, and the current-site toggle works.
 */

// Minimal DOM the popup controller queries on import.
const POPUP_HTML = `
    <div id="current-host"></div>
    <div id="current-status"></div>
    <button id="current-toggle" hidden></button>
    <ul id="site-list"></ul>
    <form id="add-form"><input id="add-input" type="text" /></form>
    <a id="open-options" href="#"></a>
`;

interface StoredSettings {
    enabledSites?: string[];
    [k: string]: unknown;
}

function makeBrowser(tabUrl: string | undefined, initial: StoredSettings) {
    const store: Record<string, unknown> = { settings: { ...initial } };
    return {
        storage: {
            local: {
                get: (key: string) => Promise.resolve({ [key]: store[key] }),
                set: (obj: Record<string, unknown>) => {
                    Object.assign(store, obj);
                    return Promise.resolve();
                },
            },
        },
        tabs: {
            query: () => Promise.resolve([{ url: tabUrl }]),
        },
        runtime: {
            openOptionsPage: vi.fn(() => Promise.resolve()),
        },
        // Read the live persisted value for assertions.
        _sites: () => (store.settings as StoredSettings).enabledSites,
    };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function loadPopup() {
    vi.resetModules();
    await import("../../src/popup/popup");
    await flush();
    await flush();
}

let mockBrowser: ReturnType<typeof makeBrowser>;

beforeEach(() => {
    document.body.innerHTML = POPUP_HTML;
    (globalThis as unknown as { close?: () => void }).close = () => {};
});

function install(tabUrl: string | undefined, sites: string[]) {
    mockBrowser = makeBrowser(tabUrl, { enabledSites: sites });
    (globalThis as unknown as { browser: unknown }).browser = mockBrowser;
}

const listItems = () =>
    Array.from(document.querySelectorAll("#site-list li .name")).map(
        (el) => el.textContent
    );

describe("toolbar popup", () => {
    it("renders the stored allowlist", async () => {
        install("https://example.com/", ["arxiv.org", "openreview.net"]);
        await loadPopup();
        expect(listItems()).toEqual(["arxiv.org", "openreview.net"]);
    });

    it("shows the current site as enabled and toggles it off", async () => {
        install("https://arxiv.org/abs/2401.1", ["arxiv.org"]);
        await loadPopup();

        const toggle = document.getElementById(
            "current-toggle"
        ) as HTMLButtonElement;
        expect(document.getElementById("current-host")?.textContent).toBe(
            "arxiv.org"
        );
        expect(toggle.hidden).toBe(false);
        expect(toggle.textContent).toBe("Disable");

        toggle.click();
        await flush();

        expect(mockBrowser._sites()).toEqual([]);
        expect(toggle.textContent).toBe("Enable here");
        expect(listItems()).toEqual([]); // empty-state row has no .name
    });

    it("enables a not-yet-listed current site", async () => {
        install("https://openreview.net/forum?id=x", ["arxiv.org"]);
        await loadPopup();

        const toggle = document.getElementById(
            "current-toggle"
        ) as HTMLButtonElement;
        expect(toggle.textContent).toBe("Enable here");

        toggle.click();
        await flush();

        expect(mockBrowser._sites()).toEqual(["arxiv.org", "openreview.net"]);
    });

    it("adds a site from free-form input, normalizing a URL to its host", async () => {
        install("https://example.com/", ["arxiv.org"]);
        await loadPopup();

        const input = document.getElementById("add-input") as HTMLInputElement;
        const form = document.getElementById("add-form") as HTMLFormElement;
        input.value = "https://www.biorxiv.org/content/10.1/v1.full.pdf";
        form.dispatchEvent(new Event("submit", { cancelable: true }));
        await flush();

        expect(mockBrowser._sites()).toEqual(["arxiv.org", "biorxiv.org"]);
        expect(input.value).toBe("");
    });

    it("removes a site via its × button", async () => {
        install("https://example.com/", ["arxiv.org", "openreview.net"]);
        await loadPopup();

        const removeBtn = document.querySelector(
            "#site-list li .remove"
        ) as HTMLButtonElement;
        removeBtn.click();
        await flush();

        expect(mockBrowser._sites()).toEqual(["openreview.net"]);
        expect(listItems()).toEqual(["openreview.net"]);
    });

    it("hides the current-site toggle for a non-http tab", async () => {
        install("about:blank", ["arxiv.org"]);
        await loadPopup();

        const toggle = document.getElementById(
            "current-toggle"
        ) as HTMLButtonElement;
        expect(toggle.hidden).toBe(true);
    });
});
