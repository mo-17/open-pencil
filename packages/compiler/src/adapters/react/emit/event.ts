import { emitExpression } from '@open-pencil/core/lowcode-validation'
import type {
  IREventHandler,
  IRSupabaseFilter,
  IRSupabaseMutationHandler,
  IRSupabaseQueryHandler
} from '#compiler/ir/types'

import { setterName } from './state'

/** Handler kinds whose emit body is a multi-statement block — `try`/`catch`
 *  wrapper around an `await`. These force `async () => { … }` and skip the
 *  trailing `;` that plain expression statements need. */
const BLOCK_KINDS = new Set<IREventHandler['kind']>([
  'apiCall',
  'supabaseQuery',
  'supabaseMutation'
])

/**
 * Render an event's handlers as a single arrow function body suitable for the
 * RHS of a JSX prop, e.g. `() => { setCount(count + 1) }`. The opening brace
 * is omitted when there is one plain (non-async-block) statement.
 *
 * Phase 2 §3: an `apiCall` handler `await`s `fetch`, so the arrow becomes
 * `async` whenever the list contains one. Phase 3 §2: same goes for
 * `supabaseQuery` / `supabaseMutation`. Block-shaped handlers are complete
 * statements so they are never given a trailing `;` and always force the
 * brace-wrapped form.
 */
export function emitEventHandler(handlers: IREventHandler[]): string {
  const isAsync = handlers.some((h) => BLOCK_KINDS.has(h.kind))
  const arrow = isAsync ? 'async () =>' : '() =>'
  if (handlers.length === 1 && !BLOCK_KINDS.has(handlers[0].kind)) {
    return `${arrow} ${emitHandlerStatement(handlers[0])}`
  }
  const body = handlers
    .map((h) => (BLOCK_KINDS.has(h.kind) ? emitHandlerStatement(h) : `${emitHandlerStatement(h)};`))
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
      // literal inside `JSON.stringify(...)`. Phase 2 §4: `h.url` is a
      // template AST — a static URL emits as a double-quoted string, an
      // interpolated one as a backtick template.
      const url = emitExpression(h.url)
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
    case 'supabaseQuery':
      return emitSupabaseQuery(h)
    case 'supabaseMutation':
      return emitSupabaseMutation(h)
    default: {
      const exhaustive: never = h
      throw new Error(`unhandled IREventHandler kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** Phase 3 §2: `await supabase.from('t').select('cols').<filter chain>
 *  .single()?`. Result goes into `resultTarget`; on error path, `errorTarget`
 *  (when set) receives the error object. Both writes go through
 *  `setDocState` — same channel page-state docState writes use. */
function emitSupabaseQuery(h: IRSupabaseQueryHandler): string {
  const chain =
    `getSupabaseClient().from(${JSON.stringify(h.table)})` +
    `.select(${JSON.stringify(h.columns)})` +
    emitFilterChain(h.filters) +
    (h.single ? '.single()' : '')
  return wrapAsyncResult(chain, h.resultTarget, h.errorTarget)
}

/** Phase 3 §2: insert / update / delete / upsert chain. Filters become the
 *  where clause for update / delete (collect side requires them); payload is
 *  pre-validated compact JSON spliced verbatim. */
function emitSupabaseMutation(h: IRSupabaseMutationHandler): string {
  const base = `getSupabaseClient().from(${JSON.stringify(h.table)})`
  let chain: string
  switch (h.operation) {
    case 'insert':
      chain = `${base}.insert(${h.payload ?? '{}'})`
      break
    case 'upsert':
      chain = `${base}.upsert(${h.payload ?? '{}'})`
      break
    case 'update':
      chain = `${base}.update(${h.payload ?? '{}'})` + emitFilterChain(h.filters)
      break
    case 'delete':
      chain = `${base}.delete()` + emitFilterChain(h.filters)
      break
  }
  return wrapAsyncResult(chain, h.resultTarget, h.errorTarget)
}

function emitFilterChain(filters: readonly IRSupabaseFilter[]): string {
  return filters
    .map((f) => `.${f.op}(${JSON.stringify(f.column)}, ${emitExpression(f.ast)})`)
    .join('')
}

/** Wrap a supabase chain expression in the canonical await + try/catch +
 *  setDocState pattern. `resultTarget === undefined` (mutation without a
 *  declared target) still runs the request — useful for fire-and-forget
 *  inserts — but does NOT call setDocState. */
function wrapAsyncResult(
  chain: string,
  resultTarget: string | undefined,
  errorTarget: string | undefined
): string {
  const errorWrite = errorTarget
    ? `setDocState(${JSON.stringify(errorTarget)}, error); `
    : ''
  const resultBranch = resultTarget
    ? `if (error) { ${errorWrite}console.error("supabase request failed:", error) } else { setDocState(${JSON.stringify(resultTarget)}, data) }`
    : `if (error) { ${errorWrite}console.error("supabase request failed:", error) }`
  return (
    `try { ` +
    `const { data, error } = await ${chain}; ` +
    resultBranch +
    ` } catch (err) { console.error("supabase request threw:", err) }`
  )
}

