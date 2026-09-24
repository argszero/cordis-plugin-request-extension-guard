# @argszero/cordis-plugin-request-extension-guard

One DeepSeek request extension field failing must not kill the turn. This plugin
guards every registered field provider's `prepare`, skips the field that throws,
names it and its exact cause in the host log, and delivers every other field
normally — plus an opt-in repair for the one cause that can be repaired from a
plugin (a profile manifest that declares a name and no version).

## The defect it answers

The official DeepSeek adapter prepares every registered top-level request field
under **one** fan-out, in the registry that owns them
(`@deepseek-ai/dsh-deepseek-llm-api-extensions`):

```ts
const prepared = await Promise.all(entries.map(async ([field, provider]) => ({
  field, result: await provider.prepare(request),
})))
```

`Promise.all` rejects on the first failure, so one provider that throws fails
**every** other field, and the adapter turns the result into a terminal turn
error (`llm-deepseek/src/request-extensions.ts`):

```ts
throw new LlmError('DeepSeek request extension preparation failed',
                   'REQUEST_EXTENSION', { cause: error })
```

Two consequences, both reported in the field:

1. **The turn dies — every message, every turn**, for as long as the composition
   is unchanged, while a pi-ai-backed route in the same profile keeps working
   (only the official adapter consumes this registry).
2. **Nobody is told why.** The cause rides along as `cause`, and no surface
   renders it: the terminal, the session record and the Web UI all show the
   wrapper sentence. The producer's own words — the path, the package name — are
   the only part of the failure that would have been actionable, and they are the
   part that is thrown away.

The same shape has been reported eight times from eight different causes: a
source-mode pnpm layout the collector cannot resolve packages through (#5172,
#5173, #5196), a stale symlink under the shared fallback directory (#5439), a
clean build (#5683), an absolute file-path module (#5844), a relative-directory
module (#6064), and — the newest, and the reason this plugin exists — the
manifest `initProfile()` writes.

That last one is an **out-of-the-box first-run path** (#7678). Since 0.1.7
`initProfile()` writes a profile manifest that declares a `name` and no
`version`; the package-inventory collector walks every module entry up to its
nearest manifest, and `identityFromManifest` rejects a manifest that has a name
and no version. So a brand-new profile with a single relative-path plugin fails
the official route on its first real request — while the same profile on a pi-ai
route answers normally.

## What it does

It wraps each registered provider's `prepare` — the object the registry stores,
not the registry's own method, which is left exactly as it was:

1. **Skip the field, keep the request** (default). A provider that throws is left
   out of this request and every other field is delivered normally. A request
   missing one field is strictly more useful than no request at all, and the
   field that was left out is named.
2. **Name the cause, in the producer's words.** The message is logged verbatim,
   once per distinct `(field, message)` pair, with a per-field ceiling so a field
   that fails in a hundred ways cannot flood the log. A cause this module
   recognizes earns the paragraph that makes it actionable — the exact manifest
   to edit and the one line to add, or the directory to look at for an
   unresolvable package.
3. **Repair the one cause that can be repaired from here** (opt-in,
   `repairProfileManifest: true`). A profile manifest that declares a name and no
   version gets a `version`, and the field is retried **inside the same request**,
   so the field comes back rather than merely surviving. Additive only: an
   existing `version` is never overwritten, whatever its value, and nothing else
   in the file changes — key order and indentation survive, because the file is
   edited as text, not re-serialized.

Providers registered **after** this plugin mounts are covered too: `register()`
writes through the registry's own map, so patching that map's `set` guards a field
that arrives later, with no polling.

## Mounting

```yaml
# cordis.patch.yml of the profile, or the bundle's own patch
- insert:
    - id: request-extension-guard
      name: '@argszero/cordis-plugin-request-extension-guard'
```

Mount it **after** `@deepseek-ai/dsh-deepseek-llm-api-extensions` (the base
bundle already does). A composition that mounts it earlier is still covered: the
plugin tries again when the service appears, and says so once if it never does.

## Configuration

```yaml
- insert:
    - id: request-extension-guard
      name: '@argszero/cordis-plugin-request-extension-guard'
      config:
        mode: isolate                 # or: report
        strictFields: []              # field names that must keep failing closed
        repairProfileManifest: false  # additive `version` into the offending manifest
        log: true
```

- `mode: 'report'` changes **nothing** about a request: it only names the
  throwing field and its cause, and rethrows. For an operator who wants to see
  the condition before a plugin acts on it.
- `strictFields` keeps fail-closed semantics for the fields you name. The default
  is empty: every field is isolated.
- `repairProfileManifest` writes into the harness's own home tree
  (`$DSH_HOME/profiles/<profile>/package.json`), which is why it is off by
  default — the log alone usually hands the user the one line they need.
- `log: false` silences the guard without changing a single request.

## What it does not claim

- **A skipped field really is absent from that request.** Skipping is not
  free. If a field's payload is the thing the endpoint needs, the request the
  endpoint receives is a request without it. That is the trade: a request missing
  one field, and a log line naming it, instead of no request and a wrapper
  sentence. `strictFields` exists for fields where the trade is unacceptable, and
  `mode: 'report'` exists for operations that want no trade at all.
- **Cancellation is never turned into a skip.** A request whose signal was
  already cancelled passes its failure through untouched: making a cancelled
  request look like a successful one would be worse than either outcome.
- **The guard never fails a request to save it.** If its own bookkeeping breaks —
  or the log sink itself throws — the producer's error is passed through
  unchanged, and the request fails exactly as it did before this plugin was
  mounted. That is also why the guard does not swallow a broken sink on the
  request path: its licence for changing a request is that it *names* what it
  dropped, and a guard that cannot name it has no business changing it.
- **The durable fix is upstream.** Tolerate one entry inside the collector
  (warn and skip the entry, do not throw), and write a `version` into the
  manifest `initProfile()` generates. This plugin is the stopgap that keeps the
  official route usable until then, and the log says so in those words.
- **The diagnosis goes to the host log, because that is the only channel a
  request-scoped advisory has.** `agent/request-error` can only return
  `{ kind: 'retry' }` or delegate, `additionalContexts` needs a tool call in
  flight, and `Session.append` admits only producer-owned kinds. The host log is
  where `dsh` logs, and it is exactly where this cause is missing today.
- **The wrapper is installed once per provider object, so it must capture the
  registry through one `get()` at mount time** — `ctx.get(name)` returns a fresh
  bound wrapper per call, and a per-request method swap would be
  concurrency-unsafe across overlapping requests.

## It does not touch

- The registry's own `prepare`: its cloning, its freezing and its joint
  acceptance transaction all stay in place. Only which providers reach them
  changes.
- `register()`: untouched, and this plugin deliberately contributes no field of
  its own — `register()` refuses a duplicate field name, and taking a name would
  make this plugin a tenant of the registry it is guarding.
- Stored Session content: nothing is rewritten, and the guard appends no session
  event.
- Any other plugin's objects beyond the `prepare` property of the providers the
  registry stores — and when that property cannot be written (a frozen object, a
  getter-only property), the guard delegates instead of mutating, leaving the
  third party's object untouched.

## Compatibility

- `@deepseek-ai/cordis` `^4.0.2` (peer; the plugin is a plain cordis plugin).
- Guards `@deepseek-ai/dsh-deepseek-llm-api-extensions`'s providers. The plugin
  reads the registry **structurally** (an object with a `providers` `Map`) and
  imports nothing from it or from `@deepseek-ai/dsh-llm`, so it stays mounted
  against a composition that pins a different build of the registry. If the
  service is missing or is not that shape, the plugin is inert and says so once —
  it never throws out of `apply`.
- Runtime dependency closure: **empty**. The emitted `lib/*.js` imports only
  `node:fs`, `node:path` and its own modules.
- Node `^22.19 || >=24`.

## Verifying it

```sh
npm install   # dev only: cordis + the real registry + typescript
npm test      # builds, then 29 arms: real cordis context, real registry,
              # the adapter's own `ctx.get(...).prepare(request)` expression
npm run test:inject   # defect injection: mutate, rebuild, require the suite to catch
```

The suite drives the registry the way the product does — a fresh `ctx.get(...)`
per request, then `.prepare` — and asserts on the log lines a user will actually
read, including the producer's message verbatim. `test:inject` mutates this
plugin's own claims one at a time and reports any mutation the suite does **not**
catch, because a green suite is not evidence until something can make it red.

## License

MIT.
