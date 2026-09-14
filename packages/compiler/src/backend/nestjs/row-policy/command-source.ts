import { replaceTenantSource } from '../tenant/source'

export function withRowPolicyCommandTypes(source: string): string {
  source = replaceTenantSource(
    source,
    'export type Scalar =',
    "import type { ResourceAccessRule } from './identity.js'\nexport type Scalar ="
  )
  return replaceTenantSource(
    source,
    "readonly access: { readonly kind: 'authenticated' }",
    "readonly access: { readonly kind: 'row-policy'; readonly entityId: string; readonly parameter: string; readonly policyIds: readonly string[]; readonly roleId?: string; readonly table: string; readonly keyColumn: string; readonly ownerColumn: string; readonly policy: ResourceAccessRule } | { readonly kind: 'authenticated' }"
  )
}

export function withRowPolicyCommandService(source: string): string {
  source = replaceTenantSource(
    source,
    "import type { VerifiedPrincipal } from './identity.js'",
    "import { rowScope, type VerifiedPrincipal } from './identity.js'"
  )
  if (
    source.includes(
      "if (plan.access.kind === 'role' && !principal.roles.includes(plan.access.roleId))"
    )
  )
    source = replaceTenantSource(
      source,
      "if (plan.access.kind === 'role' && !principal.roles.includes(plan.access.roleId))",
      "if (plan.access.kind !== 'authenticated' && plan.access.roleId !== undefined && !principal.roles.includes(plan.access.roleId))"
    )
  return replaceTenantSource(
    source,
    '    return this.database.transaction(async (client) => {',
    String.raw`    return this.database.transaction(async (client) => {
      if (plan.access.kind === 'row-policy') {
        const access = plan.access
        const selector = commandScalar(input[access.parameter])
        // All membership management and member operations lock this same authority parent first.
        const locked = await client.query('SELECT ' + access.keyColumn + ' FROM ' + access.table +
          ' WHERE ' + access.keyColumn + ' = $1 FOR UPDATE', [selector])
        if (locked.rows.length !== 1) throw new ForbiddenException('Access denied.')
        // A separate READ COMMITTED statement observes authority committed while waiting for the lock.
        const values: unknown[] = [selector]
        const predicate = rowScope(principal, access.policy, access.ownerColumn, values)
        const authorized = await client.query('SELECT ' + access.keyColumn + ' FROM ' + access.table +
          ' WHERE ' + access.keyColumn + ' = $1 AND (' + predicate + ')', values)
        if (authorized.rows.length !== 1) throw new ForbiddenException('Access denied.')
      }`
  )
}
