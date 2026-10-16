import type { AuthPrincipalIntent } from '../types'
import { id, type BackendUnknownRecord, type BackendValidationContext } from '../validation-helpers'

export const COMMON_PRINCIPAL_SHAPES = {
  anonymous: { allowed: ['kind'], required: ['kind'] },
  authenticated: { allowed: ['kind'], required: ['kind'] },
  role: { allowed: ['kind', 'roleId'], required: ['kind', 'roleId'] },
  owner: { allowed: ['kind', 'ownershipId'], required: ['kind', 'ownershipId'] }
} as const

type CommonPrincipal = Exclude<AuthPrincipalIntent, { kind: 'tenant-member' | 'related-member' }>

/** Tenant roles and related-member policies stay in their version-specific parsers. */
export function parseCommonPrincipal(
  kind: CommonPrincipal['kind'],
  source: BackendUnknownRecord,
  path: string,
  context: BackendValidationContext
): CommonPrincipal | undefined {
  if (kind === 'anonymous' || kind === 'authenticated') return { kind }
  const field = kind === 'role' ? 'roleId' : 'ownershipId'
  const reference = id(source[field], `${path}.${field}`, context)
  if (!reference) return undefined
  return kind === 'role' ? { kind, roleId: reference } : { kind, ownershipId: reference }
}
