import { backendSha256 } from '#compiler/backend/canonical'

import type { SupabaseMigrationReviewBlockerV1 } from './contract'

export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function qualified(name: string): string {
  return `${quoteIdentifier('public')}.${quoteIdentifier(name)}`
}

export function stableSQLName(prefix: string, identity: string): string {
  return `${prefix}_${backendSha256(identity).slice(0, 20).replaceAll('-', 'a').replaceAll('_', 'b')}`
}

export function addBlocker(
  blockers: SupabaseMigrationReviewBlockerV1[],
  code: string,
  path: string,
  message: string
): void {
  if (blockers.some((entry) => entry.code === code && entry.path === path)) return
  blockers.push({ code, path, message })
}

export function sortedBlockers(
  blockers: readonly SupabaseMigrationReviewBlockerV1[]
): readonly SupabaseMigrationReviewBlockerV1[] {
  return [...blockers].sort((left, right) =>
    `${left.code}:${left.path}:${left.message}`.localeCompare(
      `${right.code}:${right.path}:${right.message}`,
      'en'
    )
  )
}

export function blockedSQL(blockers: readonly SupabaseMigrationReviewBlockerV1[]): string {
  const lines = [
    '-- OpenPencil Supabase inspected migration review v1.',
    '-- Review only. Apply is forbidden; no executable SQL was emitted because blockers exist.'
  ]
  for (const blocker of blockers) lines.push(`-- BLOCKED ${blocker.code} at ${blocker.path}`)
  return `${lines.join('\n')}\n`
}

export function reviewSQL(statements: readonly string[]): string {
  return [
    '-- OpenPencil Supabase inspected migration review v1.',
    '-- Review only. The Compiler has no network, credential, filesystem, or Apply authority.',
    'BEGIN;',
    ...statements,
    'COMMIT;',
    ''
  ].join('\n')
}
