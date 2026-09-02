import type { DataEntityIR, DataFieldIR, DataModelIR } from '@open-pencil/lowcode/backend'

import type {
  SupabaseInspectionColumnV1,
  SupabaseInspectionConstraintV1,
  SupabaseInspectionIndexV1,
  SupabaseInspectionObjectV1
} from './contract'

export interface SupabaseManagedModelInventory {
  readonly objects: readonly SupabaseInspectionObjectV1[]
  readonly columns: readonly SupabaseInspectionColumnV1[]
  readonly constraints: readonly SupabaseInspectionConstraintV1[]
  readonly indexes: readonly SupabaseInspectionIndexV1[]
}

function fail(message: string): never {
  throw new TypeError(`Supabase managed inventory cannot form an exact DataModelIR: ${message}`)
}

function fieldIds(
  names: readonly string[],
  byName: ReadonlyMap<string, Readonly<{ id: string }>>,
  path: string
): string[] {
  return names.map(
    (name) => byName.get(name)?.id ?? fail(`${path} references unknown field ${name}`)
  )
}

function managedFields(
  tableName: string,
  columns: readonly SupabaseInspectionColumnV1[],
  enumIdsByName: ReadonlyMap<string, string>
): DataFieldIR[] {
  const tableColumns = columns.filter((entry) => entry.tableName === tableName)
  if (tableColumns.some((entry) => entry.management !== 'managed')) {
    fail(`managed table ${tableName} contains an unmarked column`)
  }
  return tableColumns
    .map((column) => {
      if (!column.openPencilFieldId) fail(`managed column ${tableName}.${column.name} lacks an id`)
      const enumId =
        column.type === 'enum'
          ? (enumIdsByName.get(column.enumName ?? '') ??
            fail(`managed enum column ${tableName}.${column.name} lacks a managed enum binding`))
          : undefined
      if (column.default?.kind === 'unbound') {
        fail(`managed column ${tableName}.${column.name} has an unbound default`)
      }
      return {
        id: column.openPencilFieldId,
        name: column.name,
        type: column.type,
        ...(enumId ? { enumId } : {}),
        nullable: column.nullable,
        ...(column.default ? { default: column.default } : {})
      } as DataFieldIR
    })
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
}

function managedEntity(
  object: Extract<SupabaseInspectionObjectV1, { kind: 'table' }>,
  inventory: SupabaseManagedModelInventory,
  tableIdsByName: ReadonlyMap<string, string>,
  enumIdsByName: ReadonlyMap<string, string>
): DataEntityIR {
  const entityId = object.openPencilId ?? fail(`managed table ${object.name} lacks an id`)
  const fields = managedFields(object.name, inventory.columns, enumIdsByName)
  const fieldsByName = new Map(fields.map((field) => [field.name, field]))
  const constraints = inventory.constraints.filter((entry) => entry.tableName === object.name)
  if (constraints.some((entry) => entry.management !== 'managed')) {
    fail(`managed table ${object.name} contains an unmarked constraint`)
  }
  const primaryKeys = constraints.filter((entry) => entry.kind === 'primary-key')
  if (primaryKeys.length > 1) fail(`managed table ${object.name} has multiple primary keys`)
  if (primaryKeys[0]?.openPencilId !== undefined && primaryKeys[0].openPencilId !== entityId) {
    fail(`managed table ${object.name} primary-key marker is bound to another entity`)
  }
  const uniques = constraints
    .filter((entry) => entry.kind === 'unique')
    .map((entry) => ({
      id: entry.openPencilId ?? fail(`managed unique ${entry.name} lacks an id`),
      fields: fieldIds(entry.fields, fieldsByName, `unique ${entry.name}`)
    }))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
  const foreignKeys = constraints
    .filter((entry) => entry.kind === 'foreign-key')
    .map((entry) => {
      const targetEntityId =
        tableIdsByName.get(entry.targetTableName) ??
        fail(`managed foreign key ${entry.name} targets an unmanaged table`)
      const targetFields = inventory.columns.filter(
        (column) => column.tableName === entry.targetTableName && column.management === 'managed'
      )
      const targetByName = new Map(
        targetFields.map((field) => [
          field.name,
          {
            id:
              field.openPencilFieldId ??
              fail(`managed target column ${entry.targetTableName}.${field.name} lacks an id`)
          }
        ])
      )
      return {
        id: entry.openPencilId ?? fail(`managed foreign key ${entry.name} lacks an id`),
        fields: fieldIds(entry.fields, fieldsByName, `foreign key ${entry.name}`),
        targetEntityId,
        targetFields: fieldIds(entry.targetFields, targetByName, `foreign key ${entry.name}`),
        onDelete: entry.onDelete
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
  const tableIndexes = inventory.indexes.filter((entry) => entry.tableName === object.name)
  if (tableIndexes.some((entry) => entry.management !== 'managed')) {
    fail(`managed table ${object.name} contains an unmarked index`)
  }
  const indexes = tableIndexes
    .map((entry) => {
      const orders = new Set(entry.fields.map((field) => field.order))
      if (orders.size !== 1) fail(`managed index ${entry.name} has mixed field ordering`)
      const order = entry.fields[0]?.order
      return {
        id: entry.openPencilId ?? fail(`managed index ${entry.name} lacks an id`),
        fields: fieldIds(
          entry.fields.map((field) => field.name),
          fieldsByName,
          `index ${entry.name}`
        ),
        ...(order === 'desc' ? { order } : {})
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
  const primaryKey = primaryKeys[0]
    ? {
        fields: fieldIds(primaryKeys[0].fields, fieldsByName, `primary key ${primaryKeys[0].name}`)
      }
    : undefined
  return {
    id: entityId,
    name: object.name,
    management: 'managed',
    fields,
    ...(primaryKey ? { primaryKey } : {}),
    ...(foreignKeys.length > 0 ? { foreignKeys } : {}),
    ...(indexes.length > 0 ? { indexes } : {}),
    ...(uniques.length > 0 ? { uniques } : {})
  }
}

/** Derive the only DataModelIR that the address-validated managed inventory can authorize. */
export function deriveSupabaseManagedDataModel(
  inventory: SupabaseManagedModelInventory
): DataModelIR {
  const managedEnums = inventory.objects
    .filter(
      (object): object is Extract<SupabaseInspectionObjectV1, { kind: 'enum' }> =>
        object.kind === 'enum' && object.management === 'managed'
    )
    .map((object) => ({
      id: object.openPencilId ?? fail(`managed enum ${object.name} lacks an id`),
      name: object.name,
      values: [...object.values]
    }))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
  const enumIdsByName = new Map(managedEnums.map((entry) => [entry.name, entry.id]))
  const managedTables = inventory.objects.filter(
    (object): object is Extract<SupabaseInspectionObjectV1, { kind: 'table' }> =>
      object.kind === 'table' && object.management === 'managed'
  )
  const tableIdsByName = new Map(
    managedTables.map((table) => [
      table.name,
      table.openPencilId ?? fail(`managed table ${table.name} lacks an id`)
    ])
  )
  const entities = managedTables
    .map((table) => managedEntity(table, inventory, tableIdsByName, enumIdsByName))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
  return { version: 1, entities, enums: managedEnums, relations: [] }
}
