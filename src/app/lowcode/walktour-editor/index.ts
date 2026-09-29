import { parseWalktourSteps, type WalktourStep } from '@open-pencil/core/plugins'
import type { LowcodeSelectOption } from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export type WalktourTargetOption = LowcodeSelectOption
export type WalktourStepEdit =
  | {
      kind: 'field'
      id: string
      field: 'title' | 'content' | 'targetChildName' | 'placement'
      value: string
    }
  | { kind: 'add'; title: string }
  | { kind: 'remove'; id: string }
  | { kind: 'move'; id: string; offset: -1 | 1 }

export function walktourSteps(config: JSONObject): WalktourStep[] {
  return parseWalktourSteps(config.steps)
}
export function walktourStepsValid(steps: WalktourStep[]): boolean {
  try {
    parseWalktourSteps(steps)
    return true
  } catch {
    return false
  }
}
export function editWalktourSteps(
  previous: WalktourStep[],
  edit: WalktourStepEdit
): WalktourStep[] {
  const steps = structuredClone(previous)
  if (edit.kind === 'add') {
    if (steps.length >= 12) return steps
    let number = 1
    while (steps.some((step) => step.id === `step${number}`)) number++
    steps.push({
      id: `step${number}`,
      title: edit.title,
      content: '',
      targetChildName: '',
      placement: 'bottom'
    })
    return steps
  }
  const index = steps.findIndex((step) => step.id === edit.id)
  const step = steps.at(index)
  if (index === -1 || !step) return steps
  if (edit.kind === 'field') {
    if (edit.field === 'placement') {
      if (['top', 'right', 'bottom', 'left'].includes(edit.value))
        step.placement = edit.value as WalktourStep['placement']
    } else step[edit.field] = edit.value
  } else if (edit.kind === 'remove' && steps.length > 1) steps.splice(index, 1)
  else if (edit.kind === 'move') {
    const destination = index + edit.offset
    if (destination >= 0 && destination < steps.length) {
      steps.splice(index, 1)
      steps.splice(destination, 0, step)
    }
  }
  return steps
}

/** Targets are authored direct-child names, never CSS selectors or descendants. */
export function walktourChildTargets(
  graph: Pick<SceneGraph, 'getNode'>,
  owner?: SceneNode
): WalktourTargetOption[] {
  const grouped = new Map<string, { count: number; available: boolean }>()
  for (const id of owner?.childIds ?? []) {
    const child = graph.getNode(id)
    if (!child?.name) continue
    const current = grouped.get(child.name)
    grouped.set(child.name, {
      count: (current?.count ?? 0) + 1,
      available:
        child.visible &&
        !child.internalOnly &&
        child.name.trim() === child.name &&
        child.name.length <= 120
    })
  }
  return [...grouped].map(([name, status]) => ({
    value: name,
    label: name,
    disabled: status.count !== 1 || !status.available
  }))
}
export function walktourTargetValue(name: string): string {
  return name ? `child:${name}` : 'overview'
}
export function walktourTargetOptions(
  steps: WalktourStep[],
  id: string,
  children: readonly WalktourTargetOption[],
  overview: string,
  unavailable: string
): WalktourTargetOption[] {
  const selected = steps.find((step) => step.id === id)?.targetChildName ?? ''
  const used = new Set(steps.filter((step) => step.id !== id).map((step) => step.targetChildName))
  const options = children.map((child) => ({
    value: walktourTargetValue(child.value),
    label: child.disabled ? `${unavailable}: ${child.label}` : child.label,
    disabled: child.disabled || used.has(child.value)
  }))
  if (selected && !children.some((child) => child.value === selected))
    options.push({
      value: walktourTargetValue(selected),
      label: `${unavailable}: ${selected}`,
      disabled: true
    })
  return [{ value: 'overview', label: overview }, ...options]
}
