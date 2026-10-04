import type { IRAttrValue, IRModule, IRStateDecl, IRWarning } from '#compiler/ir/types'

import {
  STEPPER_MODULE_TYPE,
  STEPPER_PLUGIN_ID,
  resolveStepperModule
} from '@open-pencil/core/plugins'
import type { SceneGraph, SceneNode, StateDef } from '@open-pencil/scene-graph'

import { createContractModuleLowerer } from './contract-lowerer'
import { moduleStateTarget, writableModuleState } from './state-targets'

export const STEPPER_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: STEPPER_PLUGIN_ID,
  moduleType: STEPPER_MODULE_TYPE,
  warningCodePrefix: 'stepper-module',
  displayName: 'Stepper',
  resolve: resolveStepperModule,
  payload: (config) => ({ ...config, items: config.items.map((item) => ({ ...item })) })
})

interface StepperBindingContext {
  graph: SceneGraph
  states: ReadonlyMap<string, IRStateDecl>
  docStates: ReadonlyMap<string, IRStateDecl>
  docStateReads: Set<string>
  docStateWrites: Set<string>
  warnings: IRWarning[]
}

function writableStepperState(
  state: IRStateDecl | undefined,
  declarations: readonly StateDef[]
): state is IRStateDecl {
  if (!writableModuleState(state, declarations, 'number')) return false
  const declaration = declarations.find(
    (candidate) => candidate.name === state.name || candidate.id === state.id
  )
  // Document-state normalization drops malformed computed metadata; Stepper must not gain a write.
  return declaration?.computedExpr === undefined
}

/** Only the exact reviewed Stepper FRAME may read and write currentIndex. */
export function collectStepperModuleBindings(
  node: SceneNode,
  module: IRModule | null,
  attrs: Record<string, IRAttrValue>,
  ctx: StepperBindingContext
): void {
  if (
    node.type !== 'FRAME' ||
    module?.pluginId !== STEPPER_PLUGIN_ID ||
    module.moduleType !== STEPPER_MODULE_TYPE
  )
    return
  for (const key of ['disabled', 'readOnly'] as const)
    if (typeof node.interactiveProps?.[key] === 'boolean') attrs[key] = node.interactiveProps[key]
  const language = node.interactiveProps?.lang
  if (language === 'zh-CN' || language === 'en') attrs.lang = language
  if (!node.bindings || !Object.hasOwn(node.bindings, 'currentIndex')) return
  module.stepper = { currentIndex: { kind: 'ident', name: 'undefined' } }
  const raw: unknown = Object.getOwnPropertyDescriptor(node.bindings, 'currentIndex')?.value
  const { state, document, declarations } = moduleStateTarget(
    ctx.graph,
    node,
    raw,
    ctx.states,
    ctx.docStates,
    true
  )
  if (!writableStepperState(state, declarations)) {
    ctx.warnings.push({
      code: 'stepper-binding-invalid',
      nodeId: node.id,
      message:
        'Stepper currentIndex requires unique writable number page/document state; invalid bindings remain unavailable.'
    })
    return
  }
  module.stepper.currentIndex = { kind: 'ident', name: state.name }
  module.stepper.write = {
    kind: document ? 'docState' : 'state',
    name: state.name,
    targetType: 'number'
  }
  if (document) {
    ctx.docStateReads.add(state.name)
    ctx.docStateWrites.add(state.name)
  }
}
