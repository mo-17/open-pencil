import { expect, test } from 'bun:test'

import { sceneNodeToKiwi, type FigNodeChangeExportRuntime } from '#fig/node-change/index'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'

test('an unchanged imported instance does not invent glyphs when runtime fonts become available', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id)
  graph.createNode('TEXT', component.id, {
    overrideKey: '2:20',
    text: 'A',
    width: 20,
    height: 20,
    derivedTextGlyphs: []
  })
  const instance = graph.createInstance(component.id, page.id)
  if (!instance) throw new Error('Missing instance')
  instance.source.format = 'fig'
  instance.source.id = '1:99'
  const text = graph.getChildren(instance.id)[0]
  let outlineCalls = 0
  const runtime: FigNodeChangeExportRuntime = {
    getGlyphOutlineMetrics: () => {
      outlineCalls++
      return [{ commands: [{ type: 'M', x: 0, y: 0 }], x: 0, advance: 10 }]
    }
  }
  const snapshot = () => {
    const record = sceneNodeToKiwi(
      instance,
      { sessionID: 1, localID: 1 },
      0,
      { value: 2 },
      graph,
      [],
      {
        fontDigestMap: new Map([['Inter|Regular', new Uint8Array([1, 2, 3])]]),
        runtime
      }
    )[0] as NodeChange
    const derived = record.derivedSymbolData as NodeChange[] | undefined
    return derived?.find((entry) => entry.derivedTextData)?.derivedTextData
  }

  expect(text.derivedTextGlyphs).toHaveLength(0)
  const unchanged = snapshot()
  expect(unchanged).toBeDefined()
  expect(unchanged?.glyphs).toBeUndefined()
  expect(outlineCalls).toBe(0)

  graph.updateNode(text.id, { text: 'B' })
  expect(text.source.editedFields).toContain('text')
  expect(snapshot()?.glyphs).toHaveLength(1)
  expect(outlineCalls).toBe(1)
})
