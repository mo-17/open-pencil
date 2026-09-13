import type { BackendHttpAPIResourceIRV1, DataFieldIR } from '@open-pencil/lowcode/backend'

export const HTTP_API_QUERY_GROUPS = ['filterFields', 'searchFields', 'sortFields'] as const
export type HTTPAPIQueryGroup = (typeof HTTP_API_QUERY_GROUPS)[number]

export function allowsHTTPAPIQueryField(field: DataFieldIR, group: HTTPAPIQueryGroup): boolean {
  if (['json', 'bytes'].includes(field.type)) return false
  if (group === 'searchFields') return field.type === 'string'
  if (group === 'sortFields') return !field.nullable && field.type !== 'string'
  return true
}

export function setHTTPAPIQueryField(
  resource: BackendHttpAPIResourceIRV1,
  group: HTTPAPIQueryGroup,
  field: DataFieldIR,
  enabled: boolean
): void {
  if (
    enabled &&
    (!resource.operations.includes('list') ||
      !resource.readFields.includes(field.id) ||
      !allowsHTTPAPIQueryField(field, group))
  )
    return
  const selected = new Set(resource.query?.[group])
  if (enabled) selected.add(field.id)
  else selected.delete(field.id)
  resource.query = {
    filterFields: [],
    searchFields: [],
    sortFields: [],
    ...resource.query,
    [group]: [...selected]
  }
  pruneHTTPAPIQuery(resource)
}

/** Removing list or its read projection also removes the query capability for those fields. */
export function pruneHTTPAPIQuery(resource: BackendHttpAPIResourceIRV1): void {
  if (!resource.query) return
  if (!resource.operations.includes('list')) {
    delete resource.query
    return
  }
  const query = { ...resource.query }
  for (const group of HTTP_API_QUERY_GROUPS) {
    query[group] = query[group].filter((id) => resource.readFields.includes(id))
  }
  if (HTTP_API_QUERY_GROUPS.some((group) => query[group]?.length)) resource.query = query
  else delete resource.query
}
