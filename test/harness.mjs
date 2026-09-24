/**
 * The integration harness the behavior suites mount the plugin on: a REAL cordis
 * context, the REAL `@deepseek-ai/dsh-deepseek-llm-api-extensions` registry, and
 * the adapter's own call expression.
 *
 * What this shape proves that a unit arm cannot: the guard really reaches the
 * providers inside the shipped registry, the adapter's per-request
 * `ctx.get('deepseekLlmApiExtensions')` lookup sees the guarded providers, and the
 * request that reaches the wire still carries the base body plus every surviving
 * field.
 *
 * What it cannot prove, and does not claim: that the harness's own adapter builds
 * this payload. `adapterPayload()` reproduces the two lines that do
 * (`request-extensions.ts`: `JSON.stringify({ ...body, ...extensions.fields })`),
 * and the failure messages are taken from the reports.
 */

import { Context } from '@deepseek-ai/cordis'
import Registry from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import * as plugin from '../lib/index.js'

/** The producer sentence for a manifest that declares a name and no version. */
export function manifestSentence(path) {
  return `plugin-package-inventory-deepseek: ${path} must declare non-empty name and version`
}

/** The producer sentence for a package the collector cannot resolve. */
export function unresolvableSentence(packageName) {
  return `plugin-package-inventory-deepseek: cannot resolve active package ${JSON.stringify(packageName)}`
}

/** A fresh abort signal per call, as the registry expects. */
export function signal() {
  return new AbortController().signal
}

/** The request facts one provider receives. */
export function request(body = { steps: 1 }, extra = {}) {
  return { body, signal: signal(), ...extra }
}

/** A provider that contributes `value`, and records its `accept` calls. */
export function okProvider(value, accepted = []) {
  return {
    prepare: (received) => ({
      value,
      accept: () => {
        accepted.push(received.body)
      },
    }),
  }
}

/** A provider whose `prepare` always throws `message`. */
export function throwingProvider(message) {
  return {
    prepare: () => {
      throw new Error(message)
    },
  }
}

/** A provider that yields `undefined` (no value for this request). */
export function absentProvider() {
  return { prepare: () => undefined }
}

/**
 * Mount the real registry and this plugin.
 * @param config - plugin config to forward; omitted → defaults.
 * @param options - `fields` registers entries **before** the plugin mounts, which is
 *   the shipped order (in-tree contributors register while the base bundle loads,
 *   a profile-level insert mounts later); `registry: false` mounts no registry (its
 *   own arm); `registryAfter: true` mounts it after the plugin (the late-service
 *   arm).
 * @returns the context and the captured log messages.
 */
export async function world(config, options = {}) {
  const ctx = new Context()
  const logged = []
  // `levels.default` is the highest level an exporter admits (2 = WARN), so the
  // mount summary and the boot lines are captured too.
  ctx.logger.exporter({ levels: { default: 2 }, export: message => { logged.push(message) } })
  if (options.registry !== false && options.registryAfter !== true) {
    await ctx.plugin(Registry)
    for (const [field, provider] of options.fields ?? []) register(ctx, field, provider)
  }
  await ctx.plugin({ name: plugin.name, apply: (c) => { plugin.apply(c, config ?? {}) } })
  if (options.registryAfter === true) await ctx.plugin(Registry)
  return { ctx, logged }
}

/** The registry service, as the tests reach it. */
export function registry(ctx) {
  return ctx.deepseekLlmApiExtensions
}

/** Register one field on the mounted registry. */
export function register(ctx, field, provider) {
  return registry(ctx).register(field, provider)
}

/**
 * The adapter's own expression, verbatim
 * (`llm-deepseek/src/index.ts`, `prepareExtensions`): a fresh `get` per request,
 * then `.prepare` off whatever came back.
 */
export function callAdapter(ctx, req = request()) {
  const extensions = ctx.get('deepseekLlmApiExtensions')
  return extensions?.prepare(req) ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
}

/** The payload `request-extensions.ts` builds: base body first, fields over it. */
export function adapterPayload(body, prepared) {
  return JSON.parse(JSON.stringify({ ...body, ...prepared.fields }))
}

/** The captured log as one string. */
export function logText(logged) {
  return logged.map(message => message.args.map(value => String(value)).join(' ')).join('\n')
}

/** The captured log lines that mention one phrase. */
export function logLines(logged, needle) {
  return logText(logged).split('\n').filter(line => line.includes(needle))
}
