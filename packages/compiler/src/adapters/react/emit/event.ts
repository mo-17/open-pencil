import { emitExpression } from '#compiler/ir/expression'
import type { IREventHandler } from '#compiler/ir/types'

import { setterName } from './state'

/**
 * Render an event's handlers as a single arrow function body suitable for the
 * RHS of a JSX prop, e.g. `() => { setCount(count + 1) }`. The opening brace
 * is omitted when there is one plain (non-apiCall) statement.
 *
 * Phase 2 §3: an `apiCall` handler `await`s `fetch`, so the arrow becomes
 * `async` whenever the list contains one. Its body is a `try/catch` block
 * (already a complete statement), so it is never given a trailing `;` and
 * always forces the brace-wrapped form.
 */
export function emitEventHandler(handlers: IREventHandler[]): string {
  const isAsync = handlers.some((h) => h.kind === 'apiCall')
  const arrow = isAsync ? 'async () =>' : '() =>'
  // A single plain handler stays brace-free for byte-stable output; an
  // apiCall is a block statement and must be wrapped.
  if (handlers.length === 1 && handlers[0].kind !== 'apiCall') {
    return `${arrow} ${emitHandlerStatement(handlers[0])}`
  }
  const body = handlers
    .map((h) => (h.kind === 'apiCall' ? emitHandlerStatement(h) : `${emitHandlerStatement(h)};`))
    .join(' ')
  return `${arrow} { ${body} }`
}

function emitHandlerStatement(h: IREventHandler): string {
  // Exhaustive switch over IREventHandler — the `never` assertion below
  // makes tsgo flag any new kind added to ir/types.ts that misses a case
  // here (the silent-drop hole Phase 0 had).
  switch (h.kind) {
    case 'setState': {
      const inner = emitExpression(h.ast)
      return h.mode === 'functional'
        ? `${setterName(h.stateName)}((prev) => ${inner})`
        : `${setterName(h.stateName)}(${inner})`
    }
    case 'navigate':
      return `navigate(${JSON.stringify(h.to)})`
    case 'setVariable': {
      const inner = emitExpression(h.ast)
      return h.mode === 'functional'
        ? `setDocState(${JSON.stringify(h.docStateName)}, (prev) => ${inner})`
        : `setDocState(${JSON.stringify(h.docStateName)}, ${inner})`
    }
    case 'apiCall': {
      // GET → `fetch(url)`; POST → `fetch(url, { method, headers, body })`.
      // `h.body` is compact, validated JSON, so it splices verbatim as a JS
      // literal inside `JSON.stringify(...)`.
      const url = JSON.stringify(h.url)
      const fetchCall =
        h.method === 'POST'
          ? `fetch(${url}, { method: "POST", headers: { "Content-Type": "application/json" }` +
            (h.body === undefined ? ' })' : `, body: JSON.stringify(${h.body}) })`)
          : `fetch(${url})`
      return (
        `try { ` +
        `const res = await ${fetchCall}; ` +
        `const data = await res.json(); ` +
        `setDocState(${JSON.stringify(h.docStateName)}, data) ` +
        `} catch (err) { console.error("apiCall failed:", err) }`
      )
    }
    default: {
      const exhaustive: never = h
      throw new Error(`unhandled IREventHandler kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}

