/**
 * Options page controller. Loads current settings into the form and persists
 * changes to `browser.storage.local` as they happen (auto-save on input).
 */
import { getSettings, saveSettings, type Settings } from "./settings";

const mailtoInput = document.getElementById("mailto") as HTMLInputElement;
const hoverInput = document.getElementById("hoverPreview") as HTMLInputElement;
const status = document.getElementById("status") as HTMLElement;

let statusTimer: ReturnType<typeof setTimeout> | undefined;

function flashSaved(): void {
    status.textContent = "Saved.";
    if (statusTimer !== undefined) {
        clearTimeout(statusTimer);
    }
    statusTimer = setTimeout(() => {
        status.textContent = "";
    }, 1500);
}

async function load(): Promise<void> {
    const settings = await getSettings();
    mailtoInput.value = settings.mailto;
    hoverInput.checked = settings.hoverPreview;
}

async function persist(): Promise<void> {
    // Preserve fields this page doesn't edit (e.g. the enabledSites allowlist,
    // owned by the toolbar popup).
    const current = await getSettings();
    const next: Settings = {
        ...current,
        mailto: mailtoInput.value.trim(),
        hoverPreview: hoverInput.checked,
    };
    await saveSettings(next);
    flashSaved();
}

mailtoInput.addEventListener("change", () => void persist());
hoverInput.addEventListener("change", () => void persist());

void load();
