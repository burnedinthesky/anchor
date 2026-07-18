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
}

export const STORAGE_KEY = "settings";

export const DEFAULT_SETTINGS: Settings = {
  mailto: DEFAULT_MAILTO,
  hoverPreview: false,
};

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
  };
}

/** Persist a full settings object. No-op in non-extension contexts. */
export async function saveSettings(settings: Settings): Promise<void> {
  if (!hasStorage()) {
    return;
  }
  await browser.storage.local.set({ [STORAGE_KEY]: settings });
}
