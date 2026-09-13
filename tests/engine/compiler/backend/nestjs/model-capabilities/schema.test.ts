import { describe, expect, test } from 'bun:test'

import {
  nestJSReadColumn,
  nestJSValidTemporalLiteral
} from '#compiler/backend/nestjs/schema-fields'
import { nestJSConstraintName } from '#compiler/backend/nestjs/schema-names'
import { managedSchema } from '#compiler/managed-preview/schema'

import { planNestJSLocalPreviewMigration } from '@open-pencil/compiler/backend'
import type { BackendApplicationSpecV1, DataFieldIR } from '@open-pencil/lowcode/backend'

import { browserApplication } from '../browser-client/helpers'
import {
  modelFiles,
  modelPlan,
  modelRequired,
  normalizeModelApplication,
  relationalApplication
} from './helpers'

function rejected(application: BackendApplicationSpecV1) {
  const parsed = normalizeModelApplication(application)
  const result = parsed.ok ? modelPlan(parsed.value) : parsed
  expect(result.ok).toBe(false)
  return result.diagnostics
}

function temporalApplication() {
  const application = browserApplication()
  if (!application.httpApi) throw new Error('Expected HTTP API')
  application.dataModel.enums = [
    { id: 'state', name: 'note_state', values: ['draft', 'published'] }
  ]
  const fields: DataFieldIR[] = [
    {
      id: 'state',
      name: 'state',
      type: 'enum',
      enumId: 'state',
      nullable: false,
      default: { kind: 'literal', value: 'draft' }
    },
    { id: 'due', name: 'due', type: 'date', nullable: true },
    { id: 'scheduled', name: 'scheduled', type: 'datetime', nullable: true },
    {
      id: 'created',
      name: 'created',
      type: 'datetime',
      nullable: false,
      default: { kind: 'generated', generator: 'created-at' }
    }
  ]
  application.dataModel.entities[0].fields.push(...fields)
  const resource = application.httpApi.resources[0]
  resource.readFields.push(...fields.map((field) => field.id))
  resource.createFields?.push('state', 'due', 'scheduled')
  resource.updateFields?.push('state', 'due', 'scheduled')
  return application
}

describe('NestJS relational schema and scalar contracts', () => {
  test('emits all tables and unique targets before foreign keys regardless of entity order', () => {
    const application = relationalApplication()
    const files = modelFiles(application)
    const sql = String(files.get('backend/nestjs/migrations/001-initial.sql'))
    expect(sql.indexOf('CREATE TABLE "public"."z_folders"')).toBeLessThan(
      sql.indexOf('FOREIGN KEY')
    )
    expect(sql.indexOf('UNIQUE ("owner_id", "id")')).toBeLessThan(sql.indexOf('FOREIGN KEY'))
    expect(sql).toContain(
      'FOREIGN KEY ("owner_id", "folder_id") REFERENCES "public"."z_folders" ("owner_id", "id") ON DELETE RESTRICT'
    )
    expect(sql).toContain('("owner_id" DESC, "folder_id" DESC)')
    const schema = JSON.parse(String(files.get('backend/nestjs/database-schema.json')))
    expect(schema.relations).toEqual(application.dataModel.relations)
    const service = String(files.get('backend/nestjs/src/resources/notes-api.service.ts'))
    expect(service).toContain('export class Resource')
    expect(service).not.toContain(' JOIN ')
    const reversed = structuredClone(application)
    reversed.dataModel.entities.reverse()
    expect(modelFiles(reversed).get('backend/nestjs/migrations/001-initial.sql')).toBe(sql)
  })

  test('emits enum, canonical date, microsecond timestamp and server-generated creation fields', () => {
    const files = modelFiles(temporalApplication())
    const sql = String(files.get('backend/nestjs/migrations/001-initial.sql'))
    expect(sql.indexOf('CREATE TYPE')).toBeLessThan(sql.indexOf('CREATE TABLE'))
    expect(sql).toContain('CREATE TYPE "public"."note_state" AS ENUM (\'draft\', \'published\')')
    expect(sql).toContain('"due" date')
    expect(sql).toContain('"created" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP')
    const dto = [...files].find(([path]) => path.endsWith('.dto.ts'))?.[1]
    expect(dto).toContain('IsIn(["draft","published"])')
    expect(dto).toContain('IsDateString({ strict: true, strictSeparator: true })')
    expect(dto).toContain('"draft" | "published"')
    const openapi = String(files.get('backend/nestjs/openapi.json'))
    expect(openapi).toContain('"format": "date"')
    expect(openapi).toContain('"format": "date-time"')
    expect(openapi).toContain('"enum": [')
    expect([...files].find(([path]) => path.endsWith('/client.ts'))?.[1]).toContain(
      '"draft" | "published"'
    )
  })

  test('date projections preserve day and full microsecond precision without JavaScript Date conversion', () => {
    expect(nestJSReadColumn({ id: 'due', name: 'due', type: 'date', nullable: true })).toBe(
      'to_char("due", \'YYYY-MM-DD\')'
    )
    expect(nestJSReadColumn({ id: 'at', name: 'at', type: 'datetime', nullable: true })).toContain(
      'HH24:MI:SS.US'
    )
    const timestamp: DataFieldIR = { id: 'at', name: 'at', type: 'datetime', nullable: true }
    expect(nestJSValidTemporalLiteral(timestamp, '2024-02-29T23:59:59.123456+08:00')).toBe(true)
    for (const value of [
      '2023-02-29T23:59:59Z',
      '0000-01-01T00:00:00Z',
      '2024-02-29T23:59:59.1234567Z',
      '2024-02-29T23:59:59'
    ])
      expect(nestJSValidTemporalLiteral(timestamp, value)).toBe(false)
  })

  test('blocks references to private records without the same-owner tuple', () => {
    const application = relationalApplication()
    const fk = modelRequired(application.dataModel.entities[0].foreignKeys)[0]
    fk.fields = ['folder_id']
    fk.targetFields = ['id']
    expect(
      rejected(application).some((entry) =>
        entry.message.includes('matching source and target owner')
      )
    ).toBe(true)
  })

  test('permits a declared public-read target without pretending it is same-owner', () => {
    const application = relationalApplication()
    const fk = modelRequired(application.dataModel.entities[0].foreignKeys)[0]
    fk.fields = ['folder_id']
    fk.targetFields = ['id']
    application.auth.rowAccess.push({
      id: 'folders-public',
      entityId: 'folders',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'anonymous' }
    })
    expect(
      String(modelFiles(application).get('backend/nestjs/migrations/001-initial.sql'))
    ).toContain('FOREIGN KEY ("folder_id")')
  })

  test('public target does not expose hidden unique fields through foreign-key existence checks', () => {
    const application = relationalApplication()
    const child = application.dataModel.entities[0]
    child.fields.push({ id: 'folder_name', name: 'folder_name', type: 'string', nullable: true })
    modelRequired(child.foreignKeys)[0].fields = ['folder_name']
    modelRequired(child.foreignKeys)[0].targetFields = ['title']
    application.dataModel.entities[1].uniques = [{ id: 'hidden-title', fields: ['title'] }]
    modelRequired(application.httpApi).resources[1].readFields = ['id']
    application.auth.rowAccess.push({
      id: 'folders-public',
      entityId: 'folders',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'anonymous' }
    })
    expect(
      rejected(application).some((entry) => entry.message.includes('public-readable HTTP resource'))
    ).toBe(true)
  })

  test.each(['cascade', 'set-null'] as const)(
    'rejects implicit related-row mutation %s',
    (onDelete) => {
      const application = relationalApplication()
      modelRequired(application.dataModel.entities[0].foreignKeys)[0].onDelete = onDelete
      expect(rejected(application).length).toBeGreaterThan(0)
    }
  )

  test('rejects wrong types, non-unique targets and relation metadata without a real foreign key', () => {
    for (const mutate of [
      (application: BackendApplicationSpecV1) => {
        modelRequired(
          application.dataModel.entities[0].fields.find((field) => field.id === 'folder_id')
        ).type = 'string'
      },
      (application: BackendApplicationSpecV1) => {
        application.dataModel.entities[1].uniques = []
      },
      (application: BackendApplicationSpecV1) => {
        application.dataModel.relations[0].sourceForeignKeyId = 'missing'
      }
    ]) {
      const application = relationalApplication()
      mutate(application)
      expect(rejected(application).length).toBeGreaterThan(0)
    }
  })

  test('keeps hashed constraint names stable and rejects collisions with authored SQL names', () => {
    const application = relationalApplication()
    const child = application.dataModel.entities[0]
    const name = nestJSConstraintName(child, 'idx', modelRequired(child.indexes)[0].id)
    expect(name.length).toBeLessThanOrEqual(63)
    application.dataModel.entities[1].name = name
    expect(rejected(application).some((entry) => entry.message.includes('relation names'))).toBe(
      true
    )
    const enums = temporalApplication()
    enums.dataModel.enums[0].name = enums.dataModel.entities[0].name
    expect(rejected(enums).length).toBeGreaterThan(0)
  })

  test('managed initial schema projects actual indexes, foreign keys, uniqueness and enums', () => {
    const schema = managedSchema(relationalApplication())
    expect(schema[0].catalog?.constraints.some((entry) => entry.kind === 'f')).toBe(true)
    expect(schema[1].catalog?.constraints.some((entry) => entry.kind === 'u')).toBe(true)
    expect(schema[0].catalog?.indexes.find((entry) => entry.options[0] === 3)?.columns).toEqual([
      'owner_id',
      'folder_id'
    ])
    expect(managedSchema(temporalApplication())[0].catalog?.enums).toEqual([
      { name: 'note_state', labels: ['draft', 'published'] }
    ])
    expect(managedSchema(browserApplication())[0]).not.toHaveProperty('catalog')
  })

  test('rebuilds existing relational models but refuses unsupported schema changes without producing SQL', async () => {
    const application = relationalApplication()
    const same = await planNestJSLocalPreviewMigration({
      fromApplication: application,
      toApplication: structuredClone(application)
    })
    expect(same.ok).toBe(true)
    if (same.ok) expect(same.plan.sql).toBe('')
    const changed = structuredClone(application)
    changed.dataModel.entities[0].fields.push({
      id: 'extra',
      name: 'extra',
      type: 'string',
      nullable: true
    })
    const result = await planNestJSLocalPreviewMigration({
      fromApplication: application,
      toApplication: changed
    })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(
        result.diagnostics.some(
          (entry) => entry.code === 'backend-local-migration-relational-schema-change-blocked'
        )
      ).toBe(true)
    expect(result).not.toHaveProperty('plan')
  })
})
