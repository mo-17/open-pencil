import { describe, expect, test } from 'bun:test'

import {
  BACKEND_ARTIFACT_MANIFEST_PATH,
  BACKEND_ARTIFACT_MANIFEST_PATH_V2,
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  emitBackendProviderPlanV2,
  type BackendArtifactSourceV2,
  type BackendProviderBundleV2,
  type EmitBackendProviderPlanInputV2
} from '@open-pencil/compiler'

import {
  createFakeBackendProviderBundleV2,
  fakeBackendApplicationV2,
  fakeSelectionV2
} from './helpers'

function emitArtifactsV2(
  artifacts: readonly BackendArtifactSourceV2[],
  occupiedPaths: readonly string[] = []
) {
  const bundle = createFakeBackendProviderBundleV2({ artifacts })
  const registry = createBackendProviderRegistryV2([bundle])
  const selection = fakeSelectionV2(bundle)
  const planned = createBackendProviderPlanV2(registry, {
    selection,
    application: fakeBackendApplicationV2(),
    target: 'react',
    mode: 'production'
  })
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
  return emitBackendProviderPlanV2(registry, { plan: planned.plan, selection, occupiedPaths })
}

function artifactV2(path: string): BackendArtifactSourceV2 {
  return {
    path,
    kind: 'database-schema',
    mediaType: 'application/sql',
    content: '-- schema v2\n'
  }
}

describe('Compiler Backend V2 artifact boundary', () => {
  test('retains the V1 portable path boundary and reserves both manifest names', () => {
    for (const path of [
      '../escape.sql',
      '/absolute.sql',
      'backend\\schema.sql',
      'backend/../schema.sql',
      'backend/CON.sql',
      'backend/trailing. ',
      'backend/e\u0301.sql',
      'https://example.invalid/schema.sql',
      BACKEND_ARTIFACT_MANIFEST_PATH,
      BACKEND_ARTIFACT_MANIFEST_PATH_V2
    ]) {
      const result = emitArtifactsV2([artifactV2(path)])
      expect(result.ok, path).toBe(false)
      if (result.ok) continue
      expect(result.diagnostics, path).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code:
              path === BACKEND_ARTIFACT_MANIFEST_PATH || path === BACKEND_ARTIFACT_MANIFEST_PATH_V2
                ? 'backend-artifact-path-conflict'
                : 'backend-artifact-path-invalid'
          })
        ])
      )
    }
  })

  test('rejects case-folded occupied paths and text-only contract violations', () => {
    expect(
      emitArtifactsV2([artifactV2('backend/schema.sql')], ['BACKEND/SCHEMA.SQL'])
    ).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-artifact-path-conflict' })
      ])
    })

    const binary: BackendArtifactSourceV2 = {
      ...artifactV2('backend/schema.bin'),
      content: new Uint8Array([1, 2, 3])
    } as never
    expect(emitArtifactsV2([binary])).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-artifact-binary-content-forbidden' })
      ])
    })

    const secretCanary = ['sk', 'live', '0123456789abcdefghijklmnopqrstuvwxyz'].join('_')
    const unsafe = {
      ...artifactV2('backend/schema.sql'),
      content: `-- ${secretCanary}\n`
    }
    const unsafeResult = emitArtifactsV2([unsafe])
    expect(unsafeResult).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-artifact-secret-material-forbidden' })
      ])
    })
    expect(JSON.stringify(unsafeResult)).not.toContain(secretCanary)
  })

  test('snapshots occupied paths as strict plain data before any Provider callback', () => {
    let getterCalls = 0
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

    const hole: string[] = []
    hole.length = 1
    const accessor = ['backend/placeholder.sql']
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'backend/accessor.sql'
      }
    })
    const symbolProperty = ['backend/symbol.sql']
    Object.defineProperty(symbolProperty, Symbol('untrusted'), {
      enumerable: true,
      value: 'value'
    })
    const customProperty = ['backend/custom.sql'] as string[] & { metadata?: string }
    customProperty.metadata = 'untrusted'
    const subclass = ['backend/subclass.sql']
    Object.setPrototypeOf(subclass, Object.create(Array.prototype))
    const throwingProxy = new Proxy(['backend/proxy.sql'], {
      getPrototypeOf() {
        throw new TypeError('proxy trap')
      }
    })

    for (const occupiedPaths of [
      hole,
      accessor,
      symbolProperty,
      customProperty,
      subclass,
      throwingProxy
    ]) {
      let result: ReturnType<typeof emitBackendProviderPlanV2> | undefined
      expect(() => {
        result = emitBackendProviderPlanV2(registry, {
          plan: planned.plan,
          selection,
          occupiedPaths
        })
      }).not.toThrow()
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [expect.objectContaining({ code: 'backend-artifact-occupied-paths-invalid' })]
      })
      expect(planCalls).toBe(0)
      expect(emitCalls).toBe(0)
    }
    expect(getterCalls).toBe(0)

    const input = { plan: planned.plan, selection } as EmitBackendProviderPlanInputV2
    Object.defineProperty(input, 'occupiedPaths', {
      enumerable: true,
      get() {
        getterCalls += 1
        throw new TypeError('input getter')
      }
    })
    let getterInputResult: ReturnType<typeof emitBackendProviderPlanV2> | undefined
    expect(() => {
      getterInputResult = emitBackendProviderPlanV2(registry, input)
    }).not.toThrow()
    expect(getterInputResult).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'backend-artifact-occupied-paths-invalid' })]
    })
    expect(getterCalls).toBe(0)
    expect(planCalls).toBe(0)
    expect(emitCalls).toBe(0)
  })
})
