import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { BusinessCompositionError } from './types'

export function conflict(path: string, message: string): never {
  throw new BusinessCompositionError([
    { code: 'business-module-conflict', severity: 'error', path, message }
  ])
}

export function normalized(value: unknown): BackendApplicationSpecV1 {
  const result = parseBackendApplicationSpecV1(value)
  if (!result.ok) throw new BusinessCompositionError(result.diagnostics)
  return result.value
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return (
    '{' +
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => JSON.stringify(key) + ':' + canonical(entry))
      .join(',') +
    '}'
  )
}

export function equivalent(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right)
}

export function requireEquivalent(left: unknown, right: unknown, path: string): void {
  if (!equivalent(left, right))
    conflict(path, 'The existing definition is not equivalent to the selected business module.')
}

export function requireEntries<T extends { id: string }>(
  existing: readonly T[],
  expected: readonly T[],
  path: string
): void {
  for (const entry of expected)
    requireEquivalent(
      existing.find((item) => item.id === entry.id),
      entry,
      path + '.' + entry.id
    )
}

/** Only the explicitly listed shared records may be deduplicated. */
export function appendEntries<T extends { id: string }>(
  actual: T[],
  checked: T[],
  incoming: readonly T[],
  path: string,
  shared: readonly string[] = [],
  alternateKey?: (entry: T) => string
): void {
  for (const entry of incoming) {
    const existing = checked.find((item) => item.id === entry.id)
    if (existing) {
      if (!shared.includes(entry.id))
        conflict(path + '.' + entry.id, 'A business module ID is already in use.')
      requireEquivalent(existing, entry, path + '.' + entry.id)
      continue
    }
    if (alternateKey && checked.some((item) => alternateKey(item) === alternateKey(entry)))
      conflict(
        path + '.' + entry.id,
        'A business module table, name, or HTTP path is already in use.'
      )
    actual.push(structuredClone(entry))
    checked.push(structuredClone(entry))
  }
}
