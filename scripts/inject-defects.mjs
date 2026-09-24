/**
 * Defect injection: mutate the source, rebuild, run the suite, and require that
 * the mutation is caught. An arm whose mutation leaves the suite green is
 * SILENT — it proves nothing, and this file says so out loud rather than letting
 * a green run stand in for a proof.
 *
 * The suite imports `lib/*.js`, not `src/*.ts`, so every arm rebuilds with tsc
 * first; a mutation that fails to type-check proves nothing either and is
 * reported separately (`UNBUILDABLE`). That rebuild is why this script is not
 * optional housekeeping: a stale `lib/` makes every arm look SILENT, and a
 * reporter who reads a stale SILENT line draws the opposite conclusion about the
 * suite. The source is restored and rebuilt in a `finally`, whatever happened.
 *
 * The mutations are this plugin's own claims, negated one at a time:
 *
 * - a throwing field is skipped and the request keeps every other field;
 * - the producer's message is quoted verbatim, not trimmed;
 * - a field registered after this plugin mounts is guarded too;
 * - a repaired field is *delivered*, and is never announced as skipped;
 * - a cancelled request is passed through, never turned into a skip;
 * - `report` mode and `strictFields` both keep failing the request closed;
 * - a provider whose `prepare` cannot be read becomes a named, isolated failure
 *   rather than a silent one;
 * - the per-field report budget is a budget;
 * - a broken log sink is not swallowed on the request path (the guard's licence
 *   for changing a request is naming what it dropped);
 * - a provider that cannot be written onto is delegated for, not left raw.
 *
 * Run from the plugin root: `npm run test:inject`.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const MUTATIONS = [
  {
    name: 'a throwing field is no longer skipped',
    file: 'src/index.ts',
    arms: 'plugin.spec.mjs',
    edits: [["  report(policy, field, message, cause, false)\n  return undefined", "  report(policy, field, message, cause, false)\n  throw error"]],
  },
  {
    name: 'the producer message is trimmed instead of quoted verbatim',
    file: 'src/advice.ts',
    arms: 'plugin.spec.mjs',
    edits: [[
      "  return `${TAG}: skipped field \"${field}\" for this request — the request still carries every other field. `\n    + `Producer message, verbatim: ${message}`",
      "  return `${TAG}: skipped field \"${field}\" for this request — the request still carries every other field. `\n    + `Producer message, verbatim: ${message.slice(0, 24)}`",
    ]],
  },
  {
    name: 'a field registered after mount is guarded no longer',
    file: 'src/index.ts',
    arms: 'plugin.spec.mjs',
    edits: [[
      "    // A field registered earlier is re-stored with the object the guard already\n    // chose for it: `register()` is the only writer, and a registration that\n    // replaced the guarded provider with the raw one would silently drop the guard.\n    const stored = already ?? guardProvider(policy, field, provider)",
      "    const stored = provider",
    ]],
  },
  {
    name: 'a repaired field is announced as skipped after all',
    file: 'src/index.ts',
    arms: 'plugin.spec.mjs',
    edits: [['      policy.warn(deliveredLine(field))', '      policy.warn(skipLine(field, message))']],
  },
  {
    name: 'a cancelled request is turned into a skip',
    file: 'src/index.ts',
    arms: 'plugin.spec.mjs',
    edits: [['  if (isAborted(request)) {\n    policy.warn(abortedLine(field))\n    throw error\n  }', '  if (isAborted(request) && false) {\n    policy.warn(abortedLine(field))\n    throw error\n  }']],
  },
  {
    name: 'report mode changes the request after all',
    file: 'src/index.ts',
    arms: 'plugin.spec.mjs',
    edits: [["  if (policy.mode === 'report' || policy.strict.has(field)) {", "  if (policy.strict.has(field)) {"]],
  },
  {
    name: 'a strict field stops failing closed',
    file: 'src/index.ts',
    arms: 'plugin.spec.mjs',
    edits: [["  if (policy.mode === 'report' || policy.strict.has(field)) {", "  if (policy.mode === 'report') {"]],
  },
  {
    name: 'an unreadable prepare becomes a silent no-op instead of a named failure',
    file: 'src/index.ts',
    arms: 'plugin.spec.mjs',
    edits: [[
      "      prepare: () => {\n        throw new TypeError(`${TAG}: the prepare of the provider for field ${JSON.stringify(field)} cannot be read (${detail})`)\n      },",
      "      prepare: () => undefined,",
    ]],
  },
  {
    name: 'the per-field report budget is not a budget',
    file: 'src/state.ts',
    arms: 'plugin.spec.mjs',
    edits: [['if (messages.size >= perFieldLimit) {', 'if (messages.size >= perFieldLimit * 100) {']],
  },
  {
    name: 'a broken log sink is swallowed on the request path',
    file: 'src/index.ts',
    arms: 'plugin.spec.mjs',
    edits: [['      if (log) ctx.logger.warn(line)', '      try { if (log) ctx.logger.warn(line) } catch { /* swallowed */ }']],
  },
  {
    name: 'a provider that cannot be written onto is left raw',
    file: 'src/index.ts',
    arms: 'plugin.spec.mjs',
    edits: [['    if (stored !== provider) originalSet.call(map, field, stored)', '    if (false) originalSet.call(map, field, stored)']],
  },
]

let silent = 0
let unbuildable = 0
for (const mutation of MUTATIONS) {
  const path = join(ROOT, mutation.file)
  const original = readFileSync(path, 'utf8')
  let mutated = original
  let anchored = true
  for (const [find, replace] of mutation.edits) {
    if (!original.includes(find)) {
      anchored = false
      console.log(`SKIP (anchor missing): ${mutation.name}`)
    }
    mutated = mutated.replace(find, replace)
  }
  if (!anchored) continue

  const build = () => {
    try {
      execFileSync('npx', ['tsc'], { cwd: ROOT, stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  writeFileSync(path, mutated)
  let built = false
  let failed = false
  let output = ''
  try {
    built = build()
    if (built) {
      try {
        execFileSync('node', ['--test', `test/${mutation.arms}`], { cwd: ROOT, stdio: 'pipe' })
      } catch (error) {
        failed = true
        output = String(error.stdout ?? '') + String(error.stderr ?? '')
      }
    }
  } finally {
    // The source is restored and rebuilt whatever happened: an injector that can
    // leave a mutation in the tree is worse than no injector.
    writeFileSync(path, original)
    build()
  }

  if (!built) {
    unbuildable += 1
    console.log(`UNBUILDABLE (proves nothing): ${mutation.name}`)
    continue
  }
  const caught = failed && new RegExp('fail [1-9]').test(output)
  if (!caught && mutation.equivalent === undefined) silent += 1
  const label = caught ? 'CAUGHT' : mutation.equivalent === undefined ? 'SILENT' : 'EQUIVALENT'
  console.log(`${label}: ${mutation.name} (${mutation.arms})${caught || mutation.equivalent === undefined ? '' : ` — ${mutation.equivalent}`}`)
}
console.log(`SILENT ARMS: ${silent === 0 ? 'none' : String(silent)}; UNBUILDABLE: ${String(unbuildable)}`)
