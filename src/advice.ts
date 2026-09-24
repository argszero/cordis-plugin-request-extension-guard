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

import { REPAIR_VERSION } from './repair.js'
import type { RepairAction } from './repair.js'
import type { RecognizedCause } from './signature.js'
import type { Mode } from './types.js'

/** The prefix every line carries, so the log can be filtered to this plugin. */
export const TAG = 'request-extension-guard'

/** How many fields the guard took over, and under which policy. */
export function mountLine(count: number, mode: Mode, repairEnabled: boolean): string {
  const policy = mode === 'isolate'
    ? 'a field whose prepare throws is skipped for that request and named below'
    : 'a field whose prepare throws is named below and the request fails exactly as before'
  return `${TAG}: mode ${mode}, guarding ${String(count)} registered field(s) of deepseekLlmApiExtensions — ${policy}`
    + `; repairProfileManifest ${repairEnabled ? 'on' : 'off'}`
}

/** Every field that registers later is guarded too, through the registry's own map. */
export function lateFieldLine(field: string): string {
  return `${TAG}: field "${field}" registered after mount; it is guarded from this request on`
}

/** The registry is not in this process, so there is nothing to guard. */
export function inertLine(): string {
  return `${TAG}: no deepseekLlmApiExtensions service in this process, so no extension field is guarded; `
    + 'mount this plugin after @deepseek-ai/dsh-deepseek-llm-api-extensions (the base bundle does)'
}

/** The registry was found but does not look like the one this plugin guards. */
export function unrecognizedLine(): string {
  return `${TAG}: the deepseekLlmApiExtensions service holds no provider map, so nothing is guarded; `
    + 'this plugin expects the @deepseek-ai/dsh-deepseek-llm-api-extensions registry'
}

/** One skipped field, with the producer's own words. */
export function skipLine(field: string, message: string): string {
  return `${TAG}: skipped field "${field}" for this request — the request still carries every other field. `
    + `Producer message, verbatim: ${message}`
}

/** The closing line for a field that has used up its report budget. */
export function capLine(field: string, limit: number): string {
  return `${TAG}: field "${field}" has now failed ${String(limit)} different ways; further causes are not logged`
}

/** A provider that cannot be prepared directly, and is therefore guarded by a stand-in. */
export function standInLine(field: string, reason: string): string {
  return `${TAG}: the provider for field "${field}" cannot be prepared directly (${reason}); a stand-in is guarding `
    + 'that field instead, so it fails alone rather than taking every other field with it'
}

/** A field that failed, was repaired, and is therefore not skipped after all. */
export function deliveredLine(field: string): string {
  return `${TAG}: field "${field}" failed, the manifest was repaired, and the field is delivered on this request — nothing was dropped`
}

/** A field that failed but keeps fail-closed semantics: named, not skipped. */
export function reportLine(field: string, message: string, reason: string): string {
  return `${TAG}: field "${field}" failed and is not skipped (${reason}); the request fails as it did before. `
    + `Producer message, verbatim: ${message}`
}

/** The request was cancelled: cancellation must not be turned into a skip. */
export function abortedLine(field: string): string {
  return `${TAG}: field "${field}" failed after the request was cancelled; the failure is passed through unchanged`
}

/** The guard's own bookkeeping broke: fail closed, with the original error. */
export function internalLine(field: string, detail: string): string {
  return `${TAG}: internal error while guarding "${field}", the producer's failure is passed through unchanged: ${detail}`
}

/** What the repair did, or why it did not. */
export function repairedLine(action: RepairAction): string {
  return `${TAG}: added "version": ${JSON.stringify(action.version)} to ${action.manifestPath} — `
    + 'the collector accepts a version-less manifest only when it is anonymous, and this one has a name'
}

/** A repair that was planned but could not be written. */
export function repairFailedLine(reason: string): string {
  return `${TAG}: could not repair the manifest (${reason}); the field stays skipped for this request`
}

/** A manifest the planner declined to touch. */
export function repairDeclinedLine(reason: string): string {
  return `${TAG}: manifest left alone — ${reason}`
}

/** The field was retried after the repair, and failed again. */
export function retryFailedLine(field: string, message: string): string {
  return `${TAG}: field "${field}" failed again after the manifest repair; skipped for this request. `
    + `Producer message, verbatim: ${message}`
}

/**
 * The extra paragraph a recognized cause earns, when the guard has one to give.
 * @param cause - what the producer's message was recognized as, if anything.
 * @param repairEnabled - whether the repair half is mounted, which changes what the
 *   paragraph tells the user to do.
 * @returns the paragraph's lines; empty for a cause this module does not know.
 */
export function adviceLines(cause: RecognizedCause | undefined, repairEnabled: boolean): string[] {
  if (cause === undefined) return []
  if (cause.kind === 'manifest-version') {
    return [
      `${TAG}: ${cause.manifestPath} is a package manifest that declares a name and no version. `
        + 'The collector walks every module entry up to its nearest manifest, so any relative-path module in that '
        + 'directory reaches this one and fails the whole request — this is the shape initProfile() writes.',
      `${TAG}: to restore the field yourself, add one line to that file and restart: `
        + `"version": "${REPAIR_VERSION}"`,
      repairEnabled
        ? `${TAG}: repairProfileManifest is on, so the guard adds that line itself and retries the field in the same request; `
          + 'an existing version is never overwritten.'
        : `${TAG}: or mount this plugin with \`repairProfileManifest: true\` and the guard adds that line itself, then retries the field `
          + 'in the same request.',
      `${TAG}: \`config: { enabled: false }\` on the plugin-package-inventory-deepseek entry stands the whole field down instead; `
        + 'the durable fix is in the harness (per-entry tolerance in the collector, and a version in the generated manifest).',
    ]
  }
  return [
    `${TAG}: "${cause.packageName}" is an active Loader entry the collector cannot resolve a manifest for. `
      + 'The usual cause is a link under <DSH_HOME>/profiles/node_modules that points at a directory an in-place '
      + 'upgrade removed, or a package the profile no longer has installed.',
    `${TAG}: reinstalling it in the profile, or removing the dangling link, restores the field; `
      + '`config: { enabled: false }` on the plugin-package-inventory-deepseek entry stands the field down meanwhile.',
  ]
}
