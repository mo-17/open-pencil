import type {
  IRAttrValue,
  IRModule,
  IRModuleValueField,
  IRStateDecl,
  IRWarning
} from '#compiler/ir/types'

import { moduleValueFields, resolveModuleFieldName } from '@open-pencil/core/plugins'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { moduleStateTarget, writableModuleState } from './state-targets'

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
    const { state, document, declarations } = moduleStateTarget(
      ctx.graph,
      node,
      binding,
      ctx.states,
      ctx.docStates
    )
    if (unsupportedOwner || !writableModuleState(state, declarations, descriptor.type)) {
      ctx.warnings.push({
        code: 'module-value-binding-invalid',
        nodeId: node.id,
        message: `${module.moduleType}.${descriptor.key} requires writable ${descriptor.type} page/document state; value stays unavailable.`
      })
      return [field]
    }
    field.read = { kind: 'ident', name: state.name }
    field.write = {
      kind: document ? 'docState' : 'state',
      name: state.name,
      targetType: descriptor.type
    }
    field.defaultValue = state.defaultValue
    field.name = resolveModuleFieldName(node, descriptor.key, state.name)
    if (field.name === undefined)
      ctx.warnings.push({
        code: 'module-field-name-invalid',
        nodeId: node.id,
        message: `${module.moduleType}.${descriptor.key} has an invalid form field name; FormData serialization is unavailable.`
      })
    if (document) {
      ctx.docStateReads.add(state.name)
      ctx.docStateWrites.add(state.name)
    }
    return [field]
  })
  if (fields.length) module.valueFields = fields
}
