import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { computeAllLayouts, computeAllLayoutsAsync } from '@open-pencil/core/layout'
import { createModalModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

function fixture(imported: boolean) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const modal = graph.createNode('FRAME', page.id, {
    ...createModalModuleFrameOverrides({ contentChildName: 'Body' }),
    x: 20,
    y: 2778,
    width: 320,
    height: 52
  })
  const body = graph.createNode('FORM', modal.id, {
    name: 'Body',
    width: 320,
    height: 200,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FILL',
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 16,
    paddingBottom: 16,
    itemSpacing: 12
  })
  const field = graph.createNode('FRAME', body.id, {
    width: 0,
    height: 72,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FILL',
    layoutAlignSelf: 'STRETCH',
    itemSpacing: 6
  })
  const label = graph.createNode('TEXT', field.id, {
    text: '姓名',
    width: 0,
    height: 22,
    textAutoResize: 'NONE',
    layoutAlignSelf: 'STRETCH'
  })
  const input = graph.createNode('INPUT', field.id, {
    width: 0,
    height: 44,
    layoutAlignSelf: 'STRETCH'
  })
  const button = graph.createNode('BUTTON', body.id, {
    width: 0,
    height: 44,
    layoutAlignSelf: 'STRETCH',
    interactiveProps: { text: 'Save' }
  })
  if (imported) {
    for (const node of [modal, body, field, label, input, button]) {
      graph.updateNode(node.id, {
        source: { ...node.source, format: 'fig', editedFields: [] },
        derivedLayout: node.type === 'TEXT' ? { width: 0, height: node.height } : null
      })
    }
  }
  return { graph, page, modal, body, field, label, input, button }
}

describe('Modal content layout boundary', () => {
  test('cooperative layout uses the same bounds and keeps imported instance geometry', async () => {
    const { graph, modal, body, field, input, button } = fixture(true)
    const instance = graph.createNode('INSTANCE', body.id, {
      width: 80,
      height: 50,
      layoutMode: 'VERTICAL'
    })
    graph.updateNode(instance.id, { source: { ...instance.source, format: 'fig' } })
    const instanceChild = graph.createNode('RECTANGLE', instance.id, {
      x: 19,
      y: 21,
      width: 70,
      height: 17
    })
    graph.updateNode(instanceChild.id, { source: { ...instanceChild.source, format: 'fig' } })
    const geometry = {
      x: instanceChild.x,
      y: instanceChild.y,
      width: instanceChild.width,
      height: instanceChild.height
    }
    await computeAllLayoutsAsync(graph)
    expect([field.width, input.width, button.width]).toEqual([288, 288, 288])
    expect(instanceChild).toMatchObject(geometry)
    expect(modal).toMatchObject({ width: 320, height: 52 })
  })

  test.each([false, true])(
    'resolves a fill-width body independently of its trigger, imported=%s',
    (imported) => {
      const { graph, modal, body, field, label, input, button } = fixture(imported)
      const metadata = [modal, body, field, label, input, button].map((node) => ({
        source: structuredClone(node.source),
        derivedLayout: structuredClone(node.derivedLayout),
        primaryAxisSizing: node.primaryAxisSizing,
        counterAxisSizing: node.counterAxisSizing
      }))
      computeAllLayouts(graph)
      expect([field.width, label.width, input.width, button.width]).toEqual([288, 288, 288, 288])
      expect(modal).toMatchObject({ width: 320, height: 52, x: 20, y: 2778 })
      expect(body).toMatchObject({ width: 320, height: 160, counterAxisSizing: 'FILL' })
      expect(
        [modal, body, field, label, input, button].map((node) => ({
          source: node.source,
          derivedLayout: node.derivedLayout,
          primaryAxisSizing: node.primaryAxisSizing,
          counterAxisSizing: node.counterAxisSizing
        }))
      ).toEqual(metadata)
    }
  )

  test('entering an existing imported body repairs derived geometry and subsequent edits use that boundary', () => {
    const { graph, body, modal, field, input, button } = fixture(true)
    const editor = createEditor({ graph, skipInitialGraphSetup: true })
    expect(editor.enterContentEdit(body.id)).toBe(true)
    expect([field.width, input.width, button.width]).toEqual([288, 288, 288])
    expect(editor.undo.canUndo).toBe(false)
    editor.updateNodeWithUndo(body.id, { width: 400 })
    expect([field.width, input.width, button.width]).toEqual([368, 368, 368])
    editor.exitContentEdit()
    expect(modal).toMatchObject({ width: 320, height: 52 })
    editor.undo.undo()
    expect(body.width).toBe(320)
    expect([field.width, input.width, button.width]).toEqual([288, 288, 288])
    editor.dispose()
  })
})
