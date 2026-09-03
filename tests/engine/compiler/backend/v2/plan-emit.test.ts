import { describe, expect, test } from 'bun:test'

import {
  BACKEND_ARTIFACT_MANIFEST_PATH_V2,
  backendProviderPlanDigestV2,
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  emitBackendProviderPlanV2,
  type BackendProviderAdapterV2,
  type BackendProviderBundleV2,
  type BackendProviderPlanV2
} from '@open-pencil/compiler'

import {
  createFakeBackendProviderBundleV2,
  fakeBackendApplicationV2,
  fakeSelectionV2
} from './helpers'

describe('Compiler Backend Provider V2 plan and emit', () => {
  test('normalizes V2 before callbacks and binds actual capabilities into deterministic output', () => {
    const contexts: unknown[] = []
    const base = createFakeBackendProviderBundleV2()
    if (!base.migrations) throw new Error('Fake V2 migration adapter is required')
    const migrationAdapter = base.migrations
    const bundle: BackendProviderBundleV2 = {
      ...base,
      validate(context) {
        contexts.push(context)
        return []
      },
      migrations: {
        ...migrationAdapter,
        validate(context) {
          contexts.push(context)
          return []
        },
        plan(context) {
          contexts.push(context)
          return migrationAdapter.plan(context)
        },
        emit(context, plan) {
          contexts.push(context)
          return migrationAdapter.emit(context, plan)
        }
      }
    }
    const registry = createBackendProviderRegistryV2([bundle])
    const selection = fakeSelectionV2(bundle)
    const source = fakeBackendApplicationV2()
    const first = createBackendProviderPlanV2(registry, {
      selection,
      application: source,
      target: 'react',
      mode: 'production'
    })
    const second = createBackendProviderPlanV2(registry, {
      selection,
      application: structuredClone(source),
      target: 'react',
      mode: 'production'
    })
    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.plan.actualCapabilities).toEqual(['migrations.schema'])
    expect(first.plan.capabilities.map((entry) => entry.capability)).toEqual(['migrations.schema'])
    expect(first.plan.authority).toMatchObject({
      contractVersion: 2,
      packageDigest: selection.packageDigest,
      capabilities: ['migrations.schema']
    })
    expect(Object.isFrozen(first.plan)).toBe(true)
    expect(Object.isFrozen(first.plan.application)).toBe(true)
    for (const value of contexts) {
      expect(value).toMatchObject({
        actualCapabilities: ['migrations.schema'],
        selection: { packageDigest: selection.packageDigest },
        application: { version: 2 }
      })
      expect(Object.isFrozen(value)).toBe(true)
    }

    const firstEmission = emitBackendProviderPlanV2(registry, {
      plan: first.plan,
      selection
    })
    const secondEmission = emitBackendProviderPlanV2(registry, {
      plan: second.plan,
      selection
    })
    expect(firstEmission).toEqual(secondEmission)
    expect(firstEmission.ok).toBe(true)
    if (!firstEmission.ok) return
    expect(firstEmission.emission.manifest).toMatchObject({
      format: 'openpencil.backend-artifacts.v2',
      version: 2,
      actualCapabilities: ['migrations.schema'],
      authority: { packageDigest: selection.packageDigest }
    })
    expect([...firstEmission.emission.files.keys()]).toEqual([
      'backend/v2/schema.sql',
      BACKEND_ARTIFACT_MANIFEST_PATH_V2
    ])
    expect(firstEmission.emission.manifest.artifacts.map((entry) => entry.path)).toEqual([
      'backend/v2/schema.sql'
    ])
    expect(Object.isFrozen(firstEmission.emission.files)).toBe(true)
    expect(Reflect.get(firstEmission.emission.files, 'set')).toBeUndefined()
  })

  test('does not activate adapters for merely declared but unused capabilities', () => {
    let unusedPlanCalls = 0
    const application = fakeBackendApplicationV2()
    application.capabilities.push({ capability: 'data.read', required: false })
    const base = createFakeBackendProviderBundleV2()
    if (!base.migrations) throw new Error('Fake V2 migration adapter is required')
    const unusedAdapter: BackendProviderAdapterV2 = {
      capabilities: ['data.read'],
      outputs: [],
      plan() {
        unusedPlanCalls += 1
        return {}
      },
      emit() {
        throw new Error('Unused adapter must not emit')
      }
    }
    const bundle: BackendProviderBundleV2 = {
      descriptor: {
        ...base.descriptor,
        capabilities: ['data.read', 'migrations.schema']
      },
      data: unusedAdapter,
      migrations: base.migrations
    }
    const registry = createBackendProviderRegistryV2([bundle])
    const planned = createBackendProviderPlanV2(registry, {
      selection: fakeSelectionV2(bundle),
      application,
      target: 'react',
      mode: 'production'
    })
    expect(planned).toMatchObject({
      ok: true,
      plan: {
        actualCapabilities: ['migrations.schema'],
        adapterPlans: { migrations: expect.anything() }
      }
    })
    if (!planned.ok) return
    expect(planned.plan.capabilities).toHaveLength(1)
    expect(planned.plan.adapterPlans.data).toBeUndefined()
    expect(unusedPlanCalls).toBe(0)
  })

  test('parses application V2 before any Provider callback', () => {
    const calls = { bundle: 0, adapter: 0, plan: 0, emit: 0 }
    const base = createFakeBackendProviderBundleV2()
    if (!base.migrations) throw new Error('Fake V2 migration adapter is required')
    const migrationAdapter = base.migrations
    const bundle: BackendProviderBundleV2 = {
      ...base,
      validate() {
        calls.bundle += 1
        return []
      },
      migrations: {
        ...migrationAdapter,
        validate() {
          calls.adapter += 1
          return []
        },
        plan(context) {
          calls.plan += 1
          return migrationAdapter.plan(context)
        },
        emit(context, plan) {
          calls.emit += 1
          return migrationAdapter.emit(context, plan)
        }
      }
    }
    const registry = createBackendProviderRegistryV2([bundle])
    const malformed = { ...fakeBackendApplicationV2(), version: 1 }
    expect(
      createBackendProviderPlanV2(registry, {
        selection: fakeSelectionV2(bundle),
        application: malformed,
        target: 'react',
        mode: 'production'
      })
    ).toMatchObject({ ok: false })
    expect(calls).toEqual({ bundle: 0, adapter: 0, plan: 0, emit: 0 })
  })

  test('rejects recomputed tampering of actual capabilities before Provider callbacks', () => {
    let planCalls = 0
    let emitCalls = 0
    const base = createFakeBackendProviderBundleV2()
    if (!base.migrations) throw new Error('Fake V2 migration adapter is required')
    const migrationAdapter = base.migrations
    const bundle: BackendProviderBundleV2 = {
      ...base,
      migrations: {
        ...migrationAdapter,
        plan(context) {
          planCalls += 1
          return migrationAdapter.plan(context)
        },
        emit(context, plan) {
          emitCalls += 1
          return migrationAdapter.emit(context, plan)
        }
      }
    }
    const registry = createBackendProviderRegistryV2([bundle])
    const selection = fakeSelectionV2(bundle)
    const planned = createBackendProviderPlanV2(registry, {
      selection,
      application: fakeBackendApplicationV2(),
      target: 'react',
      mode: 'production'
    })
    if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
    planCalls = 0
    const payload = { ...planned.plan, actualCapabilities: [] } as BackendProviderPlanV2
    const tampered = {
      ...payload,
      planDigest: backendProviderPlanDigestV2(payload)
    } as BackendProviderPlanV2
    expect(emitBackendProviderPlanV2(registry, { plan: tampered, selection })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-v2-actual-capabilities-mismatch' }]
    })
    expect(planCalls).toBe(0)
    expect(emitCalls).toBe(0)
  })

  test('rejects recomputed authority substitution before Provider callbacks', () => {
    let planCalls = 0
    let emitCalls = 0
    const base = createFakeBackendProviderBundleV2()
    if (!base.migrations) throw new Error('Fake V2 migration adapter is required')
    const migrationAdapter = base.migrations
    const bundle: BackendProviderBundleV2 = {
      ...base,
      migrations: {
        ...migrationAdapter,
        plan(context) {
          planCalls += 1
          return migrationAdapter.plan(context)
        },
        emit(context, plan) {
          emitCalls += 1
          return migrationAdapter.emit(context, plan)
        }
      }
    }
    const registry = createBackendProviderRegistryV2([bundle])
    const selection = fakeSelectionV2(bundle)
    const planned = createBackendProviderPlanV2(registry, {
      selection,
      application: fakeBackendApplicationV2(),
      target: 'react',
      mode: 'production'
    })
    if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
    planCalls = 0
    const payload = {
      ...planned.plan,
      authority: { ...planned.plan.authority, packageDigest: `sha256:${'B'.repeat(42)}E` }
    } as BackendProviderPlanV2
    const tampered = {
      ...payload,
      planDigest: backendProviderPlanDigestV2(payload)
    } as BackendProviderPlanV2
    expect(emitBackendProviderPlanV2(registry, { plan: tampered, selection })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-v2-plan-stale' }]
    })
    expect(planCalls).toBe(0)
    expect(emitCalls).toBe(0)
  })

  test('binds emission to current lifecycle package authority', () => {
    const bundle = createFakeBackendProviderBundleV2()
    const registry = createBackendProviderRegistryV2([bundle])
    const selection = fakeSelectionV2(bundle)
    const planned = createBackendProviderPlanV2(registry, {
      selection,
      application: fakeBackendApplicationV2(),
      target: 'react',
      mode: 'production'
    })
    if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
    expect(
      emitBackendProviderPlanV2(registry, {
        plan: planned.plan,
        selection: { ...selection, packageDigest: `sha256:${'B'.repeat(42)}E` }
      })
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-v2-plan-stale' }]
    })
    expect(
      emitBackendProviderPlanV2(registry, {
        plan: planned.plan,
        selection: { ...selection, enabled: false }
      })
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-v2-disabled' }]
    })
  })
})
