import { describe, expect, test } from 'bun:test'

import {
  createBackendProviderPlan,
  createBackendProviderRegistry,
  DEFAULT_TARGET_CAPABILITY_MATRIX,
  negotiateBackendCapabilities
} from '@open-pencil/compiler'
import { BACKEND_CAPABILITIES } from '@open-pencil/lowcode/backend'

import { createFakeBackendProviderBundle, fakeBackendApplication, fakeSelection } from './helpers'

describe('Compiler Backend TargetCapabilityMatrix', () => {
  test('is total for every Compiler target and Backend capability', () => {
    for (const target of [
      'react',
      'vue',
      'expo',
      'flutter',
      'wechat-miniprogram',
      'taro',
      'uni-app',
      'mpx'
    ] as const) {
      expect(Object.keys(DEFAULT_TARGET_CAPABILITY_MATRIX[target]).sort()).toEqual(
        [...BACKEND_CAPABILITIES].sort()
      )
    }
    expect(DEFAULT_TARGET_CAPABILITY_MATRIX.react['data.read']).toBe('supported')
    expect(DEFAULT_TARGET_CAPABILITY_MATRIX.react['server.functions']).toBe(
      'requires-server-bridge'
    )
    for (const capability of [
      'data.read',
      'data.write',
      'auth.identity',
      'auth.roles',
      'server.functions',
      'server.http',
      'storage.objects',
      'realtime.subscribe',
      'transactions.atomic'
    ] as const) {
      expect(DEFAULT_TARGET_CAPABILITY_MATRIX.vue[capability]).toBe('source-only')
    }
    for (const capability of [
      'policy.row-level',
      'migrations.schema',
      'migrations.data'
    ] as const) {
      expect(DEFAULT_TARGET_CAPABILITY_MATRIX.vue[capability]).toBe('supported')
    }
    expect(DEFAULT_TARGET_CAPABILITY_MATRIX.expo['data.read']).toBe('source-only')
    expect(DEFAULT_TARGET_CAPABILITY_MATRIX.mpx['policy.row-level']).toBe('unsupported')
  })

  test('rejects an unrecognized mode at the public negotiation boundary', () => {
    const bundle = createFakeBackendProviderBundle({ capabilities: ['data.read'] })
    const result = negotiateBackendCapabilities({
      requirements: [{ capability: 'data.read', required: true }],
      bundle,
      target: 'react',
      mode: 'Production' as never
    })

    expect(result.decisions).toEqual([])
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'backend-compilation-mode-unsupported',
        path: '$.mode',
        severity: 'error'
      })
    ])
  })

  test('snapshots a public negotiation target exactly once', () => {
    const bundle = createFakeBackendProviderBundle({ capabilities: ['data.read'] })
    let targetReads = 0
    const result = negotiateBackendCapabilities({
      requirements: [{ capability: 'data.read', required: true }],
      bundle,
      mode: 'production',
      get target() {
        targetReads += 1
        return targetReads === 1 ? ('react' as const) : ('vue' as const)
      }
    })

    expect(result.diagnostics).toEqual([])
    expect(result.decisions).toEqual([
      expect.objectContaining({ targetStatus: 'supported', included: true })
    ])
    expect(targetReads).toBe(1)
  })

  test('fails Vue runtime capabilities in production but preserves explicit prototype omission', () => {
    const bundle = createFakeBackendProviderBundle({ capabilities: ['data.read'] })
    const registry = createBackendProviderRegistry([bundle])
    const production = createBackendProviderPlan(registry, {
      selection: fakeSelection(bundle),
      application: fakeBackendApplication(['data.read']),
      target: 'vue',
      mode: 'production'
    })
    expect(production).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-capability-source-only-mode-required',
          severity: 'error'
        })
      ])
    })

    const prototype = createBackendProviderPlan(registry, {
      selection: fakeSelection(bundle),
      application: fakeBackendApplication(['data.read']),
      target: 'vue',
      mode: 'source-only-prototype'
    })
    expect(prototype).toMatchObject({
      ok: true,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-capability-source-only-omitted',
          severity: 'warning'
        })
      ])
    })
    if (!prototype.ok) return
    expect(prototype.plan.capabilities).toEqual([
      expect.objectContaining({ targetStatus: 'source-only', included: false })
    ])
    expect(prototype.plan.adapterPlans).toEqual({})

    const react = createBackendProviderPlan(registry, {
      selection: fakeSelection(bundle),
      application: fakeBackendApplication(['data.read']),
      target: 'react',
      mode: 'production'
    })
    expect(react).toMatchObject({
      ok: true,
      plan: {
        capabilities: [expect.objectContaining({ targetStatus: 'supported', included: true })]
      }
    })
  })

  test('keeps Vue backend-only migrations while refusing a server runtime bridge', () => {
    const serverBundle = createFakeBackendProviderBundle({
      slot: 'server',
      capabilities: ['server.functions']
    })
    const serverResult = negotiateBackendCapabilities({
      requirements: [{ capability: 'server.functions', required: true }],
      bundle: serverBundle,
      target: 'vue',
      mode: 'production'
    })
    expect(serverResult.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'backend-capability-source-only-mode-required',
        severity: 'error'
      })
    )

    const migrationBundle = createFakeBackendProviderBundle({
      slot: 'migrations',
      capabilities: ['migrations.schema']
    })
    const migrationRegistry = createBackendProviderRegistry([migrationBundle])
    const migrationResult = createBackendProviderPlan(migrationRegistry, {
      selection: fakeSelection(migrationBundle),
      application: fakeBackendApplication(['migrations.schema']),
      target: 'vue',
      mode: 'production'
    })
    expect(migrationResult).toMatchObject({
      ok: true,
      plan: {
        capabilities: [expect.objectContaining({ targetStatus: 'supported', included: true })],
        adapterPlans: { migrations: expect.anything() }
      }
    })
  })

  test('permits source-only omission only in explicit prototype mode', () => {
    const bundle = createFakeBackendProviderBundle({ capabilities: ['data.read'] })
    const production = negotiateBackendCapabilities({
      requirements: [{ capability: 'data.read', required: true }],
      bundle,
      target: 'expo',
      mode: 'production'
    })
    expect(production.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'backend-capability-source-only-mode-required',
        severity: 'error'
      })
    )

    const prototype = negotiateBackendCapabilities({
      requirements: [{ capability: 'data.read', required: true }],
      bundle,
      target: 'expo',
      mode: 'source-only-prototype'
    })
    expect(prototype.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'backend-capability-source-only-omitted',
        severity: 'warning'
      })
    )
    expect(prototype.decisions).toEqual([
      expect.objectContaining({ targetStatus: 'source-only', included: false })
    ])
  })

  test('requires a real server adapter in production and rejects browser-preview simulation', () => {
    const withoutServer = createFakeBackendProviderBundle({
      capabilities: ['server.functions']
    })
    const production = negotiateBackendCapabilities({
      requirements: [{ capability: 'server.functions', required: true }],
      bundle: withoutServer,
      target: 'react',
      mode: 'production'
    })
    expect(production.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-capability-server-bridge-required' })
    )

    const withServer = createFakeBackendProviderBundle({
      slot: 'server',
      capabilities: ['server.functions']
    })
    const supported = negotiateBackendCapabilities({
      requirements: [{ capability: 'server.functions', required: true }],
      bundle: withServer,
      target: 'react',
      mode: 'production'
    })
    expect(supported.diagnostics).toEqual([])
    expect(supported.decisions).toEqual([
      expect.objectContaining({ resolution: 'supported', included: true })
    ])

    const preview = negotiateBackendCapabilities({
      requirements: [{ capability: 'server.functions', required: true }],
      bundle: withServer,
      target: 'react',
      mode: 'preview'
    })
    expect(preview.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-preview-server-capability-unavailable' })
    )
  })

  test('fails required provider/target gaps and only warns for optional omissions', () => {
    const bundle = createFakeBackendProviderBundle({ capabilities: ['data.read'] })
    const result = negotiateBackendCapabilities({
      requirements: [
        { capability: 'data.write', required: true },
        { capability: 'auth.roles', required: false }
      ],
      bundle,
      target: 'mpx',
      mode: 'production'
    })

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-provider-capability-required',
          severity: 'error'
        }),
        expect.objectContaining({
          code: 'backend-provider-capability-optional-omitted',
          severity: 'warning'
        })
      ])
    )
  })

  test('does not let a public caller override required Mpx production policy', () => {
    const bundle = createFakeBackendProviderBundle({ capabilities: ['policy.row-level'] })
    const registry = createBackendProviderRegistry([bundle])
    const forgedMatrix = {
      ...DEFAULT_TARGET_CAPABILITY_MATRIX,
      mpx: {
        ...DEFAULT_TARGET_CAPABILITY_MATRIX.mpx,
        'policy.row-level': 'supported' as const
      }
    }
    const attemptedOverride = {
      selection: fakeSelection(bundle),
      application: fakeBackendApplication(['policy.row-level']),
      target: 'mpx' as const,
      mode: 'production' as const,
      capabilityMatrix: forgedMatrix
    }

    expect(createBackendProviderPlan(registry, attemptedOverride)).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-target-capability-unsupported',
          severity: 'error'
        })
      ])
    })
  })
})
