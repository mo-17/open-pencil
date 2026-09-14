import type { BackendApplicationSpecV1, BackendDiagnostic } from '@open-pencil/lowcode/backend'

import { backendDiagnostic } from '../diagnostics'

/** Never silently discard an authority contract the provider cannot implement. */
export function unsupportedSupabaseTenantSemantics(
  application: BackendApplicationSpecV1
): BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  if (
    application.auth.rowAccess.some(
      (policy) => policy.conditions !== undefined || policy.principal.kind === 'related-member'
    )
  )
    diagnostics.push(
      backendDiagnostic(
        'supabase-conditional-membership-unimplemented',
        'error',
        '$.auth.rowAccess',
        'Conditional reads and related-member authority require an explicitly reviewed provider implementation.'
      )
    )
  if (application.httpApi?.resources.some((resource) => resource.readPolicyIds !== undefined))
    diagnostics.push(
      backendDiagnostic(
        'supabase-http-read-policy-unimplemented',
        'error',
        '$.httpApi.resources',
        'HTTP resource read-policy subsets require an explicitly reviewed provider implementation.'
      )
    )
  if (
    application.auth.rowAccess.some(
      (policy) => policy.principal.kind === 'tenant-member' && policy.principal.roleId !== undefined
    )
  )
    diagnostics.push(
      backendDiagnostic(
        'supabase-tenant-role-unimplemented',
        'error',
        '$.auth.rowAccess',
        'Role-constrained tenant membership requires an explicitly reviewed provider implementation.'
      )
    )
  if (
    application.httpApi?.resources.some((resource) =>
      application.auth.tenants.some(
        (tenant) =>
          tenant.entityId === resource.entityId &&
          resource.createFields?.includes(tenant.tenantFieldId)
      )
    )
  )
    diagnostics.push(
      backendDiagnostic(
        'supabase-tenant-selector-unimplemented',
        'error',
        '$.httpApi.resources',
        'HTTP tenant creation selectors require an explicitly reviewed provider implementation.'
      )
    )
  return diagnostics
}
