import { isEqual } from 'es-toolkit'

import type { Editor } from '@open-pencil/core/editor'
import {
  createBreadcrumbModuleInstance,
  createStepperModuleInstance,
  resolveBreadcrumbModule,
  resolveStepperModule,
  type BreadcrumbItemV1,
  type StepperItemV1
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  currentModuleEditorOwner,
  type ModuleEditorCommit
} from '@/app/lowcode/module-editor/owner'

export type NavigationEditorValue =
  | { kind: 'stepper'; items: StepperItemV1[]; currentIndex: number }
  | { kind: 'breadcrumb'; items: BreadcrumbItemV1[] }
export type NavigationItemField = 'title' | 'description' | 'label' | 'href'
export type NavigationEditorEdit =
  | { kind: 'update'; index: number; field: NavigationItemField; value: string }
  | { kind: 'add'; title: string }
  | { kind: 'remove'; index: number }
  | { kind: 'move'; index: number; offset: -1 | 1 }
  | { kind: 'current'; index: number }
  | { kind: 'status'; index: number; value: StepperItemV1['status'] }
  | { kind: 'disabled'; index: number; value: boolean }
export type NavigationEditorCommit = ModuleEditorCommit<NavigationEditorValue>

export function navigationEditorValue(config: JSONObject): NavigationEditorValue {
  if (typeof config.currentIndex === 'number') {
    const resolved = resolveStepperModule(createStepperModuleInstance(config))
    if (resolved?.ok)
      return {
        kind: 'stepper',
        items: structuredClone(resolved.config.items),
        currentIndex: resolved.config.currentIndex
      }
  } else {
    const resolved = resolveBreadcrumbModule(createBreadcrumbModuleInstance(config))
    if (resolved?.ok) return { kind: 'breadcrumb', items: structuredClone(resolved.config.items) }
  }
  throw new TypeError('Invalid navigation configuration')
}

export function editNavigationEditor(
  current: NavigationEditorValue,
  edit: NavigationEditorEdit
): NavigationEditorValue {
  const next = structuredClone(current)
  if (edit.kind === 'add') {
    if (next.items.length >= 12) return current
    if (next.kind === 'stepper')
      next.items.push({ title: edit.title, description: '', status: 'auto', disabled: false })
    else next.items.push({ label: edit.title, href: '' })
    return next
  }
  if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= next.items.length)
    return current
  if (edit.kind === 'update') {
    const item = next.items[edit.index]
    if (Object.hasOwn(item, edit.field)) Reflect.set(item, edit.field, edit.value)
    return next
  }
  if (edit.kind === 'current') {
    if (next.kind === 'stepper') next.currentIndex = edit.index
    return next
  }
  if (edit.kind === 'status' || edit.kind === 'disabled') {
    if (next.kind === 'stepper') {
      if (edit.kind === 'status') next.items[edit.index].status = edit.value
      else next.items[edit.index].disabled = edit.value
    }
    return next
  }
  return reorderNavigationItems(current, next, edit)
}

function reorderNavigationItems(
  current: NavigationEditorValue,
  next: NavigationEditorValue,
  edit: Extract<NavigationEditorEdit, { kind: 'remove' | 'move' }>
): NavigationEditorValue {
  const selected = next.kind === 'stepper' ? next.items[next.currentIndex] : undefined
  if (edit.kind === 'remove') {
    if (next.items.length <= 1) return current
    next.items.splice(edit.index, 1)
  } else {
    const target = edit.index + edit.offset
    if (target < 0 || target >= next.items.length) return current
    ;[next.items[edit.index], next.items[target]] = [next.items[target], next.items[edit.index]]
  }
  if (next.kind === 'stepper') {
    const index = selected ? next.items.indexOf(selected) : -1
    next.currentIndex = index !== -1 ? index : Math.min(edit.index, next.items.length - 1)
  }
  return next
}

function moduleFromDraft(config: JSONObject, value: NavigationEditorValue) {
  return value.kind === 'stepper'
    ? createStepperModuleInstance({
        ...config,
        items: structuredClone(value.items),
        currentIndex: value.currentIndex
      })
    : createBreadcrumbModuleInstance({ ...config, items: structuredClone(value.items) })
}

export function validNavigationEditor(config: JSONObject, value: NavigationEditorValue): boolean {
  try {
    moduleFromDraft(config, value)
    return true
  } catch {
    return false
  }
}

export function commitNavigationEditor(
  editor: Pick<Editor, 'graph' | 'state' | 'updateNodeWithUndo'>,
  request: NavigationEditorCommit
): boolean {
  const owner = currentModuleEditorOwner(editor, request)
  if (!owner) return false
  const resolved =
    request.value.kind === 'stepper'
      ? resolveStepperModule(request.previousModule)
      : resolveBreadcrumbModule(request.previousModule)
  if (!resolved?.ok || !validNavigationEditor(resolved.config, request.value)) return false
  const module = moduleFromDraft(resolved.config, request.value)
  if (!isEqual(module, request.previousModule))
    editor.updateNodeWithUndo(
      owner.id,
      { interactiveProps: { ...owner.interactiveProps, module } },
      'Update navigation items'
    )
  return true
}
