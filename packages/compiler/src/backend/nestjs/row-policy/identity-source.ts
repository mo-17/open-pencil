import { replaceTenantSource } from '../tenant/source'

const CLAUSES = String.raw`
export interface RowCondition { readonly column: string; readonly value: string | number | boolean | null }
export interface RowAccessClause {
  readonly kind: 'owner' | 'anonymous' | 'authenticated' | 'role' | 'related-member' | 'tenant-member'
  readonly roleId?: string
  readonly conditions: readonly RowCondition[]
  readonly membership?: { readonly table: string; readonly rowColumn: string; readonly keyColumn: string;
    readonly identityColumn: string; readonly conditions: readonly RowCondition[] }
}
function fixedConditions(conditions: readonly RowCondition[], values: unknown[]): string[] {
  return conditions.map(condition => condition.value === null ? condition.column + ' IS NULL' :
    condition.column + ' = $' + values.push(condition.value))
}
function clauseScope(principal: VerifiedPrincipal | null, clauses: readonly RowAccessClause[], ownerColumn: string, values: unknown[]): string {
  const predicates: string[] = []
  for (const clause of clauses) {
    if (clause.kind !== 'anonymous' && !principal) continue
    if (clause.roleId && !principal?.roles.includes(clause.roleId)) continue
    const parts = fixedConditions(clause.conditions, values)
    if (clause.kind === 'owner') {
      if (!principal) continue
      parts.push(ownerColumn + ' = $' + values.push(principal.subject))
    }
    if (clause.kind === 'related-member' || clause.kind === 'tenant-member') {
      if (!principal || !clause.membership) throw new ForbiddenException('Access denied.')
      const membership = clause.membership
      const memberParts = [membership.keyColumn + ' = ' + membership.rowColumn,
        membership.identityColumn + ' = $' + values.push(principal.subject), ...fixedConditions(membership.conditions, values)]
      parts.push('EXISTS (SELECT 1 FROM ' + membership.table + ' AS "__openpencil_member" WHERE ' + memberParts.join(' AND ') + ')')
    }
    predicates.push('(' + (parts.length ? parts.join(' AND ') : 'TRUE') + ')')
  }
  if (!predicates.length) {
    if (!principal) throw new UnauthorizedException('Authentication required.')
    throw new ForbiddenException('Operation is not permitted.')
  }
  return '(' + predicates.join(' OR ') + ')'
}
`

export function withRowPolicyIdentity(source: string): string {
  source = replaceTenantSource(
    source,
    'export interface ResourceAccessRule {',
    'export interface ResourceAccessRule {\n  readonly clauses?: readonly RowAccessClause[]'
  )
  source = replaceTenantSource(
    source,
    "  if (policy.public) return 'TRUE'",
    "  if (policy.clauses) return clauseScope(principal, policy.clauses, ownerColumn, values)\n  if (policy.public) return 'TRUE'"
  )
  return source + CLAUSES
}
