import { BACKEND_LIMITS } from '@open-pencil/lowcode/backend'

import {
  INSPECTION_CONSTRAINT_KINDS,
  INSPECTION_DEFAULT_PRIVILEGE_OBJECT_KINDS,
  INSPECTION_FK_ACTIONS,
  INSPECTION_INVENTORY_SOURCES,
  INSPECTION_OBJECT_MANAGEMENT,
  INSPECTION_PRIVILEGES,
  type SupabaseInspectionConstraintV1,
  type SupabaseInspectionDefaultPrivilegeV1,
  type SupabaseInspectionIndexV1,
  type SupabaseInspectionObjectManagement
} from './contract'
import { parseManagedIdentity, parseRole } from './object-parser'
import {
  array,
  boolean,
  exactRecord,
  identifier,
  invalid,
  oneOf,
  parseTableObjectIdentity,
  record,
  schema,
  validateDigest,
  type UnknownRecord
} from './primitives'

function parseIdentifierList(value: unknown, path: string): readonly string[] {
  const fields = array(value, path, BACKEND_LIMITS.maxFieldsPerEntity).map((entry, index) =>
    identifier(entry, `${path}[${String(index)}]`)
  )
  if (fields.length === 0) invalid(path, 'field list cannot be empty')
  if (new Set(fields).size !== fields.length) invalid(path, 'field list must be unique')
  return fields
}

function constraintBase(
  raw: UnknownRecord,
  path: string,
  allowed: readonly string[]
): {
  source: UnknownRecord
  management: SupabaseInspectionObjectManagement
  openPencilId?: string
} {
  const source = exactRecord(
    raw,
    path,
    ['kind', 'schema', 'tableName', 'name', 'management', 'openPencilId', ...allowed],
    ['kind', 'schema', 'tableName', 'name', 'management', ...allowed]
  )
  const management = oneOf(source.management, `${path}.management`, INSPECTION_OBJECT_MANAGEMENT)
  const openPencilId = parseManagedIdentity(management, source.openPencilId, path)
  return { source, management, ...(openPencilId ? { openPencilId } : {}) }
}

function parsedConstraintBase<
  Kind extends Exclude<SupabaseInspectionConstraintV1['kind'], 'check'>
>(kind: Kind, parsed: ReturnType<typeof constraintBase>, path: string) {
  return {
    kind,
    ...parseTableObjectIdentity(parsed.source, path),
    management: parsed.management,
    ...(parsed.openPencilId ? { openPencilId: parsed.openPencilId } : {}),
    fields: parseIdentifierList(parsed.source.fields, `${path}.fields`)
  }
}

export function parseConstraint(value: unknown, index: number): SupabaseInspectionConstraintV1 {
  const path = `$.constraints[${String(index)}]`
  const raw = record(value, path)
  const kind = oneOf(raw.kind, `${path}.kind`, INSPECTION_CONSTRAINT_KINDS)
  if (kind === 'check') {
    const source = exactRecord(raw, path, [
      'kind',
      'schema',
      'tableName',
      'name',
      'management',
      'expressionDigest'
    ])
    const management = oneOf(source.management, `${path}.management`, ['external', 'unbound'])
    return {
      kind,
      ...parseTableObjectIdentity(source, path),
      management,
      expressionDigest: validateDigest(source.expressionDigest, `${path}.expressionDigest`)
    }
  }
  if (kind === 'foreign-key') {
    const parsed = constraintBase(raw, path, [
      'fields',
      'targetTableName',
      'targetFields',
      'onDelete'
    ])
    return {
      ...parsedConstraintBase(kind, parsed, path),
      targetTableName: identifier(parsed.source.targetTableName, `${path}.targetTableName`),
      targetFields: parseIdentifierList(parsed.source.targetFields, `${path}.targetFields`),
      onDelete: oneOf(parsed.source.onDelete, `${path}.onDelete`, INSPECTION_FK_ACTIONS)
    }
  }
  const parsed = constraintBase(raw, path, ['fields'])
  return parsedConstraintBase(kind, parsed, path)
}

export function parseIndex(value: unknown, index: number): SupabaseInspectionIndexV1 {
  const path = `$.indexes[${String(index)}]`
  const source = exactRecord(
    value,
    path,
    ['schema', 'tableName', 'name', 'management', 'openPencilId', 'fields'],
    ['schema', 'tableName', 'name', 'management', 'fields']
  )
  const management = oneOf(source.management, `${path}.management`, INSPECTION_OBJECT_MANAGEMENT)
  const openPencilId = parseManagedIdentity(management, source.openPencilId, path)
  const fields = array(source.fields, `${path}.fields`, BACKEND_LIMITS.maxFieldsPerEntity).map(
    (entry, fieldIndex) => {
      const field = exactRecord(entry, `${path}.fields[${String(fieldIndex)}]`, ['name', 'order'])
      return {
        name: identifier(field.name, `${path}.fields[${String(fieldIndex)}].name`),
        order: oneOf(field.order, `${path}.fields[${String(fieldIndex)}].order`, ['asc', 'desc'])
      } as const
    }
  )
  if (fields.length === 0) invalid(`${path}.fields`, 'index field list cannot be empty')
  return {
    ...parseTableObjectIdentity(source, path),
    management,
    ...(openPencilId ? { openPencilId } : {}),
    fields
  }
}

export function parseDefaultPrivilege(
  value: unknown,
  index: number
): SupabaseInspectionDefaultPrivilegeV1 {
  const path = `$.defaultPrivileges[${String(index)}]`
  const source = exactRecord(value, path, [
    'schema',
    'objectKind',
    'grantor',
    'grantee',
    'privilege',
    'isGrantable',
    'source'
  ])
  return {
    schema: schema(source.schema, `${path}.schema`),
    objectKind: oneOf(
      source.objectKind,
      `${path}.objectKind`,
      INSPECTION_DEFAULT_PRIVILEGE_OBJECT_KINDS
    ),
    grantor: identifier(source.grantor, `${path}.grantor`),
    grantee: parseRole(source.grantee, `${path}.grantee`),
    privilege: oneOf(source.privilege, `${path}.privilege`, INSPECTION_PRIVILEGES),
    isGrantable: boolean(source.isGrantable, `${path}.isGrantable`),
    source: oneOf(source.source, `${path}.source`, INSPECTION_INVENTORY_SOURCES)
  }
}
