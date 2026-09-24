/**
 * Structural shapes this plugin reads, and the configuration it accepts.
 *
 * The request-extension registry lives in `@deepseek-ai/dsh-deepseek-llm-api-extensions`.
 * This plugin deliberately does **not** import it: the guard works one layer below
 * anything that package's types describe, it calls none of its methods (it wraps
 * the provider objects the registry stores), and a package named only in a type
 * position still has to be carried as a runtime peer, because the emitted `.d.ts`
 * would reference it. Reading the one field it needs structurally keeps the
 * declared dependency set equal to the import closure — `@deepseek-ai/cordis`, and
 * nothing else — and lets the guard mount in a composition that pins a different
 * build of the registry.
 *
 * @module @argszero/cordis-plugin-request-extension-guard
 */

/** One registered extension provider, as the registry stores it. */
export interface ErasedProvider {
  /**
   * Prepare this provider's field for one request.
   * @param request - the registry's request facts.
   * @returns the prepared field, or `undefined` when this request has no value.
   */
  prepare(request: unknown): unknown
}

/** The registry service, as this plugin sees it. */
export interface ErasedRegistry {
  /**
   * The field-name to provider map `register()` writes into, and the only part of
   * the registry this plugin reads. Its own `prepare` is left untouched.
   */
  providers?: Map<string, ErasedProvider> | undefined
}

/** How a field whose `prepare` throws is treated. */
export type Mode = 'isolate' | 'report'

/** Configures the guard. */
export interface Config {
  /**
   * `isolate` (default) skips a field whose `prepare` throws, so the request still
   * carries every other field. `report` changes nothing about the request: it only
   * names the throwing field and its cause in the host log, which no other surface
   * does today.
   */
  mode?: Mode
  /**
   * Field names that keep fail-closed semantics even under `mode: 'isolate'`. An
   * empty list (the default) isolates every field: a request missing one field is
   * strictly more useful than no request at all, and the log names what was left
   * out.
   */
  strictFields?: string[]
  /**
   * Add an absent `version` to the profile manifest that caused a recognized
   * failure, then retry that field once inside the same request. Off by default: it
   * writes into the harness's own home tree, and the log alone usually hands the
   * user the one line they need. Additive only — a manifest that already declares a
   * `version` is never rewritten, whatever its value.
   */
  repairProfileManifest?: boolean
  /**
   * Log the guard's findings. On by default; the host log is the only channel a
   * request-scoped advisory has (see the module doc of `index.ts`).
   */
  log?: boolean
}
