/**
 * Generate small real PDFs (numeric, author–year, superscript) with pdf-lib,
 * mirroring the JSON TextItem fixtures. These are for later end-to-end
 * verification in the actual viewer; the unit tests use the JSON fixtures.
 *
 *   npx tsx scripts/make-fixtures.ts   →  test/fixtures/pdf/*.pdf
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "test", "fixtures", "pdf");

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const BODY = 11;
const LEADING = 20;

interface Span {
  text: string;
  size?: number;
  rise?: number; // baseline offset (superscript)
}

/** One "document" is an array of pages; each page is an array of lines of spans. */
type Doc = Span[][][];

async function build(doc: Doc, title: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);

  for (const pageLines of doc) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;
    for (const line of pageLines) {
      let x = MARGIN;
      for (const span of line) {
        const size = span.size ?? BODY;
        const rise = span.rise ?? 0;
        page.drawText(span.text, {
          x,
          y: y + rise,
          size,
          font,
          color: rgb(0, 0, 0),
        });
        x += font.widthOfTextAtSize(span.text, size) + font.widthOfTextAtSize(" ", size);
      }
      y -= LEADING;
    }
  }
  return pdf.save();
}

const t = (text: string, size?: number, rise?: number): Span => ({ text, size, rise });

const numeric: Doc = [
  [
    [t("Deep learning has advanced rapidly [1] recently.")],
    [t("Several architectures [3, 5-7] have been proposed.")],
    [t("Comparative studies [3]-[5] confirm these results.")],
    [t("Further discussion appears in prior surveys [2].")],
  ],
  [
    [t("References")],
    [t("[1] A. Smith and B. Jones. Deep nets. Journal of ML, 2019.")],
    [t("[2] C. Doe. Wide models. In Proc. NeurIPS, 2020. doi:10.1109/5.771073.")],
    [t("[3] E. Roe. Attention mechanisms. Trans. AI, 2018.")],
    [t("[4] F. Lee. Transformers everywhere. ACM Press, 2021.")],
    [t("[5] G. Kim. Scaling laws for models. arXiv preprint, 2020.")],
    [t("[6] H. Park. Pretraining strategies. ICML, 2019.")],
    [t("[7] I. Cho. Fine-tuning language models. EMNLP, 2020.")],
    [t("[8] J. Yun. Knowledge distillation methods. CVPR, 2022.")],
  ],
];

const authorYear: Doc = [
  [
    [t("Prior work (Smith et al., 2021) established the method.")],
    [t("Recent analysis (Gomez and Jones, 2020) extends it.")],
    [t("As shown by Smith et al. (2021), results improve.")],
    [t("Two efforts (Smith, 2020; Jones, 2021) diverge here.")],
    [t("Earlier results (Brown, 2020a) and later (Brown, 2020b) differ.")],
  ],
  [
    [t("References")],
    [t("Brown, A. (2020a). A first study of many things. Journal A.")],
    [t("Brown, A. (2020b). A second study of other things. Journal B.")],
    [t("Gomez, M. and Jones, R. (2020). Extending the method. Journal C.")],
    [t("Jones, R. (2021). Divergent efforts in the field. Proc. D.")],
    [t("Smith, J., Doe, K., and Roe, L. (2021). Establishing it. ACM E.")],
  ],
];

const superscript: Doc = [
  [
    [t("Recent studies "), t("1", 7, 4), t(" have shown significant gains.")],
    [t("Other work "), t("2,3", 7, 4), t(" reports similar results in 42 trials.")],
    [t("Follow-up analysis "), t("4", 7, 4), t(" extends this line of work.")],
  ],
  [
    [t("References")],
    [t("[1] A. One. A first superscript paper. Journal J, 2019.")],
    [t("[2] B. Two. A second contribution. Journal K, 2020.")],
    [t("[3] C. Three. A third result set. Journal L, 2021.")],
    [t("[4] D. Four. A fourth analysis. Journal M, 2022.")],
  ],
];

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const docs: [string, Doc][] = [
    ["numeric", numeric],
    ["author-year", authorYear],
    ["superscript", superscript],
  ];
  for (const [name, doc] of docs) {
    const bytes = await build(doc, `Fixture: ${name}`);
    writeFileSync(join(OUT_DIR, `${name}.pdf`), bytes);
    // eslint-disable-next-line no-console
    console.log(`wrote test/fixtures/pdf/${name}.pdf (${bytes.length} bytes)`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
