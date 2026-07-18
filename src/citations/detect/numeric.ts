/**
 * Bracketed-numeric citation detection (spec §4.2 scheme 1).
 * Regex core is exactly the one given in the spec.
 */
import type { CitationScheme } from "../types";

export interface RawMatch {
    start: number;
    end: number;
    rawText: string;
    scheme: CitationScheme;
    ordinal?: number;
    ordinals?: number[];
    authorKey?: string;
    year?: number;
}

const CORE =
    /\[\s*\d+(?:\s*[–—-]\s*\d+)?(?:\s*,\s*\d+(?:\s*[–—-]\s*\d+)?)*\s*\]/g;

const SINGLE = /^\[\s*\d+\s*\]$/;
const BETWEEN_DASH = /^\s*[–—-]\s*$/;

/** Expand a bracket citation's content to individual ordinals. */
export function expandOrdinals(bracketText: string): number[] {
    const inner = bracketText.replace(/[[\]]/g, "");
    const out: number[] = [];
    for (const part of inner.split(",")) {
        const rng = part.match(/^\s*(\d+)\s*[–—-]\s*(\d+)\s*$/);
        if (rng) {
            const a = Number(rng[1]);
            const b = Number(rng[2]);
            if (a <= b) for (let n = a; n <= b; n++) out.push(n);
            else out.push(a);
        } else {
            const s = part.match(/\d+/);
            if (s) out.push(Number(s[0]));
        }
    }
    return out;
}

export function findNumericMatches(text: string): RawMatch[] {
    const raw: { start: number; end: number; text: string }[] = [];
    CORE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CORE.exec(text))) {
        raw.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }

    // Merge "[3]–[5]" (and chains thereof) into a single range marker.
    const merged: { start: number; end: number; text: string }[] = [];
    for (let i = 0; i < raw.length; i++) {
        let cur = raw[i];
        if (!cur) continue;
        while (i + 1 < raw.length) {
            const nxt = raw[i + 1];
            if (!nxt) break;
            const gap = text.slice(cur.end, nxt.start);
            if (
                BETWEEN_DASH.test(gap) &&
                SINGLE.test(cur.text) &&
                SINGLE.test(nxt.text)
            ) {
                cur = {
                    start: cur.start,
                    end: nxt.end,
                    text: text.slice(cur.start, nxt.end),
                };
                i++;
            } else break;
        }
        merged.push(cur);
    }

    const out: RawMatch[] = [];
    for (const mm of merged) {
        const ordinals = expandOrdinals(mm.text);
        if (ordinals.length === 0) continue;
        out.push({
            start: mm.start,
            end: mm.end,
            rawText: mm.text,
            scheme: "numeric",
            ordinal: ordinals[0],
            ordinals,
        });
    }
    return out;
}
