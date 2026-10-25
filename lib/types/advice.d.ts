/**
 * Every sentence this plugin prints, built from plain data.
 *
 * Keeping the text out of the control flow is what lets the suites assert the
 * exact words a user will read, and what keeps one place responsible for the
 * promise the log makes: the producer's message is quoted **verbatim** and is
 * never paraphrased, because it is the only part of the failure the guard did not
 * author.
 *
 * @module @argszero/cordis-plugin-request-extension-guard
 */
import type { RepairAction } from './repair.js';
import type { RecognizedCause } from './signature.js';
import type { Mode } from './types.js';
/** The prefix every line carries, so the log can be filtered to this plugin. */
export declare const TAG = "request-extension-guard";
/** How many fields the guard took over, and under which policy. */
export declare function mountLine(count: number, mode: Mode, repairEnabled: boolean): string;
/** Every field that registers later is guarded too, through the registry's own map. */
export declare function lateFieldLine(field: string): string;
/** The registry is not in this process, so there is nothing to guard. */
export declare function inertLine(): string;
/** The registry was found but does not look like the one this plugin guards. */
export declare function unrecognizedLine(): string;
/** One skipped field, with the producer's own words. */
export declare function skipLine(field: string, message: string): string;
/** The closing line for a field that has used up its report budget. */
export declare function capLine(field: string, limit: number): string;
/** A provider that cannot be prepared directly, and is therefore guarded by a stand-in. */
export declare function standInLine(field: string, reason: string): string;
/** A field that failed, was repaired, and is therefore not skipped after all. */
export declare function deliveredLine(field: string): string;
/** A field that failed but keeps fail-closed semantics: named, not skipped. */
export declare function reportLine(field: string, message: string, reason: string): string;
/** The request was cancelled: cancellation must not be turned into a skip. */
export declare function abortedLine(field: string): string;
/** The guard's own bookkeeping broke: fail closed, with the original error. */
export declare function internalLine(field: string, detail: string): string;
/** What the repair did, or why it did not. */
export declare function repairedLine(action: RepairAction): string;
/** A repair that was planned but could not be written. */
export declare function repairFailedLine(reason: string): string;
/** A manifest the planner declined to touch. */
export declare function repairDeclinedLine(reason: string): string;
/** The field was retried after the repair, and failed again. */
export declare function retryFailedLine(field: string, message: string): string;
/**
 * The extra paragraph a recognized cause earns, when the guard has one to give.
 * @param cause - what the producer's message was recognized as, if anything.
 * @param repairEnabled - whether the repair half is mounted, which changes what the
 *   paragraph tells the user to do.
 * @returns the paragraph's lines; empty for a cause this module does not know.
 */
export declare function adviceLines(cause: RecognizedCause | undefined, repairEnabled: boolean): string[];
