import { replaceTenantSource } from './source'

export const TENANT_IDENTITY_SOURCE = String.raw`
export interface TenantAccessRule {
  readonly fieldId: string
  readonly rowColumn: string
  readonly membershipTable: string
  readonly membershipIdentityColumn: string
  readonly membershipTenantColumn: string
  readonly roleId?: string
}

function tenantPredicate(rule: TenantAccessRule, subject: string, tenant: string, values: unknown[], lock = false): string {
  const identity = '$' + values.push(subject)
  return 'EXISTS (SELECT 1 FROM ' + rule.membershipTable + ' AS "__openpencil_member" WHERE ' +
    '"__openpencil_member".' + rule.membershipIdentityColumn + ' = ' + identity +
    ' AND "__openpencil_member".' + rule.membershipTenantColumn + ' = ' + tenant +
    (lock ? ' FOR SHARE' : '') + ')'
}

function tenantRowScope(principal: VerifiedPrincipal, policy: ResourceAccessRule,
    ownerColumn: string, values: unknown[]): string {
  const predicates = policy.owner ? [ownerColumn + ' = $' + values.push(principal.subject)] : []
  for (const tenant of policy.tenants ?? []) {
    if (tenant.roleId !== undefined && !principal.roles.includes(tenant.roleId)) continue
    predicates.push(tenantPredicate(tenant, principal.subject, tenant.rowColumn, values))
  }
  return predicates.length ? '(' + predicates.join(' OR ') + ')' : 'FALSE'
}

/** INSERT selectors are untrusted identifiers until this same-statement membership check succeeds. */
export function tenantCreateScope(principal: VerifiedPrincipal | null, policy: ResourceAccessRule,
    body: object, values: unknown[]): string {
  if (!principal) throw new UnauthorizedException('Authentication required.')
  const predicates: string[] = []
  for (const tenant of policy.tenants ?? []) {
    if (tenant.roleId !== undefined && !principal.roles.includes(tenant.roleId)) continue
    const selector: unknown = Reflect.get(body, tenant.fieldId)
    if (typeof selector !== 'string' || !UUID.test(selector)) throw new ForbiddenException('Operation is not permitted.')
    predicates.push(tenantPredicate(tenant, principal.subject, '$' + values.push(selector.toLowerCase()), values, true))
  }
  if (!predicates.length) throw new ForbiddenException('Operation is not permitted.')
  return '(' + predicates.join(' OR ') + ')'
}
`

export function withTenantIdentity(source: string): string {
  source = replaceTenantSource(
    source,
    'export interface ResourceAccessRule {',
    'export interface ResourceAccessRule {\n  readonly tenants?: readonly TenantAccessRule[]'
  )
  source = replaceTenantSource(
    source,
    '  if (policy.owner) return ownerColumn',
    '  if (policy.tenants?.length) return tenantRowScope(principal, policy, ownerColumn, values)\n  if (policy.owner) return ownerColumn'
  )
  source = replaceTenantSource(
    source,
    '!policy.owner && !policy.roles.some((role) => principal.roles.includes(role))',
    '!policy.owner && !policy.roles.some((role) => principal.roles.includes(role)) &&\n      !policy.tenants?.some((tenant) => tenant.roleId === undefined || principal.roles.includes(tenant.roleId))'
  )
  return source + TENANT_IDENTITY_SOURCE
}
