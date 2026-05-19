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
  const setter = setterName(h.stateName)
  return `${setter}(${emitExpression(h.ast)})`
}
