import { expect, test } from 'bun:test'

import { nextTick, ref, shallowReactive } from 'vue'

import { createDefaultEditorState, createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createPreviewSourceInvalidations,
  watchPreviewSourceChanges
} from '@/app/lowcode/preview-pane/source-invalidations'

function setup(guarded = true) {
  const graph = new SceneGraph()
  const first = graph.getPages()[0]
  const second = graph.addPage('Second')
  for (const [page, route] of [
    [first, '/home'],
    [second, '/detail']
  ] as const) {
    const frame = graph.createNode('FRAME', page.id, { width: 100, height: 100 })
    graph.updateNode(page.id, {
      lowcodeRoutePattern: route,
      lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: frame.id },
      source: { ...page.source, format: 'fig' }
    })
  }
  graph.updateNode(graph.rootId, {
    lowcodeApplication: { version: 1, enabled: true, startPageId: first.id }
  })
  if (guarded)
    graph.updateNode(second.id, {
      lowcodeApplicationPage: {
        ...second.lowcodeApplicationPage,
        version: 1,
        role: 'application',
        entryNodeId: second.childIds[0],
        leaveConfirm: { dirtyExpr: 'draft !== ""', message: 'Leave?' }
      }
    })
  const editor = createEditor({ graph, state: shallowReactive(createDefaultEditorState(first.id)) })
  const invalidations = createPreviewSourceInvalidations()
  editor.onEditorEvent('render:requested', invalidations.record)
  return { graph, first, second, editor, invalidations }
}

for (const mode of ['legacy', 'prepared'] as const) {
  test(`${mode} guarded navigation preserves canvas versions and skips only the navigation compile`, async () => {
    const { graph, second, editor, invalidations } = setup()
    const before = editor.state.sceneVersion
    const render = editor.state.renderVersion
    try {
      if (mode === 'legacy') await editor.switchPage(second.id)
      else {
        const prepared = await editor.preparePage(second.id)
        if (!prepared) throw new Error('Page preparation failed')
        expect(editor.commitPageSwitch(prepared)).toBe(true)
      }
      expect(editor.state.currentPageId).toBe(second.id)
      expect(editor.state.sceneVersion).toBeGreaterThan(before)
      expect(editor.state.renderVersion).toBeGreaterThan(render)
      expect(invalidations.changed(graph, editor.state.sceneVersion, before)).toBe(false)
      const version = editor.state.sceneVersion
      graph.createNode('RECTANGLE', second.id, { name: 'Authored change' })
      expect(invalidations.changed(graph, editor.state.sceneVersion, version)).toBe(true)
    } finally {
      editor.dispose()
    }
  })
}

test('coalesced authored changes cannot be hidden by a later navigation render', async () => {
  const { graph, second, editor, invalidations } = setup()
  const before = editor.state.sceneVersion
  try {
    graph.createNode('RECTANGLE', second.id, { name: 'New content before switch' })
    await editor.switchPage(second.id)
    expect(invalidations.changed(graph, editor.state.sceneVersion, before)).toBe(true)
  } finally {
    editor.dispose()
  }
})

test('unguarded applications retain the previous compile behavior on navigation', async () => {
  const { graph, second, editor, invalidations } = setup(false)
  const before = editor.state.sceneVersion
  try {
    await editor.switchPage(second.id)
    expect(invalidations.changed(graph, editor.state.sceneVersion, before)).toBe(true)
  } finally {
    editor.dispose()
  }
})

test('the actual preview watcher retains navigation but recompiles fonts and coalesced graph edits', async () => {
  const { graph, first, second, editor } = setup()
  const fonts = ref(0)
  const requests: boolean[] = []
  const stop = watchPreviewSourceChanges(
    editor,
    fonts,
    () => true,
    (refresh) => requests.push(refresh)
  )
  try {
    const prepared = await editor.preparePage(second.id)
    if (!prepared) throw new Error('Page preparation failed')
    editor.commitPageSwitch(prepared)
    await nextTick()
    expect(requests).toEqual([])
    fonts.value++
    await nextTick()
    expect(requests).toEqual([true])

    const home = await editor.preparePage(first.id)
    if (!home) throw new Error('Page preparation failed')
    graph.createNode('RECTANGLE', first.id, { name: 'Content during preparation' })
    editor.commitPageSwitch(home)
    await nextTick()
    expect(requests).toEqual([true, false])
  } finally {
    stop()
    editor.dispose()
  }
})
