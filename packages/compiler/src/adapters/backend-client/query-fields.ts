import type { IRBackendListQueryBinding } from '#compiler/ir/backend-types'

import type { ExprAst } from '@open-pencil/lowcode'

/** Emit only declared query values; the generated client and server validate their runtime types. */
export function backendQueryFields(
  query: IRBackendListQueryBinding,
  expression: (ast: ExprAst) => string
): string[] {
  const filters = query.filterEntries
    ?.map((entry) => `${JSON.stringify(entry.key)}: ${expression(entry.ast)}`)
    .join(', ')
  return [
    ...(query.filterEntries?.length ? [`filter: { ${filters} }`] : []),
    ...(query.searchAst ? [`q: String(${expression(query.searchAst)}) || undefined`] : []),
    ...(query.sortField === undefined ? [] : [`sort: ${JSON.stringify(query.sortField)}`]),
    ...(query.sortDirection === undefined
      ? []
      : [`direction: ${JSON.stringify(query.sortDirection)} as const`])
  ]
}
