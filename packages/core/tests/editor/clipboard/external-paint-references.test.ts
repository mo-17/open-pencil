import { expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { buildFigmaClipboardHTML, buildOpenPencilClipboardHTML } from '@open-pencil/core/clipboard'
import { createEditor } from '@open-pencil/core/editor'
import type { SceneNode, Stroke } from '@open-pencil/scene-graph'

const pattern: Stroke = {
  type: 'PATTERN',
  color: { r: 1, g: 0, b: 0, a: 1 },
  opacity: 1,
  visible: true,
  weight: 2,
  align: 'CENTER'
}
const carriers = ['html', 'snapshot'] as const
const paintCarriers = ['fills', 'strokes', 'state', 'responsive'] as const

for (const carrier of carriers) {
  for (const paintCarrier of paintCarriers) {
    test(`${carrier}: rejects an external ${paintCarrier} target before a colliding destination changes`, async () => {
      const source = createEditor(),
        target = createEditor()
      try {
        const tile = source.graph.createNode('RECTANGLE', source.state.currentPageId, {
          name: 'External Source Tile'
        })
        const paint = { ...pattern, sourceNodeId: tile.id }
        let props: Partial<SceneNode>
        if (paintCarrier === 'state') props = { stateOverrides: { hover: { strokes: [paint] } } }
        else if (paintCarrier === 'responsive')
          props = { responsiveOverrides: { compact: { strokes: [paint] } } }
        else props = { [paintCarrier]: [paint] }
        const node = source.graph.createNode('RECTANGLE', source.state.currentPageId, {
          ...props,
          name: 'Paint'
        })
        target.graph.createNode('RECTANGLE', target.state.currentPageId, {
          id: tile.id,
          name: 'Unrelated Destination Layer'
        })
        source.select([node.id])
        const payload = await source.prepareCopy()
        const before = structuredClone([...target.graph.nodes]),
          selection = [...target.state.selectedIds]
        const paste = () =>
          carrier === 'html'
            ? target.pasteFromHTML(payload.html)
            : target.pasteSnapshot(expectDefined(payload.snapshot))
        await expect(paste()).rejects.toThrow(
          'Paint target is outside the copied document fragment'
        )
        expect([...target.graph.nodes]).toEqual(before)
        expect([...target.state.selectedIds]).toEqual(selection)
        expect(target.undo.canUndo).toBe(false)
      } finally {
        source.dispose()
        target.dispose()
      }
    })
  }
  test(`${carrier}: a same-document external target stays bound through undo/redo`, async () => {
    const editor = createEditor()
    try {
      const tile = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
        name: 'Tile'
      })
      const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
        strokes: [{ ...pattern, sourceNodeId: tile.id }]
      })
      editor.select([node.id])
      const payload = await editor.prepareCopy()
      if (carrier === 'html') await editor.pasteFromHTML(payload.html)
      else await editor.pasteSnapshot(expectDefined(payload.snapshot))
      const id = expectDefined([...editor.state.selectedIds][0])
      expect(editor.graph.getNode(id)?.strokes[0]?.sourceNodeId).toBe(tile.id)
      editor.undo.undo()
      expect(editor.graph.getNode(id)).toBeUndefined()
      editor.undo.redo()
      expect(editor.graph.getNode(id)?.strokes[0]?.sourceNodeId).toBe(tile.id)
    } finally {
      editor.dispose()
    }
  })
}

test('a colliding sourceRootId is insufficient proof that two documents share paint targets', async () => {
  const source = createEditor(),
    target = createEditor()
  try {
    const tile = source.graph.createNode('RECTANGLE', source.state.currentPageId)
    const node = source.graph.createNode('RECTANGLE', source.state.currentPageId, {
      strokes: [{ ...pattern, sourceNodeId: tile.id }]
    })
    target.graph.createNode('RECTANGLE', target.state.currentPageId, { id: tile.id })
    source.select([node.id])
    const payload = await source.prepareCopy()
    const snapshot = expectDefined(payload.snapshot)
    snapshot.sourceRootId = target.graph.rootId
    await expect(target.pasteSnapshot(snapshot)).rejects.toThrow(
      'Paint target is outside the copied document fragment'
    )
  } finally {
    source.dispose()
    target.dispose()
  }
})

test.each(['legacy-html', 'figma'] as const)(
  '%s: rejects uncaptured paint targets without document provenance',
  async (carrier) => {
    const source = createEditor(),
      target = createEditor()
    try {
      const tile = source.graph.createNode('RECTANGLE', source.state.currentPageId)
      const node = source.graph.createNode('RECTANGLE', source.state.currentPageId, {
        strokes: [{ ...pattern, sourceNodeId: tile.id }]
      })
      const html =
        carrier === 'figma'
          ? expectDefined(await buildFigmaClipboardHTML([node], source.graph))
          : buildOpenPencilClipboardHTML([node], source.graph)
      const before = structuredClone([...target.graph.nodes])
      await expect(target.pasteFromHTML(html)).rejects.toThrow(
        'Paint target is outside the copied document fragment'
      )
      expect([...target.graph.nodes]).toEqual(before)
    } finally {
      source.dispose()
      target.dispose()
    }
  }
)
