import { describe, expect, test } from 'bun:test'

import {
  buildFigmaClipboardHTML,
  buildOpenPencilClipboardHTML,
  importClipboardNodes,
  parseFigmaClipboard
} from '@open-pencil/core/clipboard'
import { createEditor } from '@open-pencil/core/editor'

import { expectDefined } from '#tests/helpers/assert'
import { generatedEffect } from '#tests/helpers/generated-effect'

describe('generated-effect clipboard persistence', () => {
  test('OpenPencil paste restores an isolated spec', async () => {
    const source = createEditor()
    const node = source.graph.createNode('RECTANGLE', source.state.currentPageId, {
      name: 'Effect source',
      generatedEffect: generatedEffect('shimmer')
    })
    const destination = createEditor()
    await destination.pasteFromHTML(buildOpenPencilClipboardHTML([node], source.graph))
    const pastedId = expectDefined([...destination.state.selectedIds][0], 'pasted node id')
    const pasted = destination.graph.getNode(pastedId)
    expect(pasted?.generatedEffect).toEqual(node.generatedEffect)
    expect(pasted?.generatedEffect).not.toBe(node.generatedEffect)
  })

  test('Figma clipboard projection restores an isolated spec', async () => {
    const source = createEditor()
    const node = source.graph.createNode('RECTANGLE', source.state.currentPageId, {
      name: 'Figma effect source',
      generatedEffect: generatedEffect('particles')
    })
    const html = await buildFigmaClipboardHTML([node], source.graph)
    if (!html) throw new Error('Expected Figma clipboard HTML')
    const parsed = await parseFigmaClipboard(html)
    if (!parsed) throw new Error('Expected parsed Figma clipboard payload')
    const destination = createEditor()
    const [createdId] = importClipboardNodes(
      parsed.nodes,
      destination.graph,
      destination.state.currentPageId,
      0,
      0,
      parsed.blobs
    )
    const pasted = destination.graph.getNode(expectDefined(createdId, 'created node id'))
    expect(pasted?.generatedEffect).toEqual(node.generatedEffect)
    expect(pasted?.generatedEffect).not.toBe(node.generatedEffect)
  })
})
