import { discriminatedRecord } from './discriminated-record'
import { BACKEND_LIMITS } from './limits'
import {
  BACKEND_STORAGE_IR_VERSION,
  type AuthPolicyIR,
  type BackendStorageBucketIR,
  type BackendStorageIR,
  type BackendStorageOperation,
  type BackendStoragePathRuleIR,
  type BackendStoragePrincipalIntent
} from './types'
import {
  array,
  id,
  oneOf,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext
} from './validation-helpers'

const STORAGE_PRINCIPAL_SHAPES = {
  owner: { allowed: ['kind'], required: ['kind'] },
  'tenant-member': { allowed: ['kind', 'tenantId'], required: ['kind', 'tenantId'] }
} as const

const STORAGE_BUCKET_NAME = /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/u
const STORAGE_PREFIX_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/u
const MIME_TYPE = /^(?:[a-z0-9][a-z0-9!#$&^_.+-]{0,63})\/(?:\*|[a-z0-9][a-z0-9!#$&^_.+-]{0,126})$/u
const STORAGE_OPERATION_ORDER: readonly BackendStorageOperation[] = Object.freeze([
  'read',
  'create',
  'update',
  'delete',
  'upsert'
])

function boundedInteger(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  maximum: number
): number | undefined {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    context.diagnostics.push({
      code: 'backend-storage-size-invalid',
      severity: 'error',
      path,
      message: `Storage object size must be an integer between 1 and ${maximum}.`
    })
    return undefined
  }
  return value as number
}

function storagePrincipal(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendStoragePrincipalIntent | undefined {
  const parsed = discriminatedRecord(value, path, context, STORAGE_PRINCIPAL_SHAPES)
  if (!parsed) return undefined
  if (parsed.kind === 'owner') return { kind: 'owner' }
  const tenantId = id(parsed.source.tenantId, `${path}.tenantId`, context)
  return tenantId ? { kind: 'tenant-member', tenantId } : undefined
}

function prefixSegments(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string[] | undefined {
  const raw = array(value, path, context, BACKEND_LIMITS.maxStoragePrefixSegments)
  if (!raw) return undefined
  const parsed = raw.flatMap((entry, index) => {
    if (typeof entry === 'string' && STORAGE_PREFIX_SEGMENT.test(entry)) return [entry]
    context.diagnostics.push({
      code: 'backend-storage-prefix-invalid',
      severity: 'error',
      path: `${path}[${index}]`,
      message: 'Storage path prefixes must contain safe literal path segments.'
    })
    return []
  })
  return parsed.length === raw.length ? parsed : undefined
}

function storagePathRule(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendStoragePathRuleIR | undefined {
  const source = record(value, path, context, ['id', 'prefix', 'principal', 'operations'])
  if (!source) return undefined
  const ruleId = id(source.id, `${path}.id`, context)
  const prefix = prefixSegments(source.prefix, `${path}.prefix`, context)
  const principal = storagePrincipal(source.principal, `${path}.principal`, context)
  const rawOperations = array(source.operations, `${path}.operations`, context, 5)
  const operations = (rawOperations ?? []).flatMap((entry, index) => {
    const operation = oneOf(entry, `${path}.operations[${index}]`, context, STORAGE_OPERATION_ORDER)
    return operation ? [operation] : []
  })
  if (rawOperations && operations.length === 0) {
    context.diagnostics.push({
      code: 'backend-storage-operations-empty',
      severity: 'error',
      path: `${path}.operations`,
      message: 'A storage path rule must contain at least one operation.'
    })
  }
  uniqueBy(operations, `${path}.operations`, context, 'storage operation')
  return ruleId && prefix && principal && rawOperations?.length === operations.length
    ? {
        id: ruleId,
        prefix,
        principal,
        operations: STORAGE_OPERATION_ORDER.filter((entry) => operations.includes(entry))
      }
    : undefined
}

function mimeTypes(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string[] | undefined {
  const raw = array(value, path, context, BACKEND_LIMITS.maxStorageMimeTypes)
  if (!raw || raw.length === 0) {
    if (raw) {
      context.diagnostics.push({
        code: 'backend-storage-mime-types-empty',
        severity: 'error',
        path,
        message: 'A storage bucket must declare at least one allowed MIME type.'
      })
    }
    return undefined
  }
  const parsed = raw.flatMap((entry, index) => {
    if (typeof entry === 'string' && MIME_TYPE.test(entry)) return [entry]
    context.diagnostics.push({
      code: 'backend-storage-mime-type-invalid',
      severity: 'error',
      path: `${path}[${index}]`,
      message: 'Storage MIME types must use a bounded lowercase type/subtype pattern.'
    })
    return []
  })
  uniqueBy(parsed, path, context, 'storage MIME type')
  return parsed.length === raw.length
    ? [...parsed].sort((left, right) => left.localeCompare(right, 'en'))
    : undefined
}

function storageBucket(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendStorageBucketIR | undefined {
  const source = record(value, path, context, [
    'id',
    'name',
    'access',
    'maxObjectBytes',
    'allowedMimeTypes',
    'pathRules'
  ])
  if (!source) return undefined
  const bucketId = id(source.id, `${path}.id`, context)
  const name =
    typeof source.name === 'string' && STORAGE_BUCKET_NAME.test(source.name)
      ? source.name
      : undefined
  if (!name) {
    context.diagnostics.push({
      code: 'backend-storage-bucket-name-invalid',
      severity: 'error',
      path: `${path}.name`,
      message: 'Storage bucket names must be bounded lowercase identifiers.'
    })
  }
  const access = oneOf(source.access, `${path}.access`, context, ['private', 'public-read'])
  const maxObjectBytes = boundedInteger(
    source.maxObjectBytes,
    `${path}.maxObjectBytes`,
    context,
    BACKEND_LIMITS.maxStorageObjectBytes
  )
  const allowedMimeTypes = mimeTypes(source.allowedMimeTypes, `${path}.allowedMimeTypes`, context)
  const pathRules = parseArrayItems(
    source.pathRules,
    `${path}.pathRules`,
    context,
    BACKEND_LIMITS.maxStoragePathRules,
    storagePathRule
  )
  if (pathRules?.length === 0) {
    context.diagnostics.push({
      code: 'backend-storage-path-rules-empty',
      severity: 'error',
      path: `${path}.pathRules`,
      message: 'A storage bucket must declare at least one owner or tenant path rule.'
    })
  }
  if (pathRules)
    uniqueBy(
      pathRules.map((entry) => entry.id),
      `${path}.pathRules`,
      context,
      'storage path rule id'
    )
  return bucketId && name && access && maxObjectBytes && allowedMimeTypes && pathRules?.length
    ? {
        id: bucketId,
        name,
        access,
        maxObjectBytes,
        allowedMimeTypes,
        pathRules: sorted(pathRules, (entry) => entry.id)
      }
    : undefined
}

function validateStorageReferences(
  storage: BackendStorageIR,
  auth: AuthPolicyIR,
  context: BackendValidationContext
): void {
  const tenants = new Map(auth.tenants.map((entry) => [entry.id, entry]))
  for (const bucket of storage.buckets) {
    for (const rule of bucket.pathRules) {
      if (rule.principal.kind !== 'tenant-member') continue
      const tenant = tenants.get(rule.principal.tenantId)
      const path = `$.storage.buckets.${bucket.id}.pathRules.${rule.id}.principal.tenantId`
      if (!tenant) {
        context.diagnostics.push({
          code: 'backend-storage-tenant-missing',
          severity: 'error',
          path,
          message: 'Storage path rule references an unknown tenant rule.'
        })
      } else if (
        !tenant.membershipEntityId ||
        !tenant.membershipIdentityFieldId ||
        !tenant.membershipTenantFieldId
      ) {
        context.diagnostics.push({
          code: 'backend-storage-tenant-membership-required',
          severity: 'error',
          path,
          message: 'Storage tenant paths require a complete tenant membership mapping.'
        })
      }
    }
  }
}

export function parseBackendStorageIR(
  value: unknown,
  path: string,
  auth: AuthPolicyIR,
  context: BackendValidationContext
): BackendStorageIR | undefined {
  const source = record(value, path, context, ['version', 'buckets'])
  if (!source) return undefined
  if (source.version !== BACKEND_STORAGE_IR_VERSION) {
    context.diagnostics.push({
      code: 'backend-storage-version-unsupported',
      severity: 'error',
      path: `${path}.version`,
      message: 'Backend storage version is not supported.'
    })
  }
  const buckets = parseArrayItems(
    source.buckets,
    `${path}.buckets`,
    context,
    BACKEND_LIMITS.maxStorageBuckets,
    storageBucket
  )
  if (!buckets || source.version !== BACKEND_STORAGE_IR_VERSION) return undefined
  uniqueBy(
    buckets.map((entry) => entry.id),
    `${path}.buckets`,
    context,
    'storage bucket id'
  )
  uniqueBy(
    buckets.map((entry) => entry.name),
    `${path}.buckets`,
    context,
    'storage bucket name'
  )
  const storage: BackendStorageIR = {
    version: BACKEND_STORAGE_IR_VERSION,
    buckets: sorted(buckets, (entry) => entry.id)
  }
  validateStorageReferences(storage, auth, context)
  return storage
}
