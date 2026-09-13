import { describe, expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { MANAGED_CATALOG_SOURCE } from '#compiler/backend/nestjs/local-run/managed/catalog'
import { managedSchema } from '#compiler/managed-preview/schema'

import { modelRequired, relationalApplication } from '../backend/nestjs/model-capabilities/helpers'

type CatalogRows = Record<string, unknown>[]

function fixture() {
  const application = relationalApplication()
  application.dataModel.enums.push({ id: 'state', name: 'state', values: ['draft', 'published'] })
  const schema = managedSchema(application)
  const enums: CatalogRows = [
    { name: 'state', kind: 'e', owner: 'openpencil_admin', labels: ['draft', 'published'] }
  ]
  const constraints: CatalogRows = schema.flatMap((table) =>
    modelRequired(table.catalog).constraints.map((entry) => ({
      table_name: table.name,
      name: entry.name,
      kind: entry.kind,
      columns: entry.columns,
      target_table: 'targetTable' in entry ? entry.targetTable : '',
      target_schema: entry.kind === 'f' ? 'public' : '',
      target_columns: 'targetColumns' in entry ? entry.targetColumns : [],
      delete_action: 'deleteAction' in entry ? entry.deleteAction : ' ',
      update_action: entry.kind === 'f' ? 'a' : ' ',
      match_type: entry.kind === 'f' ? 's' : ' ',
      deferrable: false,
      deferred: false,
      validated: true
    }))
  )
  const indexes: CatalogRows = schema.flatMap((table) =>
    modelRequired(table.catalog).indexes.map((entry) => ({
      table_name: table.name,
      name: entry.name,
      method: 'btree',
      columns: entry.columns,
      options: entry.options,
      is_unique: entry.unique,
      is_primary: entry.primary,
      valid: true,
      ready: true,
      no_include: true,
      no_predicate: true,
      no_expression: true,
      distinct_nulls: true,
      immediate: true,
      default_opclass: true
    }))
  )
  return { schema, enums, constraints, indexes }
}

const inspect = runInNewContext(
  `(async (client, schema) => {
  function fail(message) { throw new Error(message) }
  function exact(actual, expected) {
    if (JSON.stringify(actual.sort()) !== JSON.stringify(expected.sort())) fail('Catalog mismatch')
  }
  ${MANAGED_CATALOG_SOURCE}
  return extendedCatalog(client, schema)
  })`
) as (
  client: { query: (sql: string) => Promise<{ rows: CatalogRows }> },
  schema: unknown
) => Promise<unknown>

function run(values: ReturnType<typeof fixture>) {
  return inspect(
    {
      query: async (sql) => {
        if (sql.includes('FROM pg_type')) return { rows: values.enums }
        if (sql.includes('FROM pg_constraint')) return { rows: values.constraints }
        return { rows: values.indexes }
      }
    },
    values.schema
  )
}

describe('managed relational catalog semantics', () => {
  test('accepts the exact generated enum, foreign key, unique and descending index catalog', async () => {
    const values = fixture()
    expect(await run(values)).toEqual([values.enums, values.constraints, values.indexes])
  })

  test.each([
    [
      'enum labels',
      (values: ReturnType<typeof fixture>) => {
        values.enums[0].labels = ['published', 'draft']
      }
    ],
    [
      'enum owner',
      (values: ReturnType<typeof fixture>) => {
        values.enums[0].owner = 'other'
      }
    ],
    [
      'foreign target',
      (values: ReturnType<typeof fixture>) => {
        modelRequired(values.constraints.find((entry) => entry.kind === 'f')).target_table =
          'different'
      }
    ],
    [
      'foreign column',
      (values: ReturnType<typeof fixture>) => {
        modelRequired(values.constraints.find((entry) => entry.kind === 'f')).target_columns = [
          'id',
          'owner_id'
        ]
      }
    ],
    [
      'foreign cascade',
      (values: ReturnType<typeof fixture>) => {
        modelRequired(values.constraints.find((entry) => entry.kind === 'f')).delete_action = 'c'
      }
    ],
    [
      'foreign deferral',
      (values: ReturnType<typeof fixture>) => {
        modelRequired(values.constraints.find((entry) => entry.kind === 'f')).deferrable = true
      }
    ],
    [
      'unique fields',
      (values: ReturnType<typeof fixture>) => {
        modelRequired(values.constraints.find((entry) => entry.kind === 'u')).columns = ['id']
      }
    ],
    [
      'index order',
      (values: ReturnType<typeof fixture>) => {
        values.indexes[0].options = [3]
      }
    ],
    [
      'index predicate',
      (values: ReturnType<typeof fixture>) => {
        values.indexes[0].no_predicate = false
      }
    ],
    [
      'index expression',
      (values: ReturnType<typeof fixture>) => {
        values.indexes[0].no_expression = false
      }
    ],
    [
      'index custom operator class',
      (values: ReturnType<typeof fixture>) => {
        values.indexes[0].default_opclass = false
      }
    ],
    [
      'index NULL semantics',
      (values: ReturnType<typeof fixture>) => {
        values.indexes[0].distinct_nulls = false
      }
    ]
  ] as const)('rejects same-name catalog changes: %s', async (_name, mutate) => {
    const values = fixture()
    mutate(values)
    await expect(run(values)).rejects.toThrow('Catalog mismatch')
  })
})
