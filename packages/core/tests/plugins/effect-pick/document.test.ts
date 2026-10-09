import { describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor/create'
import { exportFigFile, parseFigFile } from '#core/io/formats/fig'
import { initCodec } from '#core/kiwi'
import {
  EFFECT_PICK_CATALOG,
  createEffectPickModuleFrameOverrides,
  createEffectPickModuleInstance,
  resolveEffectPickModule
} from '#core/plugins/effect-pick'

function config(node: SceneNode) {
  const resolved = resolveEffectPickModule(node.interactiveProps?.module)
  return resolved?.ok ? resolved.config : undefined
}

describe('EffectPick existing document carrier', () => {
  test('saves and reopens both reviewed collections, edited configs and authored outer paints through real FIG bytes', async () => {
    await initCodec()
    const graph = new SceneGraph()
    const page = graph.getPages().at(0)
    if (!page) throw new Error('Expected a default page')
    for (const [index, entry] of EFFECT_PICK_CATALOG.entries()) {
      const frame = createEffectPickModuleFrameOverrides({
        effectId: entry.id,
        text: `Edited ${entry.id}`,
        color: '#12345678',
        secondaryColor: '#AABBCCDD',
        speed: 1.4
      })
      graph.createNode('FRAME', page.id, {
        ...frame,
        name: `Saved effect · ${entry.id}`,
        ...(index % 2 === 0
          ? {
              fills: [
                {
                  type: 'SOLID',
                  color: { r: 1, g: 0, b: 0, a: 1 },
                  opacity: 0.5,
                  visible: true,
                  blendMode: 'NORMAL'
                }
              ],
              strokes: [
                {
                  type: 'SOLID',
                  color: { r: 0, g: 1, b: 0, a: 1 },
                  opacity: 1,
                  visible: true,
                  blendMode: 'NORMAL',
                  weight: 3,
                  align: 'INSIDE',
                  cap: 'NONE',
                  join: 'MITER',
                  dashPattern: []
                }
              ]
            }
          : {})
      })
    }
    const savedEffects = (document: SceneGraph) =>
      [...document.getAllNodes()]
        .flatMap((node) => {
          const resolved = resolveEffectPickModule(node.interactiveProps?.module)
          return resolved?.ok
            ? [
                {
                  name: node.name,
                  configVersion: resolved.instance.configVersion,
                  config: resolved.config,
                  fills: node.fills,
                  strokes: node.strokes
                }
              ]
            : []
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    const expected = structuredClone(savedEffects(graph))
    expect(expected).toHaveLength(32)
    expect(new Set(expected.map((entry) => entry.config.collectionVersion))).toEqual(
      new Set(['0.6.0', '0.7.0'])
    )
    const bytes = await exportFigFile(graph)
    const restored = await parseFigFile(bytes.slice().buffer)
    expect(savedEffects(restored)).toEqual(expected)
  })

  test.each(['diagonal-fill', 'arrow-expand'])(
    'copies %s through the actual HTML clipboard carrier and keeps module edits independently undoable',
    async (effectId) => {
      const editor = createEditor()
      try {
        const frame = editor.graph.createNode(
          'FRAME',
          editor.state.currentPageId,
          createEffectPickModuleFrameOverrides({ effectId, text: 'Before' })
        )
        const original = structuredClone(frame.interactiveProps?.module)
        editor.select([frame.id])
        const payload = await editor.prepareCopy()
        await editor.pasteFromHTML(payload.html)
        const copies = [...editor.graph.getAllNodes()].filter(
          (node) => resolveEffectPickModule(node.interactiveProps?.module)?.ok
        )
        expect(copies).toHaveLength(2)
        const copy = copies.find((node) => node.id !== frame.id)
        if (!copy) throw new Error('Expected a copied effect')
        expect(copy.interactiveProps?.module).toEqual(original)
        expect(copy.interactiveProps?.module).not.toBe(frame.interactiveProps?.module)
        editor.updateNodeWithUndo(copy.id, {
          interactiveProps: {
            ...copy.interactiveProps,
            module: createEffectPickModuleInstance({ effectId, text: 'After', speed: 2 })
          }
        })
        expect(resolveEffectPickModule(copy.interactiveProps?.module)?.ok).toBe(true)
        expect(config(copy)?.text).toBe('After')
        expect(config(frame)?.text).toBe('Before')
        editor.undo.undo()
        expect(copy.interactiveProps?.module).toEqual(original)
        editor.undo.redo()
        expect(config(copy)?.text).toBe('After')
      } finally {
        editor.dispose()
      }
    }
  )
})
