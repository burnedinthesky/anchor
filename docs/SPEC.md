# Spec: Interactive Citation Preview for a Firefox PDF Reader

**Audience:** an autonomous coding agent implementing the feature.
**Status:** implementation-ready. Assumptions are marked `[ASSUMPTION]`; where you must choose, a default is given.

---

## 0. Context

We are building a from-scratch Firefox WebExtension that ships its own PDF viewer (bundled `pdf.js`) rather than decorating Firefox's built-in viewer, because content scripts are not injected into the built-in `pdf.js` internal page. PDF navigations are intercepted with a blocking `webRequest.onBeforeRequest` handler and redirected to an extension-hosted viewer page that renders the document. **This spec covers only the citation-preview feature inside that viewer** — not the interception, the outline, figure jumps, or theming, which are specified separately.

The feature reproduces Google Scholar PDF Reader's "preview references as you read": a user clicks an in-text citation and gets an in-place card showing the cited paper's title, authors, abstract, citation count, related articles, and versions, plus a link to the paper on Google Scholar — without losing reading position.

---

## 1. Feature summary — definition of done

Given a rendered PDF in the viewer:

1. In-text citation markers (numeric `[12]`, `[3, 5–7]`, superscript `¹²`, and author–year `(Smith et al., 2021)`) are detected and rendered as clickable hit-targets overlaid on the text layer, with a hover affordance (underline/cursor change).
2. Clicking a marker resolves it to a bibliography entry, resolves that entry to a canonical paper record via an external metadata API, and opens a preview card anchored near the click.
3. The card shows: title, author list, year/venue, abstract, citation count, a "Versions" list, an "Open PDF" action when an OA copy exists, and a "View on Google Scholar" link.
4. The card has explicit loading, success, partial (some fields missing), empty (unresolved), and error states.
5. The reading position never changes as a side effect of any of the above; the card is an overlay, dismissed by outside-click / `Esc`.
6. Repeated clicks on the same or already-resolved citation are served from cache (no duplicate network calls).

---

## 2. Non-goals

- Scraping Google Scholar HTML. Scholar has no public API and applies aggressive rate-limiting and CAPTCHAs; do not fetch or parse `scholar.google.com` result pages. Scholar is used only as an outbound _deep link_.
- Annotation/highlight persistence, the AI outline, figure previews, citation-format copying, theming — separate specs.
- Server-side components. Everything runs in the extension; the only network egress is to the metadata APIs in §7.
- Perfect recall on citation detection. Precision is prioritized over recall (a missed marker is acceptable; a wrong-target marker is not).

---

## 3. Pipeline

```
click on marker
   │
   ▼
[Stage 1] Detect & overlay markers        (PDF text layer geometry)
   │  markerId ─┐
   ▼            │
[Stage 2] Resolve marker → bib entry      (reference section parsing)
   │  structured reference ─┐
   ▼                        │
[Stage 3] Resolve entry → PaperRecord     (OpenAlex → Crossref → S2)
   │  PaperRecord (cached) ─┐
   ▼                        │
[Stage 4] Render preview card             (overlay UI)
```

Stages 1–2 are pure/local (no network). Stage 3 is networked and cached. Stage 4 is UI. Implement and test each stage behind a typed interface so they are independently swappable.

---

## 4. Stage 1 — In-text citation detection

### 4.1 Input

`pdf.js` `page.getTextContent()` yields `TextItem[]`, each with `str`, `transform` (a 6-element matrix giving x/y and scale), `width`, `height`, `fontName`, `dir`. The text layer is rendered as absolutely-positioned spans over the canvas.

### 4.2 Supported schemes (detect in this priority order)

1. **Bracketed numeric:** `[12]`, `[3,5]`, `[3, 5–7]`, `[3]–[5]`. Regex core: `\[\s*\d+(?:\s*[–-]\s*\d+)?(?:\s*,\s*\d+(?:\s*[–-]\s*\d+)?)*\s*\]`. Expand ranges/lists into individual reference numbers.
2. **Superscript numeric:** digits whose `transform` scale is smaller than the surrounding body font _and_ baseline is raised. Detect via font-size delta (< ~0.8× local median) and vertical offset. Group adjacent superscript digits/commas into one marker.
3. **Author–year:** `(Author, YYYY)`, `(Author et al., YYYY)`, `(Author and Author YYYY)`, and narrative `Author et al. (YYYY)`. Regex plus a year guard `(18|19|20)\d{2}`. Capture author surname token(s) + year; these become the match key in Stage 2.

`[ASSUMPTION]` The document uses one dominant scheme. Detect the dominant scheme once per document (count matches) and only overlay that scheme's markers to reduce false positives.

### 4.3 Geometry mapping

The regex runs on concatenated text, but overlays must sit on glyphs. Algorithm:

1. Concatenate `TextItem.str` per page into one string, keeping an index map `charIndex → { itemIndex, offsetInItem }`.
2. Run the regex over the concatenated string.
3. For each match span `[start,end)`, look up the covering `TextItem`(s) and compute a bounding box in PDF user space from each item's `transform`, `width`, and the fractional offset of the matched substring (approximate per-char advance as `width / str.length`).
4. Transform the box to viewport coordinates with `page.getViewport({scale}).convertToViewportPoint`.
5. Emit a `CitationMarker` (see §8) with a viewport rect. Render an absolutely-positioned transparent `<button>` over that rect in an overlay layer that shares the text layer's transform, so it tracks zoom/scroll.

### 4.4 Output

`CitationMarker[]` per page, each carrying its raw matched text and either an ordinal (numeric) or an `{authorKey, year}` (author–year). Store in a page-indexed map. Re-run on zoom only if you rebuild the text layer; otherwise the overlay scales with its parent.

---

## 5. Stage 2 — Reference resolution (marker → bibliography entry)

### 5.1 Locate the reference section

Scan text items for a heading line matching `/^(references|bibliography|works cited|literature cited)$/i` (case-insensitive, allowing a leading number). Everything after it (to end of document or next top-level heading) is the reference block. If absent, Stage 2 fails → Stage 3 falls back to matching on the marker text itself where possible (author–year) or the feature no-ops (numeric).

### 5.2 Segment into entries

- **Numbered lists:** split on line-leading `[\d+]`, `\d+\.`, or hanging-indent numeric labels. Entry _n_ maps to reference ordinal _n_.
- **Unnumbered (author–year):** split on blank-line / hanging-indent boundaries; each block is one entry. Build an index keyed by `(firstAuthorSurname, year)`.

### 5.3 Marker → entry

- **Numeric:** direct index by ordinal. Validate ordinal ≤ entry count.
- **Author–year:** match `{authorKey, year}` against the index. Normalize surnames (strip diacritics, lowercase). On multiple year collisions for one author, disambiguate by the `a/b/c` suffix if present in the marker, else present the first and note ambiguity in the card.

### 5.4 Parse the entry into structured fields

Do **not** hand-roll a full citation parser. Options, in order of preference:

1. Pass the raw entry string to Crossref `query.bibliographic` (Stage 3) and let it resolve — most robust.
2. If offline structure is needed, extract with heuristics: year `(18|19|20)\d{2}`, title as the longest quoted or sentence-cased span, authors as the leading `Surname, I.` sequence, DOI via `10\.\d{4,9}/\S+`.

**Prefer to carry the raw reference string forward** and let Stage 3's bibliographic search do the heavy lifting; treat parsed fields as hints only.

### 5.5 Output

`ResolvedReference { markerId, rawText, doi?, hints: { title?, authors?, year? } }`.

---

## 6. Stage 3 — Metadata lookup (reference → PaperRecord)

### 6.1 Backend rationale

Google Scholar is not queryable programmatically (see §2). Use open scholarly APIs that expose the same fields. **Primary: OpenAlex** — it uniquely provides both `related_works` (the direct analog of Scholar "Related articles") and `cited_by_count`, needs no API key, and has a generous polite pool. Fallbacks fill gaps.

### 6.2 Resolution order

1. **If a DOI is known:** OpenAlex `GET /works/https://doi.org/{doi}` (exact).
2. **Else bibliographic search:** Crossref `GET /works?query.bibliographic={rawText}&rows=1&select=DOI,title,author,issued,is-referenced-by-count,abstract` to obtain a DOI, then look that DOI up in OpenAlex for related/versions.
3. **Else title search:** OpenAlex `GET /works?search={title}&per_page=1`.
4. **Semantic Scholar fallback** for abstract and recommendations if still missing.

Always send a `mailto=<config email>` param to OpenAlex/Crossref (polite pool). Set a descriptive `User-Agent` where the platform allows.

### 6.3 Endpoints and field mapping

| Card field        | OpenAlex (primary)                                         | Crossref (fallback)                | Semantic Scholar (fallback)                |
| ----------------- | ---------------------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| Title             | `title` / `display_name`                                   | `title[0]`                         | `title`                                    |
| Authors           | `authorships[].author.display_name`                        | `author[]`                         | `authors[].name`                           |
| Year / venue      | `publication_year`, `primary_location.source.display_name` | `issued`, `container-title[0]`     | `year`, `venue`                            |
| Abstract          | reconstruct from `abstract_inverted_index`                 | `abstract` (JATS XML → strip tags) | `abstract`                                 |
| Citation count    | `cited_by_count`                                           | `is-referenced-by-count`           | `citationCount`                            |
| Related articles  | `related_works[]` (resolve each ID → title)                | —                                  | `/recommendations/v1/papers/forpaper/{id}` |
| Versions          | `locations[]` (dedupe by host/version)                     | `relation.has-version`             | `externalIds` + `openAccessPdf`            |
| OA PDF            | `best_oa_location.pdf_url`                                 | via Unpaywall/DOI (skip)           | `openAccessPdf.url`                        |
| Scholar deep link | build from title (see §6.5)                                | same                               | same                                       |

**OpenAlex abstract reconstruction:** `abstract_inverted_index` maps `word → [positions]`; rebuild by placing each word at each position and joining in position order. Cap displayed abstract length (see §8, `MAX_ABSTRACT_CHARS`).

**Related articles:** `related_works` is an array of OpenAlex IDs, not titles. Resolve up to `MAX_RELATED` (default 5) via a single batched call: `GET /works?filter=openalex_id:{id1|id2|...}&select=id,display_name,publication_year`. One batched request, not N.

### 6.4 Caching & rate limiting

- In-memory `Map<cacheKey, PaperRecord>` for the session; `cacheKey` = DOI if known, else normalized title hash.
- Persist to `browser.storage.local` with a TTL (default 30 days) so citation counts refresh but repeat reads are instant.
- Serialize concurrent identical lookups (in-flight promise map) so double-clicks don't double-fetch.
- Throttle to ≤ ~5 req/s across the extension; back off on HTTP 429 with jittered exponential retry (max 3).

### 6.5 Scholar deep link

Never scrape. Build: `https://scholar.google.com/scholar?q={encodeURIComponent(title)}`. This opens the real Scholar page (with its own cited-by, related, and "all versions") in a new tab on user click. Honors the original UX intent without automated access.

### 6.6 Output

A fully or partially populated `PaperRecord` (see §8), tagged with which backend(s) supplied it and a `completeness` flag.

---

## 7. Stage 4 — Preview card UI

### 7.1 Trigger

- **Click** on a marker overlay opens the card (primary interaction, matches the original).
- **Optional hover** open after a 400 ms dwell, cancel on mouseout before threshold. Gate behind a config flag (`hoverPreview`, default off) to avoid accidental popups.

### 7.2 Anchoring & layout

- Anchor to the marker rect; prefer opening below-right, flip to stay within the viewport. Never cover the marker itself. Fixed width (default 600 px), max height with internal scroll.
- Rendered in a shadow-DOM overlay container so document CSS can't leak in and the card can't shift page layout (guarantees "don't lose your place").

### 7.3 States

- **Loading:** skeleton with title placeholder; show as soon as click registers (< 16 ms), before network returns.
- **Success:** title (link → Scholar deep link), author list (truncate with "+N more"), year · venue, abstract (clamped to 12 lines, "Show more"), and a footer row combining the additional info (`Cited by {n}`, Versions count + inline host links) on the left with the actions (`Open PDF` if OA, `View on Google Scholar`) on the right. ("Related articles" is still fetched into the record but hidden in the card.)
- **Partial:** render what resolved; hide empty sections; show a subtle "some details unavailable" note.
- **Empty (unresolved):** "Couldn't resolve this reference," with a `Search on Google Scholar` button using the raw reference text.
- **Error:** network/timeout message with a `Retry` button.

### 7.4 Dismissal & a11y

- Dismiss on outside click, `Esc`, or scrolling the marker out of view.
- Only one card open at a time.
- Card is a focus-trapped `role="dialog"` with `aria-label`; marker buttons have accessible names ("Citation 12"); full keyboard operability; respect `prefers-reduced-motion`.
- Inherit the viewer's active theme (light/dark/night) via CSS variables.

---

## 8. Data model (TypeScript)

See `src/citations/types.ts` — the authoritative, slightly extended version of the spec's data model (adds `ViewportLike`, `PageTextReadyEvent`, `ordinals`, `DEFAULT_MAILTO`, `buildScholarUrl`). Config constants: `MAX_RELATED = 5`, `MAX_ABSTRACT_CHARS = 1200`, `CACHE_TTL_DAYS = 30`, `HOVER_DWELL_MS = 400`, `CARD_WIDTH_PX = 600`.

---

## 9. Manifest / permissions (relevant subset)

```jsonc
{
    "manifest_version": 3,
    "browser_specific_settings": {
        "gecko": { "id": "scholar-reader@example" },
    },
    "host_permissions": [
        "https://api.openalex.org/*",
        "https://api.crossref.org/*",
        "https://api.semanticscholar.org/*",
    ],
    "permissions": ["storage"],
}
```

- Cross-origin fetches to the three API hosts require the `host_permissions` above; the viewer page is extension-origin, so `fetch` works once permissions are granted.
- Do **not** request Scholar host permissions — Scholar is opened as a normal tab link, not fetched.
- Store the polite-pool `mailto` in extension options, not hard-coded.
- (Project addition, outside this spec's scope:) interception additionally needs `webRequest`, `webRequestBlocking`, `tabs`-free redirect handling, and `<all_urls>` host permission.

---

## 10. Edge cases

- Marker spans two `TextItem`s or wraps a line → merge boxes, or emit two hit-targets pointing at one `markerId`.
- Range citations `[3–5]` → one visual marker; on click, resolve the first and let the card offer a small "3 · 4 · 5" switcher `[NICE-TO-HAVE]`.
- No reference section (numeric) → detection still overlays markers but resolution no-ops; card shows empty state with a Scholar search on the marker text.
- Reference entry has a DOI but the DOI 404s in OpenAlex → fall through to title search.
- Non-English abstracts / RTL → render as-is; do not translate.
- Scanned/image-only PDF (no text layer) → feature is inert; do not error.
- Duplicate authors/self-citations in related list → dedupe by title.

---

## 11. Acceptance criteria (test matrix)

| #   | Scenario                                      | Expected                                                                                    |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Numeric PDF, click `[12]`                     | Card resolves to reference 12's paper; abstract + `Cited by` shown                          |
| 2   | Author–year PDF, click `(Smith et al., 2021)` | Resolves to matching bib entry; correct paper card                                          |
| 3   | Superscript numeric PDF                       | Superscript digits detected as markers; correct resolution                                  |
| 4   | Reference with DOI                            | Exact OpenAlex hit; no title-search fallback triggered                                      |
| 5   | Reference without DOI                         | Crossref bibliographic → OpenAlex; card populated                                           |
| 6   | Related articles fetched                      | Up to 5 related items resolved into the record via one batched request (hidden in the card) |
| 7   | Versions present                              | Version count + list rendered                                                               |
| 8   | Second click on same citation                 | Served from cache; zero new network calls                                                   |
| 9   | Offline / API 500                             | Error state with working Retry                                                              |
| 10  | Unresolvable reference                        | Empty state with "Search on Google Scholar"                                                 |
| 11  | Any card open/close                           | Scroll position and page unchanged before/after                                             |
| 12  | HTTP 429                                      | Backoff + retry; no user-visible failure under transient limit                              |

Every stage has unit tests against fixtures; add integration fixtures for at least: an IEEE-style numeric paper, an ACM author–year paper, and a paper with superscript citations.
