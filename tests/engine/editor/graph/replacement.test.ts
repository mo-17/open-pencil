import { expect, mock, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { createEditor } from '#core/editor'
import { registerFigPopulationWorker } from '#core/kiwi/fig/population/client'

test('graph replacement clears tiled state even when page IDs are reused', () => {
  const editor = createEditor()
  const renderer = {
    clearDocumentCaches: mock(),
    tiledScene: { invalidateStructure: mock() },
    measureTextNode: undefined
  } as SkiaRenderer
  editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer)
  const replacement = new SceneGraph()

  editor.replaceGraph(replacement)

  expect(renderer.tiledScene.invalidateStructure).toHaveBeenCalledTimes(1)
  expect(editor.graph).toBe(replacement)
})

test('graph replacement remains ownership-neutral for temporary preview graphs', () => {
  const original = new SceneGraph()
  const preview = new SceneGraph()
  const terminate = mock(() => undefined)
  registerFigPopulationWorker(original, { terminate } as unknown as Worker)
  const editor = createEditor({ graph: original, skipInitialGraphSetup: true })

  editor.replaceGraph(preview)
  expect(terminate).not.toHaveBeenCalled()

  editor.replaceGraph(original)
  expect(terminate).not.toHaveBeenCalled()

  editor.releaseGraphResources()
  expect(terminate).toHaveBeenCalledTimes(1)
  editor.dispose()
})
