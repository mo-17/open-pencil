import type {
  AuthAccessOperation,
  AuthOwnershipIR,
  AuthRowAccessIntentIR,
  BackendApplicationSpecV1,
  BackendDiagnostic,
  BackendHttpAPIOperation
} from '@open-pencil/lowcode/backend'

import { nestJSAccessClause, type NestJSAccessClause } from './row-policy/model'
import { nestJSTenant, type NestJSTenant } from './tenant/model'

export const NESTJS_ACCESS_OPERATIONS: Readonly<
  Record<BackendHttpAPIOperation, AuthAccessOperation>
> = { list: 'select', read: 'select', create: 'insert', update: 'update', delete: 'delete' }

export interface NestJSAccessRule {
  readonly owner: boolean
  readonly public: boolean
  readonly roles: readonly string[]
  readonly clauses?: readonly NestJSAccessClause[]
  readonly tenants?: readonly (NestJSTenant & { readonly roleId?: string })[]
}

export type NestJSAuthorization = Readonly<Record<AuthAccessOperation, NestJSAccessRule>>

function supportedPolicy(
  application: BackendApplicationSpecV1,
  policy: AuthRowAccessIntentIR
): boolean {
  if (policy.effect !== 'allow') return false
  const principal = policy.principal
  if (principal.kind === 'authenticated')
    return (
      Boolean(policy.conditions?.length) && policy.operations.every((entry) => entry === 'select')
    )
  if (principal.kind === 'related-member')
    return policy.operations.every((entry) => entry === 'select')
  if (principal.kind === 'anonymous') return policy.operations.every((entry) => entry === 'select')
  if (principal.kind === 'role')
    return application.auth.roles.some((role) => role.id === principal.roleId)
  if (principal.kind === 'tenant-member')
    return (
      application.auth.tenants.some(
        (tenant) => tenant.id === principal.tenantId && tenant.entityId === policy.entityId
      ) &&
      (principal.roleId === undefined ||
        application.auth.roles.some((role) => role.id === principal.roleId))
    )
  return application.auth.ownership.some(
    (owner) => owner.entityId === policy.entityId && owner.id === principal.ownershipId
  )
}

export function validateNestJSAuthorization(
  application: BackendApplicationSpecV1
): BackendDiagnostic[] {
  const { auth, httpApi: httpAPI } = application
  const diagnostics: BackendDiagnostic[] = []
  const reject = (path: string, message: string) =>
    diagnostics.push({ code: 'backend-nestjs-unsupported', severity: 'error', path, message })
  if (
    auth.identities.length !== 1 ||
    auth.identities[0].kind !== 'user' ||
    auth.identities[0].id !== httpAPI?.authentication.identityId
  )
    reject(
      '$.application.auth',
      'NestJS requires one JWT user identity; service identities are unsupported.'
    )
  for (const policy of auth.rowAccess)
    if (!supportedPolicy(application, policy))
      reject(
        '$.application.auth.rowAccess',
        'NestJS accepts allow-owner, allow-role, bounded tenant-member, and anonymous select only; deny, authenticated-all, and anonymous writes are unsupported.'
      )
  for (const resource of httpAPI?.resources ?? []) {
    for (const operation of resource.operations) {
      const allowed = auth.rowAccess.some(
        (policy) =>
          policy.entityId === resource.entityId &&
          policy.operations.includes(NESTJS_ACCESS_OPERATIONS[operation]) &&
          (!['list', 'read'].includes(operation) ||
            !resource.readPolicyIds ||
            resource.readPolicyIds.includes(policy.id)) &&
          supportedPolicy(application, policy)
      )
      if (!allowed)
        reject(
          '$.application.httpApi.resources',
          'Each exposed operation requires an explicit supported allow policy.'
        )
    }
  }
  return diagnostics
}

/** Shared IR is validated first; this compiles explicit OR policies into fixed server metadata. */
export function nestJSAuthorization(
  application: BackendApplicationSpecV1,
  ownership: AuthOwnershipIR,
  readPolicyIds?: readonly string[]
): NestJSAuthorization {
  const rule = (operation: AuthAccessOperation): NestJSAccessRule => {
    const policies = application.auth.rowAccess.filter(
      (policy) =>
        policy.entityId === ownership.entityId &&
        policy.effect === 'allow' &&
        policy.operations.includes(operation) &&
        (operation !== 'select' || !readPolicyIds || readPolicyIds.includes(policy.id))
    )
    return {
      ...(policies.some((policy) => policy.conditions || policy.principal.kind === 'related-member')
        ? { clauses: policies.map((policy) => nestJSAccessClause(application, policy)) }
        : {}),
      ...(policies.some(({ principal }) => principal.kind === 'tenant-member')
        ? {
            tenants: policies.flatMap(({ principal }) => {
              if (principal.kind !== 'tenant-member') return []
              const tenant = application.auth.tenants.find(
                (entry) => entry.id === principal.tenantId
              )
              if (!tenant) throw new Error('Missing validated tenant policy.')
              return [
                {
                  ...nestJSTenant(application, tenant),
                  ...(principal.roleId ? { roleId: principal.roleId } : {})
                }
              ]
            })
          }
        : {}),
      owner: policies.some(
        ({ principal }) => principal.kind === 'owner' && principal.ownershipId === ownership.id
      ),
      public:
        operation === 'select' && policies.some(({ principal }) => principal.kind === 'anonymous'),
      roles: [
        ...new Set(
          policies.flatMap(({ principal }) => (principal.kind === 'role' ? [principal.roleId] : []))
        )
      ].sort()
    }
  }
  return {
    select: rule('select'),
    insert: rule('insert'),
    update: rule('update'),
    delete: rule('delete')
  }
}
