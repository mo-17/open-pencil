import type { IRTree } from '#compiler/ir/types'

import { validationUsesRemote } from './lowcode/validation'
import { pageUsesRequestDebounce, pageUsesRequestGate } from './request-timing'

/** §17: the single `react` named import a page needs — `useState` for page
 *  state and/or a Supabase-query LIST's rows, `useEffect` for the LIST fetch
 *  hook, and `useRef` for remote validation cancellation. Extracted to keep
 *  `buildPageFile` under the complexity limit. */
export function buildReactPageImport(ir: IRTree, hasMotionDriver: boolean): string {
  const hasListQueries = (ir.listQueries?.length ?? 0) > 0 || (ir.backendQueries?.length ?? 0) > 0
  // Phase 4 §19: a validated page needs `useState` for its field-errors store.
  const hasValidation = (ir.validatedFields?.length ?? 0) > 0
  const hasRemoteValidation = validationUsesRemote(ir.validatedFields ?? [])
  const hasComputedState = ir.states.some((s) => s.computed)
  const hasWritableState = ir.states.some((s) => !s.computed && s.computedInvalid !== true)
  const hasRequestGate = pageUsesRequestGate(ir)
  const hasRequestDebounce = pageUsesRequestDebounce(ir)
  const hooks: string[] = []
  if (hasWritableState || hasListQueries || hasValidation || hasRequestGate) hooks.push('useState')
  if (hasRemoteValidation || hasRequestGate) hooks.push('useRef')
  if (hasComputedState) hooks.push('useMemo')
  if (hasListQueries || hasMotionDriver || hasRequestDebounce) hooks.push('useEffect')
  return hooks.length > 0 ? `import { ${hooks.join(', ')} } from 'react'\n` : ''
}
