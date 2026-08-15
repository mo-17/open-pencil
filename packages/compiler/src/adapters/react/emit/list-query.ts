import type { IRListOrder, IRListQuery } from '#compiler/ir/types'

import { emitExpression } from '@open-pencil/lowcode'

import { emitFilterChain } from './event'

/** Phase 4 §17.3: one `.order(col, { ascending })` clause. A reactive
 *  `columnAst` / `ascendingAst` (dynamic sort bound to a control) supersedes the
 *  static `column` / `ascending`. */
function emitOrderClause(o: IRListOrder): string {
  const col = o.columnAst ? emitExpression(o.columnAst) : JSON.stringify(o.column)
  const ascending = o.ascendingAst ? emitExpression(o.ascendingAst) : String(o.ascending)
  return `.order(${col}, { ascending: ${ascending} })`
}

/** Phase 4 §17.2: the pagination clause — `.range(offset, offset + size - 1)`
 *  when an offset is set (paginated page), else `.limit(size)` (first N rows),
 *  else nothing. Range needs a page size, so collect only sets `offsetAst`
 *  alongside `limit`. */
function emitListPaging(q: IRListQuery): string {
  if (q.limit === undefined) return ''
  if (q.offsetAst) {
    const off = emitExpression(q.offsetAst)
    return `.range(${off}, ${off} + ${q.limit} - 1)`
  }
  return `.limit(${q.limit})`
}

/**
 * Phase 4 §17: emit a LIST's Supabase-query fetch hook — a `useState` for the
 * rows plus a `useEffect` that runs the query and stores the result. The effect
 * re-runs whenever a reactive filter dependency changes (`q.deps`), guarded by
 * an `active` flag so a response that lands after unmount doesn't call setState.
 * The LIST `.map()` (emitted by `emitElement`) iterates `q.rowsName`.
 *
 * Indented two spaces to sit among the other page-component hook lines.
 */
export function emitListQueryHook(q: IRListQuery): string {
  const chain =
    `getSupabaseClient().from(${JSON.stringify(q.table)})` +
    `.select(${JSON.stringify(q.columns)})` +
    emitFilterChain(q.filters) +
    q.orderBy.map(emitOrderClause).join('') +
    emitListPaging(q)
  return (
    `  const [${q.rowsName}, ${q.setterName}] = useState([])\n` +
    `  useEffect(() => {\n` +
    `    let active = true\n` +
    `    ;(async () => {\n` +
    `      const { data, error } = await ${chain}\n` +
    `      if (active && !error && data) ${q.setterName}(data)\n` +
    `    })()\n` +
    `    return () => {\n` +
    `      active = false\n` +
    `    }\n` +
    `  }, [${q.deps.join(', ')}])`
  )
}
