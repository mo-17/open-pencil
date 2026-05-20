import { emitExpression } from '#compiler/ir/expression'
import type { IREventHandler } from '#compiler/ir/types'

import { setterName } from './state'

/**
 * Render an event's handlers as a single arrow function body suitable for the
 * RHS of a JSX prop, e.g. `() => { setCount(count + 1) }`. The opening brace
 * is omitted when there is only one statement.
 */
export function emitEventHandler(handlers: IREventHandler[]): string {
  if (handlers.length === 1) {
    return `() => ${emitHandlerStatement(handlers[0])}`
  }
  const body = handlers.map((h) => `${emitHandlerStatement(h)};`).join(' ')
  return `() => { ${body} }`
}

function emitHandlerStatement(h: IREventHandler): string {
  // Exhaustive switch over IREventHandler — the `never` assertion below
  // makes tsgo flag any new kind added to ir/types.ts that misses a case
  // here (the silent-drop hole Phase 0 had).
  switch (h.kind) {
    case 'setState':
      return `${setterName(h.stateName)}(${emitExpression(h.ast)})`
    case 'navigate':
      return `navigate(${JSON.stringify(h.to)})`
    default: {
      const exhaustive: never = h
      throw new Error(`unhandled IREventHandler kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}

