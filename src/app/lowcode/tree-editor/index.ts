import { isEqual } from 'es-toolkit'

import type { Editor } from '@open-pencil/core/editor'
import {
  createTreeModuleInstance,
  createCascaderModuleInstance,
  resolveCascaderModule,
  resolveTreeModule,
  treeItemDisabled,
  type TreeItem
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  currentModuleEditorOwner,
  type ModuleEditorCommit
} from '@/app/lowcode/module-editor/owner'
export interface TreeEditorValue {
  items: TreeItem[]
  initialSelectedIds: string[]
  initialExpandedIds: string[]
}
export type TreeEditorCommit = ModuleEditorCommit<TreeEditorValue>
export type TreeEditorEdit =
  | { kind: 'text'; index: number; field: 'id' | 'label' | 'parentId'; value: string }
  | {
      kind: 'toggle'
      index: number
      field: 'disabled' | 'selected' | 'expanded'
      value: boolean
      multiple: boolean
    }
  | { kind: 'add'; label: string; parentId?: string }
  | { kind: 'remove'; index: number }
export function treeEditorValue(config: JSONObject): TreeEditorValue {
  if (Array.isArray(config.initialPath)) {
    const resolved = resolveCascaderModule(createCascaderModuleInstance(config))
    if (!resolved?.ok) throw new TypeError('Invalid cascader configuration')
    const leaf = resolved.config.initialPath.at(-1)
    return structuredClone({
      items: resolved.config.items,
      initialSelectedIds: leaf ? [leaf] : [],
      initialExpandedIds: []
    })
  }
  const resolved = resolveTreeModule(createTreeModuleInstance(config))
  if (!resolved?.ok) throw new TypeError('Invalid tree configuration')
  return structuredClone({
    items: resolved.config.items,
    initialSelectedIds: resolved.config.initialSelectedIds,
    initialExpandedIds: resolved.config.initialExpandedIds
  })
}
export function treeDescendants(items: readonly TreeItem[], id: string): Set<string> {
  const descendants = new Set([id])
  let pass = 0
  while (pass++ < items.length) {
    const count = descendants.size
    for (const item of items) if (descendants.has(item.parentId)) descendants.add(item.id)
    if (count === descendants.size) break
  }
  return descendants
}
function renameTreeItem(next: TreeEditorValue, item: TreeItem, value: string): void {
  const previous = item.id
  item.id = value
  for (const child of next.items) if (child.parentId === previous) child.parentId = value
  next.initialSelectedIds = next.initialSelectedIds.map((id) => (id === previous ? value : id))
  next.initialExpandedIds = next.initialExpandedIds.map((id) => (id === previous ? value : id))
}
export function editTreeEditor(current: TreeEditorValue, edit: TreeEditorEdit): TreeEditorValue {
  const next = structuredClone(current)
  if (edit.kind === 'add') {
    if (next.items.length >= 128) return current
    let index = 1
    while (next.items.some((item) => item.id === 'node' + index)) index++
    next.items.push({
      id: 'node' + index,
      label: edit.label,
      parentId: edit.parentId ?? '',
      disabled: false
    })
    return next
  }
  if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= next.items.length)
    return current
  const item = next.items[edit.index]
  if (edit.kind === 'remove') {
    if (next.items.length <= 1) return current
    next.items.splice(edit.index, 1)
    for (const child of next.items) if (child.parentId === item.id) child.parentId = item.parentId
    next.initialSelectedIds = next.initialSelectedIds.filter((id) => id !== item.id)
    next.initialExpandedIds = next.initialExpandedIds.filter(
      (id) => id !== item.id && next.items.some((child) => child.parentId === id)
    )
    return next
  }
  if (edit.kind === 'text') {
    if (edit.field === 'id') {
      renameTreeItem(next, item, edit.value)
    } else item[edit.field] = edit.value
  } else if (edit.field === 'disabled') item.disabled = edit.value
  else {
    const field = edit.field === 'selected' ? 'initialSelectedIds' : 'initialExpandedIds'
    next[field] = next[field].filter((id) => id !== item.id)
    if (edit.value) {
      if (edit.field === 'selected' && !edit.multiple) next[field] = []
      next[field].push(item.id)
    }
  }
  next.initialSelectedIds = next.initialSelectedIds.filter(
    (id) => !treeItemDisabled(next.items, id)
  )
  next.initialExpandedIds = next.initialExpandedIds.filter((id) =>
    next.items.some((child) => child.parentId === id)
  )
  return next
}
function treeEditorInstance(config: JSONObject, value: TreeEditorValue) {
  if (!Array.isArray(config.initialPath)) return createTreeModuleInstance({ ...config, ...value })
  const leaf = value.initialSelectedIds.at(-1)
  const path: string[] = []
  if (
    leaf &&
    !value.items.some((item) => item.parentId === leaf) &&
    !treeItemDisabled(value.items, leaf)
  ) {
    let current = value.items.find((item) => item.id === leaf)
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      path.unshift(current.id)
      const parentId = current.parentId
      current = value.items.find((item) => item.id === parentId)
    }
  }
  return createCascaderModuleInstance({ ...config, items: value.items, initialPath: path })
}
export function validTreeEditor(config: JSONObject, value: TreeEditorValue): boolean {
  try {
    treeEditorInstance(config, value)
    return true
  } catch {
    return false
  }
}
export function commitTreeEditor(
  editor: Pick<Editor, 'graph' | 'state' | 'updateNodeWithUndo'>,
  request: TreeEditorCommit
): boolean {
  const owner = currentModuleEditorOwner(editor, request),
    resolved =
      resolveTreeModule(request.previousModule) ?? resolveCascaderModule(request.previousModule)
  if (!owner || !resolved?.ok || !validTreeEditor(resolved.config, request.value)) return false
  const module = treeEditorInstance(resolved.config, structuredClone(request.value))
  if (!isEqual(module, request.previousModule))
    editor.updateNodeWithUndo(
      owner.id,
      { interactiveProps: { ...owner.interactiveProps, module } },
      'Update tree items'
    )
  return true
}
