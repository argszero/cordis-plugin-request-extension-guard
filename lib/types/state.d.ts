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
/** What one observation did to the log. */
export type Sighting = 
/** First time this field failed this way: the caller logs it. */
'new'
/** This field has exhausted its report budget: the caller logs the closing line, once. */
 | 'cap-reached'
/** Already reported (or past the cap): the caller stays quiet. */
 | 'repeat';
/** The guard's per-process memory. */
export interface Ledger {
    /**
     * Record one field failure.
     * @param field - the field whose `prepare` threw.
     * @param message - the producer's message, verbatim.
     * @returns whether the caller should log, and which line.
     */
    sight(field: string, message: string): Sighting;
    /**
     * Claim the right to repair one manifest, once per process.
     * @param manifestPath - the manifest the producer named.
     * @returns true on the first claim.
     */
    claimRepair(manifestPath: string): boolean;
}
/** How many distinct causes one field may report before the closing line. */
export declare const DEFAULT_REPORT_LIMIT = 5;
/**
 * Create the ledger.
 * @param perFieldLimit - distinct messages reported per field before the closing line.
 * @returns a fresh ledger.
 */
export declare function createLedger(perFieldLimit?: number): Ledger;
