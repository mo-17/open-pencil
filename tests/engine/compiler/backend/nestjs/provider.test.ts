import { describe, expect, test } from 'bun:test'

import type { CompilerTarget } from '@open-pencil/compiler'
import {
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  backendProviderPlanDigest,
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan,
  type BackendCompilationMode,
  type BackendProviderPlan,
  type BackendProviderSelection
} from '@open-pencil/compiler/backend'
import {
  deriveBackendApplicationCapabilities,
  digestBackendApplication,
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1,
  type DataFieldIR
} from '@open-pencil/lowcode/backend'

import { nestJSApplication } from './helpers'

function selection(): BackendProviderSelection {
  return {
    descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
    packageDigest: `sha256:${'A'.repeat(43)}`,
    enabled: true
  }
}
function api(application: BackendApplicationSpecV1) {
  if (!application.httpApi) throw new Error('Expected explicit HTTP API fixture')
  return application.httpApi
}
function field(application: BackendApplicationSpecV1, id: string) {
  const result = application.dataModel.entities[0].fields.find((entry) => entry.id === id)
  if (!result) throw new Error('Expected fixture field')
  return result
}
function fullApplication() {
  const application = structuredClone(nestJSApplication())
  const resource = api(application).resources[0]
  resource.operations = ['list', 'read', 'create', 'update', 'delete']
  resource.createFields = ['title']
  resource.updateFields = ['title']
  application.auth.rowAccess[0].operations = ['select', 'insert', 'update', 'delete']
  application.capabilities.push({ capability: 'data.write', required: true })
  return application
}
function normalized(application: BackendApplicationSpecV1) {
  application.capabilities = deriveBackendApplicationCapabilities(application).map(
    (capability) => ({ capability, required: true })
  )
  const parsed = parseBackendApplicationSpecV1(application)
  expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
  if (!parsed.ok) throw new Error('The rejection fixture must be valid shared Backend IR')
  return parsed.value
}
function plan(
  application = fullApplication(),
  target: CompilerTarget = 'react',
  mode: BackendCompilationMode = 'production'
) {
  return createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
    application,
    selection: selection(),
    target,
    mode
  })
}

function acceptedPlan(application = fullApplication()) {
  const result = plan(application)
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
  if (!result.ok) throw new Error('Expected a supported NestJS provider plan')
  return result.plan
}

function emit(source: BackendProviderPlan, occupiedPaths: readonly string[] = []) {
  return emitBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
    plan: source,
    selection: selection(),
    occupiedPaths
  })
}

function acceptedEmission(source: BackendProviderPlan) {
  const result = emit(source)
  expect(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics)).toBe(true)
  if (!result.ok) throw new Error('Expected complete NestJS source artifacts')
  return result.emission
}

function addReferencedEntity(application: BackendApplicationSpecV1): void {
  const entity = structuredClone(application.dataModel.entities[0])
  entity.id = 'archives'
  entity.name = 'archives'
  application.dataModel.entities.push(entity)
  application.auth.ownership.push({
    id: 'archive-owner',
    entityId: 'archives',
    identityFieldId: 'owner_id'
  })
  application.auth.rowAccess.push({
    ...structuredClone(application.auth.rowAccess[0]),
    id: 'archive-access',
    entityId: 'archives',
    principal: { kind: 'owner', ownershipId: 'archive-owner' }
  })
  api(application).resources.push({
    ...structuredClone(api(application).resources[0]),
    id: 'archives-api',
    path: '/archives',
    entityId: 'archives'
  })
  application.dataModel.entities[0].foreignKeys = [
    {
      id: 'archive-reference',
      fields: ['owner_id'],
      targetEntityId: 'archives',
      targetFields: ['id'],
      onDelete: 'restrict'
    }
  ]
}

type Mutation = (application: BackendApplicationSpecV1) => void

const UNSUPPORTED_MODEL: [string, Mutation][] = [
  [
    'missing owner',
    (application) => {
      application.auth.ownership = []
      application.auth.rowAccess = []
    }
  ],
  [
    'duplicate owner',
    (application) => {
      application.auth.ownership.push({ ...application.auth.ownership[0], id: 'other-owner' })
    }
  ],
  [
    'nullable owner',
    (application) => {
      field(application, 'owner_id').nullable = true
    }
  ],
  [
    'non-UUID owner',
    (application) => {
      field(application, 'owner_id').type = 'boolean'
    }
  ],
  [
    'owner default',
    (application) => {
      field(application, 'owner_id').default = {
        kind: 'literal',
        value: '11111111-1111-4111-8111-111111111111'
      }
    }
  ],
  [
    'missing generated primary key',
    (application) => {
      Reflect.deleteProperty(field(application, 'id'), 'default')
    }
  ],
  [
    'literal primary key default',
    (application) => {
      field(application, 'id').default = {
        kind: 'literal',
        value: '11111111-1111-4111-8111-111111111111'
      }
    }
  ],
  [
    'generated non-key field',
    (application) => {
      field(application, 'title').type = 'uuid'
      field(application, 'title').default = { kind: 'generated', generator: 'uuid' }
      api(application).resources[0].createFields = ['extra']
      api(application).resources[0].updateFields = ['extra']
      application.dataModel.entities[0].fields.push({
        id: 'extra',
        name: 'extra',
        type: 'string',
        nullable: true
      })
    }
  ],
  [
    'missing required create projection',
    (application) => {
      application.dataModel.entities[0].fields.push({
        id: 'extra',
        name: 'extra',
        type: 'string',
        nullable: false
      })
    }
  ],
  [
    'external table',
    (application) => {
      application.dataModel.entities.push({
        id: 'external',
        name: 'external',
        management: 'external',
        fields: []
      })
    }
  ],
  [
    'uppercase SQL table',
    (application) => {
      application.dataModel.entities[0].name = 'Notes'
    }
  ],
  [
    'reserved DTO field',
    (application) => {
      field(application, 'title').id = 'constructor'
      api(application).resources[0].readFields = ['id']
      api(application).resources[0].createFields = ['constructor']
      api(application).resources[0].updateFields = ['constructor']
    }
  ],
  [
    'large int default',
    (application) => {
      application.dataModel.entities[0].fields.push({
        id: 'count',
        name: 'count',
        type: 'integer',
        nullable: false,
        default: { kind: 'literal', value: 2147483648 }
      })
    }
  ],

  ['foreign key', addReferencedEntity],
  [
    'relation',
    (application) => {
      addReferencedEntity(application)
      application.dataModel.relations.push({
        id: 'archives-notes',
        kind: 'one-to-many',
        sourceEntityId: 'notes',
        targetEntityId: 'archives',
        sourceForeignKeyId: 'archive-reference'
      })
    }
  ],
  [
    'unexposed entity',
    (application) => {
      addReferencedEntity(application)
      Reflect.deleteProperty(application.dataModel.entities[0], 'foreignKeys')
      api(application).resources.pop()
    }
  ]
]

const UNSUPPORTED_AUTHORITY: [string, Mutation][] = [
  [
    'missing owner allow',
    (application) => {
      application.auth.rowAccess = []
    }
  ],
  [
    'missing delete allow',
    (application) => {
      application.auth.rowAccess[0].operations = ['select', 'insert', 'update']
    }
  ],
  [
    'deny owner',
    (application) => {
      application.auth.rowAccess[0].effect = 'deny'
    }
  ],
  [
    'broad authenticated allow',
    (application) => {
      application.auth.rowAccess[0].principal = { kind: 'authenticated' }
    }
  ],
  [
    'anonymous allow',
    (application) => {
      application.auth.rowAccess[0].principal = { kind: 'anonymous' }
    }
  ],
  [
    'additional service identity',
    (application) => {
      application.auth.identities.push({ id: 'worker', kind: 'service' })
    }
  ],

  [
    'tenant declaration',
    (application) => {
      application.auth.tenants.push({ id: 'tenant', entityId: 'notes', tenantFieldId: 'owner_id' })
    }
  ],
  [
    'additional environment',
    (application) => {
      application.secrets.push({
        kind: 'environment',
        name: 'EXTRA_VALUE',
        exposure: 'server',
        required: true
      })
    }
  ],
  [
    'shared JWT environments',
    (application) => {
      api(application).authentication.audienceEnvironment =
        api(application).authentication.issuerEnvironment
      application.secrets = application.secrets.filter((entry) => entry.name !== 'JWT_AUDIENCE')
    }
  ],
  [
    'reserved HOST environment',
    (application) => {
      api(application).authentication.issuerEnvironment = 'HOST'
      application.secrets = application.secrets.filter((entry) => entry.name !== 'JWT_ISSUER')
      application.secrets.push({
        kind: 'environment',
        name: 'HOST',
        exposure: 'server',
        required: true
      })
    }
  ],
  [
    'optional database environment',
    (application) => {
      const database = application.secrets.find((entry) => entry.name === 'DATABASE_URL')
      if (!database) throw new Error('Expected database environment')
      database.required = false
    }
  ],
  [
    'client-public database environment',
    (application) => {
      const database = application.secrets.find((entry) => entry.name === 'DATABASE_URL')
      if (!database) throw new Error('Expected database environment')
      database.exposure = 'client-public'
    }
  ],
  [
    'workflow',
    (application) => {
      application.workflows.workflows.push({
        id: 'respond',
        name: 'Respond',
        trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
        parameters: [],
        steps: [{ id: 'response', kind: 'respond', status: 204 }]
      })
    }
  ],
  [
    'empty storage declaration',
    (application) => {
      application.storage = { version: 1, buckets: [] }
    }
  ]
]

describe('NestJS provider supported subset and artifact replay', () => {
  test('emits deterministic complete CRUD artifacts with exact normalized bindings', () => {
    const firstPlan = acceptedPlan()
    const first = acceptedEmission(firstPlan)
    const second = acceptedEmission(acceptedPlan())
    expect([...first.files]).toEqual([...second.files])
    expect(first.manifestDigest).toBe(second.manifestDigest)
    expect(first.manifest).toMatchObject({
      applicationDigest: firstPlan.applicationDigest,
      planDigest: firstPlan.planDigest,
      authority: { providerId: 'nestjs', packageDigest: selection().packageDigest },
      target: 'react',
      mode: 'production'
    })
    expect(first.manifest.requiredSecrets).toHaveLength(4)
    for (const name of [
      'package.json',
      'src/main.ts',
      'src/auth.guard.ts',
      'src/database.service.ts',
      'src/resources/notes-api.controller.ts',
      'src/resources/notes-api.dto.ts',
      'migrations/001-initial.sql',
      'openapi.json',
      'client.ts'
    ]) {
      expect(first.files.has('backend/nestjs/' + name), name).toBe(true)
    }
    const service = first.files.get('backend/nestjs/src/resources/notes-api.service.ts')
    if (typeof service !== 'string') throw new Error('Expected generated resource service')
    for (const method of ['list', 'read', 'create', 'update', 'delete']) {
      expect(service).toContain('async ' + method + '(')
    }
  })

  test.each(UNSUPPORTED_MODEL)('rejects shared-IR-valid model: %s', (_label, mutate) => {
    const application = fullApplication()
    mutate(application)
    const result = plan(normalized(application))
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-nestjs-unsupported', severity: 'error' })
    )
  })

  test.each(UNSUPPORTED_AUTHORITY)('rejects shared-IR-valid authority: %s', (_label, mutate) => {
    const application = fullApplication()
    mutate(application)
    const result = plan(normalized(application))
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((entry) => entry.severity === 'error')).toBe(true)
  })

  test.each(['json', 'bytes'] as const)(
    'rejects unsupported %s fields without omitting them',
    (type) => {
      const application = fullApplication()
      field(application, 'title').type = type
      const result = plan(normalized(application))
      expect(result.ok).toBe(false)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'backend-nestjs-unsupported' })
      )
    }
  )

  test.each(['notes:api', 'Notes', 'a'.repeat(49), 'con', 'nul', 'com1'])(
    'rejects nonportable resource filename %s during planning',
    (id) => {
      const application = fullApplication()
      api(application).resources[0].id = id
      const result = plan(normalized(application))
      expect(result.ok).toBe(false)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'backend-nestjs-unsupported' })
      )
    }
  )

  test('accepts closed scalar fields and valid literal/default omission semantics', () => {
    const application = fullApplication()
    const additions: DataFieldIR[] = [
      {
        id: 'count',
        name: 'count',
        type: 'integer',
        nullable: false,
        default: { kind: 'literal', value: -2147483648 }
      },
      {
        id: 'rating',
        name: 'rating',
        type: 'number',
        nullable: false,
        default: { kind: 'literal', value: 0.5 }
      },
      {
        id: 'published',
        name: 'published',
        type: 'boolean',
        nullable: false,
        default: { kind: 'literal', value: false }
      },
      {
        id: 'description',
        name: 'description',
        type: 'string',
        nullable: true,
        default: { kind: 'literal', value: null }
      },
      { id: 'reference', name: 'reference', type: 'uuid', nullable: true }
    ]
    application.dataModel.entities[0].fields.push(...additions)
    const resource = api(application).resources[0]
    resource.readFields.push(...additions.map((entry) => entry.id))
    resource.updateFields = ['title', ...additions.map((entry) => entry.id)]
    acceptedEmission(acceptedPlan(normalized(application)))
  })

  test('rejects absent HTTP API without synthesizing a default endpoint', () => {
    const application = fullApplication()
    Reflect.deleteProperty(application, 'httpApi')
    const result = plan(normalized(application))
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-nestjs-unsupported' })
    )
  })

  test.each(['preview', 'source-only-prototype'] as const)(
    'rejects %s for the full CRUD application',
    (mode) => {
      expect(plan(fullApplication(), 'react', mode).ok).toBe(false)
    }
  )

  test.each(['expo', 'flutter', 'wechat-miniprogram', 'taro', 'uni-app', 'mpx'] as const)(
    'rejects %s server integration',
    (target) => {
      expect(plan(fullApplication(), target).ok).toBe(false)
    }
  )

  test.each(['backend/nestjs/src/main.ts', 'BACKEND/NESTJS/SRC/MAIN.TS'])(
    'rejects occupied output %s',
    (path) => {
      const result = emit(acceptedPlan(), [path])
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('An occupied artifact must not be overwritten')
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'backend-artifact-path-conflict' })
      )
    }
  )

  test('rejects recomputed application and adapter-plan tampering', async () => {
    const original = acceptedPlan()
    const modifiedApplication = { ...original, application: structuredClone(original.application) }
    modifiedApplication.application.auth.rowAccess = []
    modifiedApplication.applicationDigest = await digestBackendApplication(
      modifiedApplication.application
    )
    modifiedApplication.planDigest = backendProviderPlanDigest(modifiedApplication)
    expect(emit(modifiedApplication).ok).toBe(false)
    const modifiedAdapter: BackendProviderPlan = {
      ...original,
      adapterPlans: {
        ...original.adapterPlans,
        server: { format: 'forged', paths: ['backend/nestjs/src/unguarded.ts'] }
      }
    }
    const result = emit({
      ...modifiedAdapter,
      planDigest: backendProviderPlanDigest(modifiedAdapter)
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Recomputed unreviewed adapter plans must be rejected')
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-provider-plan-stale' })
    )
  })

  test('keeps Supabase HTTP declarations blocked', () => {
    const result = createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
      selection: { ...selection(), descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR },
      application: fullApplication(),
      target: 'react',
      mode: 'production'
    })
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-http-api-provider-unimplemented' })
    )
  })
})
