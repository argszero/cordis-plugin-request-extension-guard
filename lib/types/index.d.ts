/**
 * `request-extension-guard`: one extension field's failure must not take the turn
 * with it.
 *
 * ## The defect
 *
 * The official DeepSeek adapter prepares every registered top-level extension
 * field under a single fan-out (`DeepSeekLlmApiExtensionRegistry.prepare` in
 * `@deepseek-ai/dsh-deepseek-llm-api-extensions`):
 *
 * ```ts
 * const prepared = await Promise.all(entries.map(async ([field, provider]) => ({
 *   field, result: await provider.prepare(request),
 * })))
 * ```
 *
 * One provider that throws therefore fails **every** other field, and the adapter
 * wraps the result as a terminal turn error (`llm-deepseek/src/request-extensions.ts`):
 *
 * ```ts
 * throw new LlmError('DeepSeek request extension preparation failed', 'REQUEST_EXTENSION', { cause: error })
 * ```
 *
 * Two consequences follow, and both are visible in the field:
 *
 * 1. **The turn dies.** The official route is unusable in that composition — every
 *    message, every turn — while a pi-ai-backed route in the same profile keeps
 *    working, because only the official adapter consumes this registry.
 * 2. **Nobody is told why.** `LlmError` carries the cause and no surface renders
 *    it: the terminal shows the wrapper sentence, the session records the wrapper
 *    sentence, the Web UI shows the wrapper sentence, and the producer's own words
 *    — the path, the package name — are thrown away.
 *
 * The field's history is eight reports of the same shape from different causes: a
 * source-mode pnpm layout the collector cannot resolve packages through, a stale
 * symlink under the shared fallback directory, a clean build, an absolute
 * file-path module, a relative-directory module, and — since 0.1.7 — the manifest
 * `initProfile()` writes, which declares a `name` and no `version`. That last one
 * is why a **brand-new profile with one relative-path plugin breaks the official
 * route on first use** (#7678).
 *
 * ## What it does
 *
 * It wraps each registered provider's `prepare` — the object the registry stores,
 * not the registry's own method — and turns the fan-out into a per-field decision:
 *
 * 1. **Skip the field, keep the request.** A provider that throws is left out of
 *    this request, and every other field is delivered normally. A request missing
 *    one field is strictly more useful than no request at all, and the field that
 *    was left out is named.
 * 2. **Name the cause, in the producer's words.** The message is logged verbatim,
 *    once per distinct `(field, message)` pair, and a cause this module recognizes
 *    earns the paragraph that makes it actionable: the exact manifest to edit and
 *    the one line to add, or the directory to look at for an unresolvable package.
 * 3. **Repair the one cause that can be repaired from here** (`repairProfileManifest`,
 *    default off). A profile manifest that declares a name and no version gets a
 *    `version`, and the field is retried inside the same request, so the field comes
 *    back rather than merely surviving. Additive only: an existing `version` is
 *    never overwritten.
 *
 * ## Where it acts, and why there
 *
 * Two facts make this a plugin's seam, and both were measured against the shipped
 * registry (cordis 4.0.4):
 *
 * - `ctx.get('deepseekLlmApiExtensions')` returns a **fresh wrapper per call**, but
 *   one object stands behind it: `.providers` is the registry's own `Map`, and
 *   writing to it — or to a provider it holds — is visible to the adapter, which
 *   reads `ctx.get('deepseekLlmApiExtensions')` and then `.prepare` **on every
 *   request** and caches neither.
 * - Providers are stored as plain objects in that map, so guarding one is a
 *   property assignment. The registry itself is never replaced, and `register()` is
 *   left alone — it refuses a duplicate field, which is why this plugin contributes
 *   no field of its own.
 *
 * Late registrations are covered without polling: `register()` writes through the
 * map's own `set`, so patching that function guards a field registered after this
 * plugin was mounted.
 *
 * ## What it deliberately does not do
 *
 * - **It does not reorder or rebuild the fan-out.** The registry's `prepare`, its
 *   cloning, its freezing and its joint acceptance transaction all stay in place;
 *   only which providers reach them changes.
 * - **It does not touch cancellation.** A request whose signal was already aborted
 *   passes its failure through untouched — turning a cancel into a skip would make
 *   a stopped request look like a successful one.
 * - **It never fails the turn to save it.** If the guard's own bookkeeping breaks,
 *   the producer's error is rethrown unchanged: fail closed, exactly as before.
 * - **It does not claim a field is harmless to lose.** Skipping means the field is
 *   genuinely absent from that request; `strictFields` names the fields for which
 *   that trade is unacceptable, and `mode: 'report'` turns the whole guard into a
 *   diagnostic that changes no request at all.
 * - **The real fix is upstream**: tolerate one entry inside the collector, and write
 *   a `version` into the manifest `initProfile()` generates. This plugin is the
 *   stopgap that keeps the route usable until then.
 *
 * ## Where the diagnosis goes
 *
 * The host log — a limitation worth stating plainly, because it is not a choice
 * between channels: the harness has none for a request that never became a tool
 * call. `agent/request-error` can only return `{ kind: 'retry' }` or delegate,
 * `additionalContexts` needs a tool call in flight, and `Session.append` admits only
 * producer-owned kinds. So the guard logs where `dsh` logs, which is exactly where
 * the cause is missing today.
 *
 * @module @argszero/cordis-plugin-request-extension-guard
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './types.js';
export type { Config, ErasedProvider, ErasedRegistry, Mode } from './types.js';
export type { Ledger, Sighting } from './state.js';
export type { RepairAction, RepairOutcome, RepairPlan } from './repair.js';
export type { RecognizedCause } from './signature.js';
export { classifyCause, errorMessage, INVENTORY_PRODUCER } from './signature.js';
export { applyManifestRepair, planManifestRepair, REPAIR_VERSION } from './repair.js';
export { createLedger, DEFAULT_REPORT_LIMIT } from './state.js';
export { TAG } from './advice.js';
/** The plugin name the composition mounts. */
export declare const name = "request-extension-guard";
/** The service the official adapter reads this registry from. */
export declare const REGISTRY_SERVICE = "deepseekLlmApiExtensions";
/**
 * Install the guard.
 * @param ctx - the plugin's context.
 * @param config - resolved options.
 */
export declare function apply(ctx: Context, config?: Config): void;
