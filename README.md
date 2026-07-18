# Anchor PDF Reader

A Firefox extension that replaces the browser's PDF experience with its own [pdf.js](https://mozilla.github.io/pdf.js/)-based viewer and adds **interactive
citation previews**: click an in-text citation like `[12]` or `(Smith et al., 2021)` and get an in-place card with the cited paper's title, authors, abstract, citation count, related articles, versions, an open-access PDF link when one exists, and a Google Scholar deep link — without ever losing your reading position.

## How it works

PDF navigations are intercepted by a blocking `webRequest` handler and redirected to the extension's viewer page (a vendored pdf.js generic viewer). Inside the viewer, a four-stage pipeline runs:

| Stage      | What it does                                                                                                                                                                                   | Where                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1. Detect  | Finds citation markers (`[12]`, superscript `¹²`, `(Smith, 2021)`) in the pdf.js text layer, votes the document's dominant scheme, and overlays clickable hit-targets on the exact glyph rects | `src/citations/detect/`   |
| 2. Resolve | Locates the bibliography, segments it into entries, and maps a clicked marker to its reference string (plus DOI/title/year hints)                                                              | `src/citations/resolve/`  |
| 3. Lookup  | Resolves the reference to a paper record via **OpenAlex → Crossref → Semantic Scholar**, with a 30-day cache, request throttling, and 429 backoff                                              | `src/citations/metadata/` |
| 4. Card    | Renders the preview card (shadow DOM, focus-trapped dialog, five explicit states) anchored at the marker                                                                                       | `src/citations/ui/`       |

Stages 1–2 are pure and local; only stage 3 touches the network, and only the three metadata APIs above (Google Scholar is never scraped — it is linked to, not fetched). The full behavioral spec lives in [`docs/SPEC.md`](docs/SPEC.md).

## Building and running

```bash
pnpm install
pnpm build             # bundles the extension into dist/
pnpm exec web-ext run --source-dir dist   # launches Firefox with the extension loaded
```

Then open any PDF URL (an arXiv paper works well). To produce an installable artifact:

```bash
pnpm package           # -> artifacts/anchor_pdf_reader-<version>.zip (rename .xpi)
```

## Development

```bash
pnpm test              # vitest unit suite (all four stages + UI, jsdom)
pnpm typecheck         # tsc --noEmit
pnpm lint              # eslint
pnpm format            # prettier --write
pnpm lint:ext          # web-ext lint over the built dist/
```

Deeper verification scripts (run on demand):

```bash
pnpm exec tsx scripts/e2e-fixture-check.ts     # real pdf.js over generated fixture PDFs -> detect -> resolve
pnpm exec tsx scripts/live-smoke.ts            # metadata chain against the real APIs (network!)
node scripts/browser-check.mjs [pdf]     # headless-browser end-to-end: overlays, stacking, card, scroll invariance
node scripts/firefox-check.mjs [pdf]      # real-Firefox end-to-end via geckodriver (needs no running Firefox)
pnpm fixtures                         # regenerate test/fixtures/pdf/*.pdf
```

`scripts/browser-check.mjs` serves `dist/` over localhost and drives the actual viewer in headless Chromium — it is the regression test for the two integration bugs that only reproduce in a real browser (pipeline start racing document load, and PDF link annotations stacking above the marker overlay).

## Configuration

The extension options page exposes:

- **Contact email** — sent as the `mailto=` polite-pool parameter to OpenAlex and Crossref (better rate limits; please set your own).
- **Hover preview** — open cards after a 400 ms hover dwell instead of only on click (off by default).

## Permissions rationale

- `<all_urls>` + `webRequest`/`webRequestBlocking` — intercept PDF navigations and fetch the PDF bytes into the viewer.
- `api.openalex.org`, `api.crossref.org`, `api.semanticscholar.org` — the only metadata backends called.
- `storage` — settings and the citation-lookup cache.

Firefox-only by design: Chrome's MV3 does not support blocking `webRequest`.

**Important — Firefox treats MV3 host permissions as opt-in.** On a permanent install the extension starts with NO website access (the extensions-panel badge reads "Can't read and change data on this site"), so it cannot fetch PDF bytes or citation metadata until you grant access. The viewer detects this and shows a red **"Grant access"** banner; you can also grant manually via `about:addons → Anchor PDF Reader → Permissions → Access your data for all websites`. Temporary installs (`about:debugging` / `web-ext run`) are granted automatically.

## Troubleshooting

- **PDF redirects to the viewer but nothing loads / no citations:** almost always the host-permission grant above. Look for the red banner, or check the Permissions tab in `about:addons`.
- **Diagnostics:** open devtools on the viewer tab and filter the console for `[anchor]`. A healthy load logs `citation pipeline ready — dominant scheme: …`; failures log specific `[anchor]` warnings (permissions, page-text fetch, detection).
- **Which build am I running?** `about:addons` shows the version; current is the version in `src/manifest.json`.

## Repository layout

```
src/background/    PDF navigation interception
src/viewer/        pdf.js viewer bootstrap + PageTextReady hook
src/citations/     the four-stage pipeline (types.ts is the shared contract)
src/options/       options page
vendor/pdfjs/      vendored pdf.js generic viewer (patches marked "ANCHOR PATCH")
test/              vitest suites + fixtures (JSON text dumps and generated PDFs)
scripts/           fixture generation and verification harnesses
```
