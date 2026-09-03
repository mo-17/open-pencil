import { digestCanonicalBackendValue, freezeBackendValue } from '#compiler/backend/canonical'

import {
  validateDataModelIR,
  type BackendFieldDefault,
  type DataEntityIR,
  type DataFieldIR,
  type DataModelIR
} from '@open-pencil/lowcode/backend'

export const SUPABASE_PHYSICAL_SCHEMA_PROJECTION_FORMAT =
  'openpencil.supabase-physical-schema-projection.v1' as const

interface SupabasePhysicalFieldV1 {
  readonly name: string
  readonly type: DataFieldIR['type']
  readonly enumName: string | null
  readonly nullable: boolean
  readonly default: BackendFieldDefault | null
}

interface SupabasePhysicalKeyV1 {
  readonly fields: readonly string[]
}

interface SupabasePhysicalForeignKeyV1 extends SupabasePhysicalKeyV1 {
  readonly targetTableName: string
  readonly targetFields: readonly string[]
  readonly onDelete: 'restrict' | 'cascade' | 'set-null' | 'no-action'
}

interface SupabasePhysicalIndexV1 extends SupabasePhysicalKeyV1 {
  readonly order: 'asc' | 'desc'
}

export interface SupabasePhysicalSchemaProjectionV1 {
  readonly format: typeof SUPABASE_PHYSICAL_SCHEMA_PROJECTION_FORMAT
  readonly version: 1
  readonly schema: 'public'
  readonly enums: readonly Readonly<{ name: string; values: readonly string[] }>[]
  readonly tables: readonly Readonly<{
    name: string
    fields: readonly SupabasePhysicalFieldV1[]
    primaryKey: SupabasePhysicalKeyV1 | null
    foreignKeys: readonly SupabasePhysicalForeignKeyV1[]
    uniques: readonly SupabasePhysicalKeyV1[]
    indexes: readonly SupabasePhysicalIndexV1[]
  }>[]
}

function normalizedModel(value: unknown): DataModelIR {
  const parsed = validateDataModelIR(value)
  if (!parsed.ok) {
    throw new TypeError(
      `Supabase physical schema projection requires a valid DataModelIR: ${parsed.diagnostics
        .map((entry) => entry.code)
        .join(', ')}`
    )
  }
  return parsed.value
}

function fieldName(entity: DataEntityIR, fieldId: string): string {
  const field = entity.fields.find((entry) => entry.id === fieldId)
  if (!field) {
    throw new TypeError(
      `Supabase physical schema projection cannot resolve ${entity.name}.${fieldId}.`
    )
  }
  return field.name
}

function physicalFields(
  entity: DataEntityIR,
  enumNames: ReadonlyMap<string, string>
): SupabasePhysicalFieldV1[] {
  return entity.fields
    .map((field) => {
      const enumName = field.type === 'enum' ? enumNames.get(field.enumId ?? '') : undefined
      if (field.type === 'enum' && !enumName) {
        throw new TypeError(
          `Supabase physical schema projection cannot resolve enum for ${entity.name}.${field.name}.`
        )
      }
      return {
        name: field.name,
        type: field.type,
        enumName: enumName ?? null,
        nullable: field.nullable,
        default: field.default ?? null
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
}

function physicalEntity(
  entity: DataEntityIR,
  entities: ReadonlyMap<string, DataEntityIR>,
  enumNames: ReadonlyMap<string, string>
): SupabasePhysicalSchemaProjectionV1['tables'][number] {
  const fields = (fieldIds: readonly string[]): string[] =>
    fieldIds.map((fieldId) => fieldName(entity, fieldId))
  const foreignKeys = (entity.foreignKeys ?? [])
    .map((foreignKey) => {
      const target = entities.get(foreignKey.targetEntityId)
      if (target?.management !== 'managed') {
        throw new TypeError(
          `Supabase physical schema projection cannot resolve FK target ${foreignKey.targetEntityId}.`
        )
      }
      return {
        fields: fields(foreignKey.fields),
        targetTableName: target.name,
        targetFields: foreignKey.targetFields.map((fieldId) => fieldName(target, fieldId)),
        onDelete: foreignKey.onDelete
      }
    })
    .sort((left, right) =>
      `${left.fields.join(',')}->${left.targetTableName}:${left.targetFields.join(',')}`.localeCompare(
        `${right.fields.join(',')}->${right.targetTableName}:${right.targetFields.join(',')}`,
        'en'
      )
    )
  const uniques = (entity.uniques ?? [])
    .map((unique) => ({ fields: fields(unique.fields) }))
    .sort((left, right) => left.fields.join(',').localeCompare(right.fields.join(','), 'en'))
  const indexes = (entity.indexes ?? [])
    .map((index) => ({ fields: fields(index.fields), order: index.order ?? ('asc' as const) }))
    .sort((left, right) =>
      `${left.fields.join(',')}:${left.order}`.localeCompare(
        `${right.fields.join(',')}:${right.order}`,
        'en'
      )
    )
  return {
    name: entity.name,
    fields: physicalFields(entity, enumNames),
    primaryKey: entity.primaryKey ? { fields: fields(entity.primaryKey.fields) } : null,
    foreignKeys,
    uniques,
    indexes
  }
}

/**
 * Projects only addressable PostgreSQL schema state. Authored relations are not silently hashed or
 * discarded: DataModel validation first proves every relation is backed by the FK/unique/junction
 * structures that are represented below. Relation labels and ids have no independent SQL object.
 */
export function projectSupabasePhysicalSchema(value: unknown): SupabasePhysicalSchemaProjectionV1 {
  const model = normalizedModel(value)
  const managedEntities = model.entities.filter((entity) => entity.management === 'managed')
  const entities = new Map(managedEntities.map((entity) => [entity.id, entity]))
  const enumNames = new Map(model.enums.map((dataEnum) => [dataEnum.id, dataEnum.name]))
  return freezeBackendValue({
    format: SUPABASE_PHYSICAL_SCHEMA_PROJECTION_FORMAT,
    version: 1,
    schema: 'public',
    enums: model.enums
      .map((dataEnum) => ({ name: dataEnum.name, values: [...dataEnum.values] }))
      .sort((left, right) => left.name.localeCompare(right.name, 'en')),
    tables: managedEntities
      .map((entity) => physicalEntity(entity, entities, enumNames))
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))
  }) as SupabasePhysicalSchemaProjectionV1
}

export function digestSupabasePhysicalSchema(value: unknown): string {
  return digestCanonicalBackendValue(
    projectSupabasePhysicalSchema(value),
    '$.supabasePhysicalSchemaProjection'
  )
}
