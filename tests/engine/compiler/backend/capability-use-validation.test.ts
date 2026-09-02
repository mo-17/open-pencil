import { describe, expect, test } from 'bun:test'

import {
  createBackendProviderPlan,
  createBackendProviderRegistry,
  type BackendProviderBundle
} from '@open-pencil/compiler'
import type {
  BackendApplicationSpecV1,
  BackendCapabilityRequirement
} from '@open-pencil/lowcode/backend'

import { createFakeBackendProviderBundle, fakeBackendApplication, fakeSelection } from './helpers'

function readApplication(
  dataRead: BackendCapabilityRequirement | undefined
): BackendApplicationSpecV1 {
  const application = fakeBackendApplication([])
  application.dataModel.entities.push({
    id: 'notes',
    name: 'notes',
    management: 'managed',
    fields: [{ id: 'id', name: 'id', type: 'uuid', nullable: false }],
    primaryKey: { fields: ['id'] }
  })
  application.workflows.workflows.push({
    id: 'read-notes',
    name: 'Read notes',
    trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
    parameters: [],
    steps: [{ id: 'read', kind: 'data.read', entityId: 'notes', resultName: 'rows' }]
  })
  application.capabilities = [
    { capability: 'auth.identity', required: true },
    { capability: 'migrations.schema', required: true },
    { capability: 'server.functions', required: true },
    { capability: 'server.http', required: true },
    ...(dataRead ? [dataRead] : [])
  ]
  return application
}

function bundleWithServer(): BackendProviderBundle {
  const base = createFakeBackendProviderBundle({
    capabilities: ['auth.identity', 'data.read', 'server.functions', 'server.http']
  })
  if (!base.data) throw new Error('Fake data adapter is required')
  return {
    ...base,
    data: { ...base.data, capabilities: ['auth.identity', 'data.read'] },
    server: { ...base.data, capabilities: ['server.functions', 'server.http'] }
  }
}

describe('Compiler actual-use capability enforcement', () => {
  test('rejects absent data.read before source-only negotiation can skip the data adapter', () => {
    const bundle = createFakeBackendProviderBundle()
    const result = createBackendProviderPlan(createBackendProviderRegistry([bundle]), {
      selection: fakeSelection(bundle),
      application: readApplication(undefined),
      target: 'expo',
      mode: 'source-only-prototype'
    })

    expect(result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-capability-use-undeclared',
          severity: 'error',
          path: '$.capabilities.data.read'
        })
      ])
    })
  })

  test('requires server.http for the workflow HTTP trigger even without an HTTP request step', () => {
    const bundle = createFakeBackendProviderBundle()
    const application = readApplication({ capability: 'data.read', required: true })
    application.capabilities = application.capabilities.filter(
      (requirement) => requirement.capability !== 'server.http'
    )
    const result = createBackendProviderPlan(createBackendProviderRegistry([bundle]), {
      selection: fakeSelection(bundle),
      application,
      target: 'react',
      mode: 'production'
    })

    expect(result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-capability-use-undeclared',
          severity: 'error',
          path: '$.capabilities.server.http'
        })
      ])
    })
  })

  test('requires managed schema ownership and activates a real migrations adapter', () => {
    const application = fakeBackendApplication([])
    application.dataModel.entities.push({
      id: 'notes',
      name: 'notes',
      management: 'managed',
      fields: [{ id: 'id', name: 'id', type: 'uuid', nullable: false }],
      primaryKey: { fields: ['id'] }
    })
    const missingBundle = createFakeBackendProviderBundle()
    const missing = createBackendProviderPlan(createBackendProviderRegistry([missingBundle]), {
      selection: fakeSelection(missingBundle),
      application,
      target: 'react',
      mode: 'production'
    })
    expect(missing).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-capability-use-undeclared',
          path: '$.capabilities.migrations.schema'
        })
      ])
    })

    application.capabilities.push({ capability: 'migrations.schema', required: true })
    const migrationsBundle = createFakeBackendProviderBundle({
      slot: 'migrations',
      capabilities: ['migrations.schema'],
      outputs: ['migration-plan'],
      artifacts: [
        {
          path: 'backend/migration.json',
          kind: 'migration-plan',
          mediaType: 'application/json',
          content: '{}\n'
        }
      ]
    })
    const planned = createBackendProviderPlan(createBackendProviderRegistry([migrationsBundle]), {
      selection: fakeSelection(migrationsBundle),
      application,
      target: 'react',
      mode: 'production'
    })
    expect(planned.ok).toBe(true)
    if (planned.ok) expect(planned.plan.adapterPlans.migrations).toBeDefined()
  })

  test('rejects required false before source-only or unsupported target policy can downgrade it', () => {
    const sourceOnlyBundle = createFakeBackendProviderBundle({
      capabilities: [
        'auth.identity',
        'data.read',
        'migrations.schema',
        'server.functions',
        'server.http'
      ]
    })
    const sourceOnly = createBackendProviderPlan(
      createBackendProviderRegistry([sourceOnlyBundle]),
      {
        selection: fakeSelection(sourceOnlyBundle),
        application: readApplication({ capability: 'data.read', required: false }),
        target: 'expo',
        mode: 'source-only-prototype'
      }
    )
    expect(sourceOnly).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-capability-use-not-required',
          severity: 'error',
          path: '$.capabilities.data.read'
        })
      ])
    })

    const unsupportedApplication = readApplication({ capability: 'data.read', required: true })
    unsupportedApplication.auth.rowAccess.push({
      id: 'anonymous-read',
      entityId: 'notes',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'anonymous' }
    })
    unsupportedApplication.capabilities.push({
      capability: 'policy.row-level',
      required: false
    })
    const unsupported = createBackendProviderPlan(
      createBackendProviderRegistry([sourceOnlyBundle]),
      {
        selection: fakeSelection(sourceOnlyBundle),
        application: unsupportedApplication,
        target: 'mpx',
        mode: 'production'
      }
    )
    expect(unsupported).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-capability-use-not-required',
          severity: 'error',
          path: '$.capabilities.policy.row-level'
        })
      ])
    })
  })

  test('retains explicit source-only prototype behavior for actual capabilities declared required', () => {
    const bundle = createFakeBackendProviderBundle({
      capabilities: [
        'auth.identity',
        'data.read',
        'migrations.schema',
        'server.functions',
        'server.http'
      ]
    })
    const result = createBackendProviderPlan(createBackendProviderRegistry([bundle]), {
      selection: fakeSelection(bundle),
      application: readApplication({ capability: 'data.read', required: true }),
      target: 'expo',
      mode: 'source-only-prototype'
    })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'backend-capability-source-only-omitted',
          severity: 'warning'
        }),
        expect.objectContaining({
          code: 'backend-capability-server-bridge-omitted',
          severity: 'warning'
        })
      ])
    )
  })

  test('propagates Core external-schema Manual/Live warnings through a production plan', () => {
    const bundle = bundleWithServer()
    const application = readApplication({ capability: 'data.read', required: true })
    application.dataModel.entities[0] = {
      id: 'external:audit.rows',
      name: 'audit_rows',
      management: 'external',
      fields: []
    }
    application.capabilities = application.capabilities.filter(
      (requirement) => requirement.capability !== 'migrations.schema'
    )
    application.workflows.workflows[0].steps = [
      {
        id: 'read',
        kind: 'data.read',
        entityId: 'external:audit.rows',
        resultName: 'rows',
        fields: ['remote_field']
      }
    ]
    const result = createBackendProviderPlan(createBackendProviderRegistry([bundle]), {
      selection: fakeSelection(bundle),
      application,
      target: 'react',
      mode: 'production'
    })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'backend-workflow-external-schema-unverified',
        severity: 'warning',
        message: expect.stringContaining('Manual/Live')
      })
    )
  })
})
