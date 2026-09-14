import type {
  AuthRowAccessIntentIR,
  AuthRowConditionIR,
  BackendApplicationSpecV1,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

import { sqlIdentifier } from '../artifact'
import { nestJSTenant } from '../tenant/model'

export interface NestJSRowCondition {
  readonly column: string
  readonly value: string | number | boolean | null
}
export interface NestJSAccessClause {
  readonly kind:
    | 'owner'
    | 'anonymous'
    | 'authenticated'
    | 'role'
    | 'related-member'
    | 'tenant-member'
  readonly roleId?: string
  readonly conditions: readonly NestJSRowCondition[]
  readonly membership?: {
    readonly table: string
    readonly rowColumn: string
    readonly keyColumn: string
    readonly identityColumn: string
    readonly conditions: readonly NestJSRowCondition[]
  }
}

function column(entity: DataEntityIR, fieldId: string, prefix?: string): string {
  const field = entity.fields.find((entry) => entry.id === fieldId)
  if (!field) throw new Error('Missing validated policy field.')
  return (prefix ? sqlIdentifier(prefix) + '.' : '') + sqlIdentifier(field.name)
}
function conditions(
  entity: DataEntityIR,
  entries: readonly AuthRowConditionIR[] | undefined,
  prefix: string
): NestJSRowCondition[] {
  return (entries ?? []).map((entry) => ({
    column: column(entity, entry.fieldId, prefix),
    value: entry.value
  }))
}

export function nestJSAccessClause(
  application: BackendApplicationSpecV1,
  policy: AuthRowAccessIntentIR
): NestJSAccessClause {
  const entity = application.dataModel.entities.find((entry) => entry.id === policy.entityId)
  if (!entity) throw new Error('Missing validated policy entity.')
  const principal = policy.principal
  if (principal.kind === 'authenticated' && !policy.conditions?.length)
    throw new Error('Unsupported authenticated-all policy.')
  const common = {
    kind: principal.kind,
    conditions: conditions(entity, policy.conditions, entity.name),
    ...('roleId' in principal && principal.roleId ? { roleId: principal.roleId } : {})
  }
  if (principal.kind === 'related-member') {
    const membership = application.dataModel.entities.find(
      (entry) => entry.id === principal.membershipEntityId
    )
    if (!membership) throw new Error('Missing validated membership entity.')
    return {
      ...common,
      membership: {
        table: sqlIdentifier('public') + '.' + sqlIdentifier(membership.name),
        rowColumn: column(entity, principal.entityFieldId, entity.name),
        keyColumn: column(membership, principal.membershipFieldId, '__openpencil_member'),
        identityColumn: column(membership, principal.identityFieldId, '__openpencil_member'),
        conditions: conditions(membership, principal.conditions, '__openpencil_member')
      }
    }
  }
  if (principal.kind === 'tenant-member') {
    const tenant = application.auth.tenants.find((entry) => entry.id === principal.tenantId)
    if (!tenant) throw new Error('Missing validated tenant.')
    const model = nestJSTenant(application, tenant)
    return {
      ...common,
      membership: {
        table: model.membershipTable,
        rowColumn: model.rowColumn,
        keyColumn: sqlIdentifier('__openpencil_member') + '.' + model.membershipTenantColumn,
        identityColumn: sqlIdentifier('__openpencil_member') + '.' + model.membershipIdentityColumn,
        conditions: []
      }
    }
  }
  return common
}

export function usesNestJSRowPolicies(application: BackendApplicationSpecV1): boolean {
  return (
    application.auth.rowAccess.some(
      (policy) => policy.conditions !== undefined || policy.principal.kind === 'related-member'
    ) ||
    Boolean(application.commands?.commands.some((command) => command.access.kind === 'row-policy'))
  )
}
