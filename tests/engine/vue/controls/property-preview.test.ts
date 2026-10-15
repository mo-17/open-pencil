import { describe, expect, test } from 'bun:test'

import { computed, createApp, effectScope } from 'vue'

import { createEditor, type Editor } from '@open-pencil/core/editor'

import { createLayoutActions } from '#vue/controls/layout/helpers'
import { usePropScrub } from '#vue/controls/prop-scrub/use'
import { useSelectionLayout } from '#vue/controls/selection-layout/use'
import { EDITOR_KEY } from '#vue/editor/context'

describe('property previews', () => {
  test('sizing menu undoes the mode and layout geometry together', () => {
    const editor = createEditor()
    try {
      const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        width: 160,
        height: 120,
        layoutMode: 'VERTICAL',
        primaryAxisSizing: 'FIXED',
        counterAxisSizing: 'FIXED',
        counterAxisAlign: 'CENTER'
      })
      const child = editor.graph.createNode('RECTANGLE', frame.id, { width: 80, height: 40 })
      editor.runLayoutForNode(frame.id)
      const actions = createLayoutActions({
        editor,
        node: computed(() => frame)
      })
      expect(child.x).toBe(40)
      actions.setAxisSizing('width', 'HUG')
      expect([frame.width, frame.counterAxisSizing, child.x]).toEqual([80, 'HUG', 0])
      editor.undoAction()
      expect([frame.width, frame.counterAxisSizing, child.x]).toEqual([160, 'FIXED', 40])
      expect(editor.undo.canUndo).toBe(false)
      editor.redoAction()
      expect([frame.width, frame.counterAxisSizing, child.x]).toEqual([80, 'HUG', 0])
    } finally {
      editor.dispose()
    }
  })

  test('pins targets through selection changes and releases previews on scope disposal', () => {
    const editor = createEditor()
    const scope = effectScope()
    try {
      const first = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { x: 10 })
      const second = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { x: 30 })
      editor.select([first.id])
      const scrub = scope.run(() => usePropScrub(editor))
      if (!scrub) throw new Error('Scrub scope unavailable')
      scrub.updateProp([first], 'x', 50)
      editor.select([second.id])
      scrub.updateProp([second], 'x', 80)
      scrub.commitProp([second], 'x', 80, 30)
      expect([first.x, second.x]).toEqual([10, 30])
      expect(editor.undo.canUndo).toBe(false)
      scrub.updateProp([second], 'x', 90)
      scope.stop()
      expect(second.x).toBe(30)
      expect(editor.isInteractiveEditing()).toBe(false)
    } finally {
      scope.stop()
      editor.dispose()
    }
  })

  test('size preview owns the Hug-to-Fixed change and cancels or undoes it with the value', () => {
    const editor = createEditor()
    try {
      const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        width: 100,
        height: 40,
        layoutMode: 'HORIZONTAL',
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'FIXED'
      })
      editor.graph.createNode('RECTANGLE', frame.id, { width: 100, height: 20 })
      editor.runLayoutForNode(frame.id)
      const original = frame.width
      const actions = createLayoutActions({
        editor,
        node: computed(() => frame)
      })
      actions.updateAxisSize('width', 200)
      expect(frame.primaryAxisSizing).toBe('FIXED')
      expect(editor.undo.canUndo).toBe(false)
      actions.cancelPreview()
      expect(frame.primaryAxisSizing).toBe('HUG')
      expect(frame.width).toBe(original)
      actions.updateAxisSize('width', 200)
      actions.commitAxisSize('width', 200, original)
      editor.undoAction()
      expect(frame.primaryAxisSizing).toBe('HUG')
      expect(frame.width).toBe(original)
      expect(editor.undo.canUndo).toBe(false)
    } finally {
      editor.dispose()
    }
  })

  test('updates layout live without committed events, then commits and undoes the whole result', () => {
    const editor = createEditor()
    try {
      const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        width: 200,
        height: 100,
        layoutMode: 'HORIZONTAL',
        primaryAxisSizing: 'FIXED',
        counterAxisSizing: 'FIXED'
      })
      const child = editor.graph.createNode('RECTANGLE', frame.id, {
        width: 100,
        height: 20,
        layoutGrow: 1
      })
      editor.updateNode(frame.id, { width: 200 })
      expect(child.width).toBe(200)
      const sceneVersion = editor.state.sceneVersion
      let committed = 0
      editor.onEditorEvent('node:updated', () => {
        committed++
      })
      const preview = editor.beginNodePreview('Resize')
      preview.update(frame.id, { width: 320 })
      expect(child.width).toBe(320)
      expect(editor.state.sceneVersion).toBe(sceneVersion)
      expect(committed).toBe(0)
      expect(editor.undo.canUndo).toBe(false)
      preview.commit()
      expect(committed).toBeGreaterThan(0)
      editor.undoAction()
      expect(frame.width).toBe(200)
      expect(child.width).toBe(200)
      expect(editor.undo.canUndo).toBe(false)
      editor.redoAction()
      expect(frame.width).toBe(320)
      expect(child.width).toBe(320)
    } finally {
      editor.dispose()
    }
  })

  test('restores different multi-selection values on cancel and groups a completed scrub in one undo', () => {
    const editor = createEditor()
    try {
      const first = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { x: 10 })
      const second = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { x: 30 })
      const nodes = [first, second]
      const scrub = usePropScrub(editor)
      const version = editor.state.sceneVersion
      scrub.updateProp(nodes, 'x', 50)
      expect(nodes.map((n) => n.x)).toEqual([50, 50])
      scrub.cancelProp(nodes, 'x')
      expect(nodes.map((n) => n.x)).toEqual([10, 30])
      // Cancel restores through preview events, then reconciles the scene once.
      expect(editor.state.sceneVersion).toBe(version + 1)
      expect(editor.undo.canUndo).toBe(false)
      scrub.updateProp(nodes, 'x', 60)
      scrub.commitProp(nodes, 'x', 60, 0)
      editor.undoAction()
      expect(nodes.map((n) => n.x)).toEqual([10, 30])
      expect(editor.undo.canUndo).toBe(false)
      editor.redoAction()
      expect(nodes.map((n) => n.x)).toEqual([60, 60])
    } finally {
      editor.dispose()
    }
  })
})

function selectedLayoutControls(editor: Editor) {
  const scope = effectScope()
  const app = createApp({ render: () => null })
  app.provide(EDITOR_KEY, editor)
  const layout = scope.run(() => app.runWithContext(() => useSelectionLayout()))
  if (!layout) {
    scope.stop()
    throw new Error('Selection layout scope unavailable')
  }
  return { layout, dispose: () => scope.stop() }
}

describe('fork containers in selection layout controls', () => {
  test('sets FORM and LIST flow together and restores both geometry and modes in one undo', () => {
    const editor = createEditor()
    const page = editor.state.currentPageId
    const form = editor.graph.createNode('FORM', page, {
      name: 'Form',
      width: 200,
      height: 100,
      layoutMode: 'NONE',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const list = editor.graph.createNode('LIST', page, {
      name: 'List',
      x: 250,
      width: 200,
      height: 100,
      layoutMode: 'FREE',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const formChild = editor.graph.createNode('RECTANGLE', form.id, {
      x: 20,
      y: 30,
      width: 40,
      height: 20
    })
    const listChild = editor.graph.createNode('RECTANGLE', list.id, {
      x: 30,
      y: 40,
      width: 50,
      height: 30
    })
    editor.select([form.id, list.id])
    const { layout, dispose } = selectedLayoutControls(editor)
    const geometry = () =>
      [form, list, formChild, listChild].map((node) => [node.x, node.y, node.width, node.height])
    const before = geometry()
    try {
      expect(layout.containers.value.map((node) => node.id)).toEqual([form.id, list.id])
      expect(layout.layoutMode.value).not.toBeUndefined()
      layout.setLayoutMode('HORIZONTAL')
      expect([form.layoutMode, list.layoutMode]).toEqual(['HORIZONTAL', 'HORIZONTAL'])
      expect(layout.layoutMode.value).toBe('HORIZONTAL')
      expect(editor.undo.canUndo).toBe(true)
      editor.undoAction()
      expect([form.layoutMode, list.layoutMode]).toEqual(['NONE', 'FREE'])
      expect(geometry()).toEqual(before)
      expect(editor.undo.canUndo).toBe(false)
      expect([...editor.state.selectedIds]).toEqual([form.id, list.id])
      editor.redoAction()
      expect([form.layoutMode, list.layoutMode]).toEqual(['HORIZONTAL', 'HORIZONTAL'])
    } finally {
      dispose()
      editor.dispose()
    }
  })

  test('filters unsupported layers while applying flow and clipping to selected FORM LIST and FRAME', () => {
    const editor = createEditor()
    const page = editor.state.currentPageId
    const form = editor.graph.createNode('FORM', page, { layoutMode: 'NONE', clipsContent: false })
    const list = editor.graph.createNode('LIST', page, { layoutMode: 'FREE', clipsContent: true })
    const frame = editor.graph.createNode('FRAME', page, {
      layoutMode: 'HORIZONTAL',
      clipsContent: false
    })
    const rectangle = editor.graph.createNode('RECTANGLE', page, {
      layoutMode: 'NONE',
      clipsContent: false,
      width: 73,
      height: 41
    })
    const ids = [form.id, list.id, frame.id, rectangle.id]
    editor.select(ids)
    const { layout, dispose } = selectedLayoutControls(editor)
    try {
      expect(layout.containers.value.map((node) => node.id)).toEqual(ids.slice(0, 3))
      // Flow is not presented as a common selection value when an unsupported layer is present.
      expect(layout.layoutMode.value).toBeUndefined()
      layout.setLayoutMode('VERTICAL')
      expect([form.layoutMode, list.layoutMode, frame.layoutMode, rectangle.layoutMode]).toEqual([
        'VERTICAL',
        'VERTICAL',
        'VERTICAL',
        'NONE'
      ])
      expect([rectangle.width, rectangle.height]).toEqual([73, 41])
      editor.undoAction()
      expect([form.layoutMode, list.layoutMode, frame.layoutMode, rectangle.layoutMode]).toEqual([
        'NONE',
        'FREE',
        'HORIZONTAL',
        'NONE'
      ])
      expect(editor.undo.canUndo).toBe(false)
      layout.toggleClipsContent()
      expect([
        form.clipsContent,
        list.clipsContent,
        frame.clipsContent,
        rectangle.clipsContent
      ]).toEqual([true, true, true, false])
      editor.undoAction()
      expect([
        form.clipsContent,
        list.clipsContent,
        frame.clipsContent,
        rectangle.clipsContent
      ]).toEqual([false, true, false, false])
      expect(editor.undo.canUndo).toBe(false)
      editor.select([rectangle.id])
      expect(layout.containers.value).toEqual([])
      expect(layout.layoutMode.value).toBeUndefined()
      expect(layout.clipsContent.value).toBeUndefined()
      layout.setLayoutMode('GRID')
      layout.toggleClipsContent()
      expect([
        rectangle.layoutMode,
        rectangle.clipsContent,
        rectangle.width,
        rectangle.height
      ]).toEqual(['NONE', false, 73, 41])
      expect(editor.undo.canUndo).toBe(false)
    } finally {
      dispose()
      editor.dispose()
    }
  })
})
