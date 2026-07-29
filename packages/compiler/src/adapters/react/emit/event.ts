import type {
  IRApiCallHandler,
  IRConfirmHandler,
  IREventHandler,
  IRNavigateHandler,
  IRStripeCheckoutHandler,
  IRStripeCustomerPortalHandler,
  IRSupabaseAuthHandler,
  IRSupabaseFilter,
  IRSupabaseMutationHandler,
  IRSupabaseQueryHandler,
  IRTrackEventHandler,
  IRToastHandler
} from '#compiler/ir/types'

import { emitExpression } from '@open-pencil/core/lowcode-validation'
import type { ExprAst } from '@open-pencil/core/lowcode-validation'

import { setterName } from './state'

/** Handler kinds that splice a single expression statement (eligible for the
 *  brace-less single-handler arrow) and take a trailing `;` inside a block. */
const SIMPLE_STATEMENT_KINDS = new Set<IREventHandler['kind']>([
  'setState',
  'setVariable',
  'toast',
  'clipboard',
  'trackEvent',
  'playMotion',
  'stopMotion',
  'toggleMotion'
])

/** Handler kinds whose emit contains an `await` — they force `async () =>`.
 *  `condition` is async transitively when any nested branch handler is async
 *  (handled by `handlersAreAsync`'s recursion, not this set); `confirm`
 *  unconditionally awaits `__opConfirm`, so it sits in this set directly. */
const ASYNC_KINDS = new Set<IREventHandler['kind']>([
  'apiCall',
  'stripeCheckout',
  'stripeCustomerPortal',
  'supabaseQuery',
  'supabaseMutation',
  'supabaseAuth',
  'delay',
  'confirm',
  'navigate',
  'awaitMotion'
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
  'clipboard',
  'trackEvent',
  'playMotion',
  'stopMotion',
  'toggleMotion',
  'awaitMotion'
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

interface EmitEventHandlerOptions {
  eventLocals?: boolean
  prelude?: string[]
  forceAsync?: boolean
}

function handlersContainMotion(handlers: readonly IREventHandler[]): boolean {
  return handlers.some((handler) => {
    if (isMotionControlHandler(handler)) return true
    if (handler.kind === 'condition' || handler.kind === 'confirm') {
      return (
        handlersContainMotion(handler.consequent) || handlersContainMotion(handler.alternate ?? [])
      )
    }
    if (
      handler.kind === 'apiCall' ||
      handler.kind === 'supabaseQuery' ||
      handler.kind === 'supabaseMutation'
    ) {
      return (
        handlersContainMotion(handler.onSuccess ?? []) ||
        handlersContainMotion(handler.onError ?? [])
      )
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
export function emitEventHandler(
  handlers: IREventHandler[],
  options: EmitEventHandlerOptions = {}
): string {
  const prelude = options.prelude ?? []
  const motionScope = handlersContainMotion(handlers) ? '__opMotionScope' : undefined
  const needsEventArg = options.eventLocals || prelude.length > 0 || motionScope !== undefined
  const params = needsEventArg ? '(e)' : '()'
  const arrow =
    options.forceAsync || handlersAreAsync(handlers) ? `async ${params} =>` : `${params} =>`
  if (!needsEventArg && handlers.length === 1 && SIMPLE_STATEMENT_KINDS.has(handlers[0].kind)) {
    return `${arrow} ${emitHandlerStatement(handlers[0])}`
  }
  const locals = options.eventLocals
    ? 'const $event = e; const $value = (e.target as HTMLInputElement).value;'
    : ''
  const prefix = prelude.map((stmt) => `${stmt};`).join(' ')
  const scopeCapture = motionScope ? 'const __opMotionScope = e.currentTarget;' : ''
  const body = [scopeCapture, locals, prefix, emitStatementList(handlers, motionScope)]
    .filter(Boolean)
    .join(' ')
  return `${arrow} { ${body} }`
}

/** Phase 4 §19: a `<form>`'s onSubmit when it has validated descendant fields —
 *  `preventDefault()`, validate every field key, and abort (skip the user's
 *  submit actions) when any is invalid. Takes the event arg so it can call
 *  `e.preventDefault()`. The arrow is async whenever the user's handlers are. */
export function emitFormSubmitHandler(
  handlers: IREventHandler[],
  validationKeys: readonly string[]
): string {
  const arrow = 'async (e) =>'
  const ids = validationKeys.map((k) => JSON.stringify(k)).join(', ')
  const guard = `e.preventDefault(); if (!(await __validateFields([${ids}]))) return;`
  const motionScope = handlersContainMotion(handlers) ? '__opMotionScope' : undefined
  const scopeCapture = motionScope ? 'const __opMotionScope = e.currentTarget; ' : ''
  const body = handlers.length > 0 ? ` ${emitStatementList(handlers, motionScope)}` : ''
  return `${arrow} { ${scopeCapture}${guard}${body} }`
}

/** Join handlers as statements: expression / `return` statements get a
 *  trailing `;`; complete blocks (try/catch, if/else) splice as-is. Shared by
 *  the top-level body and `condition`'s nested `then` / `else` branches. */
function emitStatementList(handlers: IREventHandler[], motionScope?: string): string {
  return handlers
    .map((h) =>
      NEEDS_SEMICOLON.has(h.kind)
        ? `${emitHandlerStatement(h, motionScope)};`
        : emitHandlerStatement(h, motionScope)
    )
    .join(' ')
}

/** Emit `if (<cond>) { <consequent> } else { <alternate> }`, dropping the else
 *  arm when there is no alternate. Shared by `condition` (a static predicate)
 *  and `confirm` (an awaited user choice) so the two stay clone-free. */
function emitIfElse(
  cond: string,
  consequent: IREventHandler[],
  alternate: IREventHandler[] | undefined,
  motionScope?: string
): string {
  const elseArm =
    alternate && alternate.length > 0
      ? ` else { ${emitStatementList(alternate, motionScope)} }`
      : ''
  return `if (${cond}) { ${emitStatementList(consequent, motionScope)} }${elseArm}`
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

function emitTrackEvent(h: IRTrackEventHandler): string {
  const eventName = emitExpression(h.eventAst)
  if (!h.properties || h.properties.length === 0) return `__opTrackEvent(${eventName})`
  const props = h.properties
    .map((prop) => `${JSON.stringify(prop.key)}: ${emitExpression(prop.ast)}`)
    .join(', ')
  return `__opTrackEvent(${eventName}, { ${props} })`
}

function emitStripeCheckout(h: IRStripeCheckoutHandler): string {
  return emitStripeRedirect(h, 'checkoutUrl', 'stripeCheckout')
}

function emitStripeCustomerPortal(h: IRStripeCustomerPortalHandler): string {
  return emitStripeRedirect(h, 'portalUrl', 'stripeCustomerPortal')
}

function emitStripeRedirect(
  h: IRStripeCheckoutHandler | IRStripeCustomerPortalHandler,
  namedUrlKey: 'checkoutUrl' | 'portalUrl',
  actionName: 'stripeCheckout' | 'stripeCustomerPortal'
): string {
  const endpoint = emitExpression(h.endpoint)
  const payload = h.payloadEntries?.length
    ? `{ ${h.payloadEntries
        .map((entry) => `${JSON.stringify(entry.key)}: ${emitExpression(entry.ast)}`)
        .join(', ')} }`
    : '{}'
  const errorWrite = h.errorTarget ? `setDocState(${JSON.stringify(h.errorTarget)}, err); ` : ''
  const urlLocal = namedUrlKey
  const authSession = h.includeAuthToken
    ? 'const { data: { session } } = await getSupabaseClient().auth.getSession(); '
    : ''
  const authHeaders = h.includeAuthToken
    ? 'const authHeaders = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}; '
    : ''
  const headers = h.includeAuthToken
    ? `{ "Content-Type": "application/json", ...authHeaders }`
    : '{ "Content-Type": "application/json" }'
  return (
    `try { ` +
    authSession +
    authHeaders +
    `const res = await fetch(${endpoint}, { method: "POST", headers: ${headers}, body: JSON.stringify(${payload}) }); ` +
    `const data = await res.json(); ` +
    `if (!res.ok) throw data; ` +
    `const ${urlLocal} = data?.url ?? data?.${namedUrlKey}; ` +
    `if (typeof ${urlLocal} !== "string" || ${urlLocal} === "") throw new Error("${actionName} response missing url"); ` +
    `const nextUrl = new URL(${urlLocal}, window.location.href); ` +
    `if (nextUrl.protocol !== "https:" && nextUrl.protocol !== "http:") throw new Error("${actionName} response url must be http(s)"); ` +
    `window.location.assign(nextUrl.toString()) ` +
    `} catch (err) { ${errorWrite}console.error("${actionName} failed:", err) }`
  )
}

/** Phase 3 §10 v3 / v5: emit a `confirm` handler as an `if (await __opConfirm(…))`
 *  block. Custom button labels (§10 v5) ride in an options object; a confirm
 *  with no labels stays byte-identical to the §10 v3 output. */
function emitConfirm(h: IRConfirmHandler, motionScope?: string): string {
  const message = emitExpression(h.ast)
  const opts = objectLiteral([
    ['confirmLabel', h.confirmLabel === undefined ? undefined : JSON.stringify(h.confirmLabel)],
    ['cancelLabel', h.cancelLabel === undefined ? undefined : JSON.stringify(h.cancelLabel)]
  ])
  const arg = opts === '' ? message : `${message}, ${opts}`
  return emitIfElse(`await __opConfirm(${arg})`, h.consequent, h.alternate, motionScope)
}

/** Phase 2 §3 / §4: emit an `apiCall` handler. GET → `fetch(url)`; POST →
 *  `fetch(url, { method, headers, body })`. `h.body` is compact, validated JSON
 *  spliced verbatim inside `JSON.stringify(...)`; `h.url` is a template AST (a
 *  static URL emits as a double-quoted string, an interpolated one as a
 *  backtick template). Result goes to `setDocState`; errors are logged. */
function emitApiCall(h: IRApiCallHandler, motionScope?: string): string {
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
  const successTail = h.onSuccess ? ` ${emitStatementList(h.onSuccess, motionScope)}` : ''
  const errorWrite = h.errorTarget ? `setDocState(${JSON.stringify(h.errorTarget)}, err); ` : ''
  const errorTail = h.onError ? ` ${emitStatementList(h.onError, motionScope)}` : ''
  return (
    `try { ` +
    `const res = await ${fetchCall}; ` +
    `const data = await res.json(); ` +
    `if (!res.ok) throw data; ` +
    `${store};${successTail} ` +
    `} catch (err) { ${errorWrite}console.error("apiCall failed:", err);${errorTail} }`
  )
}

/** Phase 4 §16.2: a `navigate` call. Generated navigation first asks the
 *  optional Motion runtime to play every mounted `pageExit` track. The runtime
 *  owns the bounded wait, so a missing runtime resolves immediately and cannot
 *  block routing. Without route params the destination stays a literal
 *  `navigate("/about")`; with params it uses react-router's `generatePath`. */
function emitNavigate(h: IRNavigateHandler): string {
  const to = JSON.stringify(h.to)
  const destination =
    !h.params || h.params.length === 0
      ? to
      : `generatePath(${to}, { ${h.params
          .map((p) => `${p.name}: ${emitExpression(p.ast)}`)
          .join(', ')} })`
  return `await window.__OPENPENCIL_MOTION_RUNTIME__?.pageExit?.(); navigate(${destination})`
}

function emitHandlerStatement(h: IREventHandler, motionScope?: string): string {
  // Exhaustive switch over IREventHandler — the `never` assertion below
  // makes tsgo flag any new kind added to ir/types.ts that misses a case
  // here (the silent-drop hole Phase 0 had).
  if (isMotionControlHandler(h)) return emitMotionControlHandler(h, motionScope)
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
      return emitApiCall(h, motionScope)
    case 'stripeCheckout':
      return emitStripeCheckout(h)
    case 'stripeCustomerPortal':
      return emitStripeCustomerPortal(h)
    case 'supabaseQuery':
      return emitSupabaseQuery(h, motionScope)
    case 'supabaseMutation':
      return emitSupabaseMutation(h, motionScope)
    case 'supabaseAuth':
      return emitSupabaseAuth(h)
    case 'condition':
      // Phase 3 §10: `if (<cond>) { <consequent> } else { <alternate> }` over a
      // static predicate. Branches nest through the shared statement-list path.
      return emitIfElse(emitExpression(h.condAst), h.consequent, h.alternate, motionScope)
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
      return emitConfirm(h, motionScope)
    case 'clipboard':
      // Phase 3 §10 v3: copy to the clipboard, fire-and-forget (the returned
      // promise is intentionally not awaited — no runtime surface).
      return `navigator.clipboard.writeText(${emitExpression(h.ast)})`
    case 'trackEvent':
      return emitTrackEvent(h)
    default: {
      const exhaustive: never = h
      throw new Error(`unhandled IREventHandler kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}

type IRMotionControlHandler = Extract<
  IREventHandler,
  { kind: 'playMotion' | 'stopMotion' | 'toggleMotion' | 'awaitMotion' }
>

function isMotionControlHandler(h: IREventHandler): h is IRMotionControlHandler {
  return (
    h.kind === 'playMotion' ||
    h.kind === 'stopMotion' ||
    h.kind === 'toggleMotion' ||
    h.kind === 'awaitMotion'
  )
}

function emitMotionControlHandler(h: IRMotionControlHandler, motionScope?: string): string {
  if (h.kind === 'awaitMotion') {
    const options = objectLiteral([
      ['timeoutMs', h.timeoutMs === undefined ? undefined : String(h.timeoutMs)],
      ['stopOnTimeout', h.stopOnTimeout ? 'true' : undefined]
    ])
    return `await ${emitMotionRuntimeCall('wait', h.targetNodeId, h.trackId, motionScope, options)}`
  }
  let method: 'play' | 'stop' | 'toggle' = 'toggle'
  if (h.kind === 'playMotion') method = 'play'
  else if (h.kind === 'stopMotion') method = 'stop'
  return emitMotionRuntimeCall(method, h.targetNodeId, h.trackId, motionScope)
}

function emitMotionRuntimeCall(
  method: 'play' | 'stop' | 'toggle' | 'wait',
  targetNodeId: string,
  trackId?: string,
  motionScope?: string,
  options = ''
): string {
  const args = [JSON.stringify(targetNodeId)]
  if (trackId) args.push(JSON.stringify(trackId))
  else if (motionScope || options) args.push('undefined')
  if (motionScope) args.push(motionScope)
  else if (options) args.push('undefined')
  if (options) args.push(options)
  return `window.__OPENPENCIL_MOTION_RUNTIME__?.${method}(${args.join(', ')})`
}

/** Phase 3 §2: `await supabase.from('t').select('cols').<filter chain>
 *  .single()?`. Result goes into `resultTarget`; on error path, `errorTarget`
 *  (when set) receives the error object. Both writes go through
 *  `setDocState` — same channel page-state docState writes use. */
function emitSupabaseQuery(h: IRSupabaseQueryHandler, motionScope?: string): string {
  const chain =
    `getSupabaseClient().from(${JSON.stringify(h.table)})` +
    `.select(${JSON.stringify(h.columns)})` +
    emitFilterChain(h.filters) +
    (h.single ? '.single()' : '')
  return wrapAsyncResult(chain, h.resultTarget, h.errorTarget, h.onSuccess, h.onError, motionScope)
}

/** Phase 3 §2: insert / update / delete / upsert chain. Filters become the
 *  where clause for update / delete (collect side requires them). Payload is
 *  either an expression-based object literal built from `payloadEntries`
 *  (Phase 3 §3.v2) or a pre-validated compact JSON spliced verbatim from
 *  `payload`. IR collect picks one — both never present at this point. */
function emitSupabaseMutation(h: IRSupabaseMutationHandler, motionScope?: string): string {
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
  return wrapAsyncResult(chain, h.resultTarget, h.errorTarget, h.onSuccess, h.onError, motionScope)
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
  const errorWrite = h.errorTarget ? `setDocState(${JSON.stringify(h.errorTarget)}, error); ` : ''
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

export function emitFilterChain(filters: readonly IRSupabaseFilter[]): string {
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
  onError?: IREventHandler[],
  motionScope?: string
): string {
  const errorWrite = errorTarget ? `setDocState(${JSON.stringify(errorTarget)}, error); ` : ''
  // Phase 3 §10 v9: append onError to the error arm, onSuccess to the success
  // arm — both run where `data` / `error` are fresh locals. Branch-less +
  // capture-less stays byte-identical to the §2 output.
  const errorTail = onError ? `; ${emitStatementList(onError, motionScope)}` : ''
  const errorArm = `if (error) { ${errorWrite}console.error("supabase request failed:", error)${errorTail} }`
  const successWrites: string[] = []
  if (resultTarget) successWrites.push(`setDocState(${JSON.stringify(resultTarget)}, data)`)
  if (onSuccess) successWrites.push(emitStatementList(onSuccess, motionScope))
  const elseArm = successWrites.length > 0 ? ` else { ${successWrites.join('; ')} }` : ''
  return (
    `try { ` +
    `const { data, error } = await ${chain}; ` +
    `${errorArm}${elseArm}` +
    ` } catch (err) { console.error("supabase request threw:", err) }`
  )
}
