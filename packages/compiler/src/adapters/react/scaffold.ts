import type { IRTree } from '#compiler/ir/types'

import { emitElement } from './emit/element'
import { emitStateDecl } from './emit/state'

/**
 * Build `src/App.tsx`. Emits a stateful function component that hoists every
 * page-scoped state into a `useState` declaration, then renders the IR tree.
 */
export function buildAppTsx(ir: IRTree): string {
  const importLine = ir.states.length > 0 ? `import { useState } from 'react'\n\n` : ''
  const stateLines = ir.states.map((s) => emitStateDecl(s, 1)).join('\n')

  if (ir.children.length === 0) {
    if (ir.states.length === 0) {
      return `export default function App() {
  return <div />
}
`
    }
    return `${importLine}export default function App() {
${stateLines}
  return <div />
}
`
  }

  const body = ir.children.map((c) => emitElement(c, 3)).join('\n')
  const statePrefix = ir.states.length > 0 ? `${stateLines}\n` : ''
  return `${importLine}export default function App() {
${statePrefix}  return (
    <div>
${body}
    </div>
  )
}
`
}
