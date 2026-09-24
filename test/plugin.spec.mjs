/**
 * The integration suite: a real cordis context, the real request-extension
 * registry, and the adapter's own call expression.
 *
 * Every arm here drives the registry the way the product does — a fresh
 * `ctx.get(...)` per request, then `.prepare` — so a passing arm is evidence that
 * the guard sits in the path the adapter actually takes.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  adapterPayload,
  callAdapter,
  logLines,
  logText,
  manifestSentence,
  okProvider,
  register,
  registry,
  request,
  throwingProvider,
  unresolvableSentence,
  world,
} from './harness.mjs'

/** A throwaway directory holding one manifest and nothing else. */
function manifestFixture(manifest) {
  const dir = mkdtempSync(join(tmpdir(), 'reg-guard-'))
  const path = join(dir, 'package.json')
  writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`)
  return { dir, path }
}

/** The manifest `initProfile()` writes: a name, and no version. */
function profileManifest() {
  return manifestFixture({ name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: {} } })
}

describe('isolation', () => {
  it('skips the throwing field and delivers every other field through the adapter call', async () => {
    const { path } = profileManifest()
    const accepted = []
    const { ctx, logged } = await world(undefined, {
      fields: [
        ['dsh_plugin_packages', throwingProvider(manifestSentence(path))],
        ['dsh_session_log', okProvider({ afterSeq: 7 }, accepted)],
      ],
    })

    const prepared = await callAdapter(ctx, request({ steps: 3 }))
    assert.deepEqual(Object.keys(prepared.fields), ['dsh_session_log'])
    assert.equal(Object.hasOwn(prepared.fields, 'dsh_plugin_packages'), false)
    assert.deepEqual(adapterPayload({ steps: 3, model: 'deepseek-chat' }, prepared), {
      steps: 3,
      model: 'deepseek-chat',
      dsh_session_log: { afterSeq: 7 },
    })

    await prepared.accept()
    assert.deepEqual(accepted, [{ steps: 3 }])

    const lines = logLines(logged, 'skipped field "dsh_plugin_packages"')
    assert.equal(lines.length, 1)
    assert.ok(lines[0].includes(manifestSentence(path)), 'the producer message is quoted verbatim')
    assert.ok(logText(logged).includes('mode isolate, guarding 2 registered field(s)'))
  })

  it('leaves a request whose fields all succeed exactly as it found it', async () => {
    const accepted = []
    const { ctx, logged } = await world(undefined, {
      fields: [['dsh_session_log', okProvider({ afterSeq: 1 }, accepted)]],
    })

    const prepared = await callAdapter(ctx)
    assert.deepEqual({ ...prepared.fields }, { dsh_session_log: { afterSeq: 1 } })
    await prepared.accept()
    assert.deepEqual(accepted, [{ steps: 1 }])
    assert.equal(logLines(logged, 'skipped field').length, 0)
    assert.equal(logLines(logged, 'Producer message').length, 0)
  })

  it('isolates a field whose provider has no prepare function at all', async () => {
    const { ctx, logged } = await world()
    register(ctx, 'dsh_plugin_packages', {})
    register(ctx, 'dsh_session_log', okProvider({ afterSeq: 2 }))

    const prepared = await callAdapter(ctx)
    assert.deepEqual(Object.keys(prepared.fields), ['dsh_session_log'])
    assert.equal(logLines(logged, 'skipped field "dsh_plugin_packages"').length, 1)
    assert.ok(logText(logged).includes('has no prepare function'))
  })

  it('isolates many throwing fields at once', async () => {
    const { path } = profileManifest()
    const { ctx } = await world()
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))
    register(ctx, 'dsh_session_log', throwingProvider(unresolvableSentence('@deepseek-ai/dsh-storage-json')))
    register(ctx, 'dsh_other', okProvider({ ok: true }))

    const prepared = await callAdapter(ctx)
    assert.deepEqual(Object.keys(prepared.fields), ['dsh_other'])
  })

  it('passes a cancelled request through instead of skipping it', async () => {
    const { path } = profileManifest()
    const { ctx, logged } = await world()
    const controller = new AbortController()
    register(ctx, 'dsh_plugin_packages', {
      prepare: async () => {
        // A cancel that lands while a field is being prepared is the case the guard
        // has to recognise: an already-aborted signal never reaches a provider at
        // all, because the registry throws before the fan-out. One microtask later
        // gives the registry's own abort race time to arm, which is what the
        // shipped sequence looks like.
        await Promise.resolve()
        controller.abort()
        throw new Error(manifestSentence(path))
      },
    })

    // The registry's own abort race owns the rejection shape; what matters here is
    // that the guard turned a cancel into neither a skip nor a successful request.
    await assert.rejects(() => callAdapter(ctx, { body: { steps: 1 }, signal: controller.signal }))
    assert.equal(logLines(logged, 'after the request was cancelled').length, 1)
    assert.equal(logLines(logged, 'skipped field').length, 0)
  })

  it('leaves the registry itself alone: only providers are wrapped', async () => {
    const provider = okProvider({ ok: 1 })
    const own = provider.prepare
    const { ctx } = await world(undefined, { fields: [['dsh_session_log', provider]] })

    const service = registry(ctx)
    assert.equal(Object.hasOwn(service, 'prepare'), false, 'the registry prepares through its prototype, untouched')
    assert.notEqual(provider.prepare, own, 'the provider is wrapped')
    assert.equal(service.providers.get('dsh_session_log'), provider, 'a writable provider keeps its identity')
  })
})

describe('late registration', () => {
  it('guards a field registered after the plugin was mounted', async () => {
    const { path } = profileManifest()
    const { ctx, logged } = await world(undefined, {
      fields: [['dsh_session_log', okProvider({ afterSeq: 1 })]],
    })
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))

    const prepared = await callAdapter(ctx)
    assert.deepEqual(Object.keys(prepared.fields), ['dsh_session_log'])
    assert.equal(logLines(logged, 'registered after mount').length, 1)
  })

  it('installs when the registry arrives after the plugin', async () => {
    const { path } = profileManifest()
    const { ctx, logged } = await world(undefined, { registryAfter: true })
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))
    register(ctx, 'dsh_session_log', okProvider({ afterSeq: 5 }))

    const prepared = await callAdapter(ctx)
    assert.deepEqual(Object.keys(prepared.fields), ['dsh_session_log'])
    assert.equal(logLines(logged, 'so no extension field is guarded').length, 1)
    assert.equal(logLines(logged, 'mode isolate, guarding 0 registered field(s)').length, 1)
    assert.equal(logLines(logged, 'registered after mount').length, 2)
  })

  it('says it is inert when no registry is ever mounted', async () => {
    const { ctx, logged } = await world(undefined, { registry: false })
    assert.equal(ctx.get('deepseekLlmApiExtensions'), undefined)
    assert.equal(logLines(logged, 'so no extension field is guarded').length, 1)
  })
})

describe('report mode and strictFields', () => {
  it('changes no request in report mode, and names the field and its cause', async () => {
    const { path } = profileManifest()
    const { ctx, logged } = await world({ mode: 'report' })
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))
    register(ctx, 'dsh_session_log', okProvider({ afterSeq: 1 }))

    await assert.rejects(() => callAdapter(ctx), { message: manifestSentence(path) })
    const lines = logLines(logged, 'is not skipped (mode is report)')
    assert.equal(lines.length, 1)
    assert.ok(lines[0].includes(manifestSentence(path)))
    assert.ok(logText(logged).includes(path), 'the recognized cause earns the actionable paragraph')
  })

  it('keeps fail-closed semantics for one named field and isolates the rest', async () => {
    const { path } = profileManifest()
    const { ctx, logged } = await world({ strictFields: ['dsh_plugin_packages'] })
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))
    register(ctx, 'dsh_other', throwingProvider(unresolvableSentence('@deepseek-ai/dsh-storage-json')))

    await assert.rejects(() => callAdapter(ctx), { message: manifestSentence(path) })
    assert.equal(logLines(logged, 'is in strictFields').length, 1)
    assert.equal(logLines(logged, 'skipped field "dsh_other"').length, 1)
  })
})

describe('the recognized causes', () => {
  it('names the manifest and the line to add while the repair half is off', async () => {
    const { path } = profileManifest()
    const { ctx, logged } = await world()
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))

    await callAdapter(ctx)
    const text = logText(logged)
    assert.ok(text.includes('"version": "0.0.0"'))
    assert.ok(text.includes('repairProfileManifest: true'))
    assert.equal(readFileSync(path, 'utf8').includes('version'), false, 'the manifest is untouched by default')
  })

  it('names the unresolvable package and where to look', async () => {
    const { ctx, logged } = await world()
    register(ctx, 'dsh_plugin_packages', throwingProvider(unresolvableSentence('@deepseek-ai/dsh-storage-json')))
    await callAdapter(ctx)

    const text = logText(logged)
    assert.ok(text.includes('"@deepseek-ai/dsh-storage-json" is an active Loader entry'))
    assert.ok(text.includes('<DSH_HOME>/profiles/node_modules'))
  })

  it('says nothing extra about a message it does not recognize', async () => {
    const { ctx, logged } = await world()
    register(ctx, 'dsh_plugin_packages', throwingProvider('some other producer: it went wrong'))
    await callAdapter(ctx)

    assert.equal(logLines(logged, 'skipped field "dsh_plugin_packages"').length, 1)
    assert.equal(logLines(logged, 'is a package manifest that declares a name').length, 0)
    assert.equal(logLines(logged, 'is an active Loader entry').length, 0)
  })
})

describe('the opt-in repair', () => {
  it('adds the version, then delivers the field in the same request', async () => {
    const { path } = profileManifest()
    const { ctx, logged } = await world({ repairProfileManifest: true })
    // A provider that reads the manifest, exactly as the collector does.
    register(ctx, 'dsh_plugin_packages', {
      prepare: () => {
        const manifest = JSON.parse(readFileSync(path, 'utf8'))
        if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
          throw new Error(manifestSentence(path))
        }
        return { value: { version: 1, packages: [{ name: manifest.name, version: manifest.version }] } }
      },
    })

    const prepared = await callAdapter(ctx)
    assert.deepEqual({ ...prepared.fields }, {
      dsh_plugin_packages: { version: 1, packages: [{ name: 'dsh-profile-web', version: '0.0.0' }] },
    })
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
      name: 'dsh-profile-web',
      version: '0.0.0',
      private: true,
      dependencies: {},
      dsh: { profile: {} },
    })
    assert.equal(logLines(logged, 'added "version": "0.0.0"').length, 1)
    assert.equal(logLines(logged, 'skipped field').length, 0, 'the field was delivered, not skipped')
  })

  it('keeps a hand-edited manifest hand-editable: indent and key order survive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reg-guard-'))
    const path = join(dir, 'package.json')
    writeFileSync(path, '{\n    "name": "dsh-profile-web",\n    "private": true\n}\n')
    const { ctx } = await world({ repairProfileManifest: true })
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))

    await callAdapter(ctx)
    assert.equal(
      readFileSync(path, 'utf8'),
      '{\n    "name": "dsh-profile-web",\n    "version": "0.0.0",\n    "private": true\n}\n',
    )
  })

  it('never overwrites a version that is already there', async () => {
    const { path } = manifestFixture({ name: 'dsh-profile-web', version: 3, private: true })
    const { ctx, logged } = await world({ repairProfileManifest: true })
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))

    await callAdapter(ctx)
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { name: 'dsh-profile-web', version: 3, private: true })
    assert.equal(logLines(logged, 'already declares a version (3); it is never overwritten').length, 1)
  })

  it('declines a manifest that declares no name', async () => {
    const { path } = manifestFixture({ private: true })
    const { ctx, logged } = await world({ repairProfileManifest: true })
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))

    await callAdapter(ctx)
    assert.equal(logLines(logged, 'declares no package name').length, 1)
  })

  it('declines a manifest that is not readable JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reg-guard-'))
    const path = join(dir, 'package.json')
    writeFileSync(path, '{ not json')
    const { ctx, logged } = await world({ repairProfileManifest: true })
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))

    await callAdapter(ctx)
    assert.equal(logLines(logged, 'is not a readable JSON object').length, 1)
  })

  it('repairs once, and reports a retry that failed again', async () => {
    const { path } = profileManifest()
    const { ctx, logged } = await world({ repairProfileManifest: true })
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))

    await callAdapter(ctx)
    await callAdapter(ctx)
    assert.equal(logLines(logged, 'added "version": "0.0.0"').length, 1)
    assert.equal(logLines(logged, 'failed again after the manifest repair').length, 1)
  })

  it('does not attempt the repair when it is off', async () => {
    const { path } = profileManifest()
    const { ctx, logged } = await world()
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))

    await callAdapter(ctx)
    assert.equal(logLines(logged, 'added "version"').length, 0)
  })
})

describe('the log', () => {
  it('reports one distinct cause once, however many requests fail', async () => {
    const { path } = profileManifest()
    const { ctx, logged } = await world()
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))

    for (let index = 0; index < 4; index += 1) await callAdapter(ctx)
    assert.equal(logLines(logged, 'skipped field "dsh_plugin_packages"').length, 1)
  })

  it('stops at the per-field budget and says so once', async () => {
    const { ctx, logged } = await world()
    let counter = 0
    register(ctx, 'dsh_plugin_packages', {
      prepare: () => { throw new Error(`cause ${String(counter += 1)}`) },
    })
    for (let index = 0; index < 8; index += 1) await callAdapter(ctx)

    assert.equal(logLines(logged, 'skipped field "dsh_plugin_packages"').length, 5)
    assert.equal(logLines(logged, 'has now failed 5 different ways').length, 1)
  })

  it('can be silenced without changing the request', async () => {
    const { path } = profileManifest()
    const { ctx, logged } = await world({ log: false })
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))
    register(ctx, 'dsh_session_log', okProvider({ afterSeq: 1 }))

    const prepared = await callAdapter(ctx)
    assert.deepEqual(Object.keys(prepared.fields), ['dsh_session_log'])
    assert.equal(logged.length, 0)
  })
})

describe('a broken guard', () => {
  it('keeps the producer message when the log sink itself throws', async () => {
    const { path } = profileManifest()
    const { ctx } = await world()
    register(ctx, 'dsh_plugin_packages', throwingProvider(manifestSentence(path)))
    ctx.logger.exporter({ levels: { default: 2 }, export: () => { throw new Error('sink is closed') } })

    // Fail closed with the producer's error, not the sink's: the guard is never
    // allowed to replace one failure with another.
    await assert.rejects(() => callAdapter(ctx), { message: manifestSentence(path) })
  })

  it('keeps the request alive when the throwing provider throws a non-Error', async () => {
    const { path } = profileManifest()
    const { ctx, logged } = await world()
    register(ctx, 'dsh_plugin_packages', { prepare: () => { throw manifestSentence(path) } })
    register(ctx, 'dsh_session_log', okProvider({ afterSeq: 1 }))

    const prepared = await callAdapter(ctx)
    assert.deepEqual(Object.keys(prepared.fields), ['dsh_session_log'])
    assert.equal(logLines(logged, 'skipped field "dsh_plugin_packages"').length, 1)
  })

  it('delegates for a frozen provider instead of mutating it', async () => {
    const { path } = profileManifest()
    const frozen = Object.freeze({ prepare: () => { throw new Error(manifestSentence(path)) } })
    const own = frozen.prepare
    const { ctx, logged } = await world(undefined, {
      fields: [['dsh_plugin_packages', frozen], ['dsh_session_log', okProvider({ afterSeq: 1 })]],
    })

    const prepared = await callAdapter(ctx)
    assert.deepEqual(Object.keys(prepared.fields), ['dsh_session_log'])
    assert.equal(frozen.prepare, own, 'the frozen object is untouched')
    assert.equal(logLines(logged, 'skipped field "dsh_plugin_packages"').length, 1)
    assert.equal(logLines(logged, 'could not be guarded').length, 0)
  })

  it('keeps the other fields guarded when one provider cannot be read at all', async () => {
    const poisoned = Object.defineProperty({}, 'prepare', {
      get() { throw new Error('that property is unreadable') },
    })
    const { ctx, logged } = await world(undefined, {
      fields: [['dsh_plugin_packages', poisoned], ['dsh_session_log', okProvider({ afterSeq: 1 })]],
    })

    // The field is not abandoned: it is guarded by a stand-in that turns the
    // unreadable property into a named, isolated failure. Abandoning it would not
    // help — the registry reads `provider.prepare` in its own fan-out, so the
    // getter would take the whole request down before any guard could step in.
    assert.equal(logLines(logged, 'cannot be prepared directly').length, 1)
    assert.ok(logText(logged).includes('that property is unreadable'))
    assert.ok(logText(logged).includes('guarding 2 registered field(s)'))

    const prepared = await callAdapter(ctx)
    assert.deepEqual(Object.keys(prepared.fields), ['dsh_session_log'])
    assert.equal(logLines(logged, 'skipped field "dsh_plugin_packages"').length, 1)
    assert.ok(logText(logged).includes('the prepare of the provider for field "dsh_plugin_packages" cannot be read'))
  })
})

describe('request facts', () => {
  it('passes the session id, the purpose and the signal through untouched', async () => {
    const { ctx } = await world()
    const seen = []
    register(ctx, 'dsh_session_log', {
      prepare: (received) => {
        seen.push(received)
        return { value: { ok: true } }
      },
    })

    await callAdapter(ctx, { body: { steps: 1 }, signal: new AbortController().signal, sessionId: 's-1', purpose: 'compaction' })
    assert.equal(seen.length, 1)
    assert.deepEqual(seen[0].body, { steps: 1 })
    assert.equal(seen[0].sessionId, 's-1')
    assert.equal(seen[0].purpose, 'compaction')
    assert.equal(seen[0].signal.aborted, false)
    assert.equal(typeof seen[0].signal.throwIfAborted, 'function')
  })
})
