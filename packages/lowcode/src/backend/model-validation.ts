import { BACKEND_FIELD_TYPES, parseBackendFieldDefault } from './field-default-validation'
import { BACKEND_LIMITS } from './limits'
import { validateEntityReferences, validateForeignKeyCycles } from './model-reference-validation'
import {
  DATA_MODEL_IR_VERSION,
  type DataEntityIR,
  type DataEnumIR,
  type DataFieldIR,
  type DataForeignKeyIR,
  type DataIndexIR,
  type DataModelIR,
  type DataPrimaryKeyIR,
  type DataRelationIR,
  type DataUniqueIR
} from './types'
import {
  array,
  boolean,
  id,
  identifier,
  oneOf,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendUnknownRecord,
  type BackendValidationContext
} from './validation-helpers'

function field(
  value: unknown,
  path: string,
  context: BackendValidationContext
): DataFieldIR | undefined {
  const source = record(
    value,
    path,
    context,
    ['id', 'name', 'type', 'enumId', 'nullable', 'default'],
    ['id', 'name', 'type', 'nullable']
  )
  if (!source) return undefined
  const fieldId = id(source.id, `${path}.id`, context)
  const name = identifier(source.name, `${path}.name`, context)
  const type = oneOf(source.type, `${path}.type`, context, BACKEND_FIELD_TYPES)
  const nullable = boolean(source.nullable, `${path}.nullable`, context)
  const enumId =
    source.enumId === undefined ? undefined : id(source.enumId, `${path}.enumId`, context)
  if (type === 'enum' && !enumId) {
    context.diagnostics.push({
      code: 'backend-enum-reference-required',
      severity: 'error',
      path: `${path}.enumId`,
      message: 'Enum fields must reference an enum.'
    })
  }
  if (type && type !== 'enum' && source.enumId !== undefined) {
    context.diagnostics.push({
      code: 'backend-enum-reference-unexpected',
      severity: 'error',
      path: `${path}.enumId`,
      message: 'Only enum fields may reference an enum.'
    })
  }
  const parsedDefault =
    source.default === undefined
      ? undefined
      : parseBackendFieldDefault(source.default, `${path}.default`, context, type, nullable)
  if (
    !fieldId ||
    !name ||
    !type ||
    nullable === undefined ||
    (type === 'enum' && !enumId) ||
    (source.default !== undefined && !parsedDefault)
  ) {
    return undefined
  }
  return {
    id: fieldId,
    name,
    type,
    ...(enumId ? { enumId } : {}),
    nullable,
    ...(parsedDefault ? { default: parsedDefault } : {})
  }
}

function fieldIds(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string[] | undefined {
  const values = array(value, path, context, BACKEND_LIMITS.maxFieldsPerEntity)
  if (!values || values.length === 0) {
    if (values) {
      context.diagnostics.push({
        code: 'backend-field-reference-empty',
        severity: 'error',
        path,
        message: 'At least one field reference is required.'
      })
    }
    return undefined
  }
  const parsed = values
    .map((entry, index) => id(entry, `${path}[${index}]`, context))
    .filter((entry): entry is string => entry !== undefined)
  uniqueBy(parsed, path, context, 'field reference')
  return parsed.length === values.length ? parsed : undefined
}

function primaryKey(
  value: unknown,
  path: string,
  context: BackendValidationContext
): DataPrimaryKeyIR | undefined {
  const source = record(value, path, context, ['fields'])
  if (!source) return undefined
  const fields = fieldIds(source.fields, `${path}.fields`, context)
  return fields ? { fields } : undefined
}

function foreignKey(
  value: unknown,
  path: string,
  context: BackendValidationContext
): DataForeignKeyIR | undefined {
  const source = record(value, path, context, [
    'id',
    'fields',
    'targetEntityId',
    'targetFields',
    'onDelete'
  ])
  if (!source) return undefined
  const foreignKeyId = id(source.id, `${path}.id`, context)
  const fields = fieldIds(source.fields, `${path}.fields`, context)
  const targetEntityId = id(source.targetEntityId, `${path}.targetEntityId`, context)
  const targetFields = fieldIds(source.targetFields, `${path}.targetFields`, context)
  const onDelete = oneOf(source.onDelete, `${path}.onDelete`, context, [
    'restrict',
    'cascade',
    'set-null',
    'no-action'
  ])
  if (fields && targetFields && fields.length !== targetFields.length) {
    context.diagnostics.push({
      code: 'backend-foreign-key-arity',
      severity: 'error',
      path,
      message: 'Foreign key field lists must have the same length.'
    })
  }
  return foreignKeyId && fields && targetEntityId && targetFields && onDelete
    ? { id: foreignKeyId, fields, targetEntityId, targetFields, onDelete }
    : undefined
}

function index(
  value: unknown,
  path: string,
  context: BackendValidationContext
): DataIndexIR | undefined {
  const source = record(value, path, context, ['id', 'fields', 'order'], ['id', 'fields'])
  if (!source) return undefined
  const indexId = id(source.id, `${path}.id`, context)
  const fields = fieldIds(source.fields, `${path}.fields`, context)
  const order =
    source.order === undefined
      ? undefined
      : oneOf(source.order, `${path}.order`, context, ['asc', 'desc'])
  return indexId && fields ? { id: indexId, fields, ...(order ? { order } : {}) } : undefined
}

function unique(
  value: unknown,
  path: string,
  context: BackendValidationContext
): DataUniqueIR | undefined {
  const source = record(value, path, context, ['id', 'fields'])
  if (!source) return undefined
  const uniqueId = id(source.id, `${path}.id`, context)
  const fields = fieldIds(source.fields, `${path}.fields`, context)
  return uniqueId && fields ? { id: uniqueId, fields } : undefined
}

interface ParsedEntityShape {
  readonly rawFields: unknown[] | undefined
  readonly fields: DataFieldIR[]
  readonly primaryKey: DataPrimaryKeyIR | undefined
  readonly foreignKeys: DataForeignKeyIR[] | undefined
  readonly indexes: DataIndexIR[] | undefined
  readonly uniques: DataUniqueIR[] | undefined
}

function parsedEntityShape(
  source: BackendUnknownRecord,
  path: string,
  context: BackendValidationContext
): ParsedEntityShape {
  const rawFields = array(
    source.fields,
    `${path}.fields`,
    context,
    BACKEND_LIMITS.maxFieldsPerEntity
  )
  const fields = (rawFields ?? [])
    .map((entry, index) => field(entry, `${path}.fields[${index}]`, context))
    .filter((entry): entry is DataFieldIR => entry !== undefined)
  uniqueBy(
    fields.map((entry) => entry.id),
    `${path}.fields`,
    context,
    'field id'
  )
  uniqueBy(
    fields.map((entry) => entry.name),
    `${path}.fields`,
    context,
    'field name'
  )
  const parsedPrimaryKey =
    source.primaryKey === undefined
      ? undefined
      : primaryKey(source.primaryKey, `${path}.primaryKey`, context)
  const foreignKeys = parseArrayItems(
    source.foreignKeys,
    `${path}.foreignKeys`,
    context,
    BACKEND_LIMITS.maxConstraintsPerEntity,
    foreignKey,
    true
  )
  const indexes = parseArrayItems(
    source.indexes,
    `${path}.indexes`,
    context,
    BACKEND_LIMITS.maxConstraintsPerEntity,
    index,
    true
  )
  const uniques = parseArrayItems(
    source.uniques,
    `${path}.uniques`,
    context,
    BACKEND_LIMITS.maxConstraintsPerEntity,
    unique,
    true
  )
  return { rawFields, fields, primaryKey: parsedPrimaryKey, foreignKeys, indexes, uniques }
}

function validateConstraintIds(
  shape: ParsedEntityShape,
  path: string,
  context: BackendValidationContext
): void {
  for (const [constraintPath, constraints] of [
    ['foreignKeys', shape.foreignKeys],
    ['indexes', shape.indexes],
    ['uniques', shape.uniques]
  ] as const) {
    if (!constraints) continue
    uniqueBy(
      constraints.map((entry) => entry.id),
      `${path}.${constraintPath}`,
      context,
      `${constraintPath} id`
    )
  }
}

function normalizedEntity(
  entityId: string,
  name: string,
  management: DataEntityIR['management'],
  shape: ParsedEntityShape
): DataEntityIR {
  const result: DataEntityIR = {
    id: entityId,
    name,
    management,
    fields: sorted(shape.fields, (entry) => entry.id)
  }
  if (shape.primaryKey) result.primaryKey = shape.primaryKey
  if (shape.foreignKeys?.length) result.foreignKeys = sorted(shape.foreignKeys, (entry) => entry.id)
  if (shape.indexes?.length) result.indexes = sorted(shape.indexes, (entry) => entry.id)
  if (shape.uniques?.length) result.uniques = sorted(shape.uniques, (entry) => entry.id)
  return result
}

function entity(
  value: unknown,
  path: string,
  context: BackendValidationContext
): DataEntityIR | undefined {
  const source = record(
    value,
    path,
    context,
    ['id', 'name', 'management', 'fields', 'primaryKey', 'foreignKeys', 'indexes', 'uniques'],
    ['id', 'name', 'management', 'fields']
  )
  if (!source) return undefined
  const entityId = id(source.id, `${path}.id`, context)
  const name = identifier(source.name, `${path}.name`, context)
  const management = oneOf(source.management, `${path}.management`, context, [
    'managed',
    'external'
  ])
  const shape = parsedEntityShape(source, path, context)
  validateConstraintIds(shape, path, context)
  if (
    !entityId ||
    !name ||
    !management ||
    !shape.rawFields ||
    shape.fields.length !== shape.rawFields.length
  ) {
    return undefined
  }
  if (
    management === 'external' &&
    (shape.fields.length > 0 ||
      shape.primaryKey ||
      shape.foreignKeys?.length ||
      shape.uniques?.length)
  ) {
    context.diagnostics.push({
      code: 'backend-external-entity-shape',
      severity: 'error',
      path,
      message: 'External entities cannot declare managed fields or constraints.'
    })
  }
  return normalizedEntity(entityId, name, management, shape)
}

function dataEnum(
  value: unknown,
  path: string,
  context: BackendValidationContext
): DataEnumIR | undefined {
  const source = record(value, path, context, ['id', 'name', 'values'])
  if (!source) return undefined
  const enumId = id(source.id, `${path}.id`, context)
  const name = identifier(source.name, `${path}.name`, context)
  const rawValues = array(source.values, `${path}.values`, context, BACKEND_LIMITS.maxEnumValues)
  const values = (rawValues ?? [])
    .map((entry, index) => identifier(entry, `${path}.values[${index}]`, context))
    .filter((entry): entry is string => entry !== undefined)
  if (values.length === 0) {
    context.diagnostics.push({
      code: 'backend-enum-empty',
      severity: 'error',
      path: `${path}.values`,
      message: 'An enum must define at least one value.'
    })
  }
  uniqueBy(values, `${path}.values`, context, 'enum value')
  if (!enumId || !name || !rawValues) return undefined
  return values.length === rawValues.length && values.length > 0
    ? { id: enumId, name, values }
    : undefined
}

export {
  dataEnum as parseBackendDataEnum,
  entity as parseBackendDataEntity,
  field as parseBackendDataField,
  fieldIds as parseBackendDataFieldIds,
  foreignKey as parseBackendDataForeignKey,
  index as parseBackendDataIndex,
  unique as parseBackendDataUnique
}

function relation(
  value: unknown,
  path: string,
  context: BackendValidationContext
): DataRelationIR | undefined {
  const source = record(
    value,
    path,
    context,
    [
      'id',
      'kind',
      'sourceEntityId',
      'targetEntityId',
      'sourceForeignKeyId',
      'targetForeignKeyId',
      'junctionEntityId'
    ],
    ['id', 'kind', 'sourceEntityId', 'targetEntityId']
  )
  if (!source) return undefined
  const relationId = id(source.id, `${path}.id`, context)
  const kind = oneOf(source.kind, `${path}.kind`, context, [
    'one-to-one',
    'one-to-many',
    'many-to-many'
  ])
  const sourceEntityId = id(source.sourceEntityId, `${path}.sourceEntityId`, context)
  const targetEntityId = id(source.targetEntityId, `${path}.targetEntityId`, context)
  const sourceForeignKeyId =
    source.sourceForeignKeyId === undefined
      ? undefined
      : id(source.sourceForeignKeyId, `${path}.sourceForeignKeyId`, context)
  const targetForeignKeyId =
    source.targetForeignKeyId === undefined
      ? undefined
      : id(source.targetForeignKeyId, `${path}.targetForeignKeyId`, context)
  const junctionEntityId =
    source.junctionEntityId === undefined
      ? undefined
      : id(source.junctionEntityId, `${path}.junctionEntityId`, context)
  if (kind === 'many-to-many' && !junctionEntityId) {
    context.diagnostics.push({
      code: 'backend-relation-junction-required',
      severity: 'error',
      path: `${path}.junctionEntityId`,
      message: 'Many-to-many relations require a junction entity.'
    })
  }
  if (kind && kind !== 'many-to-many' && junctionEntityId) {
    context.diagnostics.push({
      code: 'backend-relation-junction-unexpected',
      severity: 'error',
      path: `${path}.junctionEntityId`,
      message: 'Only many-to-many relations may declare a junction entity.'
    })
  }
  return relationId &&
    kind &&
    sourceEntityId &&
    targetEntityId &&
    (kind !== 'many-to-many' || junctionEntityId)
    ? {
        id: relationId,
        kind,
        sourceEntityId,
        targetEntityId,
        ...(sourceForeignKeyId ? { sourceForeignKeyId } : {}),
        ...(targetForeignKeyId ? { targetForeignKeyId } : {}),
        ...(junctionEntityId ? { junctionEntityId } : {})
      }
    : undefined
}

export function parseDataModelIR(
  value: unknown,
  path: string,
  context: BackendValidationContext
): DataModelIR | undefined {
  const source = record(value, path, context, ['version', 'entities', 'enums', 'relations'])
  if (!source) return undefined
  if (source.version !== DATA_MODEL_IR_VERSION) {
    context.diagnostics.push({
      code: 'backend-model-version-unsupported',
      severity: 'error',
      path: `${path}.version`,
      message: 'Data model version is not supported.'
    })
  }
  const rawEntities = array(
    source.entities,
    `${path}.entities`,
    context,
    BACKEND_LIMITS.maxEntities
  )
  const rawEnums = array(source.enums, `${path}.enums`, context, BACKEND_LIMITS.maxEnums)
  const rawRelations = array(
    source.relations,
    `${path}.relations`,
    context,
    BACKEND_LIMITS.maxRelations
  )
  const entities = (rawEntities ?? [])
    .map((entry, index) => entity(entry, `${path}.entities[${index}]`, context))
    .filter((entry): entry is DataEntityIR => entry !== undefined)
  const enums = (rawEnums ?? [])
    .map((entry, index) => dataEnum(entry, `${path}.enums[${index}]`, context))
    .filter((entry): entry is DataEnumIR => entry !== undefined)
  const relations = (rawRelations ?? [])
    .map((entry, index) => relation(entry, `${path}.relations[${index}]`, context))
    .filter((entry): entry is DataRelationIR => entry !== undefined)
  uniqueBy(
    entities.map((entry) => entry.id),
    `${path}.entities`,
    context,
    'entity id'
  )
  uniqueBy(
    entities.map((entry) => entry.name),
    `${path}.entities`,
    context,
    'entity name'
  )
  uniqueBy(
    enums.map((entry) => entry.id),
    `${path}.enums`,
    context,
    'enum id'
  )
  uniqueBy(
    enums.map((entry) => entry.name),
    `${path}.enums`,
    context,
    'enum name'
  )
  uniqueBy(
    relations.map((entry) => entry.id),
    `${path}.relations`,
    context,
    'relation id'
  )
  if (
    source.version !== DATA_MODEL_IR_VERSION ||
    !rawEntities ||
    !rawEnums ||
    !rawRelations ||
    entities.length !== rawEntities.length ||
    enums.length !== rawEnums.length ||
    relations.length !== rawRelations.length
  ) {
    return undefined
  }
  const model: DataModelIR = {
    version: DATA_MODEL_IR_VERSION,
    entities: sorted(entities, (entry) => entry.id),
    enums: sorted(enums, (entry) => entry.id),
    relations: sorted(relations, (entry) => entry.id)
  }
  validateEntityReferences(model, context)
  validateForeignKeyCycles(model, context)
  return model
}
