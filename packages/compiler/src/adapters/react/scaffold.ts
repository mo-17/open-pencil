import type { IRTree } from '#compiler/ir/types'

import { emitElement } from './emit/element'
import { emitStateDecl } from './emit/state'

interface BuildAppOptions {
  /** Emit the canvas↔preview bridge import + `data-node-id` attributes. */
  devMode: boolean
}

/**
 * Build `src/App.tsx`. Emits a stateful function component that hoists every
 * page-scoped state into a `useState` declaration, then renders the IR tree.
 */
export function buildAppTsx(ir: IRTree, options: BuildAppOptions = { devMode: false }): string {
  const { devMode } = options
  const bridgeImport = devMode ? `import './__preview-bridge'\n` : ''
  const reactImport = ir.states.length > 0 ? `import { useState } from 'react'\n` : ''
  const importBlock = bridgeImport + reactImport
  const importPrefix = importBlock ? `${importBlock}\n` : ''
  const stateLines = ir.states.map((s) => emitStateDecl(s, 1)).join('\n')

  const wrapperOpen = '<div className="relative min-h-screen">'

  if (ir.children.length === 0) {
    if (ir.states.length === 0) {
      return `${importPrefix}export default function App() {
  return ${wrapperOpen}</div>
}
`
    }
    return `${importPrefix}export default function App() {
${stateLines}
  return ${wrapperOpen}</div>
}
`
  }

  const body = ir.children.map((c) => emitElement(c, 3, devMode)).join('\n')
  const statePrefix = ir.states.length > 0 ? `${stateLines}\n` : ''
  return `${importPrefix}export default function App() {
${statePrefix}  return (
    ${wrapperOpen}
${body}
    </div>
  )
}
`
}
