import { emitExpression } from '@open-pencil/core/lowcode-validation'
import type { ExprAst } from '@open-pencil/core/lowcode-validation'
import type {
  IRApiCallHandler,
  IRConfirmHandler,
  IREventHandler,
  IRNavigateHandler,
  IRSupabaseAuthHandler,
  IRSupabaseFilter,
  IRSupabaseMutationHandler,
  IRSupabaseQueryHandler,
  IRToastHandler
} from '#compiler/ir/types'

import { setterName } from './state'

/** Handler kinds that splice a single expression statement (eligible for the
 *  brace-less single-handler arrow) and take a trailing `;` inside a block. */
const SIMPLE_STATEMENT_KINDS = new Set<IREventHandler['kind']>([
  'setState',
  'navigate',
  'setVariable',
  'toast',
  'clipboard'
])

/** Handler kinds whose emit contains an `await` — they force `async () =>`.
 *  `condition` is async transitively when any nested branch handler is async
 *  (handled by `handlersAreAsync`'s recursion, not this set); `confirm`
 *  unconditionally awaits `__opConfirm`, so it sits in this set directly. */
const ASYNC_KINDS = new Set<IREventHandler['kind']>([
  'apiCall',
  'supabaseQuery',
  'supabaseMutation',
  'supabaseAuth',
  'delay',
  'confirm'
])

/** Handler kinds whose emit is an expression / `return` statement and so needs
 *  a trailing `;`. The complete-block kinds (apiCall / supabase* try-catch,
 *  `condition` if/else) are full statements and never get one. */
const NEEDS_SEMICOLON = new Set<IREventHandler['kind']>([
  'setState',
  'navigate',
  'setVariable',
  'delay',
  'stop',
  'toast',
  'clipboard'
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

/** Emit `if (<cond>) { <consequent> } else { <alternate> }`, dropping the else
 *  arm when there is no alternate. Shared by `condition` (a static predicate)
 *  and `confirm` (an awaited user choice) so the two stay clone-free. */
function emitIfElse(
  cond: string,
  consequent: IREventHandler[],
  alternate: IREventHandler[] | undefined
): string {
  const elseArm =
    alternate && alternate.length > 0 ? ` else { ${emitStatementList(alternate)} }` : ''
  return `if (${cond}) { ${emitStatementList(consequent)} }${elseArm}`
}

/** Build a `{ k: v, ... }` object-literal string from the entries whose value is
 *  defined, or '' when none are. Shared by the toast / confirm option emitters
 *  (Phase 3 §10 v5) so the two stay clone-free. Values are pre-serialized. */
function objectLiteral(entries: readonly [string, string | undefined][]): string {
  const present = entries.filter((e): e is [string, string] => e[1] !== undefined)
  if (present.length === 0) return ''
  return `{ ${present.map(([k, v]) => `${k}: ${v}`).join(', ')} }`
}

/** Phase 3 §10 v2 / v5: emit a `toast` handler. The `variant` arg is omitted for
 *  the default `info` UNLESS an options object (position / durationMs, §10 v5) is
 *  present — then the variant must be explicit so the options land in the third
 *  arg. A plain toast (no options) stays byte-identical to the §10 v2 output. */
function emitToast(h: IRToastHandler): string {
  const message = emitExpression(h.ast)
  const opts = objectLiteral([
    ['position', h.position === undefined ? undefined : JSON.stringify(h.position)],
    ['durationMs', h.durationMs === undefined ? undefined : String(h.durationMs)]
  ])
  if (opts === '') {
    return h.variant === 'info'
      ? `__opToast(${message})`
      : `__opToast(${message}, ${JSON.stringify(h.variant)})`
  }
  return `__opToast(${message}, ${JSON.stringify(h.variant)}, ${opts})`
}

/** Phase 3 §10 v3 / v5: emit a `confirm` handler as an `if (await __opConfirm(…))`
 *  block. Custom button labels (§10 v5) ride in an options object; a confirm
 *  with no labels stays byte-identical to the §10 v3 output. */
function emitConfirm(h: IRConfirmHandler): string {
  const message = emitExpression(h.ast)
  const opts = objectLiteral([
    ['confirmLabel', h.confirmLabel === undefined ? undefined : JSON.stringify(h.confirmLabel)],
    ['cancelLabel', h.cancelLabel === undefined ? undefined : JSON.stringify(h.cancelLabel)]
  ])
  const arg = opts === '' ? message : `${message}, ${opts}`
  return emitIfElse(`await __opConfirm(${arg})`, h.consequent, h.alternate)
}

/** Phase 2 §3 / §4: emit an `apiCall` handler. GET → `fetch(url)`; POST →
 *  `fetch(url, { method, headers, body })`. `h.body` is compact, validated JSON
 *  spliced verbatim inside `JSON.stringify(...)`; `h.url` is a template AST (a
 *  static URL emits as a double-quoted string, an interpolated one as a
 *  backtick template). Result goes to `setDocState`; errors are logged. */
function emitApiCall(h: IRApiCallHandler): string {
  const url = emitExpression(h.url)
  const fetchCall =
    h.method === 'POST'
      ? `fetch(${url}, { method: "POST", headers: { "Content-Type": "application/json" }` +
        (h.body === undefined ? ' })' : `, body: JSON.stringify(${h.body}) })`)
      : `fetch(${url})`
  const store = `setDocState(${JSON.stringify(h.docStateName)}, data)`
  // Phase 3 §10 v9: a branch-less / capture-less call stays byte-identical to
  // the §2 output (no res.ok guard — a non-2xx still writes its body).
  if (h.onSuccess === undefined && h.onError === undefined && h.errorTarget === undefined) {
    return (
      `try { const res = await ${fetchCall}; const data = await res.json(); ` +
      `${store} } catch (err) { console.error("apiCall failed:", err) }`
    )
  }
  // With result branches / errorTarget: a non-2xx response is a failure (throw
  // the parsed body into the catch) so onError fires and onSuccess does not.
  const successTail = h.onSuccess ? ` ${emitStatementList(h.onSuccess)}` : ''
  const errorWrite = h.errorTarget ? `setDocState(${JSON.stringify(h.errorTarget)}, err); ` : ''
  const errorTail = h.onError ? ` ${emitStatementList(h.onError)}` : ''
  return (
    `try { ` +
    `const res = await ${fetchCall}; ` +
    `const data = await res.json(); ` +
    `if (!res.ok) throw data; ` +
    `${store};${successTail} ` +
    `} catch (err) { ${errorWrite}console.error("apiCall failed:", err);${errorTail} }`
  )
}

/** Phase 4 §16.2: a `navigate` call. Without route params it stays a literal
 *  `navigate("/about")`; with params it builds the path via react-router's
 *  `generatePath("/product/:id", { id: <expr> })` so dynamic targets get their
 *  segments filled from caller-scope expressions. */
function emitNavigate(h: IRNavigateHandler): string {
  const to = JSON.stringify(h.to)
  if (!h.params || h.params.length === 0) return `navigate(${to})`
  const entries = h.params.map((p) => `${p.name}: ${emitExpression(p.ast)}`).join(', ')
  return `navigate(generatePath(${to}, { ${entries} }))`
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
      return emitNavigate(h)
    case 'setVariable': {
      const inner = emitExpression(h.ast)
      return h.mode === 'functional'
        ? `setDocState(${JSON.stringify(h.docStateName)}, (prev) => ${inner})`
        : `setDocState(${JSON.stringify(h.docStateName)}, ${inner})`
    }
    case 'apiCall':
      return emitApiCall(h)
    case 'supabaseQuery':
      return emitSupabaseQuery(h)
    case 'supabaseMutation':
      return emitSupabaseMutation(h)
    case 'supabaseAuth':
      return emitSupabaseAuth(h)
    case 'condition':
      // Phase 3 §10: `if (<cond>) { <consequent> } else { <alternate> }` over a
      // static predicate. Branches nest through the shared statement-list path.
      return emitIfElse(emitExpression(h.condAst), h.consequent, h.alternate)
    case 'delay':
      // Phase 3 §10: timed wait. Forces the enclosing arrow async (ASYNC_KINDS).
      return `await new Promise((resolve) => setTimeout(resolve, ${h.ms}))`
    case 'stop':
      // Phase 3 §10: early termination of the workflow.
      return 'return'
    case 'toast':
      // Phase 3 §10 v2 / v5: push a toast via the runtime (optional position /
      // duration options ride in a third arg).
      return emitToast(h)
    case 'confirm':
      // Phase 3 §10 v3 / v5: `if (await __opConfirm(<msg>[, opts])) {…} else {…}`
      // — the awaited user choice forces the enclosing arrow async (ASYNC_KINDS);
      // optional button labels ride in an options object.
      return emitConfirm(h)
    case 'clipboard':
      // Phase 3 §10 v3: copy to the clipboard, fire-and-forget (the returned
      // promise is intentionally not awaited — no runtime surface).
      return `navigator.clipboard.writeText(${emitExpression(h.ast)})`
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
  return wrapAsyncResult(chain, h.resultTarget, h.errorTarget, h.onSuccess, h.onError)
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
  return wrapAsyncResult(chain, h.resultTarget, h.errorTarget, h.onSuccess, h.onError)
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
  errorTarget: string | undefined,
  onSuccess?: IREventHandler[],
  onError?: IREventHandler[]
): string {
  const errorWrite = errorTarget
    ? `setDocState(${JSON.stringify(errorTarget)}, error); `
    : ''
  // Phase 3 §10 v9: append onError to the error arm, onSuccess to the success
  // arm — both run where `data` / `error` are fresh locals. Branch-less +
  // capture-less stays byte-identical to the §2 output.
  const errorTail = onError ? `; ${emitStatementList(onError)}` : ''
  const errorArm = `if (error) { ${errorWrite}console.error("supabase request failed:", error)${errorTail} }`
  const successWrites: string[] = []
  if (resultTarget) successWrites.push(`setDocState(${JSON.stringify(resultTarget)}, data)`)
  if (onSuccess) successWrites.push(emitStatementList(onSuccess))
  const elseArm = successWrites.length > 0 ? ` else { ${successWrites.join('; ')} }` : ''
  return (
    `try { ` +
    `const { data, error } = await ${chain}; ` +
    `${errorArm}${elseArm}` +
    ` } catch (err) { console.error("supabase request threw:", err) }`
  )
}

