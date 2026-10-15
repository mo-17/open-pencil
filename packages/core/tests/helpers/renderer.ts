import { spyOn } from 'bun:test'

import { SkiaRenderer } from '#core/canvas'
import { createEditor as createCoreEditor, type Editor } from '#core/editor'
import { initCanvasKit } from '#core/io'
import { getTextMeasurer, setTextMeasurer } from '#core/layout'

import { expectDefined } from './assert'

const ck = await initCanvasKit()
const probes: Array<{ renderer: SkiaRenderer; restore(): void }> = []
const editors: Editor[] = []

/** Editors release their installed text measurer before their renderer is destroyed. */
export function createRendererTestEditor(...options: Parameters<typeof createCoreEditor>): Editor {
  const editor = createCoreEditor(...options)
  editors.push(editor)
  return editor
}

export function disposeRendererProbes(): void {
  for (const editor of editors.splice(0).reverse()) editor.dispose()
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
