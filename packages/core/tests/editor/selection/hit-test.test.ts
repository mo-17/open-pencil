import { afterEach, describe, expect, test } from 'bun:test'

import { createEditor, type Editor } from '@open-pencil/core/editor'

import {
  createEffectPickModuleFrameOverrides,
  createEffectPickModuleInstance,
  EFFECT_PICK_CATALOG
} from '#core/plugins/effect-pick'

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
})

function fixture() {
  const editor = createEditor()
  editors.push(editor)
  return editor
}

describe('editor scoped hit testing', () => {
  test('uses world coordinates inside entered containers', () => {
    const editor = fixture()
    const pageId = editor.state.currentPageId
    const frame = editor.graph.createNode('FRAME', pageId, {
      x: 100,
      y: 100,
      width: 200,
      height: 200
    })
    const child = editor.graph.createNode('RECTANGLE', frame.id, {
      x: 20,
      y: 20,
      width: 40,
      height: 40,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })

    editor.state.enteredContainerId = frame.id
    editor.setCanvasKit(
      {} as Parameters<typeof editor.setCanvasKit>[0],
      {} as Parameters<typeof editor.setCanvasKit>[1]
    )

    expect(editor.hitTestAtPoint(130, 130)?.id).toBe(child.id)
  })

  test('picks every reviewed unpainted EffectPick within its authored bounds without mutating it', () => {
    for (const entry of EFFECT_PICK_CATALOG) {
      const editor = fixture()
      const node = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        ...createEffectPickModuleFrameOverrides({ effectId: entry.id }),
        x: 100,
        y: 80
      })
      const before = structuredClone(node)

      for (const deep of [false, true]) {
        expect(editor.hitTestPageAtPoint(101, 81, deep)?.id).toBe(node.id)
        expect(
          editor.hitTestPageAtPoint(100 + node.width / 2, 80 + node.height / 2, deep)?.id
        ).toBe(node.id)
        expect(editor.hitTestPageAtPoint(99, 81, deep)).toBeNull()
        expect(editor.hitTestPageAtPoint(101 + node.width, 81, deep)).toBeNull()
      }
      expect(node.fills).toEqual([])
      expect(node.strokes).toEqual([])
      expect(node).toEqual(before)
    }
  })

  test('does not make ordinary, unrelated or invalid module frames pickable', () => {
    const module = createEffectPickModuleInstance()
    const modules = [
      undefined,
      { ...module, pluginId: 'example.other' },
      { ...module, configVersion: 2 },
      { ...module, config: { ...module.config, artifactDigest: '0'.repeat(64) } }
    ]
    for (const instance of modules) {
      const editor = fixture()
      editor.graph.createNode('FRAME', editor.state.currentPageId, {
        width: 224,
        height: 101,
        fills: [],
        strokes: [],
        ...(instance ? { interactiveProps: { module: instance } } : {})
      })
      for (const deep of [false, true]) {
        expect(editor.hitTestPageAtPoint(100, 50, deep)).toBeNull()
      }
    }

    const editor = fixture()
    editor.graph.createNode('FORM', editor.state.currentPageId, {
      ...createEffectPickModuleFrameOverrides(),
      width: 224,
      height: 101
    })
    expect(editor.hitTestPageAtPoint(100, 50)).toBeNull()
  })

  test('preserves real child priority and clipping for unpainted EffectPick content', () => {
    const editor = fixture()
    const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      clipsContent: true
    })
    const node = editor.graph.createNode('FRAME', parent.id, {
      ...createEffectPickModuleFrameOverrides(),
      x: 50,
      y: 0,
      width: 224,
      height: 101
    })
    const child = editor.graph.createNode('RECTANGLE', node.id, {
      x: 10,
      y: 10,
      width: 20,
      height: 20
    })
    for (const deep of [false, true]) {
      expect(editor.hitTestPageAtPoint(170, 120, deep)?.id).toBe(child.id)
      expect(editor.hitTestPageAtPoint(190, 150, deep)?.id).toBe(node.id)
      expect(editor.hitTestPageAtPoint(230, 150, deep)).toBeNull()
    }
    editor.graph.updateNode(node.id, { visible: false })
    expect(editor.hitTestPageAtPoint(190, 150)).toBeNull()
    editor.graph.updateNode(node.id, { visible: true, internalOnly: true })
    expect(editor.hitTestPageAtPoint(190, 150)).toBeNull()
  })
})
