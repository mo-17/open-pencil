import type { IRTree } from '#compiler/ir/types'

import { emitElement } from './emit-element'

/**
 * Build `src/App.tsx`. Phase 0 emits a stateless function component — state,
 * events, and bindings land in week 5-6 per docs/lowcode-phase-0.md.
 */
export function buildAppTsx(ir: IRTree): string {
  if (ir.children.length === 0) {
    return `export default function App() {
  return <div />
}
`
  }
  const body = ir.children.map((c) => emitElement(c, 3)).join('\n')
  return `export default function App() {
  return (
    <div>
${body}
    </div>
  )
}
`
}
