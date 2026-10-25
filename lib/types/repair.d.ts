/**
 * The opt-in repair: give the manifest that broke the walk the one field it is
 * missing.
 *
 * `initProfile()` writes `{ name, private, dependencies, dsh }` — a profile
 * manifest with a `name` and no `version` — and the inventory collector walks
 * every module entry up to its nearest manifest, so any relative-path module in
 * that profile lands on it and fails the whole request. The collector's own
 * precondition is what this repair satisfies: it throws on a *named* manifest
 * that declares no usable `version`, and it caches nothing on the failure path,
 * so the provider succeeds when it is retried after the write.
 *
 * The edit is **additive**: the action is planned only when `version` is absent
 * entirely, and an existing value is never overwritten whatever it is (a
 * `version` of the wrong type is reported, not "fixed" — a guard that rewrites a
 * value the user wrote is a worse neighbour than the failure it removes).
 *
 * @module @argszero/cordis-plugin-request-extension-guard
 */
/** The version written into a manifest that declares none. */
export declare const REPAIR_VERSION = "0.0.0";
/** A planned, additive manifest edit. */
export interface RepairAction {
    /** The manifest to edit. */
    readonly manifestPath: string;
    /** The `version` text to add. */
    readonly version: string;
}
/** What planning decided. */
export type RepairPlan = {
    readonly kind: 'repair';
    readonly action: RepairAction;
} | {
    readonly kind: 'none';
    readonly reason: string;
};
/** What applying did. */
export type RepairOutcome = {
    readonly kind: 'repaired';
    readonly action: RepairAction;
} | {
    readonly kind: 'failed';
    readonly reason: string;
};
/**
 * Decide whether one manifest may have a `version` added.
 * @param manifestPath - the absolute manifest path the producer named.
 * @returns the action, or the reason this manifest is left alone.
 */
export declare function planManifestRepair(manifestPath: string): RepairPlan;
/**
 * Add the version, in place, keeping the file's own indentation.
 *
 * The write goes through a sibling temporary file and a rename, so a reader that
 * opens the manifest mid-edit sees either the old or the new contents.
 * @param action - the planned edit.
 * @returns what happened; never throws.
 */
export declare function applyManifestRepair(action: RepairAction): RepairOutcome;
