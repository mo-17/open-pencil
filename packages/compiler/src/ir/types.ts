/**
 * Framework-neutral IR. Modules under `ir/` MUST NOT import from
 * `adapters/**`; the data flow is one-way (SceneGraph → IR → adapter).
 */

import type { ExprAst } from './expression'

export type IRNode = IRElement | IRText | IRExpression

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

export type IREventName = 'onClick' | 'onChange' | 'onSubmit' | 'onFocus' | 'onBlur'

/** A statement that runs when an event fires. Phase 1 §7.4 widens this
 *  into a discriminated union so the adapter can dispatch on `kind`
 *  exhaustively (and refuse to compile an unknown future kind silently). */
export type IREventHandler = IRSetStateHandler | IRNavigateHandler

export interface IRSetStateHandler {
  kind: 'setState'
  /** Variable name of the state being updated (already resolved from stateId). */
  stateName: string
  /** Pre-parsed AST for the new-value expression. */
  ast: ExprAst
  /** Identifiers referenced by the expression. */
  references: string[]
}

/** Navigate to a literal route at click time. The collector only emits
 *  this when a router is in scope (multi-page compile); single-page
 *  compiles drop the action with a warning at collect time. */
export interface IRNavigateHandler {
  kind: 'navigate'
  /** Route path, e.g. `/about`. Already validated to be non-empty. */
  to: string
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
  /** Warnings raised while collecting the IR (invalid bindings, expressions, etc.). */
  warnings: IRWarning[]
}

export interface IRWarning {
  code: string
  message: string
  nodeId?: string
}
