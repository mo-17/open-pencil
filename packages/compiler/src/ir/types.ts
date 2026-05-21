/**
 * Framework-neutral IR. Modules under `ir/` MUST NOT import from
 * `adapters/**`; the data flow is one-way (SceneGraph → IR → adapter).
 */

import type { ExprAst } from './expression'

export type IRNode = IRElement | IRText | IRExpression | IRConditional | IRList

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
 *  Phase 2 §2 lights up the previously-stubbed `setVariable` slot. */
export type IREventHandler = IRSetStateHandler | IRNavigateHandler | IRSetVariableHandler

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

/** Phase 2 §2: a document-level state declaration. Same shape as
 *  `IRStateDecl`, but adapter emits these into the lowcode runtime store
 *  (`src/_lowcode_state.ts`) rather than into per-page `useState` calls. */
export interface IRDocStateDecl {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  defaultValue: unknown
}

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
  /** Phase 2 §2: doc-state names actually referenced on this page (via
   *  a `kind: 'docState'` binding or a `setVariable` action). Adapter
   *  emits one `const x = useDocState('x')` line per name at the top of
   *  the page component. */
  docStateRefs: string[]
  /** Warnings raised while collecting the IR (invalid bindings, expressions, etc.). */
  warnings: IRWarning[]
}

export interface IRWarning {
  code: string
  message: string
  nodeId?: string
}
