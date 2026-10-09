import type { Editor } from '@open-pencil/core/editor'
import {
  createEffectPickModuleInstance,
  getEffectPickCatalogEntry,
  resolveEffectPickModule,
  type EffectPickEditableField
} from '@open-pencil/core/plugins'
import type { EventName, ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'

import {
  currentModuleEditorOwner,
  type ModuleEditorCommit
} from '@/app/lowcode/module-editor/owner'

export interface EffectPickSwitchPlan {
  readonly instance: ModuleInstanceV1
  readonly resetFields: readonly EffectPickEditableField[]
  readonly inactiveEvents: readonly EventName[]
  readonly name: string
}

export function effectPickInactiveEvents(node: SceneNode): readonly EventName[] {
  const current = resolveEffectPickModule(node.interactiveProps?.module)
  const entry = current?.ok ? getEffectPickCatalogEntry(current.config.effectId) : undefined
  return entry && !entry.events.includes('click') && node.events?.onClick?.length ? ['onClick'] : []
}

/** Only fields exposed by both reviewed effects carry over; identity always comes from the target. */
export function planEffectPickSwitch(
  node: SceneNode,
  effectId: string
): EffectPickSwitchPlan | undefined {
  const current = resolveEffectPickModule(node.interactiveProps?.module)
  const source = current?.ok ? getEffectPickCatalogEntry(current.config.effectId) : undefined
  const target = getEffectPickCatalogEntry(effectId)
  if (!current?.ok || !source || !target)
    throw new TypeError('The selected reviewed EffectPick effect is unavailable')
  if (source.id === target.id) return undefined
  const config = structuredClone(target.defaultConfig)
  for (const key of target.editableFields) {
    if (source.editableFields.includes(key)) Reflect.set(config, key, current.config[key])
  }
  let name = node.name
  if (node.name === source.title) name = target.title
  else if (node.name === `EffectPick · ${source.title} · Static`)
    name = `EffectPick · ${target.title} · Static`
  return {
    instance: createEffectPickModuleInstance(config),
    resetFields: target.editableFields.filter((key) => !source.editableFields.includes(key)),
    inactiveEvents:
      !target.events.includes('click') && node.events?.onClick?.length ? ['onClick'] : [],
    name
  }
}

export function switchEffectPick(
  editor: Pick<Editor, 'graph' | 'state' | 'updateNodeWithUndo'>,
  request: ModuleEditorCommit<string>,
  undoLabel: string
): EffectPickSwitchPlan | undefined {
  const node = currentModuleEditorOwner(editor, request)
  if (!node) return undefined
  const plan = planEffectPickSwitch(node, request.value)
  if (!plan) return undefined
  editor.updateNodeWithUndo(
    node.id,
    {
      interactiveProps: { ...node.interactiveProps, module: plan.instance },
      ...(plan.name !== node.name ? { name: plan.name } : {})
    },
    undoLabel
  )
  return plan
}
