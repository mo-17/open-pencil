import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { expectDefined } from '#core-tests/helpers/assert'
import { readFixtureBytes, uint8ArrayToArrayBuffer } from '#core-tests/helpers/fig/fixtures'

import { exportFigFile, parseFigFile } from '@open-pencil/core'
import { buildFigmaClipboardHTML } from '@open-pencil/core/clipboard'
import { createEditor } from '@open-pencil/core/editor'
import { initCanvasKit } from '@open-pencil/core/io'
import type { SceneNode, Stroke } from '@open-pencil/scene-graph'

const bytes = readFixtureBytes('vectorize/python_logo.png')
const hash = createHash('sha1').update(bytes).digest('hex')
const imageStroke: Stroke = {
  type: 'IMAGE',
  color: { r: 0, g: 0, b: 0, a: 1 },
  opacity: 1,
  visible: true,
  weight: 4,
  align: 'CENTER',
  imageHash: hash,
  imageScaleMode: 'FIT'
}

for (const carrier of ['html', 'snapshot'] as const) {
  for (const paintCarrier of ['state', 'responsive'] as const) {
    test(`${carrier}: transports images used only by ${paintCarrier} strokes`, async () => {
      const source = createEditor()
      const target = createEditor()
      try {
        source.graph.images.set(hash, bytes)
        const node = source.graph.createNode(
          'RECTANGLE',
          source.state.currentPageId,
          paintCarrier === 'state'
            ? { stateOverrides: { hover: { strokes: [imageStroke] } } }
            : { responsiveOverrides: { compact: { strokes: [imageStroke] } } }
        )
        source.select([node.id])
        const payload = await source.prepareCopy()
        expect(expectDefined(payload.snapshot).images.get(hash)).toEqual(bytes)
        if (carrier === 'html') await target.pasteFromHTML(payload.html)
        else await target.pasteSnapshot(expectDefined(payload.snapshot))
        const pasted = expectDefined(
          target.graph.getNode(expectDefined([...target.state.selectedIds][0]))
        )
        expect(
          paintCarrier === 'state'
            ? pasted.stateOverrides?.hover?.strokes
            : pasted.responsiveOverrides?.compact?.strokes
        ).toEqual([imageStroke])
        expect(target.graph.images.get(hash)).toEqual(bytes)
      } finally {
        source.dispose()
        target.dispose()
      }
    })
  }
  test(`${carrier}: image-only stroke crosses documents and survives undo/redo`, async () => {
    const source = createEditor()
    const target = createEditor()
    try {
      source.graph.images.set(hash, bytes)
      const node = source.graph.createNode('RECTANGLE', source.state.currentPageId, {
        width: 100,
        height: 100,
        strokes: [imageStroke],
        fills: [],
        stateOverrides: { hover: { strokes: [imageStroke] } },
        responsiveOverrides: { compact: { strokes: [imageStroke] } }
      })
      source.select([node.id])
      const payload = await source.prepareCopy()
      expect(expectDefined(payload.snapshot).images.get(hash)).toEqual(bytes)
      if (carrier === 'html') await target.pasteFromHTML(payload.html)
      else await target.pasteSnapshot(expectDefined(payload.snapshot))
      const pastedId = expectDefined([...target.state.selectedIds][0])
      const pasted = expectDefined(target.graph.getNode(pastedId))
      expect(pasted.strokes).toEqual([imageStroke])
      expect(pasted.stateOverrides?.hover?.strokes).toEqual([imageStroke])
      expect(pasted.responsiveOverrides?.compact?.strokes).toEqual([imageStroke])
      expect(target.graph.images.get(hash)).toEqual(bytes)
      const ck = await initCanvasKit()
      const decoded = expectDefined(
        ck.MakeImageFromEncoded(expectDefined(target.graph.images.get(hash)))
      )
      try {
        expect(decoded.width()).toBeGreaterThan(0)
      } finally {
        decoded.delete()
      }
      target.undo.undo()
      expect(target.graph.getNode(pastedId)).toBeUndefined()
      target.undo.redo()
      expect(target.graph.getNode(pastedId)?.strokes).toEqual([imageStroke])
      expect(target.graph.images.get(hash)).toEqual(bytes)
    } finally {
      source.dispose()
      target.dispose()
    }
  })

  test(`${carrier}: pattern stroke and state stroke point at the pasted subtree`, async () => {
    const source = createEditor()
    const target = createEditor()
    try {
      const root = source.graph.createNode('FRAME', source.state.currentPageId)
      const tile = source.graph.createNode('RECTANGLE', root.id, { name: 'Tile' })
      const pattern: Stroke = {
        ...imageStroke,
        type: 'PATTERN',
        imageHash: undefined,
        sourceNodeId: tile.id,
        patternSpacing: { x: 2, y: 3 },
        dashPattern: [4, 2]
      }
      source.graph.createNode('RECTANGLE', root.id, {
        name: 'Paint',
        strokes: [pattern],
        stateOverrides: { hover: { strokes: [pattern] } },
        responsiveOverrides: { compact: { strokes: [pattern] } }
      })
      // Occupy the old ids to ensure identity is remapped rather than accidentally matching.
      for (let index = 0; index < 5; index++)
        target.graph.createNode('RECTANGLE', target.state.currentPageId)
      source.select([root.id])
      const payload = await source.prepareCopy()
      if (carrier === 'html') await target.pasteFromHTML(payload.html)
      else await target.pasteSnapshot(expectDefined(payload.snapshot))
      const id = expectDefined([...target.state.selectedIds][0])
      const children = target.graph.getChildren(id)
      const pastedTile = expectDefined(children.find((node) => node.name === 'Tile'))
      const pastedPaint = expectDefined(children.find((node) => node.name === 'Paint'))
      const assertReferences = (node: SceneNode) => {
        expect(node.strokes[0]).toEqual({ ...pattern, sourceNodeId: pastedTile.id })
        expect(node.stateOverrides?.hover?.strokes?.[0]?.sourceNodeId).toBe(pastedTile.id)
        expect(node.responsiveOverrides?.compact?.strokes?.[0]?.sourceNodeId).toBe(pastedTile.id)
        expect(pastedTile.id).not.toBe(tile.id)
      }
      assertReferences(pastedPaint)
      source.graph.deleteNode(root.id)
      assertReferences(pastedPaint)
      target.undo.undo()
      expect(target.graph.getNode(pastedPaint.id)).toBeUndefined()
      target.undo.redo()
      assertReferences(expectDefined(target.graph.getNode(pastedPaint.id)))
    } finally {
      source.dispose()
      target.dispose()
    }
  })
}

test('Duplicate remaps pattern strokes through undo/redo and save/reopen', async () => {
  const editor = createEditor()
  try {
    const root = editor.graph.createNode('FRAME', editor.state.currentPageId)
    const tile = editor.graph.createNode('RECTANGLE', root.id, { name: 'Tile' })
    const pattern: Stroke = {
      ...imageStroke,
      type: 'PATTERN',
      imageHash: undefined,
      sourceNodeId: tile.id
    }
    editor.graph.createNode('RECTANGLE', root.id, {
      name: 'Paint',
      strokes: [pattern],
      stateOverrides: { hover: { strokes: [pattern] } },
      responsiveOverrides: { compact: { strokes: [pattern] } }
    })
    editor.select([root.id])
    editor.duplicateSelected()
    const cloneId = expectDefined([...editor.state.selectedIds][0])
    const children = editor.graph.getChildren(cloneId)
    const clonedTile = expectDefined(children.find((node) => node.name === 'Tile'))
    const clonedPaint = expectDefined(children.find((node) => node.name === 'Paint'))
    expect(clonedPaint.strokes[0]?.sourceNodeId).toBe(clonedTile.id)
    expect(clonedTile.id).not.toBe(tile.id)
    editor.undo.undo()
    expect(editor.graph.getNode(cloneId)).toBeUndefined()
    expect(editor.graph.getNode(tile.id)).toBeDefined()
    editor.undo.redo()
    expect(editor.graph.getNode(clonedPaint.id)?.strokes[0]?.sourceNodeId).toBe(clonedTile.id)
    expect(editor.graph.getNode(clonedTile.id)).toBeDefined()
    const saved = await parseFigFile(uint8ArrayToArrayBuffer(await exportFigFile(editor.graph)))
    const savedRoot = expectDefined(
      [...saved.nodes.values()].find((node) => node.name === 'Frame copy')
    )
    const savedChildren = saved.getChildren(savedRoot.id)
    const savedTile = expectDefined(savedChildren.find((node) => node.name === 'Tile'))
    const savedPaint = expectDefined(savedChildren.find((node) => node.name === 'Paint'))
    expect(savedPaint.strokes[0]?.sourceNodeId).toBe(savedTile.id)
    expect(savedPaint.stateOverrides?.hover?.strokes?.[0]?.sourceNodeId).toBe(savedTile.id)
    expect(savedPaint.responsiveOverrides?.compact?.strokes?.[0]?.sourceNodeId).toBe(savedTile.id)
    const resolved =
      saved.getNode(expectDefined(savedPaint.strokes[0]?.sourceNodeId)) ??
      [...saved.nodes.values()].find(
        (node) => node.source.id === savedPaint.strokes[0]?.sourceNodeId
      )
    expect(resolved?.id).toBe(savedTile.id)
    const importedClone = expectDefined(saved.cloneTree(savedRoot.id, saved.getPages()[0].id))
    const importedChildren = saved.getChildren(importedClone.id)
    const importedTile = expectDefined(importedChildren.find((node) => node.name === 'Tile'))
    const importedPaint = expectDefined(importedChildren.find((node) => node.name === 'Paint'))
    expect(importedPaint.strokes[0]?.sourceNodeId).toBe(importedTile.id)
    saved.deleteNode(savedRoot.id)
    expect(saved.getNode(expectDefined(importedPaint.strokes[0]?.sourceNodeId))?.id).toBe(
      importedTile.id
    )
  } finally {
    editor.dispose()
  }
})

for (const carrier of ['html', 'snapshot', 'figma'] as const) {
  test(`${carrier}: imported pattern strokes resolve to the destination subtree`, async () => {
    const source = createEditor()
    const target = createEditor()
    try {
      const root = source.graph.createNode('FRAME', source.state.currentPageId, { name: 'Pattern' })
      const tile = source.graph.createNode('RECTANGLE', root.id, { name: 'Tile' })
      source.graph.createNode('RECTANGLE', root.id, {
        name: 'Paint',
        strokes: [{ ...imageStroke, type: 'PATTERN', imageHash: undefined, sourceNodeId: tile.id }]
      })
      source.replaceGraph(
        await parseFigFile(uint8ArrayToArrayBuffer(await exportFigFile(source.graph)))
      )
      const importedRoot = expectDefined(
        [...source.graph.nodes.values()].find((node) => node.name === 'Pattern')
      )
      source.select([importedRoot.id])
      const payload = await source.prepareCopy()
      if (carrier === 'html') await target.pasteFromHTML(payload.html)
      else if (carrier === 'figma')
        await target.pasteFromHTML(
          expectDefined(
            await buildFigmaClipboardHTML(expectDefined(payload.snapshot).nodes, source.graph)
          )
        )
      else await target.pasteSnapshot(expectDefined(payload.snapshot))
      const pastedRoot = expectDefined([...target.state.selectedIds][0])
      const children = target.graph.getChildren(pastedRoot)
      const pastedTile = expectDefined(children.find((node) => node.name === 'Tile'))
      const pastedPaint = expectDefined(children.find((node) => node.name === 'Paint'))
      expect(pastedPaint.strokes[0]?.sourceNodeId).toBe(pastedTile.id)
      expect(target.graph.getNode(expectDefined(pastedPaint.strokes[0]?.sourceNodeId))?.id).toBe(
        pastedTile.id
      )
      source.graph.deleteNode(importedRoot.id)
      target.undo.undo()
      target.undo.redo()
      expect(target.graph.getNode(pastedPaint.id)?.strokes[0]?.sourceNodeId).toBe(pastedTile.id)
      const reopened = await parseFigFile(uint8ArrayToArrayBuffer(await exportFigFile(target.graph)))
      const reopenedPaint = expectDefined([...reopened.nodes.values()].find((node) => node.name === 'Paint'))
      const reopenedTile = expectDefined([...reopened.nodes.values()].find((node) => node.name === 'Tile'))
      expect(reopenedPaint.strokes[0]?.sourceNodeId).toBe(reopenedTile.id)
    } finally {
      source.dispose()
      target.dispose()
    }
  })
}
