import { parseBackendBrowserClient } from './browser-client'
import { parseBackendHttpQuery } from './http-query-validation'
import { BACKEND_LIMITS } from './limits'
import {
  BACKEND_HTTP_API_IR_VERSION,
  type AuthPolicyIR,
  type BackendHttpAPIAuthenticationIRV1,
  type BackendHttpAPIIRV1,
  type BackendHttpAPIOperation,
  type BackendHttpAPIResourceIRV1,
  type BackendSecretRef,
  type DataEntityIR,
  type DataModelIR
} from './types'
import {
  diagnostic,
  environmentName,
  id,
  oneOf,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendUnknownRecord,
  type BackendValidationContext
} from './validation-helpers'

const OPERATIONS = ['list', 'read', 'create', 'update', 'delete'] as const
const ALGORITHMS = ['RS256', 'ES256'] as const
const RESOURCE_PATH = /^(?:\/[A-Za-z0-9_-]+)+$/u
const ITEM_OPERATIONS = new Set<BackendHttpAPIOperation>(['read', 'update', 'delete'])

interface ApplicationReferences {
  model: DataModelIR
  auth: AuthPolicyIR
  secrets: readonly BackendSecretRef[]
}

function nonEmptyItems<T>(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  limit: number,
  parse: (entry: unknown, entryPath: string, context: BackendValidationContext) => T | undefined
): T[] | undefined {
  const items = parseArrayItems(value, path, context, limit, parse)
  if (items?.length === 0) {
    diagnostic(context, 'backend-http-api-empty', path, 'HTTP API collections must not be empty.')
    return undefined
  }
  return items
}

function stringSet<const T extends string>(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  values: readonly T[]
): T[] | undefined {
  const items = nonEmptyItems(value, path, context, values.length, (entry, entryPath) =>
    oneOf(entry, entryPath, context, values)
  )
  if (!items) return undefined
  uniqueBy(items, path, context, 'HTTP API value')
  return sorted(items, (item) => item)
}

function requiredServerEnvironment(
  value: unknown,
  path: string,
  secrets: readonly BackendSecretRef[],
  context: BackendValidationContext
): string | undefined {
  const name = environmentName(value, path, context)
  if (!name) return undefined
  if (
    !secrets.some(
      (entry) =>
        entry.kind === 'environment' &&
        entry.name === name &&
        entry.exposure === 'server' &&
        entry.required
    )
  ) {
    diagnostic(
      context,
      'backend-http-api-environment-invalid',
      path,
      'JWT settings must reference declared required server environment values.'
    )
  }
  return name
}

function authentication(
  value: unknown,
  path: string,
  references: ApplicationReferences,
  context: BackendValidationContext
): BackendHttpAPIAuthenticationIRV1 | undefined {
  const source = record(value, path, context, [
    'kind',
    'identityId',
    'issuerEnvironment',
    'audienceEnvironment',
    'jwksUrlEnvironment',
    'algorithms'
  ])
  if (!source) return undefined
  const kind = oneOf(source.kind, `${path}.kind`, context, ['jwt'])
  const identityId = id(source.identityId, `${path}.identityId`, context)
  if (
    !references.auth.identities.some((entry) => entry.id === identityId && entry.kind === 'user')
  ) {
    diagnostic(
      context,
      'backend-http-api-identity-invalid',
      `${path}.identityId`,
      'HTTP API authentication must reference a declared user identity.'
    )
  }
  const environment = (key: string) =>
    requiredServerEnvironment(source[key], `${path}.${key}`, references.secrets, context)
  const issuerEnvironment = environment('issuerEnvironment')
  const audienceEnvironment = environment('audienceEnvironment')
  const jwksEnvironment = environment('jwksUrlEnvironment')
  const algorithms = stringSet(source.algorithms, `${path}.algorithms`, context, ALGORITHMS)
  return kind &&
    identityId &&
    issuerEnvironment &&
    audienceEnvironment &&
    jwksEnvironment &&
    algorithms
    ? {
        kind,
        identityId,
        issuerEnvironment,
        audienceEnvironment,
        jwksUrlEnvironment: jwksEnvironment,
        algorithms
      }
    : undefined
}

function resourcePath(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string | undefined {
  if (
    typeof value === 'string' &&
    value.length <= BACKEND_LIMITS.maxHttpApiPathLength &&
    RESOURCE_PATH.test(value)
  )
    return value
  diagnostic(
    context,
    'backend-http-api-path-invalid',
    path,
    'HTTP API paths must be bounded absolute paths containing only static ASCII identifier segments.'
  )
  return undefined
}

function fieldSet(
  value: unknown,
  path: string,
  entity: DataEntityIR,
  context: BackendValidationContext
): string[] | undefined {
  const fields = nonEmptyItems(value, path, context, BACKEND_LIMITS.maxFieldsPerEntity, id)
  if (!fields) return undefined
  uniqueBy(fields, path, context, 'HTTP API field')
  for (const field of fields) {
    if (!entity.fields.some((entry) => entry.id === field)) {
      diagnostic(
        context,
        'backend-http-api-field-unknown',
        path,
        'HTTP API fields must belong to the referenced entity.'
      )
    }
  }
  return sorted(fields, (field) => field)
}

function identityFields(entityId: string, auth: AuthPolicyIR): Set<string> {
  const fields = new Set(
    auth.ownership
      .filter((entry) => entry.entityId === entityId)
      .map((entry) => entry.identityFieldId)
  )
  for (const tenant of auth.tenants) {
    if (tenant.entityId === entityId) fields.add(tenant.tenantFieldId)
    if (tenant.membershipEntityId !== entityId) continue
    if (tenant.membershipIdentityFieldId) fields.add(tenant.membershipIdentityFieldId)
    if (tenant.membershipTenantFieldId) fields.add(tenant.membershipTenantFieldId)
  }
  return fields
}

function writableFields(
  source: BackendUnknownRecord,
  operation: 'create' | 'update',
  operations: readonly BackendHttpAPIOperation[],
  path: string,
  entity: DataEntityIR,
  auth: AuthPolicyIR,
  context: BackendValidationContext
): string[] | undefined {
  const key = `${operation}Fields`
  const fieldPath = `${path}.${key}`
  if (!operations.includes(operation)) {
    if (source[key] !== undefined) {
      diagnostic(
        context,
        'backend-http-api-field-unexpected',
        fieldPath,
        'Write fields require the corresponding HTTP API operation.'
      )
    }
    return undefined
  }
  const fields = fieldSet(source[key], fieldPath, entity, context)
  const protectedFields = identityFields(entity.id, auth)
  if (operation === 'update') {
    for (const field of entity.primaryKey?.fields ?? []) protectedFields.add(field)
  }
  for (const field of fields ?? []) {
    const definition = entity.fields.find((entry) => entry.id === field)
    if (protectedFields.has(field) || definition?.default?.kind === 'generated') {
      diagnostic(
        context,
        'backend-http-api-field-protected',
        fieldPath,
        'Client writes cannot supply generated or identity-controlled fields, or update primary keys.'
      )
    }
  }
  return fields
}

function pageSize(
  value: unknown,
  operations: readonly BackendHttpAPIOperation[],
  path: string,
  context: BackendValidationContext
): number | undefined {
  if (!operations.includes('list')) {
    if (value !== undefined)
      diagnostic(
        context,
        'backend-http-api-page-size-unexpected',
        path,
        'A page size is allowed only for the list operation.'
      )
    return undefined
  }
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= BACKEND_LIMITS.maxHttpApiPageSize
  )
    return value
  diagnostic(
    context,
    'backend-http-api-page-size-invalid',
    path,
    'List operations require an integer maximum page size between 1 and 100.'
  )
  return undefined
}

function validateItemKey(
  entity: DataEntityIR,
  operations: readonly BackendHttpAPIOperation[],
  path: string,
  context: BackendValidationContext
): void {
  if (!operations.some((operation) => ITEM_OPERATIONS.has(operation))) return
  const key = entity.primaryKey?.fields
  const field = key?.length === 1 ? entity.fields.find((entry) => entry.id === key[0]) : undefined
  if (field && !field.nullable && ['string', 'uuid', 'integer'].includes(field.type)) return
  diagnostic(
    context,
    'backend-http-api-primary-key-invalid',
    path,
    'Item operations require a single non-nullable string, UUID, or integer primary key.'
  )
}

function resource(
  value: unknown,
  path: string,
  references: ApplicationReferences,
  context: BackendValidationContext
): BackendHttpAPIResourceIRV1 | undefined {
  const source = record(
    value,
    path,
    context,
    [
      'id',
      'path',
      'entityId',
      'operations',
      'readFields',
      'createFields',
      'updateFields',
      'maxPageSize',
      'query'
    ],
    ['id', 'path', 'entityId', 'operations', 'readFields']
  )
  if (!source) return undefined
  const resourceId = id(source.id, `${path}.id`, context)
  const routePath = resourcePath(source.path, `${path}.path`, context)
  const entityId = id(source.entityId, `${path}.entityId`, context)
  const entity = references.model.entities.find((entry) => entry.id === entityId)
  if (!entity) {
    diagnostic(
      context,
      'backend-http-api-entity-unknown',
      `${path}.entityId`,
      'HTTP API resources must reference a declared entity.'
    )
    return undefined
  }
  const operations = stringSet(source.operations, `${path}.operations`, context, OPERATIONS)
  const readFields = fieldSet(source.readFields, `${path}.readFields`, entity, context)
  if (!operations) return undefined
  const createFields = writableFields(
    source,
    'create',
    operations,
    path,
    entity,
    references.auth,
    context
  )
  const updateFields = writableFields(
    source,
    'update',
    operations,
    path,
    entity,
    references.auth,
    context
  )
  const maxPageSize = pageSize(source.maxPageSize, operations, `${path}.maxPageSize`, context)
  const query =
    source.query === undefined
      ? undefined
      : parseBackendHttpQuery(
          source.query,
          `${path}.query`,
          entity,
          readFields ?? [],
          operations.includes('list'),
          context
        )
  validateItemKey(entity, operations, `${path}.entityId`, context)
  return resourceId && routePath && entityId && readFields
    ? {
        id: resourceId,
        path: routePath,
        entityId,
        operations,
        readFields,
        ...(createFields ? { createFields } : {}),
        ...(updateFields ? { updateFields } : {}),
        ...(maxPageSize === undefined ? {} : { maxPageSize }),
        ...(query ? { query } : {})
      }
    : undefined
}

interface RoutePattern {
  method: string
  segments: string[]
}

function routes(resource: BackendHttpAPIResourceIRV1): RoutePattern[] {
  const methods = {
    list: 'GET',
    read: 'GET',
    create: 'POST',
    update: 'PATCH',
    delete: 'DELETE'
  } as const
  return resource.operations.map((operation) => ({
    method: methods[operation],
    segments: [
      ...resource.path.toLowerCase().split('/'),
      ...(ITEM_OPERATIONS.has(operation) ? [':id'] : [])
    ]
  }))
}

function overlaps(left: RoutePattern, right: RoutePattern): boolean {
  return (
    left.method === right.method &&
    left.segments.length === right.segments.length &&
    left.segments.every(
      (segment, index) =>
        segment === right.segments[index] || segment === ':id' || right.segments[index] === ':id'
    )
  )
}

function validateRoutes(
  resources: readonly BackendHttpAPIResourceIRV1[],
  path: string,
  context: BackendValidationContext
): void {
  const patterns: RoutePattern[] = []
  resources.forEach((entry, index) => {
    for (const route of routes(entry)) {
      if (patterns.some((existing) => overlaps(existing, route))) {
        diagnostic(
          context,
          'backend-http-api-route-conflict',
          `${path}[${index}].path`,
          'HTTP API method and path patterns must not overlap, including item identifiers and case variants.'
        )
      }
      patterns.push(route)
    }
  })
}

/** Internal section parser: the application boundary first checks bounded secret-free plain data. */
export function parseBackendHttpAPIIRV1(
  value: unknown,
  path: string,
  model: DataModelIR,
  auth: AuthPolicyIR,
  secrets: readonly BackendSecretRef[],
  context: BackendValidationContext
): BackendHttpAPIIRV1 | undefined {
  const source = record(
    value,
    path,
    context,
    ['version', 'authentication', 'resources', 'browserClient'],
    ['version', 'authentication', 'resources']
  )
  if (!source) return undefined
  if (source.version !== BACKEND_HTTP_API_IR_VERSION) {
    diagnostic(
      context,
      'backend-http-api-version-unsupported',
      `${path}.version`,
      'HTTP API version is not supported.'
    )
  }
  const references = { model, auth, secrets }
  const parsedAuthentication = authentication(
    source.authentication,
    `${path}.authentication`,
    references,
    context
  )
  const resources = nonEmptyItems(
    source.resources,
    `${path}.resources`,
    context,
    BACKEND_LIMITS.maxHttpApiResources,
    (entry, entryPath) => resource(entry, entryPath, references, context)
  )
  if (!parsedAuthentication || !resources) return undefined
  uniqueBy(
    resources.map((entry) => entry.id),
    `${path}.resources`,
    context,
    'HTTP API resource'
  )
  validateRoutes(resources, `${path}.resources`, context)
  const browserClient =
    source.browserClient === undefined
      ? undefined
      : parseBackendBrowserClient(source.browserClient, `${path}.browserClient`, context)
  return {
    version: BACKEND_HTTP_API_IR_VERSION,
    authentication: parsedAuthentication,
    resources: sorted(resources, (entry) => entry.id),
    ...(browserClient ? { browserClient } : {})
  }
}
