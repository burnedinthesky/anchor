/**
 * Typed error for the metadata layer.
 *
 * Thrown by the HTTP client when a request fails after its retry budget is
 * exhausted (network reject, persistent 429/503, other 5xx) and re-thrown by
 * the resolution chain when NO source produced a usable record AND at least one
 * source failed with a transport/HTTP error. The UI maps this to its "error"
 * state and must distinguish it from a clean "no match" (an empty PaperRecord,
 * which resolves successfully with completeness === "empty").
 */
export class MetadataLookupError extends Error {
    readonly status?: number;

    constructor(
        message: string,
        options?: { cause?: unknown; status?: number }
    ) {
        super(message);
        this.name = "MetadataLookupError";
        this.status = options?.status;
        if (options?.cause !== undefined) {
            // Preserve the underlying error without relying on the ES2022 cause arg
            // being surfaced by every runtime.
            (this as { cause?: unknown }).cause = options.cause;
        }
    }
}
