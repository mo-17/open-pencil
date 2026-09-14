import type { AuthTenantIR } from '../types'
import type { BackendValidationContext } from '../validation-helpers'
import type { CommandReferences } from './references'
import { commandError } from './shape-values'
import type {
  BackendCommandDefinitionIR,
  BackendCommandStepIR,
  BackendCommandValueSourceIR
} from './types'
import type { CommandValueContext } from './value-types'

function sameLocator(left: AuthTenantIR, right: AuthTenantIR): boolean {
  return Boolean(
    left.membershipEntityId &&
    left.membershipIdentityFieldId &&
    left.membershipTenantFieldId &&
    left.membershipEntityId === right.membershipEntityId &&
    left.membershipIdentityFieldId === right.membershipIdentityFieldId &&
    left.membershipTenantFieldId === right.membershipTenantFieldId
  )
}

export function validateCommandTenantAccess(
  command: BackendCommandDefinitionIR,
  references: CommandReferences,
  path: string,
  context: BackendValidationContext
): void {
  const access = command.access
  if (access.kind !== 'tenant-member') return
  const tenant = references.auth.tenants.find((entry) => entry.id === access.tenantId)
  if (
    !tenant?.membershipEntityId ||
    !tenant.membershipIdentityFieldId ||
    !tenant.membershipTenantFieldId
  )
    commandError(context, path, 'Tenant commands require a declared complete membership locator.')
  if (!command.parameters.some((entry) => entry.name === access.parameter && entry.type === 'uuid'))
    commandError(
      context,
      path,
      'Tenant command authority must reference a required UUID parameter.'
    )
}

function validTenantSource(
  source: BackendCommandValueSourceIR,
  tenant: AuthTenantIR,
  granted: AuthTenantIR | undefined,
  references: CommandReferences,
  ctx: CommandValueContext
): boolean {
  const access = ctx.command.access
  if (
    access.kind === 'tenant-member' &&
    granted &&
    sameLocator(granted, tenant) &&
    source.kind === 'parameter' &&
    source.name === access.parameter
  )
    return true
  if (source.kind !== 'result') return false
  const previous = ctx.results.get(source.name)
  return Boolean(
    previous?.locked &&
    previous.fields.includes(source.field) &&
    references.auth.tenants.some(
      (entry) =>
        entry.entityId === previous.entity.id &&
        entry.tenantFieldId === source.field &&
        sameLocator(tenant, entry)
    )
  )
}

/** Tenant authority is derived from the authenticated membership or a prior locked row, never a free selector. */
export function validateCommandTenantStep(
  step: Exclude<BackendCommandStepIR, { kind: 'assert' }>,
  references: CommandReferences,
  path: string,
  ctx: CommandValueContext
): void {
  const access = ctx.command.access
  const granted =
    access.kind === 'tenant-member'
      ? references.auth.tenants.find((entry) => entry.id === access.tenantId)
      : undefined
  const tenants = references.auth.tenants.filter((entry) => entry.entityId === step.entityId)
  if (step.kind === 'data.read') {
    if (
      step.scope === 'tenant' &&
      (!granted || tenants.length !== 1 || !sameLocator(granted, tenants[0]))
    )
      commandError(
        ctx.context,
        path + '.scope',
        'Tenant reads require the command-authorized membership locator for this entity.'
      )
    if (granted && tenants.length && step.scope !== 'tenant')
      commandError(
        ctx.context,
        path + '.scope',
        'Tenant commands cannot bypass tenant scope on tenant-managed entities.'
      )
    return
  }
  const protectedFields = new Set(tenants.map((entry) => entry.tenantFieldId))
  for (const tenant of references.auth.tenants) {
    if (tenant.membershipEntityId !== step.entityId) continue
    if (tenant.membershipIdentityFieldId) protectedFields.add(tenant.membershipIdentityFieldId)
    if (tenant.membershipTenantFieldId) protectedFields.add(tenant.membershipTenantFieldId)
  }
  for (const assignment of step.values) {
    if (step.operation === 'update' && protectedFields.has(assignment.field)) {
      commandError(
        ctx.context,
        path + '.values',
        'Commands cannot rebind tenant or membership identity fields.'
      )
      continue
    }
    if (step.operation !== 'insert') continue
    const tenant = tenants.find((entry) => entry.tenantFieldId === assignment.field)
    if (!tenant) continue
    if (!validTenantSource(assignment.value, tenant, granted, references, ctx))
      commandError(
        ctx.context,
        path + '.values',
        'Inserted tenant identities must come from verified command membership or a matching prior locked tenant row.'
      )
  }
}
