/**
 * Fixture generator: builds geometrically realistic pdf.js-style TextItem
 * fixtures and writes them as importable JSON files in this directory.
 *
 *   npx tsx test/fixtures/_gen.ts
 *
 * The JSON files are the committed fixtures consumed by the unit tests via
 * loader.ts; regenerate them only if you change the scenarios below.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { PDFTextContent, TextItem } from "../../src/citations/types";

const HERE = dirname(fileURLToPath(import.meta.url));

const BODY = 10;
const SUP = 6;
const PAGE_TOP = 720;
const LINE_STEP = 18;
const ML = 72; // left margin
const CHAR_W = 0.5; // per-char advance as a fraction of font size
const GAP = 0.3; // inter-token gap as a fraction of font size

interface Tok {
    str: string;
    size?: number;
    raise?: number;
    font?: string;
}

interface LineSpec {
    toks: (string | Tok)[];
    x?: number;
    y?: number;
    eol?: boolean;
}

function norm(t: string | Tok): Tok {
    return typeof t === "string" ? { str: t } : t;
}

function layoutLine(spec: LineSpec, defaultY: number): TextItem[] {
    const items: TextItem[] = [];
    let x = spec.x ?? ML;
    const y = spec.y ?? defaultY;
    const toks = spec.toks.map(norm);
    toks.forEach((t, i) => {
        const size = t.size ?? BODY;
        const font = t.font ?? "g_body";
        const width = t.str.length * size * CHAR_W;
        const isLast = i === toks.length - 1;
        items.push({
            str: t.str,
            transform: [size, 0, 0, size, x, y + (t.raise ?? 0)],
            width,
            height: size,
            fontName: font,
            dir: "ltr",
            hasEOL: isLast && spec.eol !== false,
        });
        x += width + size * GAP;
    });
    return items;
}

function buildPage(lines: LineSpec[]): PDFTextContent {
    const items: TextItem[] = [];
    let y = PAGE_TOP;
    for (const line of lines) {
        const laid = layoutLine(line, y);
        items.push(...laid);
        y = (line.y ?? y) - LINE_STEP;
    }
    return { items };
}

function sup(str: string): Tok {
    return { str, size: SUP, raise: 3, font: "g_sup" };
}

// ---------------------------------------------------------------------------
// (a) IEEE-style numeric paper
// ---------------------------------------------------------------------------
const numeric: PDFTextContent[] = [
    buildPage([
        {
            toks: [
                "Deep",
                "learning",
                "has",
                "advanced",
                "rapidly",
                "[1]",
                "recently.",
            ],
        },
        {
            toks: [
                "Several",
                "architectures",
                "[3, 5–7]",
                "have",
                "been",
                "proposed.",
            ],
        },
        {
            toks: [
                "Comparative",
                "studies",
                "[3]",
                "–",
                "[5]",
                "confirm",
                "these",
                "results.",
            ],
        },
        {
            toks: [
                "Further",
                "discussion",
                "appears",
                "in",
                "prior",
                "surveys",
                "[2].",
            ],
        },
    ]),
    buildPage([
        { toks: ["References"] },
        {
            toks: [
                "[1]",
                "A. Smith and B. Jones. Deep nets. Journal of ML, 2019.",
            ],
        },
        {
            toks: [
                "[2]",
                "C. Doe. Wide models. In Proc. NeurIPS, 2020. doi:10.1109/5.771073.",
            ],
        },
        { toks: ["[3]", "E. Roe. Attention mechanisms. Trans. AI, 2018."] },
        { toks: ["[4]", "F. Lee. Transformers everywhere. ACM Press, 2021."] },
        {
            toks: [
                "[5]",
                "G. Kim. Scaling laws for models. arXiv preprint, 2020.",
            ],
        },
        { toks: ["[6]", "H. Park. Pretraining strategies. ICML, 2019."] },
        { toks: ["[7]", "I. Cho. Fine-tuning language models. EMNLP, 2020."] },
        {
            toks: [
                "[8]",
                "J. Yun. Knowledge distillation methods. CVPR, 2022.",
            ],
        },
    ]),
];

// ---------------------------------------------------------------------------
// (b) ACM author–year paper (unnumbered refs, 2020a/2020b collision, diacritic)
// ---------------------------------------------------------------------------
const authorYear: PDFTextContent[] = [
    buildPage([
        {
            toks: [
                "Prior",
                "work",
                "(Smith et al., 2021)",
                "established",
                "the",
                "method.",
            ],
        },
        {
            toks: [
                "Recent",
                "analysis",
                "(Gómez and Jones, 2020)",
                "extends",
                "it.",
            ],
        },
        {
            toks: [
                "As",
                "shown",
                "by",
                "Smith",
                "et",
                "al.",
                "(2021),",
                "results",
                "improve.",
            ],
        },
        {
            toks: [
                "Two",
                "efforts",
                "(Smith, 2020; Jones, 2021)",
                "diverge",
                "here.",
            ],
        },
        {
            toks: [
                "Earlier",
                "results",
                "(Brown, 2020a)",
                "and",
                "later",
                "(Brown, 2020b)",
                "differ.",
            ],
        },
        {
            toks: [
                "We",
                "also",
                "note",
                "(Smith & Jones, 2021)",
                "and",
                "(Smith and Jones 2021).",
            ],
        },
    ]),
    buildPage([
        { toks: ["References"] },
        {
            toks: [
                "Brown, A. (2020a). A first study of many things. Journal A.",
            ],
        },
        {
            toks: [
                "Brown, A. (2020b). A second study of other things. Journal B.",
            ],
        },
        { toks: ["Gómez, M. and Jones, R. (2020). Extending the method for"] },
        {
            toks: ["several new application domains. Journal C."],
            x: ML + 18,
            eol: true,
        },
        {
            toks: [
                "Jones, R. (2021). Divergent efforts in the field. Proc. D.",
            ],
        },
        { toks: ["Smith, J., Doe, K., and Roe, L. (2021). Establishing the"] },
        {
            toks: ["method with rigorous experiments. ACM Press E."],
            x: ML + 18,
            eol: true,
        },
    ]),
];

// ---------------------------------------------------------------------------
// (c) Superscript paper (small raised digit runs; a same-size number rejected)
// ---------------------------------------------------------------------------
const superscript: PDFTextContent[] = [
    buildPage([
        {
            toks: [
                "Recent",
                "studies",
                sup("1"),
                "have",
                "shown",
                "significant",
                "gains.",
            ],
        },
        {
            toks: [
                "Other",
                "work",
                sup("2,3"),
                "reports",
                "similar",
                "results",
                "in",
                "42",
                "trials.",
            ],
        },
        {
            toks: [
                "Follow-up",
                "analysis",
                sup("4"),
                "extends",
                "this",
                "line",
                "of",
                "work.",
            ],
        },
    ]),
    buildPage([
        { toks: ["References"] },
        {
            toks: [
                "[1]",
                "A. One. A first superscript paper. Journal J, 2019.",
            ],
        },
        { toks: ["[2]", "B. Two. A second contribution. Journal K, 2020."] },
        { toks: ["[3]", "C. Three. A third result set. Journal L, 2021."] },
        { toks: ["[4]", "D. Four. A fourth analysis. Journal M, 2022."] },
    ]),
];

// ---------------------------------------------------------------------------
// (d) No references section (author-year cites only)
// ---------------------------------------------------------------------------
const noReferences: PDFTextContent[] = [
    buildPage([
        {
            toks: [
                "The",
                "theory",
                "(Smith, 2021)",
                "is",
                "well",
                "studied",
                "today.",
            ],
        },
        {
            toks: [
                "See",
                "also",
                "(Jones, 2019)",
                "for",
                "additional",
                "details.",
            ],
        },
    ]),
];

// ---------------------------------------------------------------------------
// (e) Citation wrapping across two TextItems / two lines
// ---------------------------------------------------------------------------
const wrap: PDFTextContent[] = [
    buildPage([
        // Extra cites so author-year is the dominant scheme for this page set.
        {
            toks: [
                "Background",
                "(Jones, 2018)",
                "and",
                "(Lee, 2019)",
                "apply",
                "here.",
            ],
        },
        {
            toks: [
                "More",
                "context",
                "(Park, 2020)",
                "is",
                "also",
                "relevant.",
            ],
        },
        // The wrapped citation: "(Smith et al.," ends the line; "2021)" begins next.
        { toks: ["Prior", "work", "(Smith et al.,"], eol: true },
        { toks: ["2021)", "confirms", "this", "finding."] },
    ]),
];

// ---------------------------------------------------------------------------
// (f) Mixed signal: author-year body cites, but a numbered reference list whose
//     bracket labels must NOT win the dominant-scheme vote (they're excluded).
// ---------------------------------------------------------------------------
const mixed: PDFTextContent[] = [
    buildPage([
        { toks: ["First", "claim", "(Alpha, 2020)", "holds", "here."] },
        { toks: ["Second", "claim", "(Beta, 2019)", "as", "well."] },
        { toks: ["Third", "point", "(Gamma, 2021)", "follows."] },
        { toks: ["Fourth", "point", "(Delta, 2018)", "too."] },
    ]),
    buildPage([
        { toks: ["References"] },
        { toks: ["[1]", "Alpha, A. (2020). A paper. Venue."] },
        { toks: ["[2]", "Beta, B. (2019). B paper. Venue."] },
        { toks: ["[3]", "Gamma, C. (2021). C paper. Venue."] },
        { toks: ["[4]", "Delta, D. (2018). D paper. Venue."] },
        { toks: ["[5]", "Epsilon, E. (2017). E paper. Venue."] },
        { toks: ["[6]", "Zeta, F. (2016). F paper. Venue."] },
        { toks: ["[7]", "Eta, G. (2015). G paper. Venue."] },
        { toks: ["[8]", "Theta, H. (2014). H paper. Venue."] },
    ]),
];

function emit(name: string, pages: PDFTextContent[]): void {
    writeFileSync(
        join(HERE, `${name}.json`),
        JSON.stringify(pages, null, 2) + "\n",
        "utf8"
    );
}

emit("numeric", numeric);
emit("author-year", authorYear);
emit("superscript", superscript);
emit("no-references", noReferences);
emit("wrap", wrap);
emit("mixed", mixed);

console.log(
    "wrote fixtures: numeric, author-year, superscript, no-references, wrap, mixed"
);
