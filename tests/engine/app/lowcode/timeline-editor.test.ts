import { expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import {
  createTimelineModuleFrameOverrides,
  TIMELINE_MODULE_DEFAULT_CONFIG
} from '@open-pencil/core/plugins'

import {
  commitTimelineItems,
  editTimelineItems,
  timelineItems,
  validTimelineItems,
  type TimelineEditorCommit
} from '@/app/lowcode/timeline-editor'
import { useTimelineDraft } from '@/app/lowcode/timeline-editor/use'

test('timeline edits keep event identity, allow empty content and reject duplicate identities', () => {
  const config = structuredClone(TIMELINE_MODULE_DEFAULT_CONFIG)
  const original = timelineItems(config)
  const moved = editTimelineItems(original, { kind: 'move', index: 0, offset: 1 })
  expect(moved[1]).toEqual(original[0])
  expect(
    editTimelineItems(moved, { kind: 'status', index: 0, id: original[0].id, value: 'error' })
  ).toBe(moved)
  expect(original).toEqual(config.items)
  let empty = moved
  while (empty.length) empty = editTimelineItems(empty, { kind: 'remove', index: 0 })
  expect(validTimelineItems(config, empty)).toBe(true)
  const added = editTimelineItems(original, { kind: 'add', title: '新增事件' })
  expect(new Set(added.map((item) => item.id)).size).toBe(added.length)
  const duplicate = editTimelineItems(added, {
    kind: 'text',
    index: 1,
    field: 'id',
    value: added[0].id
  })
  expect(validTimelineItems(config, duplicate)).toBe(false)
  expect(
    validTimelineItems(
      config,
      editTimelineItems(added, { kind: 'text', index: 0, field: 'title', value: '' })
    )
  ).toBe(false)
})

test('timeline update is one undo step and stale or unselected owner cannot receive it', () => {
  const editor = createEditor()
  try {
    const owner = editor.graph.createNode(
      'FRAME',
      editor.state.currentPageId,
      createTimelineModuleFrameOverrides()
    )
    editor.select([owner.id])
    editor.undo.clear()
    const before = structuredClone(owner.interactiveProps)
    const request: TimelineEditorCommit = {
      owner,
      previousModule: structuredClone(owner.interactiveProps?.module),
      value: editTimelineItems(timelineItems(structuredClone(TIMELINE_MODULE_DEFAULT_CONFIG)), {
        kind: 'add',
        title: 'Review'
      })
    }
    expect(commitTimelineItems(editor, request)).toBe(true)
    expect(commitTimelineItems(editor, request)).toBe(false)
    editor.undo.undo()
    expect(owner.interactiveProps).toEqual(before)
    expect(editor.undo.canUndo).toBe(false)
    editor.clearSelection()
    expect(commitTimelineItems(editor, request)).toBe(false)
  } finally {
    editor.dispose()
  }
})

test('retained timeline draft drops pending edits on replacement, pause and disposal', () => {
  const editor = createEditor()
  const scope = effectScope()
  try {
    const original = editor.graph.createNode(
      'FRAME',
      editor.state.currentPageId,
      createTimelineModuleFrameOverrides()
    )
    const owner = shallowRef(original)
    const active = ref(true)
    const requests: TimelineEditorCommit[] = []
    const liveConfig = shallowRef(structuredClone(TIMELINE_MODULE_DEFAULT_CONFIG))
    const draft = scope.run(() =>
      useTimelineDraft(
        () => owner.value,
        () => liveConfig.value,
        (request) => requests.push(request),
        active
      )
    )
    if (!draft) throw new Error('Missing draft scope')
    const generation = draft.generation.value
    liveConfig.value = {
      ...liveConfig.value,
      items: editTimelineItems(liveConfig.value.items, { kind: 'move', index: 0, offset: 1 })
    }
    expect(draft.generation.value).toBeGreaterThan(generation)
    for (const boundary of ['replacement', 'pause', 'dispose']) {
      active.value = true
      draft.beginInput()
      draft.input(0, 'title', 'Pending change')
      if (boundary === 'replacement') owner.value = structuredClone(original)
      if (boundary === 'pause') active.value = false
      if (boundary === 'dispose') scope.stop()
      draft.input(0, 'title', 'Late blur')
      draft.commit()
    }
    expect(requests).toEqual([])
  } finally {
    scope.stop()
    editor.dispose()
  }
})
