import type {
  AuthAccessOperation,
  AuthPrincipalIntent,
  BackendApplicationSpecV1,
  BackendWorkflowStepIR,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

export function quoteSupabaseIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function quoteSupabaseLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function qualifiedSupabaseTable(entity: DataEntityIR): string {
  return `${quoteSupabaseIdentifier('public')}.${quoteSupabaseIdentifier(entity.name)}`
}

export function supabasePolicyOperationClause(
  operation: AuthAccessOperation,
  predicate: string
): string {
  if (operation === 'insert') return `WITH CHECK (${predicate})`
  if (operation === 'update') return `USING (${predicate}) WITH CHECK (${predicate})`
  return `USING (${predicate})`
}

export function supabasePolicyTargetRole(principal: AuthPrincipalIntent): 'anon' | 'authenticated' {
  return principal.kind === 'anonymous' ? 'anon' : 'authenticated'
}

export function supabaseModelFieldName(
  application: BackendApplicationSpecV1,
  entityId: string,
  fieldId: string
): string | undefined {
  const entity = application.dataModel.entities.find((entry) => entry.id === entityId)
  return entity?.fields.find((entry) => entry.id === fieldId)?.name
}

export function supabaseAllowPolicyPredicate(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  principal: AuthPrincipalIntent
): string | undefined {
  if (principal.kind === 'owner') {
    const ownership = application.auth.ownership.find(
      (entry) => entry.id === principal.ownershipId && entry.entityId === entity.id
    )
    if (!ownership) return undefined
    const identityField = supabaseModelFieldName(application, entity.id, ownership.identityFieldId)
    return identityField
      ? `(select auth.uid()) = ${quoteSupabaseIdentifier(identityField)}`
      : undefined
  }
  if (principal.kind === 'role') {
    const role = application.auth.roles.find((entry) => entry.id === principal.roleId)
    if (!role) return undefined
    return `coalesce((select auth.jwt()) -> 'app_metadata' -> 'roles', '[]'::jsonb) ? ${quoteSupabaseLiteral(role.name)}`
  }
  if (principal.kind === 'tenant-member') {
    const tenant = application.auth.tenants.find((entry) => entry.id === principal.tenantId)
    if (
      !tenant ||
      tenant.entityId !== entity.id ||
      !tenant.membershipEntityId ||
      !tenant.membershipIdentityFieldId ||
      !tenant.membershipTenantFieldId
    ) {
      return undefined
    }
    const membership = application.dataModel.entities.find(
      (entry) => entry.id === tenant.membershipEntityId
    )
    const targetTenantField = supabaseModelFieldName(application, entity.id, tenant.tenantFieldId)
    const memberIdentityField = supabaseModelFieldName(
      application,
      tenant.membershipEntityId,
      tenant.membershipIdentityFieldId
    )
    const memberTenantField = supabaseModelFieldName(
      application,
      tenant.membershipEntityId,
      tenant.membershipTenantFieldId
    )
    if (!membership || !targetTenantField || !memberIdentityField || !memberTenantField) {
      return undefined
    }
    const alias = quoteSupabaseIdentifier('membership')
    return `exists (select 1 from ${qualifiedSupabaseTable(membership)} as ${alias} where ${alias}.${quoteSupabaseIdentifier(memberIdentityField)} = (select auth.uid()) and ${alias}.${quoteSupabaseIdentifier(memberTenantField)} = ${quoteSupabaseIdentifier(entity.name)}.${quoteSupabaseIdentifier(targetTenantField)})`
  }
  return undefined
}

export function visitSupabaseWorkflowSteps(
  steps: readonly BackendWorkflowStepIR[],
  visit: (step: BackendWorkflowStepIR) => void
): void {
  for (const step of steps) {
    visit(step)
    if (step.kind === 'branch') {
      visitSupabaseWorkflowSteps(step.consequent, visit)
      visitSupabaseWorkflowSteps(step.alternate, visit)
    }
  }
}
