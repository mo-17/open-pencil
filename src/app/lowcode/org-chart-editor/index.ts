import { isEqual } from 'es-toolkit'

import type { Editor } from '@open-pencil/core/editor'
import {
  createOrgChartModuleInstance,
  resolveOrgChartModule,
  type OrgChartItem
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { currentModuleEditorOwner } from '@/app/lowcode/module-editor/owner'
import type { ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'

export interface OrgChartDraft {
  items: OrgChartItem[]
  initialCollapsedIds: string[]
}
export type OrgChartEdit =
  | { kind: 'text'; id: string; field: 'label' | 'description'; value: string }
  | { kind: 'parent'; id: string; parentId: string }
  | { kind: 'collapsed'; id: string; value: boolean }
  | { kind: 'add'; label: string; parentId?: string }
  | { kind: 'remove'; id: string }
  | { kind: 'move'; id: string; offset: -1 | 1 }

export function orgChartDraft(config: JSONObject): OrgChartDraft {
  const module = resolveOrgChartModule(createOrgChartModuleInstance(config))
  if (!module?.ok) throw new Error(module?.reason ?? 'Invalid organization chart')
  return structuredClone({
    items: module.config.items,
    initialCollapsedIds: module.config.initialCollapsedIds
  })
}

export function orgChartDraftConfig(config: JSONObject, draft: OrgChartDraft): JSONObject {
  return {
    ...config,
    items: draft.items.map((item) => ({ ...item })),
    initialCollapsedIds: [...draft.initialCollapsedIds]
  }
}

export function orgChartDraftValid(config: JSONObject, draft: OrgChartDraft): boolean {
  try {
    createOrgChartModuleInstance(orgChartDraftConfig(config, draft))
    return true
  } catch {
    return false
  }
}

/** Encode the empty root ID because the controlled Select reserves an empty value. */
export function orgChartParentValue(parentId: string): string {
  return parentId ? `node:${parentId}` : 'root'
}
export function orgChartParentChoices(draft: OrgChartDraft, id: string, rootLabel: string) {
  const excluded = new Set([id])
  let passes = draft.items.length
  while (passes-- > 0)
    for (const item of draft.items) if (excluded.has(item.parentId)) excluded.add(item.id)
  return [
    { value: 'root', label: rootLabel },
    ...draft.items
      .filter((item) => !excluded.has(item.id))
      .map((item) => ({
        value: orgChartParentValue(item.id),
        label: item.label || item.id
      }))
  ]
}

export function editOrgChartDraft(previous: OrgChartDraft, change: OrgChartEdit): OrgChartDraft {
  const next = structuredClone(previous)
  const item = 'id' in change ? next.items.find((entry) => entry.id === change.id) : undefined
  if (change.kind === 'add' && next.items.length < 64) {
    let index = 1
    while (next.items.some((entry) => entry.id === `member${index}`)) index++
    next.items.push({
      id: `member${index}`,
      label: change.label,
      description: '',
      parentId: change.parentId ?? ''
    })
  } else if (item) {
    switch (change.kind) {
      case 'text':
        item[change.field] = change.value
        break
      case 'parent': {
        const allowed = orgChartParentChoices(next, item.id, '')
        if (allowed.some((choice) => choice.value === orgChartParentValue(change.parentId)))
          item.parentId = change.parentId
        break
      }
      case 'collapsed':
        next.initialCollapsedIds = next.initialCollapsedIds.filter((id) => id !== item.id)
        if (change.value) next.initialCollapsedIds.push(item.id)
        break
      case 'remove':
        if (next.items.length <= 1) break
        next.items = next.items.filter((entry) => entry.id !== item.id)
        for (const child of next.items)
          if (child.parentId === item.id) child.parentId = item.parentId
        break
      case 'move': {
        const siblings = next.items.filter((entry) => entry.parentId === item.parentId)
        const target = siblings.indexOf(item) + change.offset
        const sibling = target >= 0 ? siblings.at(target) : undefined
        if (sibling) {
          const from = next.items.indexOf(item),
            to = next.items.indexOf(sibling)
          ;[next.items[from], next.items[to]] = [next.items[to], next.items[from]]
        }
        break
      }
    }
  }
  // Collapsed IDs always name surviving branches, including after promotion/reparenting.
  next.initialCollapsedIds = next.initialCollapsedIds.filter((id) =>
    next.items.some((entry) => entry.parentId === id)
  )
  return next
}

/** One graph mutation includes items and their initial folded branches. */
export function commitOrgChartItems(
  editor: Pick<Editor, 'graph' | 'state' | 'updateNodeWithUndo'>,
  request: ModuleScalarCommit
): boolean {
  const owner = currentModuleEditorOwner(editor, request)
  if (
    !owner ||
    request.value.kind !== 'value' ||
    !resolveOrgChartModule(request.previousModule)?.ok
  )
    return false
  try {
    const module = createOrgChartModuleInstance(request.value.value as JSONObject)
    if (!isEqual(module, request.previousModule))
      editor.updateNodeWithUndo(
        owner.id,
        { interactiveProps: { ...owner.interactiveProps, module } },
        'Update organization chart items'
      )
    return true
  } catch {
    return false
  }
}
