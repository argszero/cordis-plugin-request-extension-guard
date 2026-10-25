/**
 * Bookkeeping for a guard that runs on **every** request.
 *
 * A field that throws once throws on every request — the producer's failure is
 * deterministic and nothing about it is memoized on the failure path — so an
 * unguarded log would print the same paragraph a thousand times a day, and the
 * first line of a log nobody reads is worth no more than silence. Each distinct
 * `(field, message)` pair is therefore reported once per process, with a per-field
 * ceiling and one closing line when the ceiling is reached, so a field that fails
 * in a hundred different ways cannot flood the log either.
 *
 * The same ledger owns the two write-side claims: a manifest is repaired once per
 * process (the repair is planned off the file, not off the message), and the
 * retry that follows is bounded by that claim, not by a loop.
 *
 * @module @argszero/cordis-plugin-request-extension-guard
 */
/** How many distinct causes one field may report before the closing line. */
export const DEFAULT_REPORT_LIMIT = 5;
/**
 * Create the ledger.
 * @param perFieldLimit - distinct messages reported per field before the closing line.
 * @returns a fresh ledger.
 */
export function createLedger(perFieldLimit = DEFAULT_REPORT_LIMIT) {
    const seen = new Map();
    const capped = new Set();
    const repaired = new Set();
    return {
        sight(field, message) {
            const messages = seen.get(field) ?? new Set();
            seen.set(field, messages);
            if (messages.has(message))
                return 'repeat';
            if (messages.size >= perFieldLimit) {
                if (capped.has(field))
                    return 'repeat';
                capped.add(field);
                return 'cap-reached';
            }
            messages.add(message);
            return 'new';
        },
        claimRepair(manifestPath) {
            if (repaired.has(manifestPath))
                return false;
            repaired.add(manifestPath);
            return true;
        },
    };
}
