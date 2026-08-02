import { expect, mock, test } from 'bun:test'

import type { SkiaRenderer } from '@open-pencil/core/canvas'
import { createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'

let fontFamilySequence = 0

function uniqueFontFamily(prefix: string) {
  fontFamilySequence++
  return `${prefix} ${Date.now()} ${fontFamilySequence}`
}

test('overlay-only repaint emits without invalidating the scene render version', () => {
  const editor = createEditor({ skipInitialGraphSetup: true })
  const initialRenderVersion = editor.state.renderVersion
  const initialSceneVersion = editor.state.sceneVersion
  let received: { renderVersion: number; sceneVersion: number } | null = null
  editor.onEditorEvent('overlay:requested', (versions) => {
    received = versions
  })

  editor.requestOverlayRepaint()

  expect(editor.state.renderVersion).toBe(initialRenderVersion)
  expect(editor.state.sceneVersion).toBe(initialSceneVersion)
  expect(received).toEqual({
    renderVersion: initialRenderVersion,
    sceneVersion: initialSceneVersion
  })
})

test('finishing a loading phase wakes canvases without invalidating scene data', () => {
  const editor = createEditor({ skipInitialGraphSetup: true })
  const renderer = { clearDocumentCaches: mock(() => undefined) }
  editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer as SkiaRenderer)
  const initialSceneVersion = editor.state.sceneVersion
  let repaints = 0
  editor.onEditorEvent('repaint:requested', () => repaints++)

  editor.setLoading(true)
  expect(editor.state.loading).toBe(true)
  expect(repaints).toBe(0)
  expect(renderer.clearDocumentCaches).toHaveBeenCalledTimes(1)

  editor.setLoading(false)
  expect(editor.state.loading).toBe(false)
  expect(editor.state.sceneVersion).toBe(initialSceneVersion)
  expect(repaints).toBe(1)
})

test('nested loading leases keep canvases asleep until the final operation completes', () => {
  const editor = createEditor({ skipInitialGraphSetup: true })
  let repaints = 0
  editor.onEditorEvent('repaint:requested', () => repaints++)

  const finishOuter = editor.beginLoading()
  const finishInner = editor.beginLoading()
  expect(editor.state.loading).toBe(true)

  finishOuter()
  expect(editor.state.loading).toBe(true)
  expect(repaints).toBe(0)

  finishInner()
  expect(editor.state.loading).toBe(false)
  expect(repaints).toBe(1)
  finishInner()
  expect(repaints).toBe(1)
})

test('manual loading and loading leases cannot release each other early', () => {
  const editor = createEditor({ skipInitialGraphSetup: true })

  const finishLoading = editor.beginLoading()
  editor.setLoading(true)
  finishLoading()
  expect(editor.state.loading).toBe(true)

  const finishSecondLoading = editor.beginLoading()
  editor.setLoading(false)
  expect(editor.state.loading).toBe(true)
  finishSecondLoading()
  expect(editor.state.loading).toBe(false)
})

test('a cache-releasing lease nested under a page switch still releases old resources', () => {
  const editor = createEditor({ skipInitialGraphSetup: true })
  const renderer = { clearDocumentCaches: mock(() => undefined) }
  editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer as SkiaRenderer)

  const finishPageSwitch = editor.beginLoading({ releaseDocumentCaches: false })
  expect(renderer.clearDocumentCaches).not.toHaveBeenCalled()
  const finishReload = editor.beginLoading()
  expect(renderer.clearDocumentCaches).toHaveBeenCalledTimes(1)

  finishReload()
  expect(editor.state.loading).toBe(true)
  finishPageSwitch()
  expect(editor.state.loading).toBe(false)
})

test('page changes release document-scoped resources from every canvas renderer', async () => {
  const editor = createEditor({ skipInitialGraphSetup: true })
  const renderers = Array.from({ length: 2 }, () => {
    const renderer = {
      clearDocumentCaches: mock(() => undefined),
      invalidateAllPictures: mock(() => undefined)
    }
    editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer as SkiaRenderer)
    return renderer
  })
  const otherPage = editor.graph.addPage('Other')

  await editor.switchPage(otherPage.id)

  for (const renderer of renderers) {
    expect(renderer.clearDocumentCaches).toHaveBeenCalledTimes(1)
    expect(renderer.invalidateAllPictures).toHaveBeenCalled()
  }
})

test('a superseded slow page switch cannot render over the latest page', async () => {
  const graph = new SceneGraph()
  const slowPage = graph.addPage('Slow')
  const fastPage = graph.addPage('Fast')
  const family = uniqueFontFamily('Slow Switch')
  graph.createNode('TEXT', slowPage.id, { text: 'Slow', fontFamily: family })
  const fontLoad = Promise.withResolvers<ArrayBuffer | null>()
  const fontStarted = Promise.withResolvers<undefined>()
  const loadFont = mock(async (requestedFamily: string) => {
    if (requestedFamily !== family) return null
    fontStarted.resolve(undefined)
    return fontLoad.promise
  })
  const editor = createEditor({ graph, loadFont, skipInitialGraphSetup: true })
  let renders = 0
  editor.onEditorEvent('render:requested', () => renders++)

  const slowSwitch = editor.switchPage(slowPage.id)
  await fontStarted.promise
  const fastSwitch = editor.switchPage(fastPage.id)
  await Promise.all([slowSwitch, fastSwitch])

  expect(editor.state.currentPageId).toBe(fastPage.id)
  expect(editor.state.loading).toBe(false)
  expect(renders).toBe(1)
  fontLoad.resolve(null)
})

test('graph replacement cancels a page switch waiting on the previous graph', async () => {
  const graph = new SceneGraph()
  const slowPage = graph.addPage('Slow')
  const family = uniqueFontFamily('Replaced Switch')
  graph.createNode('TEXT', slowPage.id, { text: 'Slow', fontFamily: family })
  const fontLoad = Promise.withResolvers<ArrayBuffer | null>()
  const fontStarted = Promise.withResolvers<undefined>()
  const editor = createEditor({
    graph,
    loadFont: async (requestedFamily) => {
      if (requestedFamily !== family) return null
      fontStarted.resolve(undefined)
      return fontLoad.promise
    },
    skipInitialGraphSetup: true
  })
  let renders = 0
  editor.onEditorEvent('render:requested', () => renders++)

  const switching = editor.switchPage(slowPage.id)
  await fontStarted.promise
  const replacement = new SceneGraph()
  const replacementPage = replacement.getPages()[0]
  editor.replaceGraph(replacement)
  await switching

  expect(editor.graph).toBe(replacement)
  expect(editor.state.currentPageId).toBe(replacementPage.id)
  expect(editor.state.loading).toBe(false)
  expect(renders).toBe(1)
  fontLoad.resolve(null)
})

test('graph replacement clears renderer resources even when the page ID is unchanged', () => {
  const editor = createEditor({ skipInitialGraphSetup: true })
  const renderer = { clearDocumentCaches: mock(() => undefined) }
  editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer as SkiaRenderer)
  const pageId = editor.state.currentPageId
  const replacement = new SceneGraph()
  const generatedPage = replacement.getPages()[0]
  replacement.deleteNode(generatedPage.id)
  replacement.createNodeWithId(pageId, 'CANVAS', replacement.rootId, { name: 'Replacement' })
  let pageChanges = 0
  editor.onEditorEvent('page:changed', () => pageChanges++)

  editor.replaceGraph(replacement)

  expect(editor.state.currentPageId).toBe(pageId)
  expect(pageChanges).toBe(0)
  expect(renderer.clearDocumentCaches).toHaveBeenCalledTimes(1)
})
