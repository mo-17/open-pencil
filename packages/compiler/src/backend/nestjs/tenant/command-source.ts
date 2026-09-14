import { replaceTenantSource } from './source'

export function withTenantCommandTypes(source: string): string {
  source = replaceTenantSource(
    source,
    "readonly scope: 'owner' | 'command'; readonly projection: string",
    "readonly scope: 'owner' | 'command' | 'tenant'; readonly projection: string; readonly tenantColumn?: string; readonly tenantParameter?: string"
  )
  return replaceTenantSource(
    source,
    "readonly access: { readonly kind: 'authenticated' } | { readonly kind: 'role'; readonly roleId: string }",
    "readonly access: { readonly kind: 'authenticated' } | { readonly kind: 'role'; readonly roleId: string } | { readonly kind: 'tenant-member'; readonly tenantId: string; readonly parameter: string; readonly roleId?: string; readonly tenant: { readonly id: string; readonly fieldId: string; readonly column: string; readonly rowColumn: string; readonly membershipTable: string; readonly membershipIdentityColumn: string; readonly membershipTenantColumn: string } }"
  )
}

export function withTenantCommandExecution(source: string): string {
  source = replaceTenantSource(
    source,
    "    const response = await client.query('SELECT '",
    "    if (step.scope === 'tenant' && (!step.tenantColumn || !step.tenantParameter)) throw new ConflictException('Request conflict.')\n" +
      "    const tenant = step.scope === 'tenant' ? ' AND ' + step.tenantColumn + ' = $' + values.push(commandScalar(input[step.tenantParameter ?? ''])) : ''\n" +
      "    const response = await client.query('SELECT '"
  )
  return replaceTenantSource(
    source,
    "' = $1' + owner + ' FOR UPDATE'",
    "' = $1' + owner + tenant + ' FOR UPDATE'"
  )
}

export function withTenantCommandService(source: string): string {
  source = replaceTenantSource(
    source,
    "if (plan.access.kind === 'role' && !principal.roles.includes(plan.access.roleId))",
    "if (plan.access.kind !== 'authenticated' && plan.access.roleId !== undefined && !principal.roles.includes(plan.access.roleId))"
  )
  return replaceTenantSource(
    source,
    '    return this.database.transaction(async (client) => {',
    `    return this.database.transaction(async (client) => {
      if (plan.access.kind === 'tenant-member') {
        const tenant = plan.access.tenant
        const membership = await client.query('SELECT ' + tenant.membershipTenantColumn +
          ' FROM ' + tenant.membershipTable + ' WHERE ' + tenant.membershipIdentityColumn +
          ' = $1 AND ' + tenant.membershipTenantColumn + ' = $2 FOR SHARE',
          [principal.subject, commandScalar(input[plan.access.parameter])])
        if (membership.rows.length !== 1) throw new ForbiddenException('Access denied.')
      }`
  )
}
