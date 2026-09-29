import type {
  IRAttrValue,
  IRModule,
  IRModuleValueField,
  IRStateDecl,
  IRWarning
} from '#compiler/ir/types'

import { moduleValueFields } from '@open-pencil/core/plugins'
import type { SceneGraph, SceneNode, StateDef } from '@open-pencil/scene-graph'

interface Context {
  graph: SceneGraph
  states: ReadonlyMap<string, IRStateDecl>
  docStates: ReadonlyMap<string, IRStateDecl>
  docStateReads: Set<string>
  docStateWrites: Set<string>
  warnings: IRWarning[]
}
/** A present bad binding must remain unavailable, never fall back to example content. */
export function collectModuleValueFields(
  node: SceneNode,
  module: IRModule | null,
  ctx: Context,
  attrs: Record<string, IRAttrValue>
): void {
  if (!module) return
  const descriptors = moduleValueFields(node)
  if (descriptors.length === 0) return
  const props = node.interactiveProps
  for (const key of ['disabled', 'readOnly'] as const)
    if (typeof props?.[key] === 'boolean') attrs[key] = props[key]
  const unsupportedOwner = props?.form !== undefined
  if (unsupportedOwner) {
    delete attrs.form
    attrs.disabled = true
    ctx.warnings.push({
      code: 'module-form-owner-unsupported',
      nodeId: node.id,
      message:
        'Bound module controls must remain inside their owning FORM. Explicit form reassignment is unsupported; this control is disabled.'
    })
  }
  const fields = descriptors.flatMap((descriptor): IRModuleValueField[] => {
    if (!node.bindings || !Object.hasOwn(node.bindings, descriptor.key)) return []
    const field: IRModuleValueField = {
      key: descriptor.key,
      type: descriptor.type,
      read: { kind: 'ident', name: 'undefined' }
    }
    const binding: unknown = Object.getOwnPropertyDescriptor(node.bindings, descriptor.key)?.value
    const own = (key: string): unknown =>
      binding && typeof binding === 'object'
        ? Object.getOwnPropertyDescriptor(binding, key)?.value
        : undefined
    const kind = own('kind'),
      id = own('stateId'),
      name = own('docStateName')
    let state: IRStateDecl | undefined
    if (kind === 'ref' && typeof id === 'string') state = ctx.states.get(id)
    if (kind === 'docState' && typeof name === 'string') state = ctx.docStates.get(name)
    const declarations =
      kind === 'docState'
        ? (ctx.graph.getNode(ctx.graph.rootId)?.lowcodeDocumentState ?? [])
        : pageDeclarations(ctx.graph, node)
    if (
      unsupportedOwner ||
      !state ||
      declarations.filter((candidate) => candidate.name === state.name || candidate.id === state.id)
        .length !== 1 ||
      state.type !== descriptor.type ||
      state.computed ||
      state.computedExpr !== undefined ||
      state.computedInvalid
    ) {
      ctx.warnings.push({
        code: 'module-value-binding-invalid',
        nodeId: node.id,
        message: `${module.moduleType}.${descriptor.key} requires writable ${descriptor.type} page/document state; value stays unavailable.`
      })
      return [field]
    }
    field.read = { kind: 'ident', name: state.name }
    field.write = {
      kind: kind === 'docState' ? 'docState' : 'state',
      name: state.name,
      targetType: descriptor.type
    }
    field.defaultValue = state.defaultValue
    field.name = state.name
    if (kind === 'docState') {
      ctx.docStateReads.add(state.name)
      ctx.docStateWrites.add(state.name)
    }
    return [field]
  })
  if (fields.length) module.valueFields = fields
}

function pageDeclarations(graph: SceneGraph, node: SceneNode): readonly StateDef[] {
  const seen = new Set<string>()
  let current: SceneNode | undefined = node
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.type === 'CANVAS') return current.state ?? []
    current = graph.getNode(current.parentId ?? '')
  }
  return []
}
