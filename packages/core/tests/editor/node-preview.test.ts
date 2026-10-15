import { describe, expect, spyOn, test } from 'bun:test'

import { effectiveFigmaRawNodeFields } from '@open-pencil/fig'
import { SceneGraph, hasInstanceOverride, type SceneNode } from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor/create'

describe('owned node previews', () => {
  for (const terminal of ['cancel', 'commit'] as const) {
    test(`finalizes captured ancestor and sibling metadata with ${terminal} and layout provenance`, () => {
      const editor = createEditor()
      try {
        const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
          layoutMode: 'HORIZONTAL',
          primaryAxisSizing: 'HUG',
          counterAxisSizing: 'HUG',
          itemSpacing: 10
        })
        const first = editor.graph.createNode('RECTANGLE', parent.id, { width: 40, height: 20 })
        const sibling = editor.graph.createNode('RECTANGLE', parent.id, { width: 50, height: 20 })
        const untouched = editor.graph.createNode('RECTANGLE', editor.state.currentPageId)
        editor.runLayoutForNode(parent.id)
        const nodes = [first, parent, sibling, untouched]
        for (const node of nodes) {
          node.source.fig.rawSize = { x: node.width, y: node.height }
          node.source.fig.rawTransform = {
            m00: 1,
            m01: 0,
            m02: node.x,
            m10: 0,
            m11: 1,
            m12: node.y
          }
        }
        const snapshot = () =>
          nodes.map(({ x, y, width, height, source }) =>
            structuredClone({ x, y, width, height, source })
          )
        const before = snapshot()
        const updates: Array<{ id: string; layout: boolean }> = []
        editor.onEditorEvent('node:updated', (id) => {
          updates.push({ id, layout: editor.graph.isApplyingLayout })
        })
        const preview = editor.beginNodePreview('Resize', { preserveSourceMetadata: true })
        preview.update(first.id, { width: 70 }, { deferLayout: true })
        preview.update(first.id, {})
        preview.update(untouched.id, { width: untouched.width }, { deferLayout: true })
        expect([parent.width, sibling.x]).toEqual([130, 80])
        expect(nodes.map((node) => node.source)).toEqual(before.map((node) => node.source))
        expect(updates).toEqual([])

        if (terminal === 'cancel') {
          preview.cancel()
          expect(snapshot()).toEqual(before)
          expect(updates).toEqual([])
          expect(editor.undo.canUndo).toBe(false)
        } else {
          const finalized: string[] = []
          preview.commit((node, original) => {
            finalized.push(node.id)
            const source = structuredClone(node.source)
            if (
              (['width', 'height'] as const).some(
                (key) => original[key] !== undefined && original[key] !== node[key]
              )
            )
              source.fig.rawSize = null
            if (
              (['x', 'y'] as const).some(
                (key) => original[key] !== undefined && original[key] !== node[key]
              )
            )
              source.fig.rawTransform = null
            return { source }
          })
          expect(new Set(finalized)).toEqual(new Set([first.id, parent.id, sibling.id]))
          expect(first.source.fig.rawSize).toBeNull()
          expect(parent.source.fig.rawSize).toBeNull()
          expect(sibling.source.fig.rawTransform).toBeNull()
          expect(sibling.source.fig.rawSize).toEqual({ x: 50, y: 20 })
          const after = snapshot()
          editor.undoAction()
          expect(snapshot()).toEqual(before)
          expect(editor.undo.canUndo).toBe(false)
          editor.redoAction()
          expect(snapshot()).toEqual(after)
          expect(updates).toHaveLength(9)
          expect(
            updates.filter((update) => update.id !== first.id).every((update) => update.layout)
          ).toBe(true)
          expect(
            updates.filter((update) => update.id === first.id).every((update) => !update.layout)
          ).toBe(true)
        }
      } finally {
        editor.dispose()
      }
    })
  }

  test('a failed finalizer atomically cancels geometry and earlier metadata patches', () => {
    const editor = createEditor()
    try {
      const first = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 100 })
      const second = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { x: 20 })
      first.source.fig.rawSize = { x: first.width, y: first.height }
      const before = structuredClone([first, second])
      const updates: string[] = []
      editor.onEditorEvent('node:updated', (id) => updates.push(id))
      const preview = editor.beginNodePreview('Resize', { preserveSourceMetadata: true })
      preview.update(first.id, { width: 200 }, { deferLayout: true })
      preview.update(second.id, { x: 40 }, { deferLayout: true })
      expect(() =>
        preview.commit((node) => {
          if (node.id === second.id) throw new Error('Finalize failed')
          const source = structuredClone(node.source)
          source.fig.rawSize = null
          return { source }
        })
      ).toThrow('Finalize failed')
      expect([first, second]).toEqual(before)
      expect(updates).toEqual([])
      expect(preview.closed).toBe(true)
      expect(editor.undo.canUndo).toBe(false)
      expect(editor.isInteractiveEditing()).toBe(false)
    } finally {
      editor.dispose()
    }
  })

  test('keeps deferred drag frames preview-only and publishes one committed rectangle update', () => {
    const editor = createEditor()
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
      width: 100,
      height: 50
    })
    const update = spyOn(editor.graph, 'updateNode')
    try {
      const preview = editor.beginNodePreview('Resize')
      for (let width = 110; width <= 250; width += 10) {
        preview.update(node.id, { width }, { deferLayout: true })
        preview.update(node.id, {})
      }
      expect(node.width).toBe(250)
      expect(update).not.toHaveBeenCalled()
      preview.commit()
      expect(update).toHaveBeenCalledTimes(1)
      editor.undoAction()
      expect(node.width).toBe(100)
      expect(update).toHaveBeenCalledTimes(2)
      editor.redoAction()
      expect(node.width).toBe(250)
      expect(update).toHaveBeenCalledTimes(3)
    } finally {
      update.mockRestore()
      editor.dispose()
    }
  })

  for (const terminal of ['cancel', 'commit'] as const) {
    test(`deferred multi-node edits preserve layout geometry through ${terminal}`, () => {
      const editor = createEditor()
      try {
        const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
          width: 200,
          height: 100,
          layoutMode: 'HORIZONTAL',
          primaryAxisSizing: 'FIXED',
          counterAxisSizing: 'FIXED',
          itemSpacing: 10
        })
        const first = editor.graph.createNode('RECTANGLE', parent.id, { width: 80, height: 20 })
        const second = editor.graph.createNode('RECTANGLE', parent.id, {
          layoutGrow: 1,
          height: 20
        })
        editor.runLayoutForNode(parent.id)
        const geometry = () => [parent.width, first.width, second.x, second.width]
        const before = geometry()
        expect(before).toEqual([200, 80, 90, 110])
        const updates: string[] = []
        editor.onEditorEvent('node:updated', (id) => updates.push(id))

        const preview = editor.beginNodePreview('Resize')
        preview.update(parent.id, { width: 320 }, { deferLayout: true })
        preview.update(first.id, { width: 100 }, { deferLayout: true })
        expect(geometry()).toEqual([320, 100, 90, 110])
        preview.update(parent.id, {})
        const after = geometry()
        expect(after).toEqual([320, 100, 110, 210])
        expect(updates).toEqual([])

        if (terminal === 'cancel') {
          preview.cancel()
          expect(geometry()).toEqual(before)
          expect(updates).toEqual([])
          expect(editor.undo.canUndo).toBe(false)
        } else {
          preview.commit()
          expect(geometry()).toEqual(after)
          expect(updates).toContain(second.id)
          editor.undoAction()
          expect(geometry()).toEqual(before)
          expect(editor.undo.canUndo).toBe(false)
          editor.redoAction()
          expect(geometry()).toEqual(after)
        }
        expect(editor.isInteractiveEditing()).toBe(false)
      } finally {
        editor.dispose()
      }
    })
  }

  test('preserves imported path metadata across geometric commit, undo and redo only when opted in', () => {
    const editor = createEditor()
    try {
      const node = editor.graph.createNode('TEXT', editor.state.currentPageId, {
        width: 100,
        height: 100,
        textAutoResize: 'NONE'
      })
      node.source.fig.rawNodeFields = {
        vectorData: { vectorNetworkBlob: 0 },
        textPathStart: { tValue: 0.25, forward: true }
      }
      const beforeSource = structuredClone(node.source)
      const options = { preserveSourceMetadata: true }
      const preview = editor.beginNodePreview('Resize', options)
      options.preserveSourceMetadata = false
      preview.update(node.id, { width: 200, strokeGeometry: [] }, { deferLayout: true })
      preview.commit()
      expect(node.width).toBe(200)
      expect(node.source).toEqual(beforeSource)
      expect(effectiveFigmaRawNodeFields(node)).toEqual(beforeSource.fig.rawNodeFields)
      editor.undoAction()
      expect(node.width).toBe(100)
      expect(node.source).toEqual(beforeSource)
      expect(effectiveFigmaRawNodeFields(node)).toEqual(beforeSource.fig.rawNodeFields)
      editor.redoAction()
      expect(node.width).toBe(200)
      expect(node.source).toEqual(beforeSource)
      expect(effectiveFigmaRawNodeFields(node)).toEqual(beforeSource.fig.rawNodeFields)

      const authored = editor.beginNodePreview('Update')
      authored.update(node.id, { width: 240, strokeGeometry: [] })
      authored.commit()
      expect(node.source.editedFields).toContain('width')
      expect(node.source.editedFields).toContain('strokeGeometry')
      expect(effectiveFigmaRawNodeFields(node).vectorData).toBeUndefined()
    } finally {
      editor.dispose()
    }
  })

  test('publishes layout children with their layout provenance and preserves one-step undo', () => {
    const editor = createEditor()
    try {
      const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        width: 200,
        height: 100,
        layoutMode: 'HORIZONTAL',
        primaryAxisSizing: 'FIXED',
        counterAxisSizing: 'FIXED'
      })
      const child = editor.graph.createNode('RECTANGLE', parent.id, { layoutGrow: 1, height: 20 })
      editor.runLayoutForNode(parent.id)
      const updates: Array<{ id: string; changes: Partial<SceneNode>; layout: boolean }> = []
      editor.onEditorEvent('node:updated', (id, changes) => {
        updates.push({ id, changes, layout: editor.graph.isApplyingLayout })
      })
      const preview = editor.beginNodePreview('Resize')
      expect(editor.isInteractiveEditing()).toBe(false)
      preview.update(parent.id, { width: 320 })
      preview.update(parent.id, { width: 340 })
      expect(updates).toEqual([])
      expect(editor.isInteractiveEditing()).toBe(true)
      preview.commit()
      expect(editor.isInteractiveEditing()).toBe(false)
      expect(updates.find((update) => update.id === child.id)).toMatchObject({
        changes: { width: 340 },
        layout: true
      })
      expect(updates.filter((update) => update.id === child.id)).toHaveLength(1)
      editor.undoAction()
      expect([parent.width, child.width]).toEqual([200, 200])
      expect(editor.undo.canUndo).toBe(false)
      editor.redoAction()
      expect([parent.width, child.width]).toEqual([340, 340])
    } finally {
      editor.dispose()
    }
  })

  test('captures implicit style detachment and text-cache invalidation for commit, undo and cancel', () => {
    const editor = createEditor()
    try {
      const node = editor.graph.createNode('TEXT', editor.state.currentPageId, {
        text: 'Preview',
        fontSize: 16,
        textStyleId: 'linked-style',
        derivedTextGlyphs: [],
        textPicture: new Uint8Array([1, 2, 3])
      })
      const updates: Partial<SceneNode>[] = []
      editor.onEditorEvent('node:updated', (id, changes) => {
        if (id === node.id) updates.push(changes)
      })
      const preview = editor.beginNodePreview('Font size')
      preview.update(node.id, { fontSize: 32 })
      expect(updates).toEqual([])
      expect(node.textStyleId).toBeNull()
      preview.commit()
      expect(updates[0]).toMatchObject({
        fontSize: 32,
        textStyleId: null,
        derivedTextGlyphs: null,
        textPicture: null
      })
      editor.undoAction()
      expect(node.fontSize).toBe(16)
      expect(node.textStyleId).toBe('linked-style')
      expect(node.derivedTextGlyphs).toEqual([])
      expect(node.textPicture).toEqual(new Uint8Array([1, 2, 3]))
      const count = updates.length
      const cancelled = editor.beginNodePreview()
      cancelled.update(node.id, { fontSize: 48 })
      cancelled.cancel()
      expect(updates).toHaveLength(count)
      expect(node.fontSize).toBe(16)
      expect(node.textStyleId).toBe('linked-style')
      expect(node.derivedTextGlyphs).toEqual([])
    } finally {
      editor.dispose()
    }
  })

  for (const terminal of ['selection', 'replacement', 'disposal'] as const) {
    test(`${terminal} cancels the old edit and ignores its trailing input`, () => {
      const editor = createEditor()
      try {
        const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { x: 10 })
        const preview = editor.beginNodePreview()
        preview.update(node.id, { x: 50 })
        if (terminal === 'selection') editor.select([node.id])
        if (terminal === 'replacement') editor.replaceGraph(new SceneGraph())
        if (terminal === 'disposal') editor.dispose()
        expect(preview.closed).toBe(true)
        expect(node.x).toBe(10)
        preview.update(node.id, { x: 90 })
        preview.commit()
        expect(node.x).toBe(10)
        expect(editor.undo.canUndo).toBe(false)
        expect(editor.isInteractiveEditing()).toBe(false)
      } finally {
        editor.dispose()
      }
    })
  }

  test('deleting an unchanged target cancels the other targets without resurrecting it', () => {
    const editor = createEditor()
    try {
      const first = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { x: 10 })
      const second = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { x: 20 })
      const preview = editor.beginNodePreview()
      preview.update(first.id, { x: 10 })
      preview.update(second.id, { x: 30 })
      editor.graph.deleteNode(first.id)
      expect(preview.closed).toBe(true)
      expect(editor.graph.getNode(first.id)).toBeUndefined()
      expect(second.x).toBe(20)
      expect(editor.isInteractiveEditing()).toBe(false)
    } finally {
      editor.dispose()
    }
  })

  test('preview observers unwind after exceptions and include nested layout updates', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, { x: 10 })
    const previous: number[] = []
    expect(() =>
      graph.runPreviewUpdates(
        () => {
          graph.runPreviewUpdates(() => graph.updateNode(node.id, { x: 20 }))
          throw new Error('Interrupted preview')
        },
        (before) => {
          previous.push(before.x)
        }
      )
    ).toThrow('Interrupted preview')
    graph.runPreviewUpdates(() => graph.updateNode(node.id, { x: 30 }))
    expect(previous).toEqual([10])
  })

  test('history batches are not live interactions and interaction release is idempotent', () => {
    const editor = createEditor()
    try {
      editor.undo.beginBatch('Programmatic work')
      expect(editor.isInteractiveEditing()).toBe(false)
      const endFirst = editor.beginInteractiveEdit()
      const endSecond = editor.beginInteractiveEdit()
      endFirst()
      endFirst()
      expect(editor.isInteractiveEditing()).toBe(true)
      endSecond()
      expect(editor.isInteractiveEditing()).toBe(false)
      editor.undo.commitBatch()
    } finally {
      editor.dispose()
    }
  })

  test('rejects library-definition previews without leaving an active edit', () => {
    const editor = createEditor()
    try {
      const node = editor.graph.createNode('COMPONENT', editor.state.currentPageId, {
        x: 10,
        librarySource: {
          identity: { libraryId: 'design-system', assetKey: 'button', revisionId: 'r1' },
          sourceNodeId: 'source',
          readOnly: true
        }
      })
      const preview = editor.beginNodePreview()
      expect(() => preview.update(node.id, { x: 30 })).toThrow('Edit the source library')
      expect(preview.closed).toBe(true)
      expect(node.x).toBe(10)
      expect(editor.isInteractiveEditing()).toBe(false)
    } finally {
      editor.dispose()
    }
  })

  test('unchanged terminal commits do not add history for non-preview controls', () => {
    const editor = createEditor()
    try {
      const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { opacity: 1 })
      editor.commitNodeUpdate(node.id, { opacity: 1 })
      expect(editor.undo.canUndo).toBe(false)
    } finally {
      editor.dispose()
    }
  })

  test('returning to the original value closes without an undo entry', () => {
    const editor = createEditor()
    try {
      const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { x: 10 })
      const preview = editor.beginNodePreview()
      preview.update(node.id, { x: 40 })
      preview.update(node.id, { x: 10 })
      preview.commit()
      expect(preview.closed).toBe(true)
      expect(editor.undo.canUndo).toBe(false)
      expect(editor.isInteractiveEditing()).toBe(false)
    } finally {
      editor.dispose()
    }
  })
})

test('an instance preview records only authored changed fields and restores overrides with history', () => {
  const editor = createEditor()
  try {
    const { graph } = editor
    const component = graph.createNode('COMPONENT', editor.state.currentPageId, { width: 100 })
    graph.createNode('RECTANGLE', component.id, { width: 50 })
    const instance = graph.createInstance(component.id, editor.state.currentPageId)
    if (!instance) throw new Error('Expected an instance')
    const [child] = graph.getChildren(instance.id)
    if (!child) throw new Error('Expected an instance child')
    const preview = editor.beginNodePreview('Resize', { preserveSourceMetadata: true })
    preview.update(instance.id, { width: 200, x: instance.x }, { deferLayout: true })
    graph.withLayoutMutations(() => preview.update(child.id, { width: 100 }, { deferLayout: true }))
    expect(hasInstanceOverride(graph, instance.id, 'width')).toBe(false)
    preview.commit()
    expect(hasInstanceOverride(graph, instance.id, 'width')).toBe(true)
    expect(hasInstanceOverride(graph, instance.id, 'x')).toBe(false)
    expect(hasInstanceOverride(graph, child.id, 'width')).toBe(false)
    editor.undoAction()
    expect([instance.width, child.width]).toEqual([100, 50])
    expect(hasInstanceOverride(graph, instance.id, 'width')).toBe(false)
    editor.redoAction()
    expect([instance.width, child.width]).toEqual([200, 100])
    expect(hasInstanceOverride(graph, instance.id, 'width')).toBe(true)
    const cancelled = editor.beginNodePreview()
    cancelled.update(child.id, { opacity: 0.5 })
    cancelled.cancel()
    expect(hasInstanceOverride(graph, child.id, 'opacity')).toBe(false)
  } finally {
    editor.dispose()
  }
})
