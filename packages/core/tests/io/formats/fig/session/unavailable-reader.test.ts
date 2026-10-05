import { expect, test } from 'bun:test'

import { TestFigWorker } from '#core-tests/helpers/fig/worker'

import { createEditor } from '@open-pencil/core/editor'

import {
  registerFigPopulationWorker,
  releaseFigPopulationWorker
} from '#core/kiwi/fig/population/client'

test('new live pages do not require unavailable reader recovery', async () => {
  const editor = createEditor()
  const page = editor.graph.addPage('Unloaded')
  const worker = new TestFigWorker()
  registerFigPopulationWorker(editor.graph, worker)
  editor.graph.updateNode(editor.graph.rootId, { name: 'User edit' })
  try {
    await expect(editor.preparePage(page.id)).resolves.toMatchObject({ pageId: page.id })
    expect(editor.graph.getChildren(page.id)).toEqual([])
  } finally {
    releaseFigPopulationWorker(editor.graph)
  }
})
