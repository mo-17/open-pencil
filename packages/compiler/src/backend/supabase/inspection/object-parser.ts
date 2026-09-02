import { BACKEND_LIMITS, type BackendLiteral } from '@open-pencil/lowcode/backend'

import {
  INSPECTION_COVERAGE_KEYS,
  INSPECTION_FIELD_TYPES,
  INSPECTION_GENERATED_DEFAULTS,
  INSPECTION_INVENTORY_SOURCES,
  INSPECTION_OBJECT_KINDS,
  INSPECTION_OBJECT_MANAGEMENT,
  INSPECTION_POLICY_COMMANDS,
  INSPECTION_POLICY_MODES,
  INSPECTION_PRIVILEGE_OBJECT_KINDS,
  INSPECTION_PRIVILEGES,
  type SupabaseInspectionColumnDefaultV1,
  type SupabaseInspectionColumnV1,
  type SupabaseInspectionCoverageV1,
  type SupabaseInspectionObjectManagement,
  type SupabaseInspectionObjectV1,
  type SupabaseInspectionPolicyV1,
  type SupabaseInspectionPrivilegeV1,
  type SupabaseInspectionProvenanceV1,
  type SupabaseInspectionRoleMembershipV1,
  type SupabaseInspectionRoleV1
} from './contract'
import {
  array,
  boolean,
  exactRecord,
  identifier,
  invalid,
  oneOf,
  optionalStableId,
  parseNamedObjectIdentity,
  parseTableObjectIdentity,
  record,
  schema,
  stableId,
  validateDigest
} from './primitives'

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export function parseCoverage(value: unknown): SupabaseInspectionCoverageV1 {
  const source = exactRecord(value, '$.coverage', INSPECTION_COVERAGE_KEYS)
  return Object.fromEntries(
    INSPECTION_COVERAGE_KEYS.map((key) => {
      if (source[key] !== 'complete') {
        invalid(`$.coverage.${key}`, 'release inspection coverage must be complete')
      }
      return [key, 'complete']
    })
  ) as SupabaseInspectionCoverageV1
}

export function parseProvenance(value: unknown): SupabaseInspectionProvenanceV1 {
  const source = exactRecord(value, '$.provenance', [
    'projectRef',
    'accountId',
    'querySchemaVersion',
    'databaseRole',
    'observedAt',
    'completeness',
    'truncated'
  ])
  const observedAt = source.observedAt
  if (
    typeof observedAt !== 'string' ||
    !ISO_INSTANT.test(observedAt) ||
    Number.isNaN(Date.parse(observedAt)) ||
    new Date(observedAt).toISOString() !== observedAt
  ) {
    invalid('$.provenance.observedAt', 'expected an exact UTC millisecond timestamp')
  }
  if (source.completeness !== 'complete') {
    invalid('$.provenance.completeness', 'inspection must declare complete provenance')
  }
  if (source.truncated !== false) {
    invalid('$.provenance.truncated', 'truncated inspection results are forbidden')
  }
  return {
    projectRef: stableId(source.projectRef, '$.provenance.projectRef'),
    accountId: stableId(source.accountId, '$.provenance.accountId'),
    querySchemaVersion: stableId(source.querySchemaVersion, '$.provenance.querySchemaVersion'),
    databaseRole: identifier(source.databaseRole, '$.provenance.databaseRole'),
    observedAt,
    completeness: 'complete',
    truncated: false
  }
}

export function parseManagedIdentity(
  management: SupabaseInspectionObjectManagement,
  rawId: unknown,
  path: string
): string | undefined {
  const openPencilId = optionalStableId(rawId, `${path}.openPencilId`)
  if (management === 'managed' && !openPencilId) {
    invalid(`${path}.openPencilId`, 'managed objects require an exact OpenPencil identity marker')
  }
  if (management !== 'managed' && openPencilId) {
    invalid(
      `${path}.openPencilId`,
      'external or unbound objects cannot claim an OpenPencil identity'
    )
  }
  return openPencilId
}

export function parseObject(value: unknown, index: number): SupabaseInspectionObjectV1 {
  const path = `$.objects[${String(index)}]`
  const raw = record(value, path)
  const kind = oneOf(raw.kind, `${path}.kind`, INSPECTION_OBJECT_KINDS)
  if (kind === 'table') {
    const source = exactRecord(
      raw,
      path,
      ['kind', 'schema', 'name', 'management', 'openPencilId', 'rlsEnabled', 'rlsForced'],
      ['kind', 'schema', 'name', 'management', 'rlsEnabled', 'rlsForced']
    )
    const management = oneOf(source.management, `${path}.management`, INSPECTION_OBJECT_MANAGEMENT)
    const openPencilId = parseManagedIdentity(management, source.openPencilId, path)
    return {
      kind,
      ...parseNamedObjectIdentity(source, path),
      management,
      ...(openPencilId ? { openPencilId } : {}),
      rlsEnabled: boolean(source.rlsEnabled, `${path}.rlsEnabled`),
      rlsForced: boolean(source.rlsForced, `${path}.rlsForced`)
    }
  }
  if (kind === 'enum') {
    const source = exactRecord(
      raw,
      path,
      ['kind', 'schema', 'name', 'management', 'openPencilId', 'values'],
      ['kind', 'schema', 'name', 'management', 'values']
    )
    const management = oneOf(source.management, `${path}.management`, INSPECTION_OBJECT_MANAGEMENT)
    const openPencilId = parseManagedIdentity(management, source.openPencilId, path)
    const values = array(source.values, `${path}.values`, BACKEND_LIMITS.maxEnumValues).map(
      (entry, valueIndex) => identifier(entry, `${path}.values[${String(valueIndex)}]`)
    )
    if (new Set(values).size !== values.length) {
      invalid(`${path}.values`, 'enum values must be unique')
    }
    return {
      kind,
      ...parseNamedObjectIdentity(source, path),
      management,
      ...(openPencilId ? { openPencilId } : {}),
      values
    }
  }
  if (kind === 'sequence') {
    const source = exactRecord(
      raw,
      path,
      ['kind', 'schema', 'name', 'management', 'ownedBy'],
      ['kind', 'schema', 'name', 'management']
    )
    const management = oneOf(source.management, `${path}.management`, INSPECTION_OBJECT_MANAGEMENT)
    let ownedBy: { entityId: string; fieldId: string } | undefined
    if (source.ownedBy !== undefined) {
      const owner = exactRecord(source.ownedBy, `${path}.ownedBy`, ['entityId', 'fieldId'])
      ownedBy = {
        entityId: stableId(owner.entityId, `${path}.ownedBy.entityId`),
        fieldId: stableId(owner.fieldId, `${path}.ownedBy.fieldId`)
      }
    }
    if (management === 'managed' && !ownedBy) {
      invalid(`${path}.ownedBy`, 'managed sequences require an exact owning field')
    }
    return {
      kind,
      ...parseNamedObjectIdentity(source, path),
      management,
      ...(ownedBy ? { ownedBy } : {})
    }
  }
  if (kind === 'view') {
    const source = exactRecord(raw, path, [
      'kind',
      'schema',
      'name',
      'management',
      'securityInvoker'
    ])
    const management = oneOf(source.management, `${path}.management`, ['external', 'unbound'])
    return {
      kind,
      ...parseNamedObjectIdentity(source, path),
      management,
      securityInvoker: boolean(source.securityInvoker, `${path}.securityInvoker`)
    }
  }
  const source = exactRecord(raw, path, ['kind', 'schema', 'name', 'management', 'securityDefiner'])
  const management = oneOf(source.management, `${path}.management`, ['external', 'unbound'])
  return {
    kind,
    ...parseNamedObjectIdentity(source, path),
    management,
    securityDefiner: boolean(source.securityDefiner, `${path}.securityDefiner`)
  }
}

export function parseRole(value: unknown, path: string): string {
  if (value === 'PUBLIC') return value
  return identifier(value, path)
}

export function parseInspectionRole(value: unknown, index: number): SupabaseInspectionRoleV1 {
  const path = `$.roles[${String(index)}]`
  const source = exactRecord(value, path, ['roleName', 'superuser', 'bypassRls', 'inherit'])
  return {
    roleName: identifier(source.roleName, `${path}.roleName`),
    superuser: boolean(source.superuser, `${path}.superuser`),
    bypassRls: boolean(source.bypassRls, `${path}.bypassRls`),
    inherit: boolean(source.inherit, `${path}.inherit`)
  }
}

export function parseRoleMembership(
  value: unknown,
  index: number
): SupabaseInspectionRoleMembershipV1 {
  const path = `$.roleMemberships[${String(index)}]`
  const source = exactRecord(value, path, [
    'roleName',
    'memberName',
    'grantorName',
    'adminOption',
    'inheritOption',
    'setOption'
  ])
  const roleName = identifier(source.roleName, `${path}.roleName`)
  const memberName = identifier(source.memberName, `${path}.memberName`)
  if (roleName === memberName) {
    invalid(path, 'role membership cannot grant a role to itself')
  }
  return {
    roleName,
    memberName,
    grantorName: identifier(source.grantorName, `${path}.grantorName`),
    adminOption: boolean(source.adminOption, `${path}.adminOption`),
    inheritOption: boolean(source.inheritOption, `${path}.inheritOption`),
    setOption: boolean(source.setOption, `${path}.setOption`)
  }
}

export function parsePolicy(value: unknown, index: number): SupabaseInspectionPolicyV1 {
  const path = `$.policies[${String(index)}]`
  const source = exactRecord(value, path, [
    'schema',
    'tableName',
    'name',
    'command',
    'mode',
    'roles',
    'source',
    'usingExpressionDigest',
    'withCheckExpressionDigest'
  ])
  const roles = array(source.roles, `${path}.roles`, 64)
    .map((entry, roleIndex) => parseRole(entry, `${path}.roles[${String(roleIndex)}]`))
    .sort()
  if (new Set(roles).size !== roles.length) invalid(`${path}.roles`, 'roles must be unique')
  return {
    schema: schema(source.schema, `${path}.schema`),
    tableName: identifier(source.tableName, `${path}.tableName`),
    name: identifier(source.name, `${path}.name`),
    command: oneOf(source.command, `${path}.command`, INSPECTION_POLICY_COMMANDS),
    mode: oneOf(source.mode, `${path}.mode`, INSPECTION_POLICY_MODES),
    roles,
    source: oneOf(source.source, `${path}.source`, INSPECTION_INVENTORY_SOURCES),
    usingExpressionDigest:
      source.usingExpressionDigest === null
        ? null
        : validateDigest(source.usingExpressionDigest, `${path}.usingExpressionDigest`),
    withCheckExpressionDigest:
      source.withCheckExpressionDigest === null
        ? null
        : validateDigest(source.withCheckExpressionDigest, `${path}.withCheckExpressionDigest`)
  }
}

export function parsePrivilege(value: unknown, index: number): SupabaseInspectionPrivilegeV1 {
  const path = `$.privileges[${String(index)}]`
  const source = exactRecord(value, path, [
    'objectKind',
    'schema',
    'objectName',
    'grantor',
    'grantee',
    'privilege',
    'isGrantable',
    'source'
  ])
  const objectKind = oneOf(
    source.objectKind,
    `${path}.objectKind`,
    INSPECTION_PRIVILEGE_OBJECT_KINDS
  )
  const objectName = identifier(source.objectName, `${path}.objectName`)
  const objectSchema = schema(source.schema, `${path}.schema`)
  const grantor = identifier(source.grantor, `${path}.grantor`)
  const grantee = parseRole(source.grantee, `${path}.grantee`)
  const privilege = oneOf(source.privilege, `${path}.privilege`, INSPECTION_PRIVILEGES)
  const isGrantable = boolean(source.isGrantable, `${path}.isGrantable`)
  const inventorySource = oneOf(source.source, `${path}.source`, INSPECTION_INVENTORY_SOURCES)
  if (objectKind === 'schema' && objectName !== 'public') {
    invalid(`${path}.objectName`, 'schema privileges must reference exactly public')
  }
  if (objectKind === 'schema') {
    return {
      objectKind,
      schema: objectSchema,
      objectName: 'public',
      grantor,
      grantee,
      privilege,
      isGrantable,
      source: inventorySource
    }
  }
  return {
    objectKind,
    schema: objectSchema,
    objectName,
    grantor,
    grantee,
    privilege,
    isGrantable,
    source: inventorySource
  }
}

function parseLiteral(value: unknown, path: string): BackendLiteral {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value
  }
  return invalid(path, 'expected a finite backend literal')
}

function parseColumnDefault(value: unknown, path: string): SupabaseInspectionColumnDefaultV1 {
  if (value === null) return null
  const raw = record(value, path)
  const kind = oneOf(raw.kind, `${path}.kind`, ['literal', 'generated', 'unbound'])
  if (kind === 'literal') {
    const source = exactRecord(raw, path, ['kind', 'value'])
    return { kind, value: parseLiteral(source.value, `${path}.value`) }
  }
  if (kind === 'generated') {
    const source = exactRecord(raw, path, ['kind', 'generator'])
    return {
      kind,
      generator: oneOf(source.generator, `${path}.generator`, INSPECTION_GENERATED_DEFAULTS)
    }
  }
  const source = exactRecord(raw, path, ['kind', 'expressionDigest'])
  return {
    kind,
    expressionDigest: validateDigest(source.expressionDigest, `${path}.expressionDigest`)
  }
}

export function parseColumn(value: unknown, index: number): SupabaseInspectionColumnV1 {
  const path = `$.columns[${String(index)}]`
  const source = exactRecord(
    value,
    path,
    [
      'schema',
      'tableName',
      'name',
      'columnPrivilegesPresent',
      'management',
      'openPencilFieldId',
      'type',
      'enumName',
      'nullable',
      'default'
    ],
    [
      'schema',
      'tableName',
      'name',
      'columnPrivilegesPresent',
      'management',
      'type',
      'nullable',
      'default'
    ]
  )
  if (source.columnPrivilegesPresent !== false) {
    invalid(
      `${path}.columnPrivilegesPresent`,
      'column-level ACLs are unsupported and their inspected absence must be explicit'
    )
  }
  const management = oneOf(source.management, `${path}.management`, INSPECTION_OBJECT_MANAGEMENT)
  const openPencilFieldId = optionalStableId(source.openPencilFieldId, `${path}.openPencilFieldId`)
  if (management === 'managed' && !openPencilFieldId) {
    invalid(`${path}.openPencilFieldId`, 'managed columns require an exact field marker')
  }
  if (management !== 'managed' && openPencilFieldId) {
    invalid(`${path}.openPencilFieldId`, 'external or unbound columns cannot claim a field marker')
  }
  const type = oneOf(source.type, `${path}.type`, INSPECTION_FIELD_TYPES)
  const enumName =
    source.enumName === undefined ? undefined : identifier(source.enumName, `${path}.enumName`)
  if ((type === 'enum') !== Boolean(enumName)) {
    invalid(`${path}.enumName`, 'enum columns require exactly one enum name')
  }
  const columnDefault = parseColumnDefault(source.default, `${path}.default`)
  if (management === 'managed' && columnDefault?.kind === 'unbound') {
    invalid(`${path}.default`, 'managed columns cannot carry an unbound provider expression')
  }
  return {
    ...parseTableObjectIdentity(source, path),
    columnPrivilegesPresent: false,
    management,
    ...(openPencilFieldId ? { openPencilFieldId } : {}),
    type,
    ...(enumName ? { enumName } : {}),
    nullable: boolean(source.nullable, `${path}.nullable`),
    default: columnDefault
  }
}

export function objectKey(
  object: Pick<SupabaseInspectionObjectV1, 'kind' | 'schema' | 'name'>
): string {
  return `${object.kind}:${object.schema}:${object.name}`
}

export function privilegeObjectKey(privilege: SupabaseInspectionPrivilegeV1): string {
  return `${privilege.objectKind}:${privilege.schema}:${privilege.objectName}`
}
