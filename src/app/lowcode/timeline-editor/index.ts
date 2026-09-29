import { isEqual } from 'es-toolkit'

import type { Editor } from '@open-pencil/core/editor'
import {
  createTimelineModuleInstance,
  resolveTimelineModule,
  type TimelineItemV1
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  currentModuleEditorOwner,
  type ModuleEditorCommit
} from '@/app/lowcode/module-editor/owner'

export type TimelineEditorCommit = ModuleEditorCommit<TimelineItemV1[]>
export type TimelineTextField = 'id' | 'title' | 'description' | 'time'
export type TimelineEdit =
  | { kind: 'text'; index: number; field: TimelineTextField; value: string }
  | { kind: 'status'; index: number; id: string; value: TimelineItemV1['status'] }
  | { kind: 'add'; title: string }
  | { kind: 'remove'; index: number }
  | { kind: 'move'; index: number; offset: -1 | 1 }

export function timelineItems(config: JSONObject): TimelineItemV1[] {
  const result = resolveTimelineModule(createTimelineModuleInstance(config))
  if (!result?.ok) throw new TypeError('Invalid timeline configuration')
  return structuredClone(result.config.items)
}

export function editTimelineItems(items: TimelineItemV1[], edit: TimelineEdit): TimelineItemV1[] {
  const next = structuredClone(items)
  if (edit.kind === 'add') {
    if (next.length >= 24) return items
    let suffix = 1
    while (next.some((item) => item.id === `event-${suffix}`)) suffix++
    next.push({
      id: `event-${suffix}`,
      title: edit.title,
      description: '',
      time: '',
      status: 'pending'
    })
    return next
  }
  if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= next.length) return items
  const item = next[edit.index]
  switch (edit.kind) {
    case 'text':
      item[edit.field] = edit.value
      break
    case 'status':
      if (item.id !== edit.id) return items
      item.status = edit.value
      break
    case 'remove':
      next.splice(edit.index, 1)
      break
    case 'move': {
      const target = edit.index + edit.offset
      if (target < 0 || target >= next.length) return items
      next.splice(edit.index, 1)
      next.splice(target, 0, item)
      break
    }
  }
  return next
}

export function validTimelineItems(config: JSONObject, items: TimelineItemV1[]): boolean {
  try {
    createTimelineModuleInstance({ ...config, items })
    return true
  } catch {
    return false
  }
}

export function commitTimelineItems(
  editor: Pick<Editor, 'graph' | 'state' | 'updateNodeWithUndo'>,
  request: TimelineEditorCommit
): boolean {
  const owner = currentModuleEditorOwner(editor, request)
  const resolved = resolveTimelineModule(request.previousModule)
  if (!owner || !resolved?.ok || !validTimelineItems(resolved.config, request.value)) return false
  const module = createTimelineModuleInstance({ ...resolved.config, items: request.value })
  if (isEqual(module, request.previousModule)) return true
  editor.updateNodeWithUndo(
    owner.id,
    { interactiveProps: { ...owner.interactiveProps, module } },
    'Edit timeline events'
  )
  return true
}
