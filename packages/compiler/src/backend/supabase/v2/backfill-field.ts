import type {
  BackendApplicationSpecV2,
  BackendLiteral,
  DataEntityIR,
  DataFieldIR
} from '@open-pencil/lowcode/backend'

const UUID_LITERAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const DATE_LITERAL = /^\d{4}-\d{2}-\d{2}$/u
const RFC3339_DATETIME =
  /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/u

export function sameBackendLiteral(left: BackendLiteral, right: BackendLiteral): boolean {
  return Object.is(left, right)
}

export function isBackendLiteral(value: unknown): value is BackendLiteral {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

function isCanonicalDate(value: string): boolean {
  if (!DATE_LITERAL.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** PostgreSQL text forbids NUL and JSONB rejects unpaired UTF-16 surrogate escapes. */
function isPostgresCompatibleString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit === 0) return false
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
      continue
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false
  }
  return true
}

// oxlint-disable-next-line complexity -- Exhaustive scalar checks repeat the normalized Backend IR boundary defensively.
export function literalMatchesSupabaseBackfillTargetV2(
  application: BackendApplicationSpecV2,
  field: DataFieldIR,
  value: unknown
): value is BackendLiteral {
  if (!isBackendLiteral(value) || value === null) return false
  if (typeof value === 'string' && !isPostgresCompatibleString(value)) return false
  switch (field.type) {
    case 'string':
      return typeof value === 'string'
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value)
    case 'number':
      return typeof value === 'number'
    case 'boolean':
      return typeof value === 'boolean'
    case 'date':
      return typeof value === 'string' && isCanonicalDate(value)
    case 'datetime':
      return (
        typeof value === 'string' &&
        RFC3339_DATETIME.test(value) &&
        isCanonicalDate(RFC3339_DATETIME.exec(value)?.[1] ?? '') &&
        Number.isFinite(Date.parse(value))
      )
    case 'uuid':
      return typeof value === 'string' && UUID_LITERAL.test(value)
    case 'json':
      return true
    case 'enum': {
      const dataEnum = application.dataModel.enums.find((entry) => entry.id === field.enumId)
      return (
        typeof value === 'string' &&
        dataEnum?.values.includes(value) === true &&
        dataEnum.values.every(isPostgresCompatibleString)
      )
    }
    case 'bytes':
      return false
    default: {
      const exhaustive: never = field.type
      void exhaustive
      return false
    }
  }
}

function qualifiedPostgresType(schema: string, name: string): string {
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`
  return `${quote(schema)}.${quote(name)}`
}

export function expectedSupabaseBackfillPostgresTypeV2(
  application: BackendApplicationSpecV2,
  field: DataFieldIR
): string {
  switch (field.type) {
    case 'string':
      return 'pg_catalog.text'
    case 'integer':
      return 'pg_catalog.int8'
    case 'number':
      return 'pg_catalog.float8'
    case 'boolean':
      return 'pg_catalog.bool'
    case 'date':
      return 'pg_catalog.date'
    case 'datetime':
      return 'pg_catalog.timestamptz'
    case 'uuid':
      return 'pg_catalog.uuid'
    case 'json':
      return 'pg_catalog.jsonb'
    case 'bytes':
      throw new TypeError('Byte-literal Supabase backfills are outside the reviewed subset.')
    case 'enum': {
      const dataEnum = application.dataModel.enums.find((entry) => entry.id === field.enumId)
      if (!dataEnum) throw new TypeError('Backfill target enum binding is unavailable.')
      return qualifiedPostgresType('public', dataEnum.name)
    }
    default: {
      const exhaustive: never = field.type
      void exhaustive
      throw new TypeError('Supabase backfill field type is unsupported.')
    }
  }
}

export function supabaseBackfillProtectedFieldsV2(
  application: BackendApplicationSpecV2,
  entity: DataEntityIR
): ReadonlySet<string> {
  const protectedIds = new Set(entity.primaryKey?.fields)
  for (const unique of entity.uniques ?? []) {
    for (const fieldId of unique.fields) protectedIds.add(fieldId)
  }
  for (const foreignKey of entity.foreignKeys ?? []) {
    for (const fieldId of foreignKey.fields) protectedIds.add(fieldId)
  }
  for (const candidate of application.dataModel.entities) {
    for (const foreignKey of candidate.foreignKeys ?? []) {
      if (foreignKey.targetEntityId !== entity.id) continue
      for (const fieldId of foreignKey.targetFields) protectedIds.add(fieldId)
    }
  }
  for (const ownership of application.auth.ownership) {
    if (ownership.entityId === entity.id) protectedIds.add(ownership.identityFieldId)
  }
  for (const tenant of application.auth.tenants) {
    if (tenant.entityId === entity.id) protectedIds.add(tenant.tenantFieldId)
    if (tenant.membershipEntityId !== entity.id) continue
    if (tenant.membershipIdentityFieldId) protectedIds.add(tenant.membershipIdentityFieldId)
    if (tenant.membershipTenantFieldId) protectedIds.add(tenant.membershipTenantFieldId)
  }
  return protectedIds
}
