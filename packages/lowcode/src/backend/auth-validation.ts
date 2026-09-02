import { discriminatedRecord } from './discriminated-record'
import { BACKEND_LIMITS } from './limits'
import {
  AUTH_POLICY_IR_VERSION,
  type AuthAccessOperation,
  type AuthIdentityIR,
  type AuthOwnershipIR,
  type AuthPolicyIR,
  type AuthPrincipalIntent,
  type AuthRoleIR,
  type AuthRowAccessIntentIR,
  type AuthTenantIR,
  type DataModelIR
} from './types'
import {
  array,
  id,
  identifier,
  oneOf,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext
} from './validation-helpers'

const PRINCIPAL_SHAPES = {
  anonymous: { allowed: ['kind'], required: ['kind'] },
  authenticated: { allowed: ['kind'], required: ['kind'] },
  role: { allowed: ['kind', 'roleId'], required: ['kind', 'roleId'] },
  owner: { allowed: ['kind', 'ownershipId'], required: ['kind', 'ownershipId'] },
  'tenant-member': { allowed: ['kind', 'tenantId'], required: ['kind', 'tenantId'] }
} as const

function identity(
  value: unknown,
  path: string,
  context: BackendValidationContext
): AuthIdentityIR | undefined {
  const source = record(value, path, context, ['id', 'kind'])
  if (!source) return undefined
  const identityId = id(source.id, `${path}.id`, context)
  const kind = oneOf(source.kind, `${path}.kind`, context, ['anonymous', 'user', 'service'])
  return identityId && kind ? { id: identityId, kind } : undefined
}

function role(
  value: unknown,
  path: string,
  context: BackendValidationContext
): AuthRoleIR | undefined {
  const source = record(value, path, context, ['id', 'name'])
  if (!source) return undefined
  const roleId = id(source.id, `${path}.id`, context)
  const name = identifier(source.name, `${path}.name`, context)
  return roleId && name ? { id: roleId, name } : undefined
}

function ownership(
  value: unknown,
  path: string,
  context: BackendValidationContext
): AuthOwnershipIR | undefined {
  const source = record(value, path, context, ['id', 'entityId', 'identityFieldId'])
  if (!source) return undefined
  const ownershipId = id(source.id, `${path}.id`, context)
  const entityId = id(source.entityId, `${path}.entityId`, context)
  const identityFieldId = id(source.identityFieldId, `${path}.identityFieldId`, context)
  return ownershipId && entityId && identityFieldId
    ? { id: ownershipId, entityId, identityFieldId }
    : undefined
}

function tenant(
  value: unknown,
  path: string,
  context: BackendValidationContext
): AuthTenantIR | undefined {
  const source = record(
    value,
    path,
    context,
    [
      'id',
      'entityId',
      'tenantFieldId',
      'membershipEntityId',
      'membershipIdentityFieldId',
      'membershipTenantFieldId'
    ],
    ['id', 'entityId', 'tenantFieldId']
  )
  if (!source) return undefined
  const tenantId = id(source.id, `${path}.id`, context)
  const entityId = id(source.entityId, `${path}.entityId`, context)
  const tenantFieldId = id(source.tenantFieldId, `${path}.tenantFieldId`, context)
  const membershipEntityId =
    source.membershipEntityId === undefined
      ? undefined
      : id(source.membershipEntityId, `${path}.membershipEntityId`, context)
  const membershipIdentityFieldId =
    source.membershipIdentityFieldId === undefined
      ? undefined
      : id(source.membershipIdentityFieldId, `${path}.membershipIdentityFieldId`, context)
  const membershipTenantFieldId =
    source.membershipTenantFieldId === undefined
      ? undefined
      : id(source.membershipTenantFieldId, `${path}.membershipTenantFieldId`, context)
  const membershipCount = [
    membershipEntityId,
    membershipIdentityFieldId,
    membershipTenantFieldId
  ].filter(Boolean).length
  if (membershipCount !== 0 && membershipCount !== 3) {
    context.diagnostics.push({
      code: 'backend-tenant-membership-incomplete',
      severity: 'error',
      path,
      message: 'Tenant membership references must be absent or complete.'
    })
  }
  return tenantId && entityId && tenantFieldId && (membershipCount === 0 || membershipCount === 3)
    ? {
        id: tenantId,
        entityId,
        tenantFieldId,
        ...(membershipEntityId ? { membershipEntityId } : {}),
        ...(membershipIdentityFieldId ? { membershipIdentityFieldId } : {}),
        ...(membershipTenantFieldId ? { membershipTenantFieldId } : {})
      }
    : undefined
}

function principal(
  value: unknown,
  path: string,
  context: BackendValidationContext
): AuthPrincipalIntent | undefined {
  const parsed = discriminatedRecord(value, path, context, PRINCIPAL_SHAPES)
  if (!parsed) return undefined
  const { kind, source } = parsed
  if (kind === 'anonymous' || kind === 'authenticated') {
    return { kind }
  }
  if (kind === 'role') {
    const roleId = id(source.roleId, `${path}.roleId`, context)
    return roleId ? { kind, roleId } : undefined
  }
  if (kind === 'owner') {
    const ownershipId = id(source.ownershipId, `${path}.ownershipId`, context)
    return ownershipId ? { kind, ownershipId } : undefined
  }
  const tenantId = id(source.tenantId, `${path}.tenantId`, context)
  return tenantId ? { kind, tenantId } : undefined
}

function rowAccess(
  value: unknown,
  path: string,
  context: BackendValidationContext
): AuthRowAccessIntentIR | undefined {
  const source = record(value, path, context, [
    'id',
    'entityId',
    'effect',
    'operations',
    'principal'
  ])
  if (!source) return undefined
  const accessId = id(source.id, `${path}.id`, context)
  const entityId = id(source.entityId, `${path}.entityId`, context)
  const effect = oneOf(source.effect, `${path}.effect`, context, ['allow', 'deny'])
  const rawOperations = array(source.operations, `${path}.operations`, context, 4)
  const operations = (rawOperations ?? [])
    .map((entry, index) =>
      oneOf(entry, `${path}.operations[${index}]`, context, [
        'select',
        'insert',
        'update',
        'delete'
      ])
    )
    .filter((entry): entry is AuthAccessOperation => entry !== undefined)
  if (operations.length === 0) {
    context.diagnostics.push({
      code: 'backend-policy-operations-empty',
      severity: 'error',
      path: `${path}.operations`,
      message: 'A row-access intent must contain at least one operation.'
    })
  }
  uniqueBy(operations, `${path}.operations`, context, 'access operation')
  const parsedPrincipal = principal(source.principal, `${path}.principal`, context)
  const order: readonly AuthAccessOperation[] = ['select', 'insert', 'update', 'delete']
  return accessId && entityId && effect && rawOperations && operations.length > 0 && parsedPrincipal
    ? {
        id: accessId,
        entityId,
        effect,
        operations: order.filter((entry) => operations.includes(entry)),
        principal: parsedPrincipal
      }
    : undefined
}

function validatePrincipalReference(
  entry: AuthRowAccessIntentIR,
  roles: ReadonlySet<string>,
  ownership: ReadonlyMap<string, AuthOwnershipIR>,
  tenants: ReadonlyMap<string, AuthTenantIR>,
  context: BackendValidationContext
): void {
  const path = `$.auth.rowAccess.${entry.id}.principal`
  if (entry.principal.kind === 'role' && !roles.has(entry.principal.roleId)) {
    context.diagnostics.push({
      code: 'backend-auth-role-missing',
      severity: 'error',
      path: `${path}.roleId`,
      message: 'Auth intent references an unknown role.'
    })
  }
  if (entry.principal.kind === 'owner') {
    const rule = ownership.get(entry.principal.ownershipId)
    if (!rule) {
      context.diagnostics.push({
        code: 'backend-auth-ownership-missing',
        severity: 'error',
        path: `${path}.ownershipId`,
        message: 'Auth intent references an unknown ownership rule.'
      })
      return
    }
    if (rule.entityId !== entry.entityId) {
      context.diagnostics.push({
        code: 'backend-auth-ownership-entity-mismatch',
        severity: 'error',
        path: `${path}.ownershipId`,
        message: 'Ownership rule must target the row-access entity.'
      })
    }
    return
  }
  if (entry.principal.kind === 'tenant-member') {
    const rule = tenants.get(entry.principal.tenantId)
    if (!rule) {
      context.diagnostics.push({
        code: 'backend-auth-tenant-missing',
        severity: 'error',
        path: `${path}.tenantId`,
        message: 'Auth intent references an unknown tenant rule.'
      })
      return
    }
    if (rule.entityId !== entry.entityId) {
      context.diagnostics.push({
        code: 'backend-auth-tenant-entity-mismatch',
        severity: 'error',
        path: `${path}.tenantId`,
        message: 'Tenant rule must target the row-access entity.'
      })
    }
  }
}

function validateAuthReferences(
  auth: AuthPolicyIR,
  model: DataModelIR,
  context: BackendValidationContext
): void {
  const entities = new Map(model.entities.map((entry) => [entry.id, entry]))
  const ownership = new Map(auth.ownership.map((entry) => [entry.id, entry]))
  const tenants = new Map(auth.tenants.map((entry) => [entry.id, entry]))
  const roles = new Set(auth.roles.map((entry) => entry.id))
  const requireField = (entityId: string, fieldId: string, path: string): void => {
    const entity = entities.get(entityId)
    if (!entity || !entity.fields.some((entry) => entry.id === fieldId)) {
      context.diagnostics.push({
        code: 'backend-auth-field-missing',
        severity: 'error',
        path,
        message: 'Auth intent references an unknown entity field.'
      })
    }
  }
  for (const entry of auth.ownership) {
    requireField(entry.entityId, entry.identityFieldId, `$.auth.ownership.${entry.id}`)
  }
  for (const entry of auth.tenants) {
    requireField(entry.entityId, entry.tenantFieldId, `$.auth.tenants.${entry.id}`)
    if (
      entry.membershipEntityId &&
      entry.membershipIdentityFieldId &&
      entry.membershipTenantFieldId
    ) {
      requireField(
        entry.membershipEntityId,
        entry.membershipIdentityFieldId,
        `$.auth.tenants.${entry.id}.membershipIdentityFieldId`
      )
      requireField(
        entry.membershipEntityId,
        entry.membershipTenantFieldId,
        `$.auth.tenants.${entry.id}.membershipTenantFieldId`
      )
    }
  }
  for (const entry of auth.rowAccess) {
    if (!entities.has(entry.entityId)) {
      context.diagnostics.push({
        code: 'backend-auth-entity-missing',
        severity: 'error',
        path: `$.auth.rowAccess.${entry.id}.entityId`,
        message: 'Auth intent references an unknown entity.'
      })
    }
    validatePrincipalReference(entry, roles, ownership, tenants, context)
  }
}

export function parseAuthPolicyIR(
  value: unknown,
  path: string,
  model: DataModelIR,
  context: BackendValidationContext
): AuthPolicyIR | undefined {
  const source = record(value, path, context, [
    'version',
    'identities',
    'roles',
    'ownership',
    'tenants',
    'rowAccess'
  ])
  if (!source) return undefined
  if (source.version !== AUTH_POLICY_IR_VERSION) {
    context.diagnostics.push({
      code: 'backend-auth-version-unsupported',
      severity: 'error',
      path: `${path}.version`,
      message: 'Auth policy version is not supported.'
    })
  }
  const identities = parseArrayItems(source.identities, `${path}.identities`, context, 32, identity)
  const roles = parseArrayItems(source.roles, `${path}.roles`, context, 128, role)
  const ownershipEntries = parseArrayItems(
    source.ownership,
    `${path}.ownership`,
    context,
    BACKEND_LIMITS.maxPolicies,
    ownership
  )
  const tenants = parseArrayItems(
    source.tenants,
    `${path}.tenants`,
    context,
    BACKEND_LIMITS.maxPolicies,
    tenant
  )
  const rowAccessEntries = parseArrayItems(
    source.rowAccess,
    `${path}.rowAccess`,
    context,
    BACKEND_LIMITS.maxPolicies,
    rowAccess
  )
  for (const [entries, entryPath] of [
    [identities, 'identities'],
    [roles, 'roles'],
    [ownershipEntries, 'ownership'],
    [tenants, 'tenants'],
    [rowAccessEntries, 'rowAccess']
  ] as const) {
    if (entries)
      uniqueBy(
        entries.map((entry) => entry.id),
        `${path}.${entryPath}`,
        context,
        `${entryPath} id`
      )
  }
  if (
    source.version !== AUTH_POLICY_IR_VERSION ||
    !identities ||
    !roles ||
    !ownershipEntries ||
    !tenants ||
    !rowAccessEntries
  ) {
    return undefined
  }
  const auth: AuthPolicyIR = {
    version: AUTH_POLICY_IR_VERSION,
    identities: sorted(identities, (entry) => entry.id),
    roles: sorted(roles, (entry) => entry.id),
    ownership: sorted(ownershipEntries, (entry) => entry.id),
    tenants: sorted(tenants, (entry) => entry.id),
    rowAccess: sorted(rowAccessEntries, (entry) => entry.id)
  }
  validateAuthReferences(auth, model, context)
  return auth
}
