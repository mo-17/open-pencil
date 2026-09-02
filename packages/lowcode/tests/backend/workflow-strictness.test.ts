import { describe, expect, test } from 'bun:test'

import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1,
  type BackendSecretRef
} from '@open-pencil/lowcode/backend'

import { backendApplicationFixture } from './fixture'

const expression = { kind: 'expression', expression: 'input' } as const

function applicationWithSteps(steps: readonly unknown[]): BackendApplicationSpecV1 {
  const application = backendApplicationFixture()
  Reflect.set(application.workflows, 'workflows', [
    {
      id: 'main',
      name: 'main',
      trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
      parameters: [],
      steps
    }
  ])
  return application
}

function environmentSecret(name: string): BackendSecretRef {
  return { kind: 'environment', name, exposure: 'server', required: true }
}

describe('Backend workflow application strictness', () => {
  test('requires managed workflow data references to use declared field ids', () => {
    const cases = [
      {
        id: 'read-fields',
        kind: 'data.read',
        entityId: 'notes',
        resultName: 'notes',
        fields: ['missing']
      },
      {
        id: 'read-filter',
        kind: 'data.read',
        entityId: 'notes',
        resultName: 'notes',
        filters: [{ field: 'missing', operator: 'eq', value: expression }]
      },
      {
        id: 'insert-value',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'insert',
        values: [{ field: 'missing', value: expression }]
      },
      {
        id: 'update-filter',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'update',
        values: [{ field: 'title', value: expression }],
        filters: [{ field: 'missing', operator: 'eq', value: expression }]
      }
    ]

    for (const step of cases) {
      const result = parseBackendApplicationSpecV1(applicationWithSteps([step]))
      expect(result.ok).toBe(false)
      expect(result.diagnostics.map((entry) => entry.code)).toContain(
        'backend-workflow-field-missing'
      )
    }

    const nameIsNotId = applicationWithSteps([
      {
        id: 'read-name',
        kind: 'data.read',
        entityId: 'notes',
        resultName: 'notes',
        fields: ['title']
      }
    ])
    nameIsNotId.dataModel.entities[0].fields[2].id = 'title_id'
    const nameResult = parseBackendApplicationSpecV1(nameIsNotId)
    expect(nameResult.ok).toBe(false)
    expect(nameResult.diagnostics.map((entry) => entry.code)).toContain(
      'backend-workflow-field-missing'
    )
  })

  test('accepts safe backend ids, including hyphens, in workflow field references', () => {
    const application = applicationWithSteps([
      {
        id: 'insert',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'insert',
        values: [
          { field: 'id', value: expression },
          { field: 'owner-id', value: expression },
          { field: 'title', value: expression }
        ]
      },
      {
        id: 'read',
        kind: 'data.read',
        entityId: 'notes',
        resultName: 'notes',
        fields: ['owner-id'],
        filters: [{ field: 'owner-id', operator: 'eq', value: expression }]
      }
    ])
    application.dataModel.entities[0].fields[1].id = 'owner-id'
    const ownerIndex = application.dataModel.entities[0].indexes?.[0]
    if (!ownerIndex) throw new Error('Backend workflow fixture requires an owner index.')
    ownerIndex.fields = ['owner-id']
    application.auth.ownership[0].identityFieldId = 'owner-id'

    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
  })

  test('accepts unknown external fields only with a propagated Manual/Live warning', () => {
    const application = applicationWithSteps([
      {
        id: 'external-read',
        kind: 'data.read',
        entityId: 'audit_log',
        resultName: 'rows',
        fields: ['remote_field'],
        filters: [{ field: 'remote_filter', operator: 'eq', value: expression }]
      }
    ])
    application.dataModel.entities.push({
      id: 'audit_log',
      name: 'audit_log',
      management: 'external',
      fields: []
    })

    const result = parseBackendApplicationSpecV1(application)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics).toContainEqual({
      code: 'backend-workflow-external-schema-unverified',
      severity: 'warning',
      path: '$.workflows.workflows[0].steps[0].entityId',
      message:
        'External entity fields are not declared in Backend IR; Manual/Live schema verification is required before release.'
    })
    expect(result.diagnostics).not.toHaveLength(0)
  })

  test('fails closed for full-table or empty data mutations', () => {
    const invalid = [
      { id: 'insert-missing', kind: 'data.mutate', entityId: 'notes', operation: 'insert' },
      {
        id: 'insert-empty',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'insert',
        values: []
      },
      { id: 'upsert-missing', kind: 'data.mutate', entityId: 'notes', operation: 'upsert' },
      {
        id: 'update-no-filter',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'update',
        values: [{ field: 'title', value: expression }]
      },
      {
        id: 'update-no-values',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'update',
        filters: [{ field: 'id', operator: 'eq', value: expression }]
      },
      { id: 'delete-missing', kind: 'data.mutate', entityId: 'notes', operation: 'delete' },
      {
        id: 'delete-empty',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'delete',
        filters: []
      }
    ]

    for (const step of invalid) {
      const result = parseBackendApplicationSpecV1(applicationWithSteps([step]))
      expect(result.ok).toBe(false)
      expect(result.diagnostics.map((entry) => entry.code)).toContain(
        'backend-workflow-mutation-unsafe'
      )
    }

    const safe = [
      {
        id: 'insert',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'insert',
        values: [
          { field: 'id', value: expression },
          { field: 'owner_id', value: expression },
          { field: 'title', value: expression }
        ]
      },
      {
        id: 'upsert',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'upsert',
        values: [
          { field: 'id', value: expression },
          { field: 'owner_id', value: expression },
          { field: 'title', value: expression }
        ]
      },
      {
        id: 'update',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'update',
        values: [{ field: 'title', value: expression }],
        filters: [{ field: 'id', operator: 'eq', value: expression }]
      },
      {
        id: 'delete',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'delete',
        filters: [{ field: 'id', operator: 'eq', value: expression }]
      }
    ]
    expect(parseBackendApplicationSpecV1(applicationWithSteps(safe)).ok).toBe(true)
  })

  test('requires insert/upsert coverage for required fields and the upsert primary key', () => {
    const missingRequired = parseBackendApplicationSpecV1(
      applicationWithSteps([
        {
          id: 'insert',
          kind: 'data.mutate',
          entityId: 'notes',
          operation: 'insert',
          values: [{ field: 'title', value: expression }]
        },
        {
          id: 'upsert',
          kind: 'data.mutate',
          entityId: 'notes',
          operation: 'upsert',
          values: [{ field: 'title', value: expression }]
        }
      ])
    )
    expect(missingRequired.ok).toBe(false)
    expect(missingRequired.diagnostics.map((entry) => entry.code)).toContain(
      'backend-workflow-required-field-missing'
    )
    expect(missingRequired.diagnostics.map((entry) => entry.code)).toContain(
      'backend-workflow-upsert-key-missing'
    )

    const generatedKey = applicationWithSteps([
      {
        id: 'upsert',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'upsert',
        values: [
          { field: 'owner_id', value: expression },
          { field: 'title', value: expression }
        ]
      }
    ])
    generatedKey.dataModel.entities[0].fields[0].default = {
      kind: 'generated',
      generator: 'uuid'
    }
    const generatedKeyResult = parseBackendApplicationSpecV1(generatedKey)
    expect(generatedKeyResult.ok).toBe(false)
    expect(generatedKeyResult.diagnostics.map((entry) => entry.code)).toContain(
      'backend-workflow-upsert-key-missing'
    )
    expect(generatedKeyResult.diagnostics.map((entry) => entry.code)).not.toContain(
      'backend-workflow-required-field-missing'
    )

    const noPrimaryKey = applicationWithSteps([
      {
        id: 'upsert',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'upsert',
        values: [
          { field: 'id', value: expression },
          { field: 'owner_id', value: expression },
          { field: 'title', value: expression }
        ]
      }
    ])
    delete noPrimaryKey.dataModel.entities[0].primaryKey
    const noPrimaryKeyResult = parseBackendApplicationSpecV1(noPrimaryKey)
    expect(noPrimaryKeyResult.ok).toBe(false)
    expect(noPrimaryKeyResult.diagnostics.map((entry) => entry.code)).toContain(
      'backend-workflow-upsert-primary-key-missing'
    )
  })

  test('rejects duplicate mutation value fields', () => {
    const duplicate = parseBackendApplicationSpecV1(
      applicationWithSteps([
        {
          id: 'update',
          kind: 'data.mutate',
          entityId: 'notes',
          operation: 'update',
          values: [
            { field: 'title', value: expression },
            { field: 'title', value: expression }
          ],
          filters: [{ field: 'id', operator: 'eq', value: expression }]
        }
      ])
    )
    expect(duplicate.ok).toBe(false)
    expect(duplicate.diagnostics).toContainEqual({
      code: 'backend-duplicate',
      severity: 'error',
      path: '$.workflows.workflows[0].steps[0].values',
      message: 'Duplicate mutation value field is not allowed.'
    })
  })

  test('recursively binds every nested workflow environment source to a declaration', () => {
    const names = [
      'READ_FILTER',
      'MUTATE_VALUE',
      'MUTATE_FILTER',
      'HTTP_URL',
      'HTTP_HEADER',
      'HTTP_BODY'
    ]
    const application = applicationWithSteps([
      {
        id: 'outer-branch',
        kind: 'branch',
        condition: 'input',
        consequent: [
          {
            id: 'read',
            kind: 'data.read',
            entityId: 'notes',
            resultName: 'notes',
            filters: [
              {
                field: 'id',
                operator: 'eq',
                value: { kind: 'environment', name: 'READ_FILTER' }
              }
            ]
          },
          {
            id: 'mutate',
            kind: 'data.mutate',
            entityId: 'notes',
            operation: 'update',
            values: [
              {
                field: 'title',
                value: { kind: 'environment', name: 'MUTATE_VALUE' }
              }
            ],
            filters: [
              {
                field: 'id',
                operator: 'eq',
                value: { kind: 'environment', name: 'MUTATE_FILTER' }
              }
            ]
          }
        ],
        alternate: [
          {
            id: 'inner-branch',
            kind: 'branch',
            condition: 'input',
            consequent: [
              {
                id: 'request',
                kind: 'http.request',
                method: 'POST',
                url: { kind: 'environment', name: 'HTTP_URL' },
                headers: [
                  {
                    name: 'X-Backend-Value',
                    value: { kind: 'environment', name: 'HTTP_HEADER' }
                  }
                ],
                body: { kind: 'environment', name: 'HTTP_BODY' }
              }
            ],
            alternate: []
          }
        ]
      }
    ])

    const missing = parseBackendApplicationSpecV1(application)
    expect(missing.ok).toBe(false)
    const missingReferences = missing.diagnostics.filter(
      (entry) => entry.code === 'backend-workflow-environment-undeclared'
    )
    expect(missingReferences).toHaveLength(names.length)
    expect(missingReferences.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('.filters[0].value.name'),
        expect.stringContaining('.values[0].value.name'),
        expect.stringContaining('.url.name'),
        expect.stringContaining('.headers[0].value.name'),
        expect.stringContaining('.body.name')
      ])
    )

    application.secrets.push(...names.map(environmentSecret))
    const declared = parseBackendApplicationSpecV1(application)
    expect(declared.ok).toBe(true)
    if (declared.ok) expect(declared.diagnostics).toEqual([])
  })

  test('enforces uppercase environment names and rejects credential value-source variants', () => {
    const lowercase = applicationWithSteps([
      {
        id: 'request',
        kind: 'http.request',
        method: 'GET',
        url: { kind: 'environment', name: 'api_url' }
      }
    ])
    lowercase.secrets.push(environmentSecret('API_URL'))
    const lowercaseResult = parseBackendApplicationSpecV1(lowercase)
    expect(lowercaseResult.ok).toBe(false)
    expect(lowercaseResult.diagnostics.map((entry) => entry.code)).toContain(
      'backend-environment-name-invalid'
    )

    const credential = applicationWithSteps([
      {
        id: 'request',
        kind: 'http.request',
        method: 'GET',
        url: {
          kind: 'credential',
          name: 'API_URL',
          credentialRef: 'credential.123e4567-e89b-42d3-a456-426614174000'
        }
      }
    ])
    const credentialResult = parseBackendApplicationSpecV1(credential)
    expect(credentialResult.ok).toBe(false)
    expect(credentialResult.diagnostics.map((entry) => entry.code)).toContain(
      'backend-enum-invalid'
    )

    const mixed = applicationWithSteps([
      {
        id: 'request',
        kind: 'http.request',
        method: 'GET',
        url: {
          kind: 'environment',
          name: 'API_URL',
          credentialRef: 'credential.123e4567-e89b-42d3-a456-426614174000'
        }
      }
    ])
    mixed.secrets.push(environmentSecret('API_URL'))
    const mixedResult = parseBackendApplicationSpecV1(mixed)
    expect(mixedResult.ok).toBe(false)
    expect(mixedResult.diagnostics.map((entry) => entry.code)).toContain('backend-unknown-field')
  })
})
