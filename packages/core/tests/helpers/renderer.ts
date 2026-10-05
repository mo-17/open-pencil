import { spyOn } from 'bun:test'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { initCanvasKit } from '@open-pencil/core/io'
import { getTextMeasurer, setTextMeasurer } from '@open-pencil/core/layout'

import { expectDefined } from './assert'

const ck = await initCanvasKit()
const probes: Array<{ renderer: SkiaRenderer; restore(): void }> = []

export function disposeRendererProbes(): void {
  for (const probe of probes.splice(0).reverse()) {
    probe.restore()
    probe.renderer.destroy()
  }
}

/** Complete renderer with only the invalidation effects observed by editor tests stubbed. */
export function createRendererProbe() {
  const previousTextMeasurer = getTextMeasurer()
  const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(1, 1), 'test surface'))
  const clearDocumentCaches = spyOn(renderer, 'clearDocumentCaches').mockImplementation(
    () => undefined
  )
  const invalidateAllPictures = spyOn(renderer, 'invalidateAllPictures').mockImplementation(
    () => undefined
  )
  const invalidateNodePicture = spyOn(renderer, 'invalidateNodePicture').mockImplementation(
    () => undefined
  )
  const invalidateStructure = spyOn(renderer.tiledScene, 'invalidateStructure').mockImplementation(
    () => undefined
  )
  const invalidateNode = spyOn(renderer.tiledScene, 'invalidateNode').mockImplementation(
    () => undefined
  )
  probes.push({
    renderer,
    restore() {
      setTextMeasurer(previousTextMeasurer)
      clearDocumentCaches.mockRestore()
      invalidateAllPictures.mockRestore()
      invalidateNodePicture.mockRestore()
      invalidateStructure.mockRestore()
      invalidateNode.mockRestore()
    }
  })
  return {
    ck,
    renderer,
    clearDocumentCaches,
    invalidateAllPictures,
    invalidateNodePicture,
    tiledScene: { invalidateStructure, invalidateNode }
  }
}
