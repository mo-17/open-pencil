import { sha256 } from '@noble/hashes/sha2'

import type { DataEntityIR } from '@open-pencil/lowcode/backend'

/** Stable bounded names preserve arbitrary IR IDs without PostgreSQL's silent truncation. */
export function nestJSConstraintName(entity: DataEntityIR, kind: 'fk' | 'uq' | 'idx', id: string) {
  const bytes = sha256(new TextEncoder().encode(JSON.stringify([entity.id, kind, id])))
  return (
    'op_' +
    kind +
    '_' +
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32)
  )
}

export function nestJSRelationNames(entity: DataEntityIR): string[] {
  return [
    entity.name,
    entity.name + '_pkey',
    entity.name + '_owner_page_idx',
    ...(entity.uniques ?? []).map((entry) => nestJSConstraintName(entity, 'uq', entry.id)),
    ...(entity.indexes ?? []).map((entry) => nestJSConstraintName(entity, 'idx', entry.id))
  ]
}
