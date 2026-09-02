import { describe, expect, test } from 'bun:test'

import {
  parseAuthPolicyIR,
  parseBackendWorkflowIR
} from '#lowcode/backend/auth-workflow-validation'
import type { BackendValidationContext } from '#lowcode/backend/validation-helpers'

import { parseBackendApplicationSpecV1, validateDataModelIR } from '@open-pencil/lowcode/backend'

import { backendApplicationFixture, backendModelFixture, stripeSecretCanary } from './fixture'

function applicationWithWorkflowStep(step: unknown) {
  const input = backendApplicationFixture()
  input.secrets.push({
    kind: 'environment',
    name: 'API_URL',
    exposure: 'server',
    required: true
  })
  Reflect.set(input.workflows, 'workflows', [
    {
      id: 'main',
      name: 'main',
      trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
      parameters: [],
      steps: [step]
    },
    {
      id: 'target',
      name: 'target',
      trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
      parameters: [],
      steps: []
    }
  ])
  return input
}

describe('provider-neutral Backend Core validation', () => {
  test('normalizes a strict versioned application without provider dialect fields', () => {
    const input = backendApplicationFixture()
    input.capabilities.reverse()
    input.dataModel.entities[0].fields.reverse()
    const result = parseBackendApplicationSpecV1(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.capabilities.map((entry) => entry.capability)).toEqual([
      'data.read',
      'data.write',
      'policy.row-level'
    ])
    expect(result.value.dataModel.entities[0].fields.map((entry) => entry.id)).toEqual([
      'id',
      'owner_id',
      'title'
    ])
    expect(JSON.stringify(result.value).toLowerCase()).not.toContain('supabase')
  })

  test('fails closed for unknown versions, fields, types, and capabilities', () => {
    const future: unknown = {
      ...structuredClone(backendApplicationFixture()),
      version: 2,
      executor: 'not allowed'
    }
    const result = parseBackendApplicationSpecV1(future)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.map((entry) => entry.code)).toContain('backend-version-unsupported')
    expect(result.diagnostics.map((entry) => entry.code)).toContain('backend-unknown-field')

    const validModel = backendModelFixture()
    const model: unknown = {
      ...validModel,
      entities: [
        {
          ...validModel.entities[0],
          fields: [{ ...validModel.entities[0].fields[0], type: 'provider_serial' }]
        }
      ]
    }
    expect(validateDataModelIR(model).ok).toBe(false)

    const capabilityFixture = backendApplicationFixture()
    const unknownCapability: unknown = {
      ...capabilityFixture,
      capabilities: [
        {
          ...capabilityFixture.capabilities[0],
          capability: 'database.superuser'
        },
        ...capabilityFixture.capabilities.slice(1)
      ]
    }
    expect(parseBackendApplicationSpecV1(unknownCapability).ok).toBe(false)
  })

  test('enforces exact keys for all five auth principal variants', () => {
    const cases = [
      [{ kind: 'anonymous' }, { roleId: 'reader' }],
      [{ kind: 'authenticated' }, { tenantId: 'workspace' }],
      [{ kind: 'role', roleId: 'reader' }, { ownershipId: 'note-owner' }],
      [{ kind: 'owner', ownershipId: 'note-owner' }, { tenantId: 'workspace' }],
      [{ kind: 'tenant-member', tenantId: 'workspace' }, { roleId: 'reader' }]
    ] as const

    for (const [principal, crossVariantField] of cases) {
      const valid = backendApplicationFixture()
      valid.auth.roles = [{ id: 'reader', name: 'reader' }]
      valid.auth.tenants = [{ id: 'workspace', entityId: 'notes', tenantFieldId: 'owner_id' }]
      Reflect.set(valid.auth.rowAccess[0], 'principal', principal)
      expect(parseBackendApplicationSpecV1(valid).ok).toBe(true)

      const invalid = structuredClone(valid)
      const invalidPrincipal = {
        ...principal,
        ...crossVariantField
      }
      Reflect.set(invalid.auth.rowAccess[0], 'principal', invalidPrincipal)
      const result = parseBackendApplicationSpecV1(invalid)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        const field = Object.keys(crossVariantField)[0]
        expect(result.diagnostics).toContainEqual({
          code: 'backend-unknown-field',
          severity: 'error',
          path: `$.auth.rowAccess[0].principal.${field}`,
          message: 'Unknown field is not allowed.'
        })
      }
    }
  })

  test('enforces exact keys for all six workflow step variants', () => {
    const cases = [
      [
        {
          id: 'read',
          kind: 'data.read',
          entityId: 'notes',
          resultName: 'notes'
        },
        { method: 'GET' }
      ],
      [
        {
          id: 'mutate',
          kind: 'data.mutate',
          entityId: 'notes',
          operation: 'delete',
          filters: [
            {
              field: 'id',
              operator: 'eq',
              value: { kind: 'expression', expression: 'input' }
            }
          ]
        },
        { url: { kind: 'environment', name: 'API_URL' } }
      ],
      [
        {
          id: 'request',
          kind: 'http.request',
          method: 'GET',
          url: { kind: 'environment', name: 'API_URL' }
        },
        { entityId: 'notes' }
      ],
      [
        {
          id: 'choose',
          kind: 'branch',
          condition: 'input',
          consequent: [],
          alternate: []
        },
        { status: 200 }
      ],
      [{ id: 'respond', kind: 'respond', status: 200 }, { workflowId: 'target' }],
      [{ id: 'call', kind: 'call', workflowId: 'target' }, { method: 'POST' }]
    ] as const

    for (const [step, crossVariantField] of cases) {
      expect(parseBackendApplicationSpecV1(applicationWithWorkflowStep(step)).ok).toBe(true)

      const result = parseBackendApplicationSpecV1(
        applicationWithWorkflowStep({ ...step, ...crossVariantField })
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        const field = Object.keys(crossVariantField)[0]
        expect(result.diagnostics).toContainEqual({
          code: 'backend-unknown-field',
          severity: 'error',
          path: `$.workflows.workflows[0].steps[0].${field}`,
          message: 'Unknown field is not allowed.'
        })
      }
    }
  })

  test('enforces exact keys for both workflow value-source variants', () => {
    const cases = [
      [{ kind: 'expression', expression: 'endpoint' }, { name: 'API_URL' }],
      [{ kind: 'environment', name: 'API_URL' }, { expression: 'endpoint' }]
    ] as const

    for (const [url, crossVariantField] of cases) {
      const step = { id: 'request', kind: 'http.request', method: 'GET', url }
      expect(parseBackendApplicationSpecV1(applicationWithWorkflowStep(step)).ok).toBe(true)

      const result = parseBackendApplicationSpecV1(
        applicationWithWorkflowStep({
          ...step,
          url: { ...url, ...crossVariantField }
        })
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        const field = Object.keys(crossVariantField)[0]
        expect(result.diagnostics).toContainEqual({
          code: 'backend-unknown-field',
          severity: 'error',
          path: `$.workflows.workflows[0].steps[0].url.${field}`,
          message: 'Unknown field is not allowed.'
        })
      }
    }
  })

  test('rejects missing references and managed foreign-key cycles', () => {
    const missing = backendModelFixture()
    missing.entities[0].primaryKey = { fields: ['missing'] }
    const missingResult = validateDataModelIR(missing)
    expect(missingResult.ok).toBe(false)
    if (!missingResult.ok) {
      expect(missingResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-field-reference-missing'
      )
    }

    const cyclic = backendModelFixture()
    cyclic.entities.push({
      id: 'users',
      name: 'users',
      management: 'managed',
      fields: [{ id: 'id', name: 'id', type: 'uuid', nullable: false }],
      primaryKey: { fields: ['id'] },
      foreignKeys: [
        {
          id: 'users_notes_fk',
          fields: ['id'],
          targetEntityId: 'notes',
          targetFields: ['id'],
          onDelete: 'restrict'
        }
      ]
    })
    cyclic.entities[0].foreignKeys = [
      {
        id: 'notes_users_fk',
        fields: ['owner_id'],
        targetEntityId: 'users',
        targetFields: ['id'],
        onDelete: 'restrict'
      }
    ]
    const cyclicResult = validateDataModelIR(cyclic)
    expect(cyclicResult.ok).toBe(false)
    if (!cyclicResult.ok) {
      expect(cyclicResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-foreign-key-cycle'
      )
    }
  })

  test('rejects cyclic/accessor data and client exposure of secret-named variables', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(parseBackendApplicationSpecV1(cyclic).ok).toBe(false)

    const accessor: object = backendApplicationFixture()
    Object.defineProperty(accessor, 'applicationId', {
      get: () => 'unsafe',
      enumerable: true
    })
    const accessorResult = parseBackendApplicationSpecV1(accessor)
    expect(accessorResult.ok).toBe(false)
    if (!accessorResult.ok) {
      expect(accessorResult.diagnostics.map((entry) => entry.code)).toContain('backend-accessor')
    }

    const secret = backendApplicationFixture()
    secret.secrets = [
      {
        kind: 'environment',
        name: 'SERVICE_ROLE_TOKEN',
        exposure: 'client-public',
        required: true
      }
    ]
    expect(parseBackendApplicationSpecV1(secret).ok).toBe(false)
  })

  test('accepts only opaque credential references and never treats credential material as a ref', () => {
    const valid = backendApplicationFixture()
    valid.secrets.push({
      kind: 'credential',
      credentialRef: 'credential.123e4567-e89b-42d3-a456-426614174000',
      name: 'SERVER_CREDENTIAL',
      exposure: 'server',
      required: true
    })
    expect(parseBackendApplicationSpecV1(valid).ok).toBe(true)

    const malformed = backendApplicationFixture()
    Reflect.set(malformed, 'secrets', [
      ...malformed.secrets,
      {
        kind: 'credential',
        credentialRef: 'credential.backend',
        name: 'SERVER_CREDENTIAL',
        exposure: 'server',
        required: true
      }
    ])
    const malformedResult = parseBackendApplicationSpecV1(malformed)
    expect(malformedResult.ok).toBe(false)
    if (!malformedResult.ok) {
      expect(malformedResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-credential-reference-invalid'
      )
    }

    for (const secretCanary of [
      stripeSecretCanary('0123456789abcdefghijklmnopqrstuvwxyz'),
      `credential.${stripeSecretCanary('0123456789abcdefghijklmnopqrstuvwxyz')}`,
      'credential.eyJhbGciOiJIUzI1NiJ9.payload.signature',
      'credential.ghp_0123456789abcdefghijklmnopqrstuvwxyz'
    ]) {
      const invalid = backendApplicationFixture()
      Reflect.set(invalid, 'secrets', [
        ...invalid.secrets,
        {
          kind: 'credential',
          credentialRef: secretCanary,
          name: 'SERVER_CREDENTIAL',
          exposure: 'server',
          required: true
        }
      ])
      const result = parseBackendApplicationSpecV1(invalid)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.diagnostics.map((entry) => entry.code)).toEqual(
          expect.arrayContaining([
            expect.stringMatching(
              /^backend-(?:credential-reference-invalid|secret-material-forbidden)$/u
            )
          ])
        )
        expect(JSON.stringify(result.diagnostics)).not.toContain(secretCanary)
      }
    }
  })

  test('rejects secret-like material across model and workflow value positions', () => {
    const secretCanary = stripeSecretCanary('0123456789abcdefghijklmnopqrstuvwxyz')
    const modelDefault = backendApplicationFixture()
    modelDefault.dataModel.entities[0].fields[2].default = {
      kind: 'literal',
      value: secretCanary
    }
    const sources = [
      modelDefault,
      applicationWithWorkflowStep({
        id: 'request-body',
        kind: 'http.request',
        method: 'POST',
        url: { kind: 'expression', expression: '"https://example.invalid"' },
        body: { kind: 'expression', expression: `"${secretCanary}"` }
      }),
      applicationWithWorkflowStep({
        id: 'request-url',
        kind: 'http.request',
        method: 'GET',
        url: { kind: 'expression', expression: `"${secretCanary}"` }
      }),
      applicationWithWorkflowStep({
        id: 'request-header',
        kind: 'http.request',
        method: 'GET',
        url: { kind: 'environment', name: 'API_URL' },
        headers: [
          {
            name: 'X-Custom',
            value: { kind: 'expression', expression: `"${secretCanary}"` }
          }
        ]
      }),
      applicationWithWorkflowStep({
        id: 'mutate',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'insert',
        values: [
          {
            field: 'title',
            value: { kind: 'expression', expression: `"${secretCanary}"` }
          }
        ]
      })
    ]
    for (const source of sources) {
      const result = parseBackendApplicationSpecV1(source)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.diagnostics.map((entry) => entry.code)).toContain(
          'backend-secret-material-forbidden'
        )
        expect(JSON.stringify(result.diagnostics)).not.toContain(secretCanary)
      }
    }
  })

  test('rejects secret-like object keys without copying them into diagnostics', () => {
    const secretKeyCanary = stripeSecretCanary('objectkeycanary0123456789')
    const source = backendApplicationFixture()
    Reflect.set(source, secretKeyCanary, 'inert-value')

    const result = parseBackendApplicationSpecV1(source)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics.map((entry) => entry.code)).toContain(
        'backend-secret-material-forbidden'
      )
      expect(result.diagnostics.map((entry) => entry.path)).toContain('$')
      expect(JSON.stringify(result)).not.toContain(secretKeyCanary)
    }
  })

  test('rejects unlabeled high-entropy credentials while preserving UUIDs and digests', () => {
    for (const secretCanary of [
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO0B'
    ]) {
      const secretBearing = backendApplicationFixture()
      secretBearing.dataModel.entities[0].fields[2].default = {
        kind: 'literal',
        value: secretCanary
      }
      const rejected = parseBackendApplicationSpecV1(secretBearing)
      expect(rejected.ok).toBe(false)
      if (!rejected.ok) {
        expect(rejected.diagnostics.map((entry) => entry.code)).toContain(
          'backend-secret-material-forbidden'
        )
        expect(JSON.stringify(rejected.diagnostics)).not.toContain(secretCanary)
      }
    }

    const userInfoCanary = 'https://alice:ExamplePass987@example.invalid/api'
    const userInfoResult = parseBackendApplicationSpecV1(
      applicationWithWorkflowStep({
        id: 'request-with-user-info',
        kind: 'http.request',
        method: 'GET',
        url: { kind: 'expression', expression: JSON.stringify(userInfoCanary) }
      })
    )
    expect(userInfoResult.ok).toBe(false)
    if (!userInfoResult.ok) {
      expect(userInfoResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-secret-material-forbidden'
      )
      expect(JSON.stringify(userInfoResult.diagnostics)).not.toContain(userInfoCanary)
    }

    for (const safeValue of [
      '123e4567-e89b-42d3-a456-426614174000',
      'pW9GMbKQAwZGLKfTqjPTyuzT9HCoHMNTx_ezQJTDfYQ',
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO0A',
      'A normal customer-visible label with spaces.'
    ]) {
      const application = backendApplicationFixture()
      application.dataModel.entities[0].fields[2].default = {
        kind: 'literal',
        value: safeValue
      }
      expect(parseBackendApplicationSpecV1(application).ok, safeValue).toBe(true)
    }
  })

  test('rejects non-plain array shapes without invoking item accessors', () => {
    let getterCalls = 0
    const cases: readonly [() => unknown[], string][] = [
      [
        () => {
          const value = [...backendApplicationFixture().capabilities]
          Object.defineProperty(value, '0', {
            enumerable: true,
            get() {
              getterCalls += 1
              return backendApplicationFixture().capabilities[0]
            }
          })
          return value
        },
        'backend-accessor'
      ],
      [
        () => {
          const value: unknown[] = []
          value.length = 1
          return value
        },
        'backend-sparse-array'
      ],
      [
        () => {
          const value = [...backendApplicationFixture().capabilities]
          Object.defineProperty(value, 'metadata', {
            enumerable: true,
            value: 'untrusted'
          })
          return value
        },
        'backend-array-property'
      ],
      [
        () => {
          const value = [...backendApplicationFixture().capabilities]
          Object.defineProperty(value, Symbol('metadata'), {
            enumerable: true,
            value: 'untrusted'
          })
          return value
        },
        'backend-array-property'
      ],
      [
        () => {
          const value = [...backendApplicationFixture().capabilities]
          Object.defineProperty(value, '0', {
            enumerable: false,
            value: value[0]
          })
          return value
        },
        'backend-array-property'
      ],
      [
        () => {
          const value = [...backendApplicationFixture().capabilities]
          Object.setPrototypeOf(value, Object.create(Array.prototype))
          return value
        },
        'backend-invalid-array'
      ]
    ]

    for (const [createCapabilities, code] of cases) {
      const input: unknown = {
        ...backendApplicationFixture(),
        capabilities: createCapabilities()
      }
      const result = parseBackendApplicationSpecV1(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.diagnostics.map((entry) => entry.code)).toContain(code)
    }
    expect(getterCalls).toBe(0)
  })

  test('rejects symbol and non-enumerable object properties without invoking accessors', () => {
    const symbolInput = backendApplicationFixture()
    Object.defineProperty(symbolInput, Symbol('metadata'), {
      enumerable: true,
      value: 'untrusted'
    })
    const symbolResult = parseBackendApplicationSpecV1(symbolInput)
    expect(symbolResult.ok).toBe(false)
    if (!symbolResult.ok) {
      expect(symbolResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-object-property'
      )
    }

    const hiddenCanary = stripeSecretCanary('hiddenkeycanary0123456789')
    const hiddenInput = backendApplicationFixture()
    Object.defineProperty(hiddenInput, hiddenCanary, {
      enumerable: false,
      value: 'untrusted'
    })
    const hiddenResult = parseBackendApplicationSpecV1(hiddenInput)
    expect(hiddenResult.ok).toBe(false)
    if (!hiddenResult.ok) {
      expect(hiddenResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-object-property'
      )
      expect(hiddenResult.diagnostics.map((entry) => entry.path)).toContain('$')
      expect(JSON.stringify(hiddenResult)).not.toContain(hiddenCanary)
    }

    let getterCalls = 0
    const accessorCanary = stripeSecretCanary('accessorkeycanary0123456789')
    const accessorInput = backendApplicationFixture()
    Object.defineProperty(accessorInput, accessorCanary, {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'untrusted'
      }
    })
    const accessorResult = parseBackendApplicationSpecV1(accessorInput)
    expect(accessorResult.ok).toBe(false)
    if (!accessorResult.ok) {
      expect(accessorResult.diagnostics.map((entry) => entry.code)).toContain('backend-accessor')
      expect(accessorResult.diagnostics.map((entry) => entry.path)).toContain('$')
      expect(JSON.stringify(accessorResult)).not.toContain(accessorCanary)
    }
    expect(getterCalls).toBe(0)
  })

  test('does not invoke accessors while selecting principal, step, or value-source variants', () => {
    let getterCalls = 0

    const auth = structuredClone(backendApplicationFixture().auth)
    const discriminatedCanary = stripeSecretCanary('discriminatedkeycanary0123456789')
    Object.defineProperty(auth.rowAccess[0].principal, discriminatedCanary, {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'reader'
      }
    })
    const authContext: BackendValidationContext = { diagnostics: [] }
    expect(parseAuthPolicyIR(auth, '$.auth', backendModelFixture(), authContext)).toBeUndefined()
    expect(authContext.diagnostics.map((entry) => entry.code)).toContain('backend-accessor')
    expect(JSON.stringify(authContext.diagnostics)).not.toContain(discriminatedCanary)

    const dataKeyCanary = stripeSecretCanary('discriminateddatakeycanary0123456789')
    const dataKeyAuth = structuredClone(backendApplicationFixture().auth)
    Reflect.set(dataKeyAuth.rowAccess[0].principal, dataKeyCanary, 'untrusted')
    const dataKeyContext: BackendValidationContext = { diagnostics: [] }
    expect(
      parseAuthPolicyIR(dataKeyAuth, '$.auth', backendModelFixture(), dataKeyContext)
    ).toBeUndefined()
    expect(dataKeyContext.diagnostics).toContainEqual({
      code: 'backend-unknown-field',
      severity: 'error',
      path: '$.auth.rowAccess[0].principal',
      message: 'Unknown field is not allowed.'
    })
    expect(JSON.stringify(dataKeyContext.diagnostics)).not.toContain(dataKeyCanary)

    const step = {
      id: 'read',
      kind: 'data.read',
      entityId: 'notes',
      resultName: 'notes'
    }
    Object.defineProperty(step, 'method', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'GET'
      }
    })
    const stepInput = applicationWithWorkflowStep(step)
    const stepContext: BackendValidationContext = { diagnostics: [] }
    expect(
      parseBackendWorkflowIR(stepInput.workflows, '$.workflows', stepInput.dataModel, stepContext)
    ).toBeUndefined()
    expect(stepContext.diagnostics.map((entry) => entry.code)).toContain('backend-accessor')

    const url = { kind: 'expression', expression: 'endpoint' }
    Object.defineProperty(url, 'name', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'API_URL'
      }
    })
    const valueSourceInput = applicationWithWorkflowStep({
      id: 'request',
      kind: 'http.request',
      method: 'GET',
      url
    })
    const valueSourceContext: BackendValidationContext = { diagnostics: [] }
    expect(
      parseBackendWorkflowIR(
        valueSourceInput.workflows,
        '$.workflows',
        valueSourceInput.dataModel,
        valueSourceContext
      )
    ).toBeUndefined()
    expect(valueSourceContext.diagnostics.map((entry) => entry.code)).toContain('backend-accessor')
    expect(getterCalls).toBe(0)
  })
})
