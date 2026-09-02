import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  BACKEND_ARTIFACT_MANIFEST_PATH,
  backendProviderPlanDigest,
  createBackendProviderPlan,
  createBackendProviderRegistry,
  emitBackendProviderPlan
} from '@open-pencil/compiler'
import type { BackendProviderBundle, BackendProviderPlan } from '@open-pencil/compiler'

import { createFakeBackendProviderBundle, fakeBackendApplication, fakeSelection } from './helpers'

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('base64url')
}

describe('Compiler Backend Provider plan and emission', () => {
  test('rejects every unrecognized runtime mode before invoking Provider code', () => {
    const base = createFakeBackendProviderBundle()
    if (!base.data) throw new Error('Fake Provider data adapter is required')
    const data = base.data
    let bundleValidateCalls = 0
    let adapterValidateCalls = 0
    let adapterPlanCalls = 0
    const bundle: BackendProviderBundle = {
      ...base,
      validate() {
        bundleValidateCalls += 1
        return []
      },
      data: {
        ...data,
        validate() {
          adapterValidateCalls += 1
          return []
        },
        plan(context) {
          adapterPlanCalls += 1
          return data.plan(context)
        }
      }
    }
    const registry = createBackendProviderRegistry([bundle])
    const invalidModes: readonly unknown[] = [
      'production ',
      'Production',
      '',
      null,
      false,
      0,
      {},
      [],
      undefined
    ]

    for (const mode of invalidModes) {
      expect(
        createBackendProviderPlan(registry, {
          selection: fakeSelection(bundle),
          application: fakeBackendApplication(),
          target: 'react',
          mode
        } as never)
      ).toMatchObject({
        ok: false,
        diagnostics: [
          expect.objectContaining({
            code: 'backend-compilation-mode-unsupported',
            path: '$.mode',
            severity: 'error'
          })
        ]
      })
    }
    expect(bundleValidateCalls).toBe(0)
    expect(adapterValidateCalls).toBe(0)
    expect(adapterPlanCalls).toBe(0)
  })

  test('snapshots the target once before capability negotiation and Provider callbacks', () => {
    const bundle = createFakeBackendProviderBundle({ capabilities: ['data.read'] })
    const registry = createBackendProviderRegistry([bundle])
    let targetReads = 0
    const input = {
      selection: fakeSelection(bundle),
      application: fakeBackendApplication(['data.read']),
      mode: 'production' as const,
      get target() {
        targetReads += 1
        return targetReads === 1 ? ('react' as const) : ('vue' as const)
      }
    }

    const planned = createBackendProviderPlan(registry, input)
    expect(planned).toMatchObject({ ok: true, plan: { target: 'react' } })
    expect(targetReads).toBe(1)
  })

  test('rejects credential material masquerading as a credential reference before planning', () => {
    const bundle = createFakeBackendProviderBundle()
    const registry = createBackendProviderRegistry([bundle])
    const secretCanary = [
      'credential.sk',
      'live',
      '0123456789abcdefghijklmnopqrstuvwxyz'
    ].join('_')
    const application = fakeBackendApplication()
    Reflect.set(application, 'secrets', [
      {
        kind: 'credential',
        credentialRef: secretCanary,
        name: 'SERVER_CREDENTIAL',
        exposure: 'server',
        required: true
      }
    ])
    const result = createBackendProviderPlan(registry, {
      selection: fakeSelection(bundle),
      application,
      target: 'react',
      mode: 'production'
    })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(secretCanary)
  })

  test('normalizes IR and emits byte-for-byte deterministic artifacts, order, and digests', () => {
    const bundle = createFakeBackendProviderBundle()
    const registry = createBackendProviderRegistry([bundle])
    const application = fakeBackendApplication(
      ['data.write', 'data.read'],
      [
        {
          kind: 'credential',
          credentialRef: 'credential.123e4567-e89b-42d3-a456-426614174000',
          name: 'SERVICE_TOKEN',
          exposure: 'server',
          required: true
        },
        {
          kind: 'environment',
          name: 'PUBLIC_BACKEND_URL',
          exposure: 'client-public',
          required: true
        },
        {
          kind: 'environment',
          name: 'OPTIONAL_REGION',
          exposure: 'server',
          required: false
        }
      ]
    )
    const input = {
      selection: fakeSelection(bundle),
      application,
      target: 'react',
      mode: 'production'
    } as const

    const firstPlan = createBackendProviderPlan(registry, input)
    const secondPlan = createBackendProviderPlan(registry, input)
    expect(firstPlan).toEqual(secondPlan)
    expect(firstPlan.ok).toBe(true)
    if (!firstPlan.ok || !secondPlan.ok) return
    expect(firstPlan.plan.application.capabilities.map((entry) => entry.capability)).toEqual([
      'data.read',
      'data.write'
    ])
    expect(Object.isFrozen(firstPlan.plan)).toBe(true)
    expect(Object.isFrozen(firstPlan.plan.application)).toBe(true)

    const firstEmission = emitBackendProviderPlan(registry, {
      plan: firstPlan.plan,
      selection: input.selection
    })
    const secondEmission = emitBackendProviderPlan(registry, {
      plan: secondPlan.plan,
      selection: input.selection
    })
    expect(firstEmission).toEqual(secondEmission)
    expect(firstEmission.ok).toBe(true)
    if (!firstEmission.ok || !secondEmission.ok) return

    expect(Object.isFrozen(firstEmission.emission.files)).toBe(true)
    expect(Reflect.get(firstEmission.emission.files, 'set')).toBeUndefined()
    expect(Reflect.set(firstEmission.emission.files as object, 'set', () => undefined)).toBe(false)
    expect([...firstEmission.emission.files.keys()]).toEqual([
      'backend/schema.json',
      BACKEND_ARTIFACT_MANIFEST_PATH,
      'src/backend/config.json'
    ])
    expect(firstEmission.emission.manifest.artifacts.map((entry) => entry.path)).toEqual([
      'backend/schema.json',
      'src/backend/config.json'
    ])
    for (const entry of firstEmission.emission.manifest.artifacts) {
      const content = firstEmission.emission.files.get(entry.path)
      expect(content).toBeDefined()
      if (content === undefined) return
      expect(entry.digest).toBe(digest(content))
    }
    expect(firstEmission.emission.manifest.requiredSecrets).toEqual([
      {
        kind: 'credential',
        credentialRef: 'credential.123e4567-e89b-42d3-a456-426614174000',
        name: 'SERVICE_TOKEN',
        exposure: 'server',
        required: true
      },
      {
        kind: 'environment',
        name: 'PUBLIC_BACKEND_URL',
        exposure: 'client-public',
        required: true
      }
    ])
    const manifestContent = firstEmission.emission.files.get(BACKEND_ARTIFACT_MANIFEST_PATH)
    expect(typeof manifestContent).toBe('string')
    if (manifestContent === undefined) return
    expect(firstEmission.emission.manifestDigest).toBe(digest(manifestContent))
    expect(manifestContent).toBe(secondEmission.emission.files.get(BACKEND_ARTIFACT_MANIFEST_PATH))
  })

  test('fails closed for binary artifacts in contract v1', () => {
    const sourceBytes = new Uint8Array([1, 2, 3, 4])
    const bundle = createFakeBackendProviderBundle({
      outputs: ['database-schema'],
      artifacts: [
        {
          path: 'backend/schema.bin',
          kind: 'database-schema',
          mediaType: 'application/octet-stream',
          content: sourceBytes
        }
      ]
    })
    const registry = createBackendProviderRegistry([bundle])
    const selection = fakeSelection(bundle)
    const planned = createBackendProviderPlan(registry, {
      selection,
      application: fakeBackendApplication(),
      target: 'react',
      mode: 'production'
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const emitted = emitBackendProviderPlan(registry, {
      plan: planned.plan,
      selection
    })
    expect(emitted).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-artifact-binary-content-forbidden'
        })
      ])
    })
  })

  test('rejects a tampered plan before any adapter emission', () => {
    const bundle = createFakeBackendProviderBundle()
    const registry = createBackendProviderRegistry([bundle])
    const planned = createBackendProviderPlan(registry, {
      selection: fakeSelection(bundle),
      application: fakeBackendApplication(),
      target: 'react',
      mode: 'production'
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    const tampered = { ...planned.plan, target: 'vue' } as BackendProviderPlan
    expect(
      emitBackendProviderPlan(registry, {
        plan: tampered,
        selection: fakeSelection(bundle)
      })
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-plan-digest-mismatch' }]
    })
  })

  test('rejects a forged illegal-mode plan during emission revalidation', () => {
    const base = createFakeBackendProviderBundle()
    if (!base.data) throw new Error('Fake Provider data adapter is required')
    const data = base.data
    let emitCalls = 0
    const bundle: BackendProviderBundle = {
      ...base,
      data: {
        ...data,
        emit(context, plan) {
          emitCalls += 1
          return data.emit(context, plan)
        }
      }
    }
    const registry = createBackendProviderRegistry([bundle])
    const selection = fakeSelection(bundle)
    const planned = createBackendProviderPlan(registry, {
      selection,
      application: fakeBackendApplication(),
      target: 'react',
      mode: 'production'
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    const illegalModePlan: BackendProviderPlan = { ...planned.plan }
    Reflect.set(illegalModePlan, 'mode', 'development')
    const forgedPlan = {
      ...illegalModePlan,
      planDigest: backendProviderPlanDigest(illegalModePlan)
    } as BackendProviderPlan
    expect(
      emitBackendProviderPlan(registry, {
        plan: forgedPlan,
        selection
      })
    ).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'backend-compilation-mode-unsupported',
          severity: 'error'
        })
      ]
    })
    expect(emitCalls).toBe(0)
  })

  test('binds emission to the current package digest and enabled lifecycle state', () => {
    const bundle = createFakeBackendProviderBundle()
    const registry = createBackendProviderRegistry([bundle])
    const selection = fakeSelection(bundle)
    const planned = createBackendProviderPlan(registry, {
      selection,
      application: fakeBackendApplication(),
      target: 'react',
      mode: 'production'
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    const substitutedDigest = `sha256:${'A'.repeat(42)}E`
    expect(registry.resolve({ ...selection, packageDigest: substitutedDigest }).ok).toBe(true)
    expect(
      emitBackendProviderPlan(registry, {
        plan: planned.plan,
        selection: { ...selection, packageDigest: substitutedDigest }
      })
    ).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-provider-plan-stale' })
      ])
    })
    expect(
      emitBackendProviderPlan(registry, {
        plan: planned.plan,
        selection: { ...selection, enabled: false }
      })
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-disabled' }]
    })
  })

  test('fails before Provider code when Backend Application IR is malformed', () => {
    const bundle = createFakeBackendProviderBundle()
    const registry = createBackendProviderRegistry([bundle])
    const malformed = {
      ...fakeBackendApplication(),
      endpoint: 'https://example.invalid'
    }

    expect(
      createBackendProviderPlan(registry, {
        selection: fakeSelection(bundle),
        application: malformed,
        target: 'react',
        mode: 'production'
      })
    ).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-unknown-field' })
      ])
    })
  })

  test('preserves successful Core warnings for external workflow schema review', () => {
    const capabilities = ['auth.identity', 'data.read', 'server.functions', 'server.http'] as const
    const base = createFakeBackendProviderBundle({ capabilities })
    if (!base.data) throw new Error('Fake data adapter is required')
    const bundle: BackendProviderBundle = {
      ...base,
      data: { ...base.data, capabilities: ['auth.identity', 'data.read'] },
      server: {
        ...base.data,
        capabilities: ['server.functions', 'server.http']
      }
    }
    const registry = createBackendProviderRegistry([bundle])
    const application = fakeBackendApplication(capabilities)
    application.dataModel.entities.push({
      id: 'legacy_records',
      name: 'legacy_records',
      management: 'external',
      fields: []
    })
    application.auth.identities.push({ id: 'user', kind: 'user' })
    application.workflows.workflows.push({
      id: 'read-legacy-records',
      name: 'Read legacy records',
      trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
      parameters: [],
      steps: [
        {
          id: 'read',
          kind: 'data.read',
          entityId: 'legacy_records',
          resultName: 'records',
          fields: ['provider_owned_column']
        }
      ]
    })

    const result = createBackendProviderPlan(registry, {
      selection: fakeSelection(bundle),
      application,
      target: 'react',
      mode: 'production'
    })

    expect(result).toMatchObject({
      ok: true,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-workflow-external-schema-unverified',
          severity: 'warning'
        })
      ])
    })
  })

  test('rejects secret-like adapter plans without echo and preserves opaque digests', () => {
    const secretCanary = ['sk', 'live', '0123456789abcdefghijklmnopqrstuvwxyz'].join('_')
    const unsafePlans = [
      { nested: { value: secretCanary } },
      { nested: { [secretCanary]: 'value' } }
    ]
    for (const unsafePlan of unsafePlans) {
      const base = createFakeBackendProviderBundle()
      if (!base.data) throw new Error('Fake Provider data adapter is required')
      const bundle: BackendProviderBundle = {
        ...base,
        data: { ...base.data, plan: () => unsafePlan as never }
      }
      const registry = createBackendProviderRegistry([bundle])
      const result = createBackendProviderPlan(registry, {
        selection: fakeSelection(bundle),
        application: fakeBackendApplication(),
        target: 'react',
        mode: 'production'
      })
      expect(result).toMatchObject({
        ok: false,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'backend-provider-plan-secret-material-forbidden'
          })
        ])
      })
      expect(JSON.stringify(result)).not.toContain(secretCanary)
    }

    const safeBase = createFakeBackendProviderBundle()
    if (!safeBase.data) throw new Error('Fake Provider data adapter is required')
    const safeBundle: BackendProviderBundle = {
      ...safeBase,
      data: {
        ...safeBase.data,
        plan: () => ({
          digest: 'pW9GMbKQAwZGLKfTqjPTyuzT9HCoHMNTx_ezQJTDfYQ',
          operationId: '123e4567-e89b-42d3-a456-426614174000'
        })
      }
    }
    const safeRegistry = createBackendProviderRegistry([safeBundle])
    expect(
      createBackendProviderPlan(safeRegistry, {
        selection: fakeSelection(safeBundle),
        application: fakeBackendApplication(),
        target: 'react',
        mode: 'production'
      }).ok
    ).toBe(true)
  })

  test('replaces secret-bearing Provider diagnostics with a generic invalid diagnostic', () => {
    const secretCanary = ['sk', 'live', '0123456789abcdefghijklmnopqrstuvwxyz'].join('_')
    const base = createFakeBackendProviderBundle()
    const bundle: BackendProviderBundle = {
      ...base,
      validate: () => [
        {
          code: 'provider-review-warning',
          severity: 'warning',
          path: `$.provider.${secretCanary}`,
          message: 'Provider review is required.'
        },
        {
          code: 'provider-review-warning',
          severity: 'warning',
          path: '$.provider',
          message: `Provider returned ${secretCanary}.`
        }
      ]
    }
    const registry = createBackendProviderRegistry([bundle])
    const result = createBackendProviderPlan(registry, {
      selection: fakeSelection(bundle),
      application: fakeBackendApplication(),
      target: 'react',
      mode: 'production'
    })
    expect(result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-provider-diagnostic-invalid'
        })
      ])
    })
    expect(JSON.stringify(result)).not.toContain(secretCanary)
  })

  test('rejects non-data canonical arrays without invoking accessors', () => {
    let getterCalls = 0
    const arrays = [
      () => {
        const value: unknown[] = []
        value.length = 1
        return value
      },
      () => {
        const value = [1]
        Object.defineProperty(value, 'metadata', {
          enumerable: true,
          value: 'untrusted'
        })
        return value
      },
      () => {
        const value = [1]
        Object.defineProperty(value, '0', {
          enumerable: true,
          get() {
            getterCalls += 1
            return 1
          }
        })
        return value
      },
      () => {
        const value = [1]
        Object.setPrototypeOf(value, Object.create(Array.prototype))
        return value
      }
    ]

    for (const createArray of arrays) {
      const base = createFakeBackendProviderBundle()
      if (!base.data) throw new Error('Fake Provider data adapter is required')
      const bundle: BackendProviderBundle = {
        ...base,
        data: {
          ...base.data,
          plan() {
            return { values: createArray() } as never
          }
        }
      }
      const registry = createBackendProviderRegistry([bundle])
      expect(
        createBackendProviderPlan(registry, {
          selection: fakeSelection(bundle),
          application: fakeBackendApplication(),
          target: 'react',
          mode: 'production'
        })
      ).toMatchObject({
        ok: false,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'backend-provider-plan-failed' })
        ])
      })
    }
    expect(getterCalls).toBe(0)
  })
})
