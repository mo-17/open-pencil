import type { IRListQuery } from '#compiler/ir/types'

import { emitFilterChain } from './event'

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
    q.orderBy
      .map((o) => `.order(${JSON.stringify(o.column)}, { ascending: ${o.ascending} })`)
      .join('') +
    (q.limit !== undefined ? `.limit(${q.limit})` : '')
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
