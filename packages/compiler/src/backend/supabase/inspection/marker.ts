export const SUPABASE_MANAGED_MARKER_PREFIX = 'openpencil:v1:' as const

export const SUPABASE_MANAGED_MARKER_KINDS = [
  'entity',
  'enum',
  'field',
  'primary-key',
  'foreign-key',
  'unique',
  'index',
  'policy'
] as const

export type SupabaseManagedMarkerKind = (typeof SUPABASE_MANAGED_MARKER_KINDS)[number]

export interface SupabaseManagedMarkerV1 {
  readonly kind: SupabaseManagedMarkerKind
  readonly id: string
}

const KIND_SET = new Set<string>(SUPABASE_MANAGED_MARKER_KINDS)
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u

export function formatSupabaseManagedMarker(kind: SupabaseManagedMarkerKind, id: string): string {
  if (!KIND_SET.has(kind) || !STABLE_ID.test(id)) {
    throw new TypeError('Supabase managed marker identity is invalid.')
  }
  return `${SUPABASE_MANAGED_MARKER_PREFIX}${kind}:${id}`
}

/**
 * Parse only the closed OpenPencil marker grammar. Unmarked catalog objects return null, while an
 * `openpencil:` lookalike fails closed instead of being silently treated as third-party state.
 */
export function parseSupabaseManagedMarker(value: string | null): SupabaseManagedMarkerV1 | null {
  if (value === null) return null
  if (!value.startsWith('openpencil:')) return null
  if (!value.startsWith(SUPABASE_MANAGED_MARKER_PREFIX)) {
    throw new TypeError('Supabase managed marker version is unsupported.')
  }
  const remainder = value.slice(SUPABASE_MANAGED_MARKER_PREFIX.length)
  const separator = remainder.indexOf(':')
  if (separator <= 0) throw new TypeError('Supabase managed marker is malformed.')
  const kind = remainder.slice(0, separator)
  const id = remainder.slice(separator + 1)
  if (!KIND_SET.has(kind) || !STABLE_ID.test(id)) {
    throw new TypeError('Supabase managed marker is malformed.')
  }
  return Object.freeze({ kind: kind as SupabaseManagedMarkerKind, id })
}
