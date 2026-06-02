import { emitExpression } from '@open-pencil/core/lowcode-validation'
import type { ExprAst } from '@open-pencil/core/lowcode-validation'
import type {
  IREventHandler,
  IRSupabaseAuthHandler,
  IRSupabaseFilter,
  IRSupabaseMutationHandler,
  IRSupabaseQueryHandler
} from '#compiler/ir/types'

import { setterName } from './state'

/** Handler kinds that splice a single expression statement (eligible for the
 *  brace-less single-handler arrow) and take a trailing `;` inside a block. */
const SIMPLE_STATEMENT_KINDS = new Set<IREventHandler['kind']>([
  'setState',
  'navigate',
  'setVariable'
])

/** Handler kinds whose emit contains an `await` — they force `async () =>`.
 *  `condition` is async transitively when any nested branch handler is async
 *  (handled by `handlersAreAsync`'s recursion, not this set). */
const ASYNC_KINDS = new Set<IREventHandler['kind']>([
  'apiCall',
  'supabaseQuery',
  'supabaseMutation',
  'supabaseAuth',
  'delay'
])

/** Handler kinds whose emit is an expression / `return` statement and so needs
 *  a trailing `;`. The complete-block kinds (apiCall / supabase* try-catch,
 *  `condition` if/else) are full statements and never get one. */
const NEEDS_SEMICOLON = new Set<IREventHandler['kind']>([
  'setState',
  'navigate',
  'setVariable',
  'delay',
  'stop'
])

/** Phase 3 §10: an arrow is `async` when any handler — at any nesting depth
 *  inside `condition` branches — awaits. */
function handlersAreAsync(handlers: IREventHandler[]): boolean {
  return handlers.some((h) => {
    if (ASYNC_KINDS.has(h.kind)) return true
    if (h.kind === 'condition') {
      return handlersAreAsync(h.consequent) || handlersAreAsync(h.alternate ?? [])
    }
    return false
  })
}

/**
 * Render an event's handlers as a single arrow function body suitable for the
 * RHS of a JSX prop, e.g. `() => { setCount(count + 1) }`. The opening brace
 * is omitted when there is one plain (simple-statement) handler.
 *
 * Phase 2 §3: an `apiCall` handler `await`s `fetch`, so the arrow becomes
 * `async` whenever the list contains one. Phase 3 §2: same for
 * `supabaseQuery` / `supabaseMutation`. Phase 3 §10: `delay` awaits and
 * `condition` is async whenever a nested branch awaits.
 */
export function emitEventHandler(handlers: IREventHandler[]): string {
  const arrow = handlersAreAsync(handlers) ? 'async () =>' : '() =>'
  if (handlers.length === 1 && SIMPLE_STATEMENT_KINDS.has(handlers[0].kind)) {
    return `${arrow} ${emitHandlerStatement(handlers[0])}`
  }
  return `${arrow} { ${emitStatementList(handlers)} }`
}

/** Join handlers as statements: expression / `return` statements get a
 *  trailing `;`; complete blocks (try/catch, if/else) splice as-is. Shared by
 *  the top-level body and `condition`'s nested `then` / `else` branches. */
function emitStatementList(handlers: IREventHandler[]): string {
  return handlers
    .map((h) => (NEEDS_SEMICOLON.has(h.kind) ? `${emitHandlerStatement(h)};` : emitHandlerStatement(h)))
    .join(' ')
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
    case 'supabaseAuth':
      return emitSupabaseAuth(h)
    case 'condition': {
      // Phase 3 §10: `if (<cond>) { <consequent> } else { <alternate> }`.
      // Branches are emitted through the same statement-list path so they nest.
      // The else arm is dropped when the IR carried no falsy branch.
      const cond = emitExpression(h.condAst)
      const elseArm =
        h.alternate && h.alternate.length > 0
          ? ` else { ${emitStatementList(h.alternate)} }`
          : ''
      return `if (${cond}) { ${emitStatementList(h.consequent)} }${elseArm}`
    }
    case 'delay':
      // Phase 3 §10: timed wait. Forces the enclosing arrow async (ASYNC_KINDS).
      return `await new Promise((resolve) => setTimeout(resolve, ${h.ms}))`
    case 'stop':
      // Phase 3 §10: early termination of the workflow.
      return 'return'
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
 *  where clause for update / delete (collect side requires them). Payload is
 *  either an expression-based object literal built from `payloadEntries`
 *  (Phase 3 §3.v2) or a pre-validated compact JSON spliced verbatim from
 *  `payload`. IR collect picks one — both never present at this point. */
function emitSupabaseMutation(h: IRSupabaseMutationHandler): string {
  const base = `getSupabaseClient().from(${JSON.stringify(h.table)})`
  const payloadLiteral = emitMutationPayload(h)
  let chain: string
  switch (h.operation) {
    case 'insert':
      chain = `${base}.insert(${payloadLiteral})`
      break
    case 'upsert':
      chain = `${base}.upsert(${payloadLiteral})`
      break
    case 'update':
      chain = `${base}.update(${payloadLiteral})` + emitFilterChain(h.filters)
      break
    case 'delete':
      chain = `${base}.delete()` + emitFilterChain(h.filters)
      break
  }
  return wrapAsyncResult(chain, h.resultTarget, h.errorTarget)
}

/** Phase 3 §2.v2: signIn / signOut. §2.v3 adds signUp. §2.v4 adds
 *  resetPassword + updatePassword. Emit per operation (collect guarantees the
 *  required ASTs are present, so the casts narrow away schema-level
 *  `undefined`):
 *    signIn         → signInWithPassword({ email, password })
 *    signUp         → signUp({ email, password })
 *    signOut        → signOut()
 *    resetPassword  → resetPasswordForEmail(email, { redirectTo: window.location.origin })
 *    updatePassword → updateUser({ password })
 *  All return `{ data, error }` (runtime-probed, decision §2.v4.2 d) and all
 *  only destructure `{ error }`: a successful auth syncs `$currentUser` through
 *  the runtime's `onAuthStateChange`, so none writes a result target (decision
 *  §2.v2.2 e). redirectTo = window.location.origin (decision §2.v4.2 f) so the
 *  reset email links back to wherever the app is served. `errorTarget`, when
 *  set, captures the auth error. */
function emitSupabaseAuth(h: IRSupabaseAuthHandler): string {
  const errorWrite = h.errorTarget
    ? `setDocState(${JSON.stringify(h.errorTarget)}, error); `
    : ''
  const call = emitAuthCall(h)
  return (
    `try { ` +
    `const { error } = await ${call}; ` +
    `if (error) { ${errorWrite}console.error("${h.operation} failed:", error) } ` +
    `} catch (err) { console.error("${h.operation} threw:", err) }`
  )
}

/** The `getSupabaseClient().auth.*` call for one auth handler. Split out of
 *  emitSupabaseAuth to keep the per-operation dispatch a flat if-chain (oxlint
 *  rejects nested ternaries — §2.v3 step 2 lesson). */
function emitAuthCall(h: IRSupabaseAuthHandler): string {
  const base = 'getSupabaseClient().auth'
  if (h.operation === 'signOut') return `${base}.signOut()`
  if (h.operation === 'resetPassword') {
    return `${base}.resetPasswordForEmail(${emitExpression(
      h.emailAst as ExprAst
    )}, { redirectTo: window.location.origin })`
  }
  if (h.operation === 'updatePassword') {
    return `${base}.updateUser({ password: ${emitExpression(h.passwordAst as ExprAst)} })`
  }
  const credentials = `{ email: ${emitExpression(
    h.emailAst as ExprAst
  )}, password: ${emitExpression(h.passwordAst as ExprAst)} }`
  if (h.operation === 'signUp') return `${base}.signUp(${credentials})`
  return `${base}.signInWithPassword(${credentials})`
}

/** Phase 3 §3.v2: prefer `payloadEntries` (expression-based object literal)
 *  over `payload` (verbatim JSON). Falls back to `{}` only when neither
 *  channel is set — collect rejects insert/update/upsert with no payload,
 *  so this branch only matters for `delete` where the payload is unused. */
function emitMutationPayload(h: IRSupabaseMutationHandler): string {
  if (h.payloadEntries && h.payloadEntries.length > 0) {
    const entries = h.payloadEntries
      .map((e) => `${JSON.stringify(e.key)}: ${emitExpression(e.ast)}`)
      .join(', ')
    return `{ ${entries} }`
  }
  return h.payload ?? '{}'
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

