import type { IRModule, IRStateDecl, IRWarning } from '#compiler/ir/types'

import { moduleDataField } from '@open-pencil/core/plugins'
import { collectReferences, type ExprAst } from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode, StateDef } from '@open-pencil/scene-graph'

import { moduleStateTarget } from './state-targets'

interface DataBindingContext {
  graph: SceneGraph
  states: ReadonlyMap<string, IRStateDecl>
  docStates: ReadonlyMap<string, IRStateDecl>
  docStateReads: Set<string>
  warnings: IRWarning[]
}

/** Read-only bindings never join FORM writes, CSV imports, or business selection state. */
export function collectModuleDataBinding(
  node: SceneNode,
  module: IRModule | null,
  ctx: DataBindingContext,
  resolve: (source: string) => ExprAst | undefined
): void {
  const field = moduleDataField(node)
  if (!module || !field || !node.bindings || !Object.hasOwn(node.bindings, field.key)) return
  const key = field.key === 'rows' ? 'dataGridRowsExpr' : 'chartDataExpr'
  module[key] = { kind: 'ident', name: 'undefined' }
  const invalid = () =>
    ctx.warnings.push({
      code: 'module-data-binding-invalid',
      nodeId: node.id,
      message: `${module.moduleType} ${field.key} requires unique ${field.type} page/document state or a valid read expression; invalid data remains unavailable.`
    })
  const binding: unknown = Object.getOwnPropertyDescriptor(node.bindings, field.key)?.value
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    invalid()
    return
  }
  const own = (name: string): unknown => Object.getOwnPropertyDescriptor(binding, name)?.value
  if (own('kind') === 'expr' && typeof own('expr') === 'string') {
    const ast = resolve(own('expr') as string)
    if (!ast) return
    if (unsupportedComputedRead(ast, ctx)) {
      invalid()
      return
    }
    module[key] = ast
    return
  }
  const target = moduleStateTarget(ctx.graph, node, binding, ctx.states, ctx.docStates, true)
  const state = target.state
  if (!readableDataState(state, target.declarations, field.type, target.document)) {
    invalid()
    return
  }
  const ast: ExprAst = { kind: 'ident', name: state.name }
  if (unsupportedComputedRead(ast, ctx)) {
    invalid()
    return
  }
  module[key] = ast
  if (target.document) ctx.docStateReads.add(state.name)
}

function unsupportedComputedRead(ast: ExprAst, ctx: DataBindingContext): boolean {
  const pending = [...collectReferences(ast)]
  const seen = new Set<string>()
  const pages = new Map([...ctx.states.values()].map((state) => [state.name, state]))
  const computedDocs = new Set(
    (ctx.graph.getNode(ctx.graph.rootId)?.lowcodeDocumentState ?? [])
      .filter((state) => state.computedExpr !== undefined)
      .map((state) => state.name)
  )
  while (pending.length) {
    const name = pending.pop()
    if (name === undefined || seen.has(name)) continue
    seen.add(name)
    if (computedDocs.has(name)) return true
    const state = pages.get(name)
    if (state?.computedInvalid) return true
    if (state?.computed) pending.push(...state.computed.references)
  }
  return false
}

function readableDataState(
  state: IRStateDecl | undefined,
  declarations: readonly StateDef[],
  type: StateDef['type'],
  isDocument: boolean
): state is IRStateDecl {
  if (!state || state.type !== type || state.computedInvalid) return false
  const matches = declarations.filter(
    (candidate) => candidate.id === state.id || candidate.name === state.name
  )
  return matches.length === 1 && (!isDocument || matches[0].computedExpr === undefined)
}
