import type {
  IRAttrValue,
  IRDocStateDecl,
  IRModule,
  IRPaginationBindings,
  IRStateDecl,
  IRWarning
} from '#compiler/ir/types'

import {
  PAGINATION_MODULE_TYPE,
  PAGINATION_PLUGIN_ID,
  resolvePaginationModule
} from '@open-pencil/core/plugins'
import { collectReferences, type ExprAst } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

import { createContractModuleLowerer } from './contract-lowerer'

export const PAGINATION_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: PAGINATION_PLUGIN_ID,
  moduleType: PAGINATION_MODULE_TYPE,
  warningCodePrefix: 'pagination-module',
  displayName: 'Pagination',
  resolve: resolvePaginationModule,
  payload: (config) => ({ ...config })
})

interface PaginationBindingContext {
  states: ReadonlyMap<string, IRStateDecl>
  docStates: ReadonlyMap<string, IRDocStateDecl>
  docStateReads: Set<string>
  docStateWrites: Set<string>
  warnings: IRWarning[]
}

function paginationWarning(node: SceneNode, ctx: PaginationBindingContext, key: string): void {
  ctx.warnings.push({
    code: 'pagination-binding-invalid',
    nodeId: node.id,
    message: `Pagination ${key} requires ${key === 'currentPage' ? 'writable number page/document state' : 'number state or a valid read expression'}; invalid bindings remain unavailable.`
  })
}

function stateBinding(
  node: SceneNode,
  key: string,
  raw: PaginationBindingData,
  ctx: PaginationBindingContext
): IRStateDecl | undefined {
  if (raw.kind === 'ref' && typeof raw.stateId === 'string' && ctx.states.has(raw.stateId))
    return ctx.states.get(raw.stateId)
  if (
    raw.kind === 'docState' &&
    typeof raw.docStateName === 'string' &&
    ctx.docStates.has(raw.docStateName)
  )
    return ctx.docStates.get(raw.docStateName)
  paginationWarning(node, ctx, key)
  return undefined
}

type PaginationBindingKey = 'currentPage' | 'total' | 'pageSize'
interface PaginationBindingData {
  kind?: unknown
  expr?: unknown
  stateId?: unknown
  docStateName?: unknown
}
function ownBindingData(value: unknown): PaginationBindingData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const own = (key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value
  return {
    kind: own('kind'),
    expr: own('expr'),
    stateId: own('stateId'),
    docStateName: own('docStateName')
  }
}
function collectPaginationBinding(
  node: SceneNode,
  key: PaginationBindingKey,
  bindings: IRPaginationBindings,
  ctx: PaginationBindingContext,
  resolve: (source: string) => ExprAst | undefined
): void {
  if (!node.bindings || !Object.hasOwn(node.bindings, key)) return
  bindings[key] = { kind: 'ident', name: 'undefined' }
  const data = ownBindingData(Object.getOwnPropertyDescriptor(node.bindings, key)?.value)
  if (!data) {
    paginationWarning(node, ctx, key)
    return
  }
  if (key !== 'currentPage' && data.kind === 'expr' && typeof data.expr === 'string') {
    const ast = resolve(data.expr)
    if (ast && !readsInvalidComputedState(ast, ctx)) bindings[key] = ast
    else if (ast) paginationWarning(node, ctx, key)
    return
  }
  const state = stateBinding(node, key, data, ctx)
  if (!state) return
  if (!validNumericState(state, key)) {
    paginationWarning(node, ctx, key)
    return
  }
  bindings[key] = { kind: 'ident', name: state.name }
  if (data.kind === 'docState') ctx.docStateReads.add(state.name)
  if (key === 'currentPage') {
    bindings.write = {
      kind: data.kind === 'docState' ? 'docState' : 'state',
      name: state.name,
      targetType: 'number'
    }
    if (data.kind === 'docState') ctx.docStateWrites.add(state.name)
  }
}
function validNumericState(state: IRStateDecl, key: PaginationBindingKey): boolean {
  if (state.type !== 'number' || state.computedInvalid) return false
  return key !== 'currentPage' || !(state.computed || state.computedExpr !== undefined)
}
function readsInvalidComputedState(ast: ExprAst, ctx: PaginationBindingContext): boolean {
  const references = collectReferences(ast)
  return [...ctx.states.values(), ...ctx.docStates.values()].some(
    (state) => state.computedInvalid && references.has(state.name)
  )
}
/** Bindings belong to the exact reviewed module, never to a look-alike FRAME. */
export function collectPaginationModuleBindings(
  node: SceneNode,
  module: IRModule | null,
  attrs: Record<string, IRAttrValue>,
  ctx: PaginationBindingContext,
  resolve: (source: string) => ExprAst | undefined
): void {
  if (module?.pluginId !== PAGINATION_PLUGIN_ID || module.moduleType !== PAGINATION_MODULE_TYPE)
    return
  const language = node.interactiveProps?.lang
  if (language === 'zh-CN' || language === 'en') attrs.lang = language
  const bindings: IRPaginationBindings = {}
  for (const key of ['currentPage', 'total', 'pageSize'] as const)
    collectPaginationBinding(node, key, bindings, ctx, resolve)
  if (Object.keys(bindings).length) module.pagination = bindings
}
