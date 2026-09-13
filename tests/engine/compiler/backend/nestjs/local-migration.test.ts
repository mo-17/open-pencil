import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  nestJSLocalPreviewMigrationSQLDigest,
  nestJSPreviewApplicationDigest,
  planNestJSLocalPreviewMigration,
  type NestJSLocalPreviewMigrationPlan,
  type NestJSLocalPreviewMigrationResult
} from '@open-pencil/compiler/backend'
import {
  planBackendMigration,
  type BackendApplicationSpecV1,
  type DataFieldIR
} from '@open-pencil/lowcode/backend'

import { browserApplication } from './browser-client/helpers'

function fixture() {
  const from = browserApplication()
  return { from, to: structuredClone(from) }
}

function api(application: BackendApplicationSpecV1) {
  if (!application.httpApi) throw new Error('Fixture needs HTTP API')
  return application.httpApi
}

function addField(application: BackendApplicationSpecV1, field: DataFieldIR) {
  application.dataModel.entities[0].fields.push(field)
}

function addEntity(application: BackendApplicationSpecV1, id = 'folders') {
  const entity = structuredClone(application.dataModel.entities[0])
  entity.id = id
  entity.name = id
  application.dataModel.entities.push(entity)
  const owner = structuredClone(application.auth.ownership[0])
  owner.id = id + '-owner'
  owner.entityId = id
  application.auth.ownership.push(owner)
  const policy = structuredClone(application.auth.rowAccess[0])
  policy.id = id + '-access'
  policy.entityId = id
  policy.principal = { kind: 'owner', ownershipId: owner.id }
  application.auth.rowAccess.push(policy)
  const resource = structuredClone(api(application).resources[0])
  resource.id = id + '-api'
  resource.path = '/' + id
  resource.entityId = id
  api(application).resources.push(resource)
}

async function plan(
  from: BackendApplicationSpecV1,
  to: BackendApplicationSpecV1
): Promise<NestJSLocalPreviewMigrationPlan> {
  const result = await planNestJSLocalPreviewMigration({ fromApplication: from, toApplication: to })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.plan
}

function expectBlocked(result: NestJSLocalPreviewMigrationResult, code?: string) {
  expect(result.ok).toBe(false)
  expect('plan' in result).toBe(false)
  if (!result.ok && code) expect(result.diagnostics.some((entry) => entry.code === code)).toBe(true)
}

describe('pure managed local NestJS migration planning', () => {
  test('makes schema no-op/runtime-only changes explicit without a SQL approval', async () => {
    const { from, to } = fixture()
    const browser = api(to).browserClient
    if (!browser) throw new Error('Missing browser client')
    browser.authentication.clientId = 'updated-public-client'
    const result = await plan(from, to)
    expect(result.sql).toBe('')
    expect(result.operations).toEqual([])
    expect(result.requiresReview).toBe(false)
    expect(result.schemaChanged).toBe(false)
    expect(result.fromModelDigest).toBe(result.toModelDigest)
    expect(result.fromApplicationDigest).not.toBe(result.toApplicationDigest)
    expect(result.scope).toBe('owned-local-preview')
    expect(result.transactionRequired).toBe(true)
  })

  test.each([
    { id: 'subtitle', name: 'subtitle', type: 'string', nullable: true },
    {
      id: 'archived',
      name: 'archived',
      type: 'boolean',
      nullable: false,
      default: { kind: 'literal', value: false }
    },
    {
      id: 'priority',
      name: 'priority',
      type: 'integer',
      nullable: false,
      default: { kind: 'literal', value: 0 }
    },
    {
      id: 'rating',
      name: 'rating',
      type: 'number',
      nullable: false,
      default: { kind: 'literal', value: 1.5 }
    },
    {
      id: 'summary',
      name: 'summary',
      type: 'string',
      nullable: false,
      default: { kind: 'literal', value: '' }
    }
  ] satisfies DataFieldIR[])(
    'adds the compatible $name column while retaining prior rows',
    async (field) => {
      const { from, to } = fixture()
      addField(to, field)
      const result = await plan(from, to)
      expect(result.operations).toHaveLength(1)
      expect(result.operations[0].kind).toBe('add-field')
      expect(result.sql).toContain('ALTER TABLE "public"."notes" ADD COLUMN "' + field.name + '"')
      expect(result.sql.startsWith('SET LOCAL standard_conforming_strings = on;')).toBe(true)
      expect(result.requiresReview).toBe(true)
      expect(result.highestRisk).toBe('default' in field ? 'medium' : 'low')
      expect(result.sql).not.toContain('DROP ')
    }
  )

  test('adds a complete owned table with its paging index', async () => {
    const { from, to } = fixture()
    addEntity(to)
    const result = await plan(from, to)
    expect(result.operations.map((entry) => entry.kind)).toEqual(['create-entity'])
    expect(result.sql).toContain('CREATE TABLE "public"."folders"')
    expect(result.sql).toContain(
      'CREATE INDEX "folders_owner_page_idx" ON "public"."folders" ("owner_id", "id");'
    )
    expect(result.sql).toContain('PRIMARY KEY ("id")')
    expect(result.sql).not.toContain('"public"."notes"')
  })

  test('renames stable-ID tables and columns without copying or dropping data', async () => {
    const { from, to } = fixture()
    to.dataModel.entities[0].name = 'personal_notes'
    const title = to.dataModel.entities[0].fields.find((field) => field.id === 'title')
    if (!title) throw new Error('Missing title')
    title.name = 'heading'
    const result = await plan(from, to)
    expect(result.operations.map((entry) => entry.kind)).toEqual(['rename-entity', 'rename-field'])
    expect(result.sql).toContain('ALTER TABLE "public"."notes" RENAME TO "personal_notes";')
    expect(result.sql).toContain(
      'ALTER TABLE "public"."personal_notes" RENAME CONSTRAINT "notes_pkey" TO "personal_notes_pkey";'
    )
    expect(result.sql).toContain(
      'ALTER INDEX "public"."notes_owner_page_idx" RENAME TO "personal_notes_owner_page_idx";'
    )
    expect(result.sql).toContain(
      'ALTER TABLE "public"."personal_notes" RENAME COLUMN "title" TO "heading";'
    )
    expect(result.sql).not.toMatch(/\b(?:DROP|DELETE|INSERT|UPDATE)\b/u)
    expect(result.highestRisk).toBe('medium')
  })

  test('hashes exact SQL bytes, freezes plans, and stays deterministic across input ordering', async () => {
    const { from, to } = fixture()
    addField(to, {
      id: 'caption',
      name: 'caption',
      type: 'string',
      nullable: false,
      default: { kind: 'literal', value: "'); DROP TABLE notes; --\\" }
    })
    const result = await plan(from, to)
    expect(result.sqlDigest).toBe(createHash('sha256').update(result.sql).digest('base64url'))
    expect(result.sqlDigest).toBe(nestJSLocalPreviewMigrationSQLDigest(result.sql))
    expect(nestJSLocalPreviewMigrationSQLDigest(result.sql + '\n')).not.toBe(result.sqlDigest)
    expect(result.sql).toContain("DEFAULT '''); DROP TABLE notes; --\\';")
    expect(result.fromApplicationDigest).toBe(nestJSPreviewApplicationDigest(from))
    expect(result.toApplicationDigest).toBe(nestJSPreviewApplicationDigest(to))
    expect(Object.isFrozen(result.operations[0])).toBe(true)
    expect(Object.isFrozen(result)).toBe(true)
    from.dataModel.entities[0].fields.reverse()
    to.dataModel.entities[0].fields.reverse()
    expect(await plan(from, to)).toEqual(result)
  })

  test('keeps stable primary-key and owner bindings when their SQL columns are renamed', async () => {
    const { from, to } = fixture()
    for (const field of to.dataModel.entities[0].fields) {
      if (field.id === 'id') field.name = 'note_key'
      if (field.id === 'owner_id') field.name = 'author_key'
    }
    const result = await plan(from, to)
    expect(result.operations.map((entry) => entry.kind)).toEqual(['rename-field', 'rename-field'])
    expect(result.sql).toContain('RENAME COLUMN "id" TO "note_key";')
    expect(result.sql).toContain('RENAME COLUMN "owner_id" TO "author_key";')
    expect(result.sql).not.toContain('DROP ')
    expect(result.requiresReview).toBe(true)
  })

  test('refuses oversized escaped SQL without returning a partial plan', async () => {
    const { from, to } = fixture()
    for (let index = 0; index < 140; index++) {
      addField(to, {
        id: 'caption_' + index,
        name: 'caption_' + index,
        type: 'string',
        nullable: true,
        default: { kind: 'literal', value: "'".repeat(1024) }
      })
    }
    expectBlocked(
      await planNestJSLocalPreviewMigration({ fromApplication: from, toApplication: to }),
      'backend-local-migration-plan-unavailable'
    )
  })

  test('does not weaken shared migration risk classification', async () => {
    const { from, to } = fixture()
    addField(to, {
      id: 'subtitle',
      name: 'subtitle',
      type: 'string',
      nullable: false,
      default: { kind: 'literal', value: '' }
    })
    expect((await planBackendMigration(from.dataModel, to.dataModel)).highestRisk).toBe('high')
    expect((await plan(from, to)).highestRisk).toBe('medium')
    expect((await planBackendMigration(from.dataModel, to.dataModel)).highestRisk).toBe('high')
  })

  test.each(['drop-field', 'type', 'nullable', 'default', 'required-field'] as const)(
    'blocks %s without partial SQL',
    async (change) => {
      const { from, to } = fixture()
      const title = to.dataModel.entities[0].fields.find((field) => field.id === 'title')
      if (!title) throw new Error('Missing title')
      if (change === 'drop-field')
        addField(from, { id: 'old', name: 'old', type: 'string', nullable: true })
      if (change === 'type') title.type = 'integer'
      if (change === 'nullable') title.nullable = true
      if (change === 'default') title.default = { kind: 'literal', value: 'changed' }
      if (change === 'required-field') {
        addField(to, { id: 'required', name: 'required', type: 'string', nullable: false })
        api(to).resources[0].createFields?.push('required')
      }
      expectBlocked(
        await planNestJSLocalPreviewMigration({ fromApplication: from, toApplication: to }),
        'backend-local-migration-operation-blocked'
      )
    }
  )

  test('blocks table drops and source application adoption', async () => {
    const { from, to } = fixture()
    addEntity(from)
    expectBlocked(
      await planNestJSLocalPreviewMigration({ fromApplication: from, toApplication: to }),
      'backend-local-migration-operation-blocked'
    )
    to.applicationId = 'another-application'
    expectBlocked(
      await planNestJSLocalPreviewMigration({ fromApplication: from, toApplication: to }),
      'backend-local-migration-application-mismatch'
    )
  })

  test('blocks owner and primary key identity changes', async () => {
    const { from } = fixture()
    addField(from, { id: 'backup_owner', name: 'backup_owner', type: 'uuid', nullable: false })
    api(from).resources[0].createFields?.push('backup_owner')
    const to = structuredClone(from)
    to.auth.ownership[0].identityFieldId = 'backup_owner'
    api(to).resources[0].createFields = ['title', 'owner_id']
    expectBlocked(
      await planNestJSLocalPreviewMigration({ fromApplication: from, toApplication: to }),
      'backend-local-migration-ownership-change-blocked'
    )
    const changedKey = structuredClone(from)
    const id = changedKey.dataModel.entities[0].fields.find((field) => field.id === 'id')
    if (!id) throw new Error('Missing key')
    delete id.default
    addField(changedKey, {
      id: 'new_id',
      name: 'new_id',
      type: 'uuid',
      nullable: false,
      default: { kind: 'generated', generator: 'uuid' }
    })
    changedKey.dataModel.entities[0].primaryKey = { fields: ['new_id'] }
    api(changedKey).resources[0].readFields.unshift('new_id')
    api(changedKey).resources[0].createFields?.push('id')
    expectBlocked(
      await planNestJSLocalPreviewMigration({ fromApplication: from, toApplication: changedKey })
    )
  })

  test.each(['notes_pkey', 'notes_owner_page_idx'] as const)(
    'blocks renaming a table onto its own %s relation',
    async (name) => {
      const { from, to } = fixture()
      to.dataModel.entities[0].name = name
      expectBlocked(
        await planNestJSLocalPreviewMigration({ fromApplication: from, toApplication: to }),
        'backend-local-migration-name-reuse-unsupported'
      )
    }
  )

  test('blocks column name swaps while stable IDs remain unchanged', async () => {
    const { from } = fixture()
    addField(from, { id: 'subtitle', name: 'subtitle', type: 'string', nullable: true })
    const to = structuredClone(from)
    for (const field of to.dataModel.entities[0].fields) {
      if (field.id === 'title') field.name = 'subtitle'
      if (field.id === 'subtitle') field.name = 'title'
    }
    expectBlocked(
      await planNestJSLocalPreviewMigration({ fromApplication: from, toApplication: to }),
      'backend-local-migration-name-reuse-unsupported'
    )
  })

  test('rejects injected top-level fields and getters without reading them', async () => {
    const { from, to } = fixture()
    const input = { fromApplication: from, toApplication: to }
    Object.assign(input, { sql: 'DROP TABLE notes' })
    expectBlocked(
      await planNestJSLocalPreviewMigration(input),
      'backend-local-migration-input-invalid'
    )
    let reads = 0
    const accessor = { fromApplication: from, toApplication: to }
    Object.defineProperty(accessor, 'fromApplication', {
      get: () => {
        reads++
        return from
      },
      enumerable: true
    })
    expectBlocked(
      await planNestJSLocalPreviewMigration(accessor),
      'backend-local-migration-input-invalid'
    )
    expect(reads).toBe(0)
  })
})
