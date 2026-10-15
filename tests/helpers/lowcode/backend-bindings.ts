import { parseBackendResourceDataSource } from '@open-pencil/lowcode/backend'

/** Inspect optional Backend bindings through their owning parser before asserting fields. */
export function readBackendResourceDataSource(value: unknown) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('kind' in value) ||
    value.kind !== 'backendResource'
  )
    return undefined
  const parsed = parseBackendResourceDataSource(value)
  if (!parsed.ok) throw new Error('Expected a valid Backend resource binding')
  return parsed.value
}
