import { describe, expect, test } from 'bun:test'

import {
  deriveBackendApplicationCapabilities,
  validateBackendCapabilityDeclarations
} from '@open-pencil/lowcode/backend'

import { backendApplicationFixture } from './fixture'

const expression = { kind: 'expression', expression: 'input' } as const

describe('Backend actual-use capability derivation', () => {
  test('derives auth, policy, workflow, data, HTTP, and storage requirements from normalized IR', () => {
    const application = backendApplicationFixture()
    application.auth.roles.push({ id: 'editor', name: 'editor' })
    application.auth.rowAccess.push({
      id: 'editor-access',
      entityId: 'notes',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'role', roleId: 'editor' }
    })
    application.dataModel.entities.push({
      id: 'external:storage.storage_objects',
      name: 'storage_objects',
      management: 'external',
      fields: []
    })
    application.workflows.workflows.push({
      id: 'main',
      name: 'main',
      trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
      parameters: [],
      steps: [
        { id: 'read', kind: 'data.read', entityId: 'notes', resultName: 'rows' },
        {
          id: 'update',
          kind: 'data.mutate',
          entityId: 'notes',
          operation: 'update',
          values: [{ field: 'title', value: expression }],
          filters: [{ field: 'id', operator: 'eq', value: expression }]
        },
        {
          id: 'request',
          kind: 'http.request',
          method: 'POST',
          url: { kind: 'expression', expression: 'endpoint' }
        }
      ]
    })

    expect(deriveBackendApplicationCapabilities(application)).toEqual([
      'auth.identity',
      'auth.roles',
      'data.read',
      'data.write',
      'migrations.schema',
      'policy.row-level',
      'server.functions',
      'server.http',
      'storage.objects'
    ])
  })

  test('rejects both absent and optional declarations for capabilities used by IR', () => {
    const absent = backendApplicationFixture()
    expect(validateBackendCapabilityDeclarations(absent)).toContainEqual(
      expect.objectContaining({
        code: 'backend-capability-use-undeclared',
        severity: 'error',
        path: '$.capabilities.auth.identity'
      })
    )
    expect(validateBackendCapabilityDeclarations(absent)).toContainEqual(
      expect.objectContaining({
        code: 'backend-capability-use-undeclared',
        severity: 'error',
        path: '$.capabilities.migrations.schema'
      })
    )

    const optional = backendApplicationFixture()
    optional.capabilities.push({ capability: 'auth.identity', required: false })
    expect(validateBackendCapabilityDeclarations(optional)).toContainEqual(
      expect.objectContaining({
        code: 'backend-capability-use-not-required',
        severity: 'error',
        path: '$.capabilities.auth.identity'
      })
    )

    const workflowTrigger = backendApplicationFixture()
    workflowTrigger.workflows.workflows.push({
      id: 'main',
      name: 'main',
      trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
      parameters: [],
      steps: []
    })
    expect(validateBackendCapabilityDeclarations(workflowTrigger)).toContainEqual(
      expect.objectContaining({
        code: 'backend-capability-use-undeclared',
        severity: 'error',
        path: '$.capabilities.server.http'
      })
    )
  })

  test('derives schema management only for managed entities', () => {
    const managed = backendApplicationFixture()
    expect(deriveBackendApplicationCapabilities(managed)).toContain('migrations.schema')

    const externalOnly = backendApplicationFixture()
    externalOnly.dataModel.entities = [
      { id: 'external:audit.rows', name: 'audit_rows', management: 'external', fields: [] }
    ]
    externalOnly.auth = {
      version: 1,
      identities: [],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    }
    expect(deriveBackendApplicationCapabilities(externalOnly)).not.toContain('migrations.schema')
  })
})
