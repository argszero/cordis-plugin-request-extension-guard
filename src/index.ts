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

import type { Context } from '@deepseek-ai/cordis'
import {
  TAG,
  abortedLine,
  adviceLines,
  capLine,
  deliveredLine,
  inertLine,
  internalLine,
  lateFieldLine,
  mountLine,
  repairedLine,
  repairDeclinedLine,
  repairFailedLine,
  reportLine,
  retryFailedLine,
  skipLine,
  standInLine,
  unrecognizedLine,
} from './advice.js'
import { applyManifestRepair, planManifestRepair } from './repair.js'
import { classifyCause, errorMessage } from './signature.js'
import type { RecognizedCause } from './signature.js'
import { DEFAULT_REPORT_LIMIT, createLedger } from './state.js'
import type { Ledger, Sighting } from './state.js'
import type { Config, ErasedProvider, ErasedRegistry, Mode } from './types.js'

export type { Config, ErasedProvider, ErasedRegistry, Mode } from './types.js'
export type { Ledger, Sighting } from './state.js'
export type { RepairAction, RepairOutcome, RepairPlan } from './repair.js'
export type { RecognizedCause } from './signature.js'

export { classifyCause, errorMessage, INVENTORY_PRODUCER } from './signature.js'
export { applyManifestRepair, planManifestRepair, REPAIR_VERSION } from './repair.js'
export { createLedger, DEFAULT_REPORT_LIMIT } from './state.js'
export { TAG } from './advice.js'

/** The plugin name the composition mounts. */
export const name = 'request-extension-guard'

/** The service the official adapter reads this registry from. */
export const REGISTRY_SERVICE = 'deepseekLlmApiExtensions'

/** The request facts one provider receives; only the signal is read here. */
interface GuardedRequest {
  readonly signal?: { readonly aborted?: boolean } | undefined
}

/** What one apply call decided, shared by every wrapper it installs. */
interface GuardPolicy {
  readonly mode: Mode
  readonly strict: ReadonlySet<string>
  readonly repair: boolean
  readonly ledger: Ledger
  /**
   * Write one line. **May throw** when the sink is broken, which is deliberate:
   * the install path decides for itself (a broken sink must not leave the guard
   * unmounted), and the request path treats it as "cannot explain, so do not
   * intervene" (`tryLog` documents the second half).
   */
  warn(line: string): void
}

/**
 * Lazy `get` lookup for a service key the installed `Context` interface does not
 * declare — this plugin depends on no package that declares it, and the value is
 * never read through a property access, which is the failure mode that shape is
 * known to cause.
 * @param ctx - the plugin's context.
 * @returns the registry, or undefined when it is absent or malformed.
 */
function lookupRegistry(ctx: Context): ErasedRegistry | undefined {
  const lookup = ctx as unknown as { get(service: string, strict?: boolean): unknown }
  const found = lookup.get(REGISTRY_SERVICE)
  if (found === null || typeof found !== 'object') return undefined
  return found as ErasedRegistry
}

/**
 * Write one line at **install** time, best-effort.
 *
 * The two halves of this plugin's log have opposite failure modes, and the
 * difference is not an accident:
 *
 * - At install time a broken sink must not stop the guard being mounted. The
 *   mount is what keeps the route usable; the sentence describing it is not.
 * - On the request path a broken sink must **not** be swallowed (`decide` calls
 *   `policy.warn` directly). The guard's whole licence for changing a request is
 *   that it names what it dropped; if it cannot name it, the only honest thing
 *   left is the stock behavior — the producer's error — so the wrapper rethrows it
 *   instead of quietly shipping a request with a field missing and no explanation.
 * @param policy - the apply call's decisions.
 * @param line - the line to write.
 */
function tryLog(policy: GuardPolicy, line: string): void {
  try {
    policy.warn(line)
  } catch {
    // Nothing left to say, and nothing at all left to do differently.
  }
}

/** The `prepare` to call for one field, and the reason it is a stand-in when it is. */
interface PreparedCall {
  readonly prepare: ErasedProvider['prepare']
  readonly trouble?: string
}

/** What one attempted repair did to the request. */
type Recovery =
  | { readonly delivered: true; readonly value: unknown }
  | { readonly delivered: false }

/** The field stays skipped for this request. */
const SKIPPED: Recovery = { delivered: false }

/** Whether the containing request was already cancelled when the field failed. */
function isAborted(request: unknown): boolean {
  if (request === null || typeof request !== 'object') return false
  return (request as GuardedRequest).signal?.aborted === true
}

/**
 * The `prepare` to call, and — when it is not the provider's own — why.
 *
 * A provider that declares no `prepare` function, or whose `prepare` cannot even
 * be read, would fail the whole fan-out anonymously: the registry never says which
 * field it was. Substituting a named thrower turns both into an ordinary, named,
 * skippable field failure, which is the only shape this plugin can act on. Leaving
 * such a field *unguarded* is not an option — the registry reads `provider.prepare`
 * in its own fan-out, so the unreadable property would take the request down before
 * any guard could look at it.
 * @param provider - the provider object the registry stores.
 * @param field - the field it owns, for the message.
 * @returns the callable to use, and the reason it is a stand-in when it is one.
 */
function readPrepare(provider: ErasedProvider, field: string): PreparedCall {
  let candidate: unknown
  try {
    candidate = provider.prepare
  } catch (error: unknown) {
    const detail = errorMessage(error)
    return {
      prepare: () => {
        throw new TypeError(`${TAG}: the prepare of the provider for field ${JSON.stringify(field)} cannot be read (${detail})`)
      },
      trouble: detail,
    }
  }
  if (typeof candidate === 'function') return { prepare: candidate as ErasedProvider['prepare'] }
  return {
    prepare: () => {
      throw new TypeError(`${TAG}: the provider registered for field ${JSON.stringify(field)} has no prepare function`)
    },
    trouble: 'it declares no prepare function',
  }
}

/**
 * Guard one provider.
 *
 * The call shape is preserved: the registry invokes `provider.prepare(request)`, so
 * the original is called with the provider as its explicit receiver.
 *
 * The wrapper is written **onto** the provider when the property is writable, and
 * handed back as a delegate when it is not (a frozen object, a getter-only
 * property): the guard must never be the reason a third party's object cannot be
 * used, and it must still cover a provider it cannot edit.
 * @param policy - the apply call's decisions.
 * @param field - the field this provider owns, for the log.
 * @param provider - the provider object the registry stores.
 * @returns the object to store for this field: the provider itself when the wrapper
 *   could be written onto it, a delegate when it could not.
 */
function guardProvider(policy: GuardPolicy, field: string, provider: ErasedProvider): ErasedProvider {
  const call = readPrepare(provider, field)
  // Said once, at install time: a provider nobody can prepare is a defect in the
  // composition, and the operator is the only one who can fix it.
  if (call.trouble !== undefined) tryLog(policy, standInLine(field, call.trouble))
  const original = call.prepare
  const guardedPrepare = async function guarded(this: unknown, request: unknown): Promise<unknown> {
    try {
      return await original.call(provider, request)
    } catch (error: unknown) {
      try {
        return await decide(policy, field, provider, original, request, error)
      } catch (internal: unknown) {
        // The guard's own failure must not become a second, worse failure: the
        // producer's error is what the caller was going to see anyway. Reached
        // both by a broken log sink and by a defect in this module's own
        // bookkeeping — in both cases the request fails exactly as it did before
        // this plugin was mounted.
        tryLog(policy, internalLine(field, errorMessage(internal)))
        throw error
      }
    }
  }
  try {
    provider.prepare = guardedPrepare
    return provider
  } catch {
    // A frozen object, or a property with no setter: delegate instead of mutating.
    return { prepare: guardedPrepare }
  }
}

/**
 * Decide what one thrown field does to the request.
 * @param policy - the apply call's decisions.
 * @param field - the field whose `prepare` threw.
 * @param provider - the provider object, for the retry.
 * @param original - the provider's own `prepare`.
 * @param request - the request the field was preparing for.
 * @param error - what the provider threw.
 * @returns the field's value (`undefined` when it was skipped), or a retried value.
 * @throws the producer's own error whenever the policy says the request must fail.
 */
async function decide(
  policy: GuardPolicy,
  field: string,
  provider: ErasedProvider,
  original: ErasedProvider['prepare'],
  request: unknown,
  error: unknown,
): Promise<unknown> {
  if (isAborted(request)) {
    policy.warn(abortedLine(field))
    throw error
  }
  const message = errorMessage(error)
  const cause = classifyCause(message)
  // Report mode never changes a request, and a strict field has to keep failing
  // closed — both are decided before anything else is attempted.
  if (policy.mode === 'report' || policy.strict.has(field)) {
    report(policy, field, message, cause, true)
    throw error
  }
  // The one cause that can be repaired from here is attempted *before* the field
  // is written off, so a field that was saved is never announced as skipped: the
  // log says what actually happened to the request, and the request kept the field.
  if (cause?.kind === 'manifest-version' && policy.repair && policy.ledger.claimRepair(cause.manifestPath)) {
    const recovery = await recover(policy, field, provider, original, request, cause)
    if (recovery.delivered) {
      policy.warn(deliveredLine(field))
      for (const line of adviceLines(cause, policy.repair)) policy.warn(line)
      return recovery.value
    }
  }
  report(policy, field, message, cause, false)
  return undefined
}

/**
 * Log one field failure, subject to the per-field report budget.
 * @param policy - the apply call's decisions.
 * @param field - the field that failed.
 * @param message - the producer's message, verbatim.
 * @param cause - the recognition of that message, if any.
 * @param strict - whether this field keeps fail-closed semantics.
 */
function report(
  policy: GuardPolicy,
  field: string,
  message: string,
  cause: RecognizedCause | undefined,
  strict: boolean,
): void {
  const sighting: Sighting = policy.ledger.sight(field, message)
  if (sighting === 'repeat') return
  if (sighting === 'cap-reached') {
    policy.warn(capLine(field, DEFAULT_REPORT_LIMIT))
    return
  }
  policy.warn(strict
    ? reportLine(
      field,
      message,
      policy.mode === 'report' ? 'mode is report' : `${JSON.stringify(field)} is in strictFields`,
    )
    : skipLine(field, message))
  for (const line of adviceLines(cause, policy.repair)) policy.warn(line)
}

/**
 * Repair the manifest the producer named, then retry the field in the same request.
 * @param policy - the apply call's decisions.
 * @param field - the field whose failure named the manifest.
 * @param provider - the provider object, for the retry.
 * @param original - the provider's own `prepare`.
 * @param request - the current request.
 * @param cause - the recognized manifest cause.
 * @returns the retried value, or `SKIPPED` when the field stays skipped — an
 *   explicit marker, because a provider may legitimately contribute `undefined`.
 */
async function recover(
  policy: GuardPolicy,
  field: string,
  provider: ErasedProvider,
  original: ErasedProvider['prepare'],
  request: unknown,
  cause: Extract<RecognizedCause, { kind: 'manifest-version' }>,
): Promise<Recovery> {
  const plan = planManifestRepair(cause.manifestPath)
  if (plan.kind !== 'repair') {
    policy.warn(repairDeclinedLine(plan.reason))
    return SKIPPED
  }
  const outcome = applyManifestRepair(plan.action)
  if (outcome.kind !== 'repaired') {
    policy.warn(repairFailedLine(outcome.reason))
    return SKIPPED
  }
  policy.warn(repairedLine(outcome.action))
  try {
    return { delivered: true, value: await original.call(provider, request) }
  } catch (error: unknown) {
    if (isAborted(request)) {
      policy.warn(abortedLine(field))
      throw error
    }
    policy.warn(retryFailedLine(field, errorMessage(error)))
    return SKIPPED
  }
}

/**
 * Install the guard on every provider the registry currently holds, and on every
 * one it accepts later.
 * @param policy - the apply call's decisions.
 * @param registry - the registry service.
 * @param guarded - the providers this apply call already wrapped, and the object to
 *   store for each. A provider object is guarded once, so the second install (the
 *   late-service path) cannot nest wrappers.
 * @returns the number of fields guarded, or undefined when the registry is not the
 *   shape this plugin guards.
 */
function install(
  policy: GuardPolicy,
  registry: ErasedRegistry,
  guarded: WeakMap<object, ErasedProvider>,
): number | undefined {
  const map = registry.providers
  if (!(map instanceof Map)) return undefined
  const existing = [...map.entries()]
  const originalSet = map.set
  map.set = function guardedSet(
    this: Map<string, ErasedProvider>,
    field: string,
    provider: ErasedProvider,
  ): Map<string, ErasedProvider> {
    if (typeof provider !== 'object' || provider === null) return originalSet.call(this, field, provider)
    const already = guarded.get(provider)
    // A field registered earlier is re-stored with the object the guard already
    // chose for it: `register()` is the only writer, and a registration that
    // replaced the guarded provider with the raw one would silently drop the guard.
    const stored = already ?? guardProvider(policy, field, provider)
    if (already === undefined) {
      guarded.set(provider, stored)
      tryLog(policy, lateFieldLine(field))
    }
    return originalSet.call(this, field, stored)
  }
  let count = 0
  for (const [field, provider] of existing) {
    if (typeof provider !== 'object' || provider === null) continue
    const already = guarded.get(provider)
    const stored = already ?? guardProvider(policy, field, provider)
    if (already === undefined) guarded.set(provider, stored)
    if (stored !== provider) originalSet.call(map, field, stored)
    count += 1
  }
  return count
}

/**
 * Install the guard.
 * @param ctx - the plugin's context.
 * @param config - resolved options.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const log = config.log !== false
  const policy: GuardPolicy = {
    mode: config.mode ?? 'isolate',
    strict: new Set(config.strictFields ?? []),
    repair: config.repairProfileManifest === true,
    ledger: createLedger(),
    warn(line: string) {
      // Deliberately bare: a sink that throws must reach `decide`'s caller, which
      // turns it into "the guard cannot explain this, so it does not intervene"
      // (see `tryLog`). Only the install path swallows it.
      if (log) ctx.logger.warn(line)
    },
  }
  const guarded = new WeakMap<object, ErasedProvider>()
  let installed = false
  let explained = false

  /** Try to install; explain a miss once, and never throw out of `apply`. */
  const attempt = (): void => {
    if (installed) return
    try {
      const registry = lookupRegistry(ctx)
      if (registry === undefined) {
        if (!explained) {
          explained = true
          tryLog(policy, inertLine())
        }
        return
      }
      const count = install(policy, registry, guarded)
      if (count === undefined) {
        if (!explained) {
          explained = true
          tryLog(policy, unrecognizedLine())
        }
        return
      }
      installed = true
      tryLog(policy, mountLine(count, policy.mode, policy.repair))
    } catch (error: unknown) {
      if (!explained) {
        explained = true
        tryLog(policy, `${TAG}: could not install the guard: ${errorMessage(error)}`)
      }
    }
  }

  attempt()
  if (installed) return
  // The registry may be mounted after this plugin. A service event is the signal
  // cordis offers for that; a composition mounting in the shipped order never
  // needs it. The listener is dropped as soon as it has done its job.
  let disposeListener: (() => void) | undefined
  disposeListener = ctx.on('internal/service', (serviceName: string) => {
    if (installed || serviceName !== REGISTRY_SERVICE) return
    attempt()
    if (installed) disposeListener?.()
  })
}
