/**
 * Headless end-to-end check: load the generated fixture PDFs with the REAL
 * pdf.js library (same version the viewer vendors), feed its actual
 * getTextContent() output through Stage 1 detection and Stage 2 resolution,
 * and assert markers + resolution behave on genuine pdf.js data (not
 * hand-authored fixtures).
 *
 *   npx tsx scripts/e2e-fixture-check.ts
 */
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DocumentCitationDetector } from "../src/citations/detect/index.js";
import { BibliographyResolver } from "../src/citations/resolve/index.js";
import type { PDFTextContent, TextItem, CitationMarker } from "../src/citations/types.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`E2E FAIL: ${msg}`);
}

async function loadPages(path: string): Promise<{ pages: PDFTextContent[]; viewports: any[] }> {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)) }).promise;
  const pages: PDFTextContent[] = [];
  const viewports: any[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push({
      items: tc.items.filter((it: any): it is TextItem => typeof it.str === "string"),
    });
    viewports.push(page.getViewport({ scale: 1.0 }));
  }
  return { pages, viewports };
}

function checkRects(markers: CitationMarker[], viewport: any, label: string) {
  for (const m of markers) {
    assert(m.rect.w > 0 && m.rect.h > 0, `${label}: degenerate rect on ${m.rawText}`);
    assert(
      m.rect.x >= -1 && m.rect.y >= -1 && m.rect.x + m.rect.w <= viewport.width + 1 && m.rect.y + m.rect.h <= viewport.height + 1,
      `${label}: rect out of page bounds for ${m.rawText}: ${JSON.stringify(m.rect)} vs ${viewport.width}x${viewport.height}`
    );
  }
}

// --- Numeric fixture -------------------------------------------------------
{
  const { pages, viewports } = await loadPages("test/fixtures/pdf/numeric.pdf");
  const det = new DocumentCitationDetector(pages);
  assert(det.dominantScheme === "numeric", `numeric.pdf voted ${det.dominantScheme}`);
  const all = pages.flatMap((p, i) => det.detect(i + 1, p, viewports[i]));
  console.log(`[numeric] scheme=${det.dominantScheme} markers=${all.length}: ${[...new Set(all.map((m) => m.rawText))].join(" ")}`);
  assert(all.length >= 2, "numeric.pdf: expected >=2 markers");
  all.forEach((m) => checkRects([m], viewports[m.page - 1], "numeric"));

  const res = new BibliographyResolver(pages);
  const resolved = all.map((m) => ({ m, r: res.resolve(m) }));
  const ok = resolved.filter((x) => x.r !== null);
  assert(ok.length === resolved.length, `numeric.pdf: ${resolved.length - ok.length} markers failed to resolve`);
  for (const { m, r } of ok) {
    console.log(`  ${m.rawText} -> ordinal ${m.ordinal}: "${r!.rawText.slice(0, 70)}..." doi=${r!.doi ?? "-"}`);
    assert(r!.rawText.length > 20, `numeric.pdf: suspiciously short entry for ${m.rawText}`);
  }
}

// --- Author-year fixture ---------------------------------------------------
{
  const { pages, viewports } = await loadPages("test/fixtures/pdf/author-year.pdf");
  const det = new DocumentCitationDetector(pages);
  assert(det.dominantScheme === "author-year", `author-year.pdf voted ${det.dominantScheme}`);
  const all = pages.flatMap((p, i) => det.detect(i + 1, p, viewports[i]));
  console.log(`[author-year] scheme=${det.dominantScheme} markers=${all.length}: ${[...new Set(all.map((m) => m.rawText))].join(" | ")}`);
  assert(all.length >= 2, "author-year.pdf: expected >=2 markers");
  all.forEach((m) => checkRects([m], viewports[m.page - 1], "author-year"));

  const res = new BibliographyResolver(pages);
  const ok = all.map((m) => res.resolve(m)).filter((r) => r !== null);
  console.log(`  resolved ${ok.length}/${all.length}`);
  assert(ok.length >= Math.ceil(all.length / 2), "author-year.pdf: fewer than half of markers resolved");
}

// --- Superscript fixture ---------------------------------------------------
{
  const { pages, viewports } = await loadPages("test/fixtures/pdf/superscript.pdf");
  const det = new DocumentCitationDetector(pages);
  assert(det.dominantScheme === "superscript", `superscript.pdf voted ${det.dominantScheme}`);
  const all = pages.flatMap((p, i) => det.detect(i + 1, p, viewports[i]));
  console.log(`[superscript] scheme=${det.dominantScheme} markers=${all.length}: ${[...new Set(all.map((m) => m.rawText))].join(" ")}`);
  assert(all.length >= 1, "superscript.pdf: expected >=1 marker");
  all.forEach((m) => checkRects([m], viewports[m.page - 1], "superscript"));

  const res = new BibliographyResolver(pages);
  const ok = all.map((m) => res.resolve(m)).filter((r) => r !== null);
  assert(ok.length >= 1, "superscript.pdf: no marker resolved");
  console.log(`  resolved ${ok.length}/${all.length}`);
}

console.log("\nE2E FIXTURE CHECK PASS — real pdf.js text output flows through detect+resolve correctly.");
