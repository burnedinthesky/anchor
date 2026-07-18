/**
 * Regression tests for real-world author-year bibliographies (ACL/NeurIPS
 * style), reduced from aclanthology.org/2023.acl-long.1.pdf where resolution
 * failed for every marker:
 *
 *  1. Entries use "First Last" name order with the year AFTER the authors
 *     ("Layla El Asri, Jing He, and Kaheer Suleman. 2016. Title.") — keying
 *     an entry only by its first token indexes a given name, never matching
 *     the marker's surname key.
 *  2. Two-column layouts: right-column entry starts must not be treated as
 *     hanging-indent continuations of the left column.
 *  3. Trailing appendix content pollutes the x histogram; margins must be
 *     the frequent flush positions, not raw minima or low-count noise.
 *  4. Continuation lines that start with a wrapped year ("2002. Finite-time
 *     analysis...") must not make the block parse as a NUMBERED bibliography
 *     with ordinals like 2002.
 */
import { describe, it, expect } from "vitest";
import { BibliographyResolver } from "../../src/citations/resolve/index";
import type {
    CitationMarker,
    PDFTextContent,
    TextItem,
} from "../../src/citations/types";

function line(x: number, y: number, str: string): TextItem {
    return {
        str,
        transform: [10, 0, 0, 10, x, y],
        width: str.length * 5,
        height: 10,
        fontName: "g_body",
        dir: "ltr",
        hasEOL: true,
    };
}

function ayMarker(
    authorKey: string,
    year: number,
    rawText: string
): CitationMarker {
    return {
        id: `t#${authorKey}${year}`,
        page: 1,
        scheme: "author-year",
        rawText,
        rect: { x: 0, y: 0, w: 1, h: 1 },
        authorKey,
        year,
    };
}

// Two columns: flush x=72 / 306, hanging indent x=82 / 316. y descends.
function aclPages(): PDFTextContent[] {
    let yl = 700;
    let yr = 700;
    const L = (x: number, s: string) => line(x, (yl -= 14), s);
    const R = (x: number, s: string) => line(x, (yr -= 14), s);
    const refs: TextItem[] = [
        line(72, 714, "References"),
        // Left column — ACL-style entries, year after authors, some wrapped
        // so the year starts a continuation line (numbered-list bait).
        L(72, "Layla El Asri, Jing He, and Kaheer Suleman. 2016."),
        L(82, "A sequence-to-sequence model for user simulation."),
        L(72, "Peter Auer, Nicolo Cesa-Bianchi, and Paul Fischer."),
        L(82, "2002. Finite-time analysis of the multiarmed bandit"),
        L(82, "problem. Machine Learning."),
        L(72, "Bing Liu and Ian Lane. 2016. Attention-based recurrent"),
        L(82, "neural network models for joint intent detection."),
        L(72, "Baolin Peng, Chunyuan Li, and Jianfeng Gao. 2021."),
        L(82, "Soloist: Building task bots at scale."),
        // Year LAST, preceded by a page range that looks like years
        // (Medusa-paper regression: Brown et al., 2020 never resolved).
        L(72, "Tom Brown and Benjamin Mann. Language models are"),
        L(82, "few-shot learners. Advances in neural information"),
        L(82, "processing systems, 33:1877–1901, 2020."),
    ];
    const rightRefs: TextItem[] = [
        // Right column — entry starts at a different flush margin.
        R(306, "Jost Schatzmann, Blaise Thomson, Karl Weilhammer,"),
        R(316, "and Steve Young. 2007. Agenda-based user simulation"),
        R(316, "for bootstrapping a POMDP dialogue system."),
        R(306, "Tsung-Hsien Wen, David Vandyke, and Steve Young."),
        R(316, "2017. A network-based end-to-end trainable task-"),
        R(316, "oriented dialogue system."),
        R(306, "Xinnuo Xu, Yizhe Zhang, and Lars Liden. 2020."),
        R(316, "Conversation graph: Data augmentation and training."),
    ];
    // Appendix after the references: body text and stray table x positions
    // that must neither become margins nor drag real margins down.
    const appendix: TextItem[] = [
        line(72, 300, "A Appendix: Training Details"),
        line(72, 286, "We train every model for ten epochs using the"),
        line(72, 272, "same optimizer configuration as the baseline."),
        line(93, 258, "batch size 32"),
        line(103, 244, "learning rate 5e-5"),
        line(293, 230, "seed 42"),
        line(306, 216, "Additional results are reported for completeness"),
        line(306, 202, "in the table above."),
    ];
    return [{ items: [...refs, ...rightRefs, ...appendix] }];
}

describe("ACL-style bibliography resolution (regression)", () => {
    const res = new BibliographyResolver(aclPages());

    it('resolves markers against "First Last"-ordered entries (surname is not the first token)', () => {
        const r = res.resolve(ayMarker("asri", 2016, "Asri et al., 2016"));
        expect(r).not.toBeNull();
        expect(r!.rawText).toContain("sequence-to-sequence");
        expect(r!.hints.year).toBe(2016);
    });

    it("resolves right-column entries (per-column flush margins)", () => {
        const r = res.resolve(
            ayMarker("schatzmann", 2007, "Schatzmann et al., 2007")
        );
        expect(r).not.toBeNull();
        expect(r!.rawText).toContain("Agenda-based");

        const r2 = res.resolve(ayMarker("wen", 2017, "Wen et al., 2017"));
        expect(r2).not.toBeNull();
        expect(r2!.rawText).toContain("network-based");
    });

    it("matches non-first authors too (Liu and Lane -> lane key)", () => {
        const r = res.resolve(ayMarker("lane", 2016, "Liu and Lane, 2016"));
        expect(r).not.toBeNull();
        expect(r!.rawText).toContain("Attention-based");
    });

    it("does not mistake wrapped-year lines for a numbered bibliography", () => {
        // "2002. Finite-time..." starts a line; a numbered parse would swallow
        // the block and break every author-year lookup (and answer ordinal
        // 2002). Both must behave correctly:
        const auer = res.resolve(ayMarker("auer", 2002, "Auer et al., 2002"));
        expect(auer).not.toBeNull();
        expect(auer!.rawText).toContain("Finite-time");

        const numeric: CitationMarker = {
            id: "t#n2002",
            page: 1,
            scheme: "numeric",
            rawText: "[2002]",
            rect: { x: 0, y: 0, w: 1, h: 1 },
            ordinal: 2002,
            ordinals: [2002],
        };
        expect(res.resolve(numeric)).toBeNull();
    });

    it("indexes entries under trailing years too (page ranges masquerade as the first year)", () => {
        // "33:1877–1901, 2020." — the entry's real year is last; 1877/1901
        // must not eclipse it.
        const r = res.resolve(ayMarker("brown", 2020, "Brown and Mann, 2020"));
        expect(r).not.toBeNull();
        expect(r!.rawText).toContain("few-shot learners");
    });

    it("does not index appendix noise as entries for cited keys", () => {
        // Appendix mentions no (surname, year) pairs; a genuinely uncited key
        // must stay unresolved.
        expect(res.resolve(ayMarker("liden", 2021, "Liden, 2021"))).toBeNull();
    });
});
