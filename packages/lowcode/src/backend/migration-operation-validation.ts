import { BACKEND_LIMITS } from './limits'
import {
  parseBackendDataEntity,
  parseBackendDataEnum,
  parseBackendDataField,
  parseBackendDataFieldIds,
  parseBackendDataForeignKey,
  parseBackendDataIndex,
  parseBackendDataUnique
} from './model-validation'
import type { MigrationOperation } from './types'
import {
  boundedText,
  id,
  identifier,
  oneOf,
  record,
  type BackendUnknownRecord,
  type BackendValidationContext
} from './validation-helpers'

const MIGRATION_OPERATION_KINDS: readonly MigrationOperation['kind'][] = [
  'create-enum',
  'drop-enum',
  'add-enum-value',
  'drop-enum-value',
  'create-entity',
  'drop-entity',
  'rename-entity',
  'add-field',
  'drop-field',
  'rename-field',
  'alter-field',
  'add-primary-key',
  'drop-primary-key',
  'add-foreign-key',
  'drop-foreign-key',
  'add-unique',
  'drop-unique',
  'add-index',
  'drop-index',
  'rewrite-data'
]

const MIGRATION_OPERATION_KEYS = [
  'id',
  'kind',
  'enum',
  'enumId',
  'value',
  'entity',
  'entityId',
  'nextName',
  'field',
  'fieldId',
  'change',
  'nextField',
  'fields',
  'foreignKey',
  'foreignKeyId',
  'unique',
  'uniqueId',
  'index',
  'indexId',
  'reason'
] as const

function operationSource(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  fields: readonly string[]
): { source: BackendUnknownRecord; operationId: string } | undefined {
  const source = record(value, path, context, ['id', 'kind', ...fields])
  if (!source) return undefined
  const operationId = id(source.id, `${path}.id`, context)
  return operationId ? { source, operationId } : undefined
}

function operationIdField(
  source: BackendUnknownRecord,
  key: string,
  path: string,
  context: BackendValidationContext
): string | undefined {
  return id(source[key], `${path}.${key}`, context)
}

type OperationParser = (
  value: unknown,
  path: string,
  context: BackendValidationContext
) => MigrationOperation | undefined

function enumValueParser(kind: 'add-enum-value' | 'drop-enum-value'): OperationParser {
  return (value, path, context) => {
    const parsed = operationSource(value, path, context, ['enumId', 'value'])
    if (!parsed) return undefined
    const enumId = operationIdField(parsed.source, 'enumId', path, context)
    const enumValue = identifier(parsed.source.value, `${path}.value`, context)
    return enumId && enumValue
      ? { id: parsed.operationId, kind, enumId, value: enumValue }
      : undefined
  }
}

function entityOnlyParser(kind: 'drop-entity' | 'drop-primary-key'): OperationParser {
  return (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entityId'])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    return entityId ? { id: parsed.operationId, kind, entityId } : undefined
  }
}

const OPERATION_PARSERS: Readonly<Record<MigrationOperation['kind'], OperationParser>> = {
  'create-enum': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['enum'])
    if (!parsed) return undefined
    const dataEnum = parseBackendDataEnum(parsed.source.enum, `${path}.enum`, context)
    return dataEnum ? { id: parsed.operationId, kind: 'create-enum', enum: dataEnum } : undefined
  },
  'drop-enum': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['enumId'])
    if (!parsed) return undefined
    const enumId = operationIdField(parsed.source, 'enumId', path, context)
    return enumId ? { id: parsed.operationId, kind: 'drop-enum', enumId } : undefined
  },
  'add-enum-value': enumValueParser('add-enum-value'),
  'drop-enum-value': enumValueParser('drop-enum-value'),
  'create-entity': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entity'])
    if (!parsed) return undefined
    const entity = parseBackendDataEntity(parsed.source.entity, `${path}.entity`, context)
    if (entity?.management === 'external') {
      context.diagnostics.push({
        code: 'backend-migration-external-entity-operation',
        severity: 'error',
        path: `${path}.entity.management`,
        message: 'Migration plans cannot create provider-managed schema for external entities.'
      })
    }
    return entity?.management === 'managed'
      ? { id: parsed.operationId, kind: 'create-entity', entity }
      : undefined
  },
  'drop-entity': entityOnlyParser('drop-entity'),
  'rename-entity': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entityId', 'nextName'])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    const nextName = identifier(parsed.source.nextName, `${path}.nextName`, context)
    return entityId && nextName
      ? { id: parsed.operationId, kind: 'rename-entity', entityId, nextName }
      : undefined
  },
  'add-field': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entityId', 'field'])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    const field = parseBackendDataField(parsed.source.field, `${path}.field`, context)
    return entityId && field
      ? { id: parsed.operationId, kind: 'add-field', entityId, field }
      : undefined
  },
  'drop-field': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entityId', 'fieldId'])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    const fieldId = operationIdField(parsed.source, 'fieldId', path, context)
    return entityId && fieldId
      ? { id: parsed.operationId, kind: 'drop-field', entityId, fieldId }
      : undefined
  },
  'rename-field': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entityId', 'fieldId', 'nextName'])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    const fieldId = operationIdField(parsed.source, 'fieldId', path, context)
    const nextName = identifier(parsed.source.nextName, `${path}.nextName`, context)
    return entityId && fieldId && nextName
      ? { id: parsed.operationId, kind: 'rename-field', entityId, fieldId, nextName }
      : undefined
  },
  'alter-field': (value, path, context) => {
    const parsed = operationSource(value, path, context, [
      'entityId',
      'fieldId',
      'change',
      'nextField'
    ])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    const fieldId = operationIdField(parsed.source, 'fieldId', path, context)
    const change = oneOf(parsed.source.change, `${path}.change`, context, [
      'widen-type',
      'narrow-type',
      'set-not-null',
      'drop-not-null',
      'change-default'
    ])
    const nextField = parseBackendDataField(parsed.source.nextField, `${path}.nextField`, context)
    if (fieldId && nextField && nextField.id !== fieldId) {
      context.diagnostics.push({
        code: 'backend-migration-field-identity-mismatch',
        severity: 'error',
        path: `${path}.nextField.id`,
        message: 'Alter-field payload must retain the reviewed field identity.'
      })
      return undefined
    }
    return entityId && fieldId && change && nextField
      ? { id: parsed.operationId, kind: 'alter-field', entityId, fieldId, change, nextField }
      : undefined
  },
  'add-primary-key': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entityId', 'fields'])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    const fields = parseBackendDataFieldIds(parsed.source.fields, `${path}.fields`, context)
    return entityId && fields
      ? { id: parsed.operationId, kind: 'add-primary-key', entityId, fields }
      : undefined
  },
  'drop-primary-key': entityOnlyParser('drop-primary-key'),
  'add-foreign-key': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entityId', 'foreignKey'])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    const foreignKey = parseBackendDataForeignKey(
      parsed.source.foreignKey,
      `${path}.foreignKey`,
      context
    )
    return entityId && foreignKey
      ? { id: parsed.operationId, kind: 'add-foreign-key', entityId, foreignKey }
      : undefined
  },
  'drop-foreign-key': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entityId', 'foreignKeyId'])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    const foreignKeyId = operationIdField(parsed.source, 'foreignKeyId', path, context)
    return entityId && foreignKeyId
      ? { id: parsed.operationId, kind: 'drop-foreign-key', entityId, foreignKeyId }
      : undefined
  },
  'add-unique': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entityId', 'unique'])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    const unique = parseBackendDataUnique(parsed.source.unique, `${path}.unique`, context)
    return entityId && unique
      ? { id: parsed.operationId, kind: 'add-unique', entityId, unique }
      : undefined
  },
  'drop-unique': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entityId', 'uniqueId'])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    const uniqueId = operationIdField(parsed.source, 'uniqueId', path, context)
    return entityId && uniqueId
      ? { id: parsed.operationId, kind: 'drop-unique', entityId, uniqueId }
      : undefined
  },
  'add-index': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entityId', 'index'])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    const index = parseBackendDataIndex(parsed.source.index, `${path}.index`, context)
    return entityId && index
      ? { id: parsed.operationId, kind: 'add-index', entityId, index }
      : undefined
  },
  'drop-index': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entityId', 'indexId'])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    const indexId = operationIdField(parsed.source, 'indexId', path, context)
    return entityId && indexId
      ? { id: parsed.operationId, kind: 'drop-index', entityId, indexId }
      : undefined
  },
  'rewrite-data': (value, path, context) => {
    const parsed = operationSource(value, path, context, ['entityId', 'reason'])
    if (!parsed) return undefined
    const entityId = operationIdField(parsed.source, 'entityId', path, context)
    const reason = boundedText(
      parsed.source.reason,
      `${path}.reason`,
      context,
      BACKEND_LIMITS.maxReasonLength
    )
    return entityId && reason
      ? { id: parsed.operationId, kind: 'rewrite-data', entityId, reason }
      : undefined
  }
}

export function parseMigrationOperation(
  value: unknown,
  path: string,
  context: BackendValidationContext
): MigrationOperation | undefined {
  const envelope = record(value, path, context, MIGRATION_OPERATION_KEYS, ['id', 'kind'])
  if (!envelope) return undefined
  const kind = oneOf(envelope.kind, `${path}.kind`, context, MIGRATION_OPERATION_KINDS)
  return kind ? OPERATION_PARSERS[kind](value, path, context) : undefined
}
