import { afterEach, expect, mock, test } from 'bun:test'

import { createRendererProbe, disposeRendererProbes } from '#core-tests/helpers/renderer'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor'
import { registerFigPopulationWorker } from '#core/kiwi/fig/population/client'

import { createOwnershipWorker } from '#tests/helpers/worker'

afterEach(disposeRendererProbes)

test('graph replacement clears tiled state even when page IDs are reused', () => {
  const editor = createEditor()
  const renderer = createRendererProbe()
  editor.setCanvasKit(renderer.ck, renderer.renderer)
  const replacement = new SceneGraph()

  editor.replaceGraph(replacement)

  expect(renderer.tiledScene.invalidateStructure).toHaveBeenCalledTimes(1)
  expect(editor.graph).toBe(replacement)
  editor.dispose()
})

test('graph replacement remains ownership-neutral for temporary preview graphs', () => {
  const original = new SceneGraph()
  const preview = new SceneGraph()
  const terminate = mock(() => undefined)
  registerFigPopulationWorker(original, createOwnershipWorker(terminate))
  const editor = createEditor({ graph: original, skipInitialGraphSetup: true })

  editor.replaceGraph(preview)
  expect(terminate).not.toHaveBeenCalled()

  editor.replaceGraph(original)
  expect(terminate).not.toHaveBeenCalled()

  editor.releaseGraphResources()
  expect(terminate).toHaveBeenCalledTimes(1)
  editor.dispose()
})
