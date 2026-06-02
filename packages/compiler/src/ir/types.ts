/**
 * Framework-neutral IR. Modules under `ir/` MUST NOT import from
 * `adapters/**`; the data flow is one-way (SceneGraph → IR → adapter).
 */

import type { ExprAst } from '@open-pencil/core/lowcode-validation'

export type IRNode = IRElement | IRText | IRExpression | IRConditional | IRList | IRComponentRef

/**
 * Phase 3 §8 — a reference to a reusable component (a Figma COMPONENT master,
 * emitted once as `src/components/<name>.tsx`). Replaces inlining the subtree
 * for the master node itself and every *clean* INSTANCE (one with no overrides);
 * instances that carry overrides fall back to inline emission to stay faithful.
 * `className` carries the ref site's own classes (size/fill/position), which the
 * component applies to its root — so each usage is positioned in its own
 * context while sharing the children subtree.
 */
export interface IRComponentRef {
  kind: 'componentRef'
  /** SceneNode id of the master/instance this ref was derived from. */
  sourceId: string
  /** PascalCase component name (matches the emitted `src/components/<name>.tsx`). */
  name: string
  /** Space-separated Tailwind classes for this usage's root (empty when none). */
  className: string
}

/**
 * Phase 3 §8 — a reusable component definition extracted from a COMPONENT
 * master. `children` is the master's subtree IR; the adapter wraps it in a
 * `<div className={className}>` whose class string is supplied per usage.
 */
export interface ComponentDef {
  /** Master COMPONENT node id (the registry key). */
  componentId: string
  /** PascalCase React component name. */
  name: string
  /** The master's child subtrees (the shared body). */
  children: IRNode[]
}

export interface IRElement {
  kind: 'element'
  /** SceneNode id this IR node was derived from. Adapters may emit this as a
   *  `data-node-id` attribute later for canvas↔preview highlighting. */
  sourceId: string
  /** Lowercase HTML tag for the adapter to emit (e.g. 'div', 'input'). */
  tag: string
  /** Space-separated Tailwind class string. Empty string when no classes. */
  className: string
  /** Static JSX attributes. Adapters quote/escape per their syntax. */
  attrs: Record<string, IRAttrValue>
  children: IRNode[]
  /** Event handlers. Phase 0 only emits `onClick` (BUTTON) and `onSubmit` (FORM). */
  events?: Partial<Record<IREventName, IREventHandler[]>>
  /** Phase 3 §3.x: controlled-input two-way wiring for INPUT nodes that bind
   *  `bindings.value` to a string-typed docState or page-state. Adapter emits
   *  `value={<read>}` plus a synthesized `onChange` writer; uncontrolled
   *  `defaultValue` and any user-defined `onChange` are dropped (the latter
   *  with an `input-controlled-onchange-conflict` warning at collect time). */
  controlled?: IRControlledInput
  /** Raw inner HTML to emit verbatim via `dangerouslySetInnerHTML` instead of
   *  `children`. Set for vector-shape nodes (VECTOR / BOOLEAN_OPERATION / STAR /
   *  POLYGON / LINE) whose appearance IS the path geometry: the wrapper keeps
   *  its layout/size classes and this holds the inline `<svg>` rendered from the
   *  node's geometry. Mutually exclusive with `children` (emit ignores children
   *  when set). */
  rawHtml?: string
}

/** Phase 3 §3.x + §3.v4: descriptor for a controlled form control — both
 *  halves of the two-way binding the adapter emits. `read` is the JS
 *  identifier the value attribute references (already in scope as a
 *  `useState` local or a `useDocState` hoist from the scaffold). `write`
 *  identifies the writer the synthesized `onChange` calls; `targetType`
 *  selects the read attr + coercion + onChange source:
 *   - string  → `value={read}` + `e.target.value` (pass-through)
 *   - number  → `value={read}` + `Number(e.target.value)` + `type="number"`
 *   - boolean → `checked={read}` + `e.target.checked` (no coerce; §3.v4
 *     CHECKBOX / SWITCH, single mode)
 *   - array   → per-child `checked={read.includes(<opt>)}` + onChange that
 *     toggles `<opt>` in/out of the array (§3.v4 step 8 CHECKBOX group
 *     mode — only meaningful when the parent has `interactiveProps.options`
 *     so we know which option each child represents).
 *  Per-node-type targetType constraint lives in `resolveValueBinding`. */
export interface IRControlledInput {
  read: string
  write: {
    kind: 'docState' | 'state'
    name: string
    targetType: 'string' | 'number' | 'boolean' | 'array'
  }
}

export interface IRText {
  kind: 'text'
  /** Literal text content. Adapters apply framework-specific escaping. */
  value: string
}

/** A dynamic text node — the adapter emits this as `{<expr>}` rather than a
 *  string literal. Used when a TEXT node's `text` is bound to a state ref or
 *  formula expression. */
export interface IRExpression {
  kind: 'expression'
  /** Pre-parsed AST so the adapter does not re-parse. */
  ast: ExprAst
  /** Identifier names this expression depends on (state variables). */
  references: string[]
}

export type IRAttrValue = string | number | boolean

/** Phase 2 §9: conditional render wrapper. Adapter emits
 *  `{(<expr>) && (<consequent>)}`. Only present when the source node's
 *  `renderCondition` parses cleanly AND every referenced identifier is in
 *  scope; failures degrade to the bare `consequent` with a warning. */
export interface IRConditional {
  kind: 'conditional'
  ast: ExprAst
  references: string[]
  consequent: IRNode
}

/** Phase 2 §9: list-rendering directive. Adapter emits
 *  `{(<arrayName>).map((<itemName>, <indexName>) => <template>)}`. Generated
 *  for LIST nodes with a valid array-typed state datasource and at least
 *  one visible child (which becomes the template). */
export interface IRList {
  kind: 'list'
  arrayName: string
  itemName: string
  indexName: string
  template: IRNode
}

export type IREventName = 'onClick' | 'onChange' | 'onSubmit' | 'onFocus' | 'onBlur'

/** A statement that runs when an event fires. Phase 1 §7.4 widens this
 *  into a discriminated union so the adapter can dispatch on `kind`
 *  exhaustively (and refuse to compile an unknown future kind silently).
 *  Phase 2 §2 lights up the previously-stubbed `setVariable` slot.
 *  Phase 3 §2 adds Supabase {Query,Mutation} for typed DB access. */
export type IREventHandler =
  | IRSetStateHandler
  | IRNavigateHandler
  | IRSetVariableHandler
  | IRApiCallHandler
  | IRSupabaseQueryHandler
  | IRSupabaseMutationHandler
  | IRSupabaseAuthHandler

/** Phase 2 §2: 'absolute' = adapter emits `setX(<expr>)`; 'functional' =
 *  adapter emits `setX((prev) => <expr-with-$prev-as-prev>)`. The collector
 *  picks the mode by checking the source expression for `$prev`. */
export type ValueUpdateMode = 'absolute' | 'functional'

export interface IRSetStateHandler {
  kind: 'setState'
  /** Variable name of the state being updated (already resolved from stateId). */
  stateName: string
  /** Pre-parsed AST for the new-value expression. In functional mode,
   *  `$prev` has already been rewritten to the chosen parameter name
   *  (`prev`) so adapters can splice the AST verbatim. */
  ast: ExprAst
  /** Identifiers referenced by the expression. In functional mode, the
   *  reserved `$prev` token is stripped — only real state references
   *  remain. */
  references: string[]
  /** Phase 2 §2: functional vs absolute updater emit form. */
  mode: ValueUpdateMode
}

/** Navigate to a literal route at click time. The collector only emits
 *  this when a router is in scope (multi-page compile); single-page
 *  compiles drop the action with a warning at collect time. */
export interface IRNavigateHandler {
  kind: 'navigate'
  /** Route path, e.g. `/about`. Already validated to be non-empty. */
  to: string
}

/** Phase 2 §2: writes a document-level state value via the lowcode
 *  runtime (`setDocState(name, value)`). Resolved against
 *  `IRTree.docStates`; unknown `docStateName` is dropped with a warning. */
export interface IRSetVariableHandler {
  kind: 'setVariable'
  /** Name of the DocumentStateDef this handler writes to. */
  docStateName: string
  ast: ExprAst
  references: string[]
  mode: ValueUpdateMode
}

/** Phase 2 §3: fire an HTTP request and write the parsed JSON response into
 *  a Document State via `setDocState(name, data)`. The adapter emits an
 *  async fetch wrapped in try/catch. Resolved against `IRTree.docStates`;
 *  unknown `docStateName` / empty `url` is dropped with a warning. */
export interface IRApiCallHandler {
  kind: 'apiCall'
  method: 'GET' | 'POST'
  /** Phase 2 §4: parsed request-URL template (a `kind:'template'` ExprAst).
   *  A static URL is a degenerate zero-expression template — the adapter
   *  emits it as a plain double-quoted string, byte-identical to §3. */
  url: ExprAst
  /** Validated JSON string for POST requests; undefined for GET. */
  body?: string
  /** Name of the DocumentStateDef the response is written to. */
  docStateName: string
}

/** Phase 3 §2: a single where-clause filter on a Supabase query / mutation.
 *  `ast` is the parsed value expression (same restricted sub-language as
 *  `IRSetStateHandler.ast` / `IRApiCallHandler.url`); adapter emits its JS
 *  value as the second argument to `.eq(column, value)` / `.gt(...)` / etc. */
export interface IRSupabaseFilter {
  column: string
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in'
  ast: ExprAst
  references: string[]
}

/** Phase 3 §2: typed read against a Supabase table. Adapter emits an
 *  async chain `await getSupabaseClient().from(table).select(columns)
 *  .<filter chain>.<.single()?>` and writes the result into `resultTarget`
 *  (a DocumentStateDef name). Error path writes to `errorTarget` when set. */
export interface IRSupabaseQueryHandler {
  kind: 'supabaseQuery'
  table: string
  /** Comma-separated column list; adapter emits as a JS string literal.
   *  Defaults to `'*'` when the source action's `columns` was undefined. */
  columns: string
  filters: IRSupabaseFilter[]
  single: boolean
  resultTarget: string
  errorTarget?: string
}

/** Phase 3 §3.v2: a single expression-driven payload column. `key` is a
 *  JS identifier (the table column); `ast` is the parsed value expression
 *  (same restricted sub-language as `IRSupabaseFilter.ast`); adapter emits
 *  its JS value as the object-literal value for `<key>:`. */
export interface IRSupabasePayloadEntry {
  key: string
  ast: ExprAst
  references: string[]
}

/** Phase 3 §2: typed write against a Supabase table. One of two payload
 *  channels:
 *    - `payloadEntries` (Phase 3 §3.v2) — expression-based, one entry per
 *      column; supports docState / page-state references.
 *    - `payload` (Phase 3 §2) — compact validated JSON literal,
 *      parsed + re-serialised at collect time like `IRApiCallHandler.body`;
 *      spliced verbatim as a JS object literal.
 *  When source `SupabaseMutationAction` carries both, IR collect emits
 *  `action-supabase-mutation-payload-source-conflict` warning and prefers
 *  `payloadEntries` (decision §3.v2.2 #e). `filters` is the update / delete
 *  where-clause; required by collect for those two operations. */
export interface IRSupabaseMutationHandler {
  kind: 'supabaseMutation'
  operation: 'insert' | 'update' | 'delete' | 'upsert'
  table: string
  payload?: string
  payloadEntries?: IRSupabasePayloadEntry[]
  filters: IRSupabaseFilter[]
  resultTarget?: string
  errorTarget?: string
}

/** Phase 3 §2.v2: sign a user in / out. Phase 3 §2.v3 adds signUp. Phase 3
 *  §2.v4 adds resetPassword + updatePassword. Adapter emits the matching
 *  `await getSupabaseClient().auth.*` call: signInWithPassword / signUp /
 *  signOut / resetPasswordForEmail(email, { redirectTo: window.location.origin })
 *  / updateUser({ password }). `emailAst` is present for signIn / signUp /
 *  resetPassword; `passwordAst` for signIn / signUp / updatePassword (per-op
 *  gating, decision §2.v4.2 b). No `resultTarget`: `$currentUser` stays synced
 *  via the runtime's `onAuthStateChange` (decision §2.v2.2 e). `errorTarget`
 *  optionally captures the auth error. */
export interface IRSupabaseAuthHandler {
  kind: 'supabaseAuth'
  operation: 'signIn' | 'signOut' | 'signUp' | 'resetPassword' | 'updatePassword'
  emailAst?: ExprAst
  passwordAst?: ExprAst
  references: string[]
  errorTarget?: string
}

/** A page-level state declaration. Adapter emits `useState(defaultValue)`. */
export interface IRStateDecl {
  /** Underlying StateDef id. Adapters do not need it, but it helps debug. */
  id: string
  /** Variable name in emitted code (must be a valid JS identifier). */
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  /** Default value used to seed `useState(...)`. */
  defaultValue: unknown
}

/** Phase 2 §2: a document-level state declaration. Structurally identical to
 *  `IRStateDecl`, but the adapter emits these into the lowcode runtime store
 *  (`src/_lowcode_state.ts`) rather than into per-page `useState` calls. */
export type IRDocStateDecl = IRStateDecl

export interface IRTree {
  /** SceneNode id of the page (CANVAS) this tree was derived from. */
  pageId: string
  /** Page name from the scene graph. Currently unused by the adapter, but
   *  reserved for multi-page routing in Phase 1. */
  pageName: string
  /** Top-level children of the page. */
  children: IRNode[]
  /** Page-scoped state declarations the adapter must hoist into the component. */
  states: IRStateDecl[]
  /** Phase 2 §2: every document-level state declaration; identical across
   *  every `IRTree` from the same compile. The adapter scaffolds the
   *  zustand store from this list once. */
  docStates: IRDocStateDecl[]
  /** Phase 2 §2: doc-state names this page READS via a `kind: 'docState'`
   *  binding. Adapter emits one `const x = useDocState('x')` per name at
   *  the top of the page component so the IRExpression's `ident(x)` AST
   *  resolves to a real local. */
  docStateReads: string[]
  /** Phase 2 §2: doc-state names this page WRITES via a `setVariable`
   *  action. Adapter imports `setDocState` when this list is non-empty;
   *  no hook declaration is needed (setDocState is a plain function). */
  docStateWrites: string[]
  /** Phase 3 §2: connection settings from the root SceneNode, lifted into
   *  every IRTree from the same compile. Adapter uses this to decide
   *  whether to emit `_lowcode_supabase.ts` and inject the supabase-js
   *  dependency. Undefined when the document has no Supabase wiring. */
  supabaseConfig?: IRSupabaseConfig
  /** Warnings raised while collecting the IR (invalid bindings, expressions, etc.). */
  warnings: IRWarning[]
}

/** Phase 3 §2: IR-local mirror of `SupabaseConfig` from scene-graph, so the
 *  adapter layer never has to reach into core. Same shape — anonKey is the
 *  public anon JWT (safe per Supabase RLS design); `schema` defaults to
 *  `'public'` at runtime. */
export interface IRSupabaseConfig {
  url: string
  anonKey: string
  schema?: string
}

export interface IRWarning {
  code: string
  message: string
  nodeId?: string
}
