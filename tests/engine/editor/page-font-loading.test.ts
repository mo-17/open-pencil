import { expect, mock, test } from 'bun:test'

import type { SkiaRenderer } from '@open-pencil/core/canvas'
import { createEditor } from '@open-pencil/core/editor'
import { fontManager } from '@open-pencil/core/text'
import { SceneGraph } from '@open-pencil/scene-graph'

import { repoPath } from '#tests/helpers/paths'

let fontSequence = 0

function pendingFontFamily(label: string): string {
  fontSequence++
  return `${label} ${Date.now()} ${fontSequence}`
}

function textPage(graph: SceneGraph, pageId: string, family: string) {
  return graph.createNode('TEXT', pageId, {
    text: 'Page font loading',
    fontFamily: family,
    textPicture: new Uint8Array([1, 2, 3])
  })
}

async function flushBackgroundWork(): Promise<void> {
  await Promise.resolve()
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  await Promise.resolve()
}

test('page switch renders fallback content without awaiting a never-settling font load', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const family = pendingFontFamily('Never settling page font')
  const text = textPage(graph, page.id, family)
  const fontStarted = Promise.withResolvers<undefined>()
  const neverSettles = Promise.withResolvers<ArrayBuffer | null>().promise
  let receivedSignal: AbortSignal | undefined
  const editor = createEditor({
    graph,
    loadFont: async (requestedFamily, _style, _characters, options) => {
      if (requestedFamily !== family) return null
      receivedSignal = options?.signal
      fontStarted.resolve(undefined)
      return neverSettles
    },
    skipInitialGraphSetup: true
  })
  let renders = 0
  editor.onEditorEvent('render:requested', () => renders++)

  const switching = editor.switchPage(page.id)
  await switching
  await fontStarted.promise

  expect(editor.state.loading).toBe(false)
  expect(editor.state.currentPageId).toBe(page.id)
  expect(fontManager.isNodeBlocked(text.id)).toBe(false)
  expect(renders).toBe(1)
  expect(receivedSignal?.aborted).toBe(false)

  editor.replaceGraph(new SceneGraph())
  expect(receivedSignal?.aborted).toBe(true)
  await flushBackgroundWork()
})

test('a successful background font load refreshes only after the first page is usable', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const family = pendingFontFamily('Successful background page font')
  const text = textPage(graph, page.id, family)
  const fontLoad = Promise.withResolvers<ArrayBuffer | null>()
  const editor = createEditor({
    graph,
    loadFont: async (requestedFamily) => (requestedFamily === family ? fontLoad.promise : null),
    skipInitialGraphSetup: true
  })
  const renderer = {
    clearDocumentCaches: mock(() => undefined),
    invalidateAllPictures: mock(() => undefined)
  }
  editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer as SkiaRenderer)

  await editor.switchPage(page.id)
  expect(editor.state.loading).toBe(false)
  expect(text.textPicture).not.toBeNull()
  const invalidationBaseline = renderer.invalidateAllPictures.mock.calls.length

  const refreshed = Promise.withResolvers<undefined>()
  const stop = editor.onEditorEvent('render:requested', () => refreshed.resolve(undefined))
  fontLoad.resolve(new ArrayBuffer(8))
  await refreshed.promise
  stop()

  expect(text.textPicture).toBeNull()
  expect(renderer.invalidateAllPictures).toHaveBeenCalledTimes(invalidationBaseline + 1)
  expect(editor.state.currentPageId).toBe(page.id)
})

test('an imported fig page preserves its authored geometry before and after fonts load', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    source: { ...page.source, format: 'fig', id: page.id }
  })
  const frame = graph.createNode('FRAME', page.id, {
    width: 200,
    height: 100,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED'
  })
  const family = pendingFontFamily('Imported fig page font')
  const text = graph.createNode('TEXT', frame.id, {
    y: 77,
    width: 100,
    height: 20,
    text: 'Imported geometry',
    fontFamily: family,
    textPicture: new Uint8Array([1, 2, 3])
  })
  const fontLoad = Promise.withResolvers<ArrayBuffer | null>()
  const editor = createEditor({
    graph,
    loadFont: async (requestedFamily) => (requestedFamily === family ? fontLoad.promise : null),
    skipInitialGraphSetup: true
  })

  await editor.switchPage(page.id)
  expect(text.y).toBe(77)

  const refreshed = Promise.withResolvers<undefined>()
  const stop = editor.onEditorEvent('render:requested', () => refreshed.resolve(undefined))
  fontLoad.resolve(new ArrayBuffer(8))
  await refreshed.promise
  stop()

  expect(text.textPicture).toBeNull()
  expect(text.y).toBe(77)
})

test('an already registered font result does not schedule a duplicate refresh', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const family = pendingFontFamily('Already registered page font')
  fontManager.markLoaded(
    family,
    'Regular',
    await Bun.file(repoPath('public/Inter-Regular.ttf')).arrayBuffer()
  )
  const text = textPage(graph, page.id, family)
  const loadFont = mock(async () => new ArrayBuffer(8))
  const editor = createEditor({
    graph,
    loadFont,
    skipInitialGraphSetup: true
  })
  const renderer = {
    clearDocumentCaches: mock(() => undefined),
    invalidateAllPictures: mock(() => undefined)
  }
  editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer as SkiaRenderer)
  let renders = 0
  editor.onEditorEvent('render:requested', () => renders++)

  await editor.switchPage(page.id)
  const renderBaseline = renders
  const invalidationBaseline = renderer.invalidateAllPictures.mock.calls.length
  await flushBackgroundWork()

  expect(loadFont).not.toHaveBeenCalled()
  expect(text.textPicture).not.toBeNull()
  expect(renderer.invalidateAllPictures).toHaveBeenCalledTimes(invalidationBaseline)
  expect(renders).toBe(renderBaseline)
})

test('null and rejected font attempts do not schedule a final refresh', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const nullFamily = pendingFontFamily('Null page font')
  const rejectedFamily = pendingFontFamily('Rejected page font')
  const nullText = textPage(graph, page.id, nullFamily)
  const rejectedText = textPage(graph, page.id, rejectedFamily)
  const editor = createEditor({
    graph,
    loadFont: async (family) => {
      if (family === rejectedFamily) throw new Error('font loading failed')
      return null
    },
    skipInitialGraphSetup: true
  })
  const renderer = {
    clearDocumentCaches: mock(() => undefined),
    invalidateAllPictures: mock(() => undefined)
  }
  editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer as SkiaRenderer)
  let renders = 0
  editor.onEditorEvent('render:requested', () => renders++)

  await editor.switchPage(page.id)
  const renderBaseline = renders
  const invalidationBaseline = renderer.invalidateAllPictures.mock.calls.length
  await flushBackgroundWork()

  expect(nullText.textPicture).not.toBeNull()
  expect(rejectedText.textPicture).not.toBeNull()
  expect(renderer.invalidateAllPictures).toHaveBeenCalledTimes(invalidationBaseline)
  expect(renders).toBe(renderBaseline)
})

test('a partial font success keeps derived text pictures for unresolved faces', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const loadedFamily = pendingFontFamily('Partially loaded page font')
  const missingFamily = pendingFontFamily('Partially missing page font')
  const loadedText = textPage(graph, page.id, loadedFamily)
  const missingText = textPage(graph, page.id, missingFamily)
  const editor = createEditor({
    graph,
    loadFont: async (family) => (family === loadedFamily ? new ArrayBuffer(8) : null),
    skipInitialGraphSetup: true
  })

  await editor.switchPage(page.id)
  const refreshed = Promise.withResolvers<undefined>()
  const stop = editor.onEditorEvent('render:requested', () => refreshed.resolve(undefined))
  await refreshed.promise
  stop()

  expect(loadedText.textPicture).not.toBeNull()
  expect(missingText.textPicture).not.toBeNull()
})

test('multiple pending faces produce one batched background refresh', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const firstFamily = pendingFontFamily('First batched page font')
  const secondFamily = pendingFontFamily('Second batched page font')
  const firstText = textPage(graph, page.id, firstFamily)
  const secondText = textPage(graph, page.id, secondFamily)
  const firstLoad = Promise.withResolvers<ArrayBuffer | null>()
  const secondLoad = Promise.withResolvers<ArrayBuffer | null>()
  const editor = createEditor({
    graph,
    loadFont: async (family) => (family === firstFamily ? firstLoad.promise : secondLoad.promise),
    skipInitialGraphSetup: true
  })
  const renderer = {
    clearDocumentCaches: mock(() => undefined),
    invalidateAllPictures: mock(() => undefined)
  }
  editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer as SkiaRenderer)
  let renders = 0
  editor.onEditorEvent('render:requested', () => renders++)

  await editor.switchPage(page.id)
  const renderBaseline = renders
  const invalidationBaseline = renderer.invalidateAllPictures.mock.calls.length

  firstLoad.resolve(new ArrayBuffer(8))
  await flushBackgroundWork()
  expect(firstText.textPicture).not.toBeNull()
  expect(secondText.textPicture).not.toBeNull()
  expect(renders).toBe(renderBaseline)

  const refreshed = Promise.withResolvers<undefined>()
  const stop = editor.onEditorEvent('render:requested', () => refreshed.resolve(undefined))
  secondLoad.resolve(new ArrayBuffer(8))
  await refreshed.promise
  stop()
  await flushBackgroundWork()

  expect(firstText.textPicture).toBeNull()
  expect(secondText.textPicture).toBeNull()
  expect(renderer.invalidateAllPictures).toHaveBeenCalledTimes(invalidationBaseline + 1)
  expect(renders).toBe(renderBaseline + 1)
})

test('a font load from a stale page cannot refresh the current page', async () => {
  const graph = new SceneGraph()
  const slowPage = graph.getPages()[0]
  const currentPage = graph.addPage('Current page')
  const family = pendingFontFamily('Stale page font')
  const staleText = textPage(graph, slowPage.id, family)
  const fontLoad = Promise.withResolvers<ArrayBuffer | null>()
  const editor = createEditor({
    graph,
    loadFont: async (requestedFamily) => (requestedFamily === family ? fontLoad.promise : null),
    skipInitialGraphSetup: true
  })
  const renderer = {
    clearDocumentCaches: mock(() => undefined),
    invalidateAllPictures: mock(() => undefined)
  }
  editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer as SkiaRenderer)
  let renders = 0
  editor.onEditorEvent('render:requested', () => renders++)

  await editor.switchPage(slowPage.id)
  await editor.switchPage(currentPage.id)
  await flushBackgroundWork()
  const renderBaseline = renders
  const invalidationBaseline = renderer.invalidateAllPictures.mock.calls.length

  fontLoad.resolve(new ArrayBuffer(8))
  await flushBackgroundWork()

  expect(editor.state.currentPageId).toBe(currentPage.id)
  expect(staleText.textPicture).not.toBeNull()
  expect(renderer.invalidateAllPictures).toHaveBeenCalledTimes(invalidationBaseline)
  expect(renders).toBe(renderBaseline)
})

test('a font load from a replaced graph cannot mutate or repaint the replacement', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const family = pendingFontFamily('Stale graph font')
  const staleText = textPage(graph, page.id, family)
  const fontLoad = Promise.withResolvers<ArrayBuffer | null>()
  const editor = createEditor({
    graph,
    loadFont: async (requestedFamily) => (requestedFamily === family ? fontLoad.promise : null),
    skipInitialGraphSetup: true
  })
  const renderer = {
    clearDocumentCaches: mock(() => undefined),
    invalidateAllPictures: mock(() => undefined)
  }
  editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer as SkiaRenderer)
  let renders = 0
  editor.onEditorEvent('render:requested', () => renders++)

  await editor.switchPage(page.id)
  const replacement = new SceneGraph()
  editor.replaceGraph(replacement)
  const renderBaseline = renders
  const invalidationBaseline = renderer.invalidateAllPictures.mock.calls.length

  fontLoad.resolve(new ArrayBuffer(8))
  await flushBackgroundWork()

  expect(editor.graph).toBe(replacement)
  expect(staleText.textPicture).not.toBeNull()
  expect(renderer.invalidateAllPictures).toHaveBeenCalledTimes(invalidationBaseline)
  expect(renders).toBe(renderBaseline)
})
