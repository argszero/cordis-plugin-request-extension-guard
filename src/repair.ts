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

import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The version written into a manifest that declares none. */
export const REPAIR_VERSION = '0.0.0'

/** A planned, additive manifest edit. */
export interface RepairAction {
  /** The manifest to edit. */
  readonly manifestPath: string
  /** The `version` text to add. */
  readonly version: string
}

/** What planning decided. */
export type RepairPlan =
  | { readonly kind: 'repair'; readonly action: RepairAction }
  | { readonly kind: 'none'; readonly reason: string }

/** What applying did. */
export type RepairOutcome =
  | { readonly kind: 'repaired'; readonly action: RepairAction }
  | { readonly kind: 'failed'; readonly reason: string }

/** Read the file, or undefined when it cannot be read or parsed as an object. */
function readManifest(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * Decide whether one manifest may have a `version` added.
 * @param manifestPath - the absolute manifest path the producer named.
 * @returns the action, or the reason this manifest is left alone.
 */
export function planManifestRepair(manifestPath: string): RepairPlan {
  const manifest = readManifest(manifestPath)
  if (manifest === undefined) return { kind: 'none', reason: `${manifestPath} is not a readable JSON object` }
  const { name, version } = manifest
  if (typeof name !== 'string' || name.length === 0) {
    return { kind: 'none', reason: `${manifestPath} declares no package name, so a version would not satisfy the collector` }
  }
  if (version !== undefined) {
    return { kind: 'none', reason: `${manifestPath} already declares a version (${JSON.stringify(version)}); it is never overwritten` }
  }
  return { kind: 'repair', action: { manifestPath, version: REPAIR_VERSION } }
}

/**
 * Add the version, in place, keeping the file's own indentation.
 *
 * The write goes through a sibling temporary file and a rename, so a reader that
 * opens the manifest mid-edit sees either the old or the new contents.
 * @param action - the planned edit.
 * @returns what happened; never throws.
 */
export function applyManifestRepair(action: RepairAction): RepairOutcome {
  const { manifestPath, version } = action
  try {
    const text = readFileSync(manifestPath, 'utf8')
    const manifest = JSON.parse(text) as Record<string, unknown>
    // `version` sits directly after `name` when there is one: the edit then reads
    // as one added line in a diff, not a reordered manifest.
    const ordered: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(manifest)) {
      ordered[key] = value
      if (key === 'name') ordered.version = version
    }
    if (!Object.hasOwn(ordered, 'version')) ordered.version = version
    const temporary = join(dirname(manifestPath), `.dsh-version-${process.pid}-${Date.now()}.tmp`)
    try {
      writeFileSync(temporary, `${JSON.stringify(ordered, undefined, indentationOf(text))}\n`)
      renameSync(temporary, manifestPath)
    } catch (error: unknown) {
      try {
        unlinkSync(temporary)
      } catch {
        // The temporary file was never created, or is already gone: the failure
        // below is the one worth reporting.
      }
      throw error
    }
    return { kind: 'repaired', action }
  } catch (error: unknown) {
    return { kind: 'failed', reason: `${manifestPath}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * The indentation the manifest is already written with.
 *
 * A profile manifest is generated as two-space JSON, but a user who edited one by
 * hand keeps their own style; reusing it keeps the repair's diff to the line it
 * adds.
 * @param text - the manifest's current contents.
 * @returns the indentation string to serialize with.
 */
function indentationOf(text: string): string {
  return /^([ \t]+)"/m.exec(text)?.[1] ?? '  '
}
