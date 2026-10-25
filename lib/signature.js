/**
 * Recognize the known producers behind a swallowed `REQUEST_EXTENSION` failure.
 *
 * The guard logs every throwing field's producer message verbatim, whatever
 * produced it. Recognition exists only to add the *actionable* half — the file to
 * edit, or the directory to look at — and it is deliberately narrow: a sentence
 * this module does not recognize loses nothing but the extra paragraph.
 *
 * Both recognized sentences come from the package inventory collector
 * (`@deepseek-ai/dsh-plugin-package-inventory-deepseek`), whose two throw sites
 * are the ones every report in this family has landed on
 * (#5172/#5173/#5196/#5439/#5683/#5844/#6064/#7678).
 *
 * @module @argszero/cordis-plugin-request-extension-guard
 */
import { basename, isAbsolute } from 'node:path';
/** The producer whose two sentences this module knows. */
export const INVENTORY_PRODUCER = 'plugin-package-inventory-deepseek';
/** `<producer>: <rest>` — the shape both of the producer's throw sites share. */
const PRODUCER_PREFIX = `${INVENTORY_PRODUCER}: `;
/** The manifest sentence: `<path> must declare non-empty name and version`. */
const MANIFEST_SENTENCE = /^(?<path>.+) must declare non-empty name and version$/;
/** The resolution sentence: `cannot resolve active package "<name>"`. */
const RESOLUTION_SENTENCE = /^cannot resolve active package (?<quoted>".*")$/;
/** The message of any thrown value. */
export function errorMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/**
 * Read the producer's words and decide whether the guard knows the cause.
 *
 * The manifest sentence is accepted only when it names an absolute `package.json`:
 * the producer walks up from a module to the nearest manifest, so anything else is
 * a message that merely looks alike, and the repair half must never open a path it
 * cannot account for.
 * @param message - the throwing field's message, verbatim.
 * @returns the recognized cause, or undefined when this module knows nothing more.
 */
export function classifyCause(message) {
    if (!message.startsWith(PRODUCER_PREFIX))
        return undefined;
    const rest = message.slice(PRODUCER_PREFIX.length);
    const manifest = MANIFEST_SENTENCE.exec(rest);
    if (manifest !== null) {
        const path = manifest.groups?.path ?? '';
        if (!isAbsolute(path) || basename(path) !== 'package.json')
            return undefined;
        return { kind: 'manifest-version', manifestPath: path };
    }
    const resolution = RESOLUTION_SENTENCE.exec(rest);
    if (resolution !== null) {
        const quoted = resolution.groups?.quoted ?? '""';
        let packageName;
        try {
            packageName = JSON.parse(quoted);
        }
        catch {
            return undefined;
        }
        if (typeof packageName !== 'string' || packageName.length === 0)
            return undefined;
        return { kind: 'unresolvable-package', packageName };
    }
    return undefined;
}
