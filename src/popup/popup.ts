/**
 * Toolbar popup controller. Lets the user pick which sites Anchor is allowed to
 * hijack PDF navigations on. Writes the `enabledSites` allowlist to
 * `browser.storage.local`; the background interceptor picks changes up live via
 * `storage.onChanged`.
 *
 * The current tab's host gets a one-click enable/disable toggle at the top; the
 * full list below can be edited freely.
 */
import { getSettings, saveSettings } from "../options/settings";

const currentHostEl = document.getElementById("current-host") as HTMLElement;
const currentStatusEl = document.getElementById(
    "current-status"
) as HTMLElement;
const currentToggleEl = document.getElementById(
    "current-toggle"
) as HTMLButtonElement;
const listEl = document.getElementById("site-list") as HTMLUListElement;
const addForm = document.getElementById("add-form") as HTMLFormElement;
const addInput = document.getElementById("add-input") as HTMLInputElement;
const openOptions = document.getElementById(
    "open-options"
) as HTMLAnchorElement;

/** Working copy of the allowlist; the storage write is the source of truth. */
let sites: string[] = [];
/** The active tab's hostname, or null when it has no http(s) host. */
let currentHost: string | null = null;

/**
 * Turn free-form input (`https://arxiv.org/abs/1`, `www.arxiv.org`, `arxiv.org`)
 * into a bare hostname, or null when nothing host-like can be extracted. A
 * leading `www.` is dropped so the entry also covers the apex domain.
 */
function toHostname(raw: string): string | null {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "") return null;
    const withScheme = /^[a-z]+:\/\//.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
    try {
        const host = new URL(withScheme).hostname;
        if (host === "") return null;
        return host.replace(/^www\./, "");
    } catch {
        return null;
    }
}

/** True when `currentHost` is covered by an entry in `sites`. */
function currentIsEnabled(): boolean {
    if (!currentHost) return false;
    return sites.some(
        (s) => currentHost === s || currentHost!.endsWith("." + s)
    );
}

async function persist(): Promise<void> {
    const settings = await getSettings();
    await saveSettings({ ...settings, enabledSites: sites });
}

function renderCurrent(): void {
    if (!currentHost) {
        currentHostEl.textContent = "No site to add here";
        currentHostEl.classList.add("none");
        currentStatusEl.textContent =
            "Open a web page or PDF to enable it for that site.";
        currentStatusEl.classList.remove("on");
        currentToggleEl.hidden = true;
        return;
    }

    currentHostEl.textContent = currentHost;
    currentHostEl.classList.remove("none");
    currentToggleEl.hidden = false;

    if (currentIsEnabled()) {
        currentStatusEl.textContent = "Anchor opens PDFs here";
        currentStatusEl.classList.add("on");
        currentToggleEl.textContent = "Disable";
        currentToggleEl.classList.remove("primary");
    } else {
        currentStatusEl.textContent = "PDFs open in Firefox's default viewer";
        currentStatusEl.classList.remove("on");
        currentToggleEl.textContent = "Enable here";
        currentToggleEl.classList.add("primary");
    }
}

function renderList(): void {
    listEl.replaceChildren();

    if (sites.length === 0) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "No sites yet — Anchor stays out of the way.";
        listEl.appendChild(li);
        renderCurrent();
        return;
    }

    for (const site of sites) {
        const li = document.createElement("li");

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = site;

        const remove = document.createElement("button");
        remove.className = "remove";
        remove.type = "button";
        remove.textContent = "×";
        remove.title = `Remove ${site}`;
        remove.setAttribute("aria-label", `Remove ${site}`);
        remove.addEventListener("click", () => {
            sites = sites.filter((s) => s !== site);
            void persist();
            render();
        });

        li.append(name, remove);
        listEl.appendChild(li);
    }

    renderCurrent();
}

function render(): void {
    renderList();
}

/** Add `host` if not already present; returns whether the list changed. */
function addSite(host: string): boolean {
    if (sites.includes(host)) return false;
    sites = [...sites, host];
    return true;
}

currentToggleEl.addEventListener("click", () => {
    if (!currentHost) return;
    if (currentIsEnabled()) {
        // Remove any entry that covers the current host (exact or parent domain).
        sites = sites.filter(
            (s) => !(currentHost === s || currentHost!.endsWith("." + s))
        );
    } else {
        addSite(currentHost);
    }
    void persist();
    render();
});

addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const host = toHostname(addInput.value);
    if (!host) {
        addInput.select();
        return;
    }
    const changed = addSite(host);
    addInput.value = "";
    addInput.focus();
    if (changed) {
        void persist();
    }
    render();
});

openOptions.addEventListener("click", (e) => {
    e.preventDefault();
    if (typeof browser !== "undefined" && browser.runtime?.openOptionsPage) {
        void browser.runtime.openOptionsPage();
        window.close();
    }
});

async function resolveCurrentHost(): Promise<void> {
    if (typeof browser === "undefined" || !browser.tabs) return;
    try {
        const [tab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
        });
        currentHost = tab?.url ? toHostname(tab.url) : null;
    } catch {
        currentHost = null;
    }
}

async function init(): Promise<void> {
    const [settings] = await Promise.all([getSettings(), resolveCurrentHost()]);
    sites = settings.enabledSites;
    render();
}

void init();
