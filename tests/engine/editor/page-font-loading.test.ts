import { expect, mock, spyOn, test } from 'bun:test'

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
  let progressEvents = 0
  editor.onEditorEvent('render:requested', () => renders++)
  editor.onEditorEvent('font:load-progress', () => progressEvents++)

  await editor.switchPage(page.id)
  const renderBaseline = renders
  const invalidationBaseline = renderer.invalidateAllPictures.mock.calls.length
  await flushBackgroundWork()

  expect(loadFont).not.toHaveBeenCalled()
  expect(text.textPicture).not.toBeNull()
  expect(renderer.invalidateAllPictures).toHaveBeenCalledTimes(invalidationBaseline)
  expect(renders).toBe(renderBaseline)
  expect(progressEvents).toBe(0)
})

test('background font faces report incremental progress without requesting a render', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const firstFamily = pendingFontFamily('First progress page font')
  const secondFamily = pendingFontFamily('Second progress page font')
  textPage(graph, page.id, firstFamily)
  textPage(graph, page.id, secondFamily)
  const firstLoad = Promise.withResolvers<ArrayBuffer | null>()
  const secondLoad = Promise.withResolvers<ArrayBuffer | null>()
  const editor = createEditor({
    graph,
    loadFont: async (family) => (family === firstFamily ? firstLoad.promise : secondLoad.promise),
    skipInitialGraphSetup: true
  })
  const started = Promise.withResolvers<undefined>()
  const firstSettled = Promise.withResolvers<undefined>()
  const completed = Promise.withResolvers<undefined>()
  const progress: Array<{
    operationId: number
    completed: number
    total: number
    failed: number
    status: string
    renderVersion: number
    sceneVersion: number
  }> = []
  editor.onEditorEvent('font:load-progress', (event) => {
    progress.push({
      operationId: event.operationId,
      completed: event.completed,
      total: event.total,
      failed: event.failed,
      status: event.status,
      renderVersion: editor.state.renderVersion,
      sceneVersion: editor.state.sceneVersion
    })
    if (event.completed === 0) started.resolve(undefined)
    if (event.completed === 1) firstSettled.resolve(undefined)
    if (event.status === 'completed') completed.resolve(undefined)
  })

  await editor.switchPage(page.id)
  await started.promise
  const baseline = {
    renderVersion: editor.state.renderVersion,
    sceneVersion: editor.state.sceneVersion
  }

  firstLoad.resolve(new ArrayBuffer(8))
  await firstSettled.promise
  secondLoad.resolve(null)
  await completed.promise

  expect(progress.map(({ operationId: _, ...event }) => event)).toEqual([
    { completed: 0, total: 2, failed: 0, status: 'loading', ...baseline },
    { completed: 1, total: 2, failed: 0, status: 'loading', ...baseline },
    { completed: 2, total: 2, failed: 1, status: 'completed', ...baseline }
  ])
  expect(new Set(progress.map((event) => event.operationId)).size).toBe(1)
  await flushBackgroundWork()
})

test('all required fallback scripts count as one progress task', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const coverageFamily = pendingFontFamily('Fallback coverage page font')
  fontManager.markLoaded(
    coverageFamily,
    'Regular',
    await Bun.file(repoPath('public/Inter-Regular.ttf')).arrayBuffer()
  )
  graph.createNode('TEXT', page.id, {
    text: '中文 العربية',
    fontFamily: coverageFamily
  })
  const family = pendingFontFamily('Fallback progress page font')
  textPage(graph, page.id, family)
  const faceLoad = Promise.withResolvers<ArrayBuffer | null>()
  const fallbackLoad =
    Promise.withResolvers<Awaited<ReturnType<typeof fontManager.ensureFallbackPack>>>()
  type FallbackScripts = NonNullable<Parameters<typeof fontManager.ensureFallbackPack>[0]>
  const fallbackStarted = Promise.withResolvers<FallbackScripts>()
  const fallbackSpy = spyOn(fontManager, 'ensureFallbackPack').mockImplementation(
    async (scripts) => {
      fallbackStarted.resolve(scripts)
      return fallbackLoad.promise
    }
  )

  try {
    const editor = createEditor({
      graph,
      loadFont: async (requestedFamily) => (requestedFamily === family ? faceLoad.promise : null),
      skipInitialGraphSetup: true
    })
    const started = Promise.withResolvers<number>()
    const completed = Promise.withResolvers<undefined>()
    editor.onEditorEvent('font:load-progress', (event) => {
      if (event.completed === 0) started.resolve(event.total)
      if (event.status === 'completed') completed.resolve(undefined)
    })

    await editor.switchPage(page.id)
    expect(await started.promise).toBe(2)
    faceLoad.resolve(new ArrayBuffer(8))
    const scripts = await fallbackStarted.promise
    expect(scripts).toHaveLength(2)
    fallbackLoad.resolve(Object.fromEntries(scripts.map((script) => [script, ['Test fallback']])))
    await completed.promise
  } finally {
    fallbackSpy.mockRestore()
  }
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

test('a superseded page operation is cancelled and cannot overwrite new progress', async () => {
  const graph = new SceneGraph()
  const stalePage = graph.getPages()[0]
  const currentPage = graph.addPage('Current font progress page')
  const staleFamily = pendingFontFamily('Stale progress page font')
  const currentFamily = pendingFontFamily('Current progress page font')
  textPage(graph, stalePage.id, staleFamily)
  textPage(graph, currentPage.id, currentFamily)
  const staleLoad = Promise.withResolvers<ArrayBuffer | null>()
  const currentLoad = Promise.withResolvers<ArrayBuffer | null>()
  const editor = createEditor({
    graph,
    loadFont: async (family) => (family === staleFamily ? staleLoad.promise : currentLoad.promise),
    skipInitialGraphSetup: true
  })
  const staleStarted = Promise.withResolvers<number>()
  const currentStarted = Promise.withResolvers<number>()
  const currentCompleted = Promise.withResolvers<undefined>()
  const events: Array<{
    operationId: number
    pageId: string
    completed: number
    status: string
  }> = []
  editor.onEditorEvent('font:load-progress', (event) => {
    events.push(event)
    if (event.pageId === stalePage.id && event.completed === 0)
      staleStarted.resolve(event.operationId)
    if (event.pageId === currentPage.id && event.completed === 0)
      currentStarted.resolve(event.operationId)
    if (event.pageId === currentPage.id && event.status === 'completed')
      currentCompleted.resolve(undefined)
  })

  await editor.switchPage(stalePage.id)
  const staleOperationId = await staleStarted.promise
  await editor.switchPage(currentPage.id)
  const currentOperationId = await currentStarted.promise
  expect(currentOperationId).toBeGreaterThan(staleOperationId)

  staleLoad.resolve(new ArrayBuffer(8))
  await flushBackgroundWork()
  expect(events.filter((event) => event.operationId === staleOperationId)).toEqual([
    {
      operationId: staleOperationId,
      pageId: stalePage.id,
      completed: 0,
      total: 1,
      failed: 0,
      status: 'loading'
    },
    {
      operationId: staleOperationId,
      pageId: stalePage.id,
      completed: 0,
      total: 1,
      failed: 0,
      status: 'cancelled'
    }
  ])
  expect(events.at(-1)).toMatchObject({
    operationId: currentOperationId,
    pageId: currentPage.id,
    status: 'loading'
  })

  currentLoad.resolve(new ArrayBuffer(8))
  await currentCompleted.promise
  expect(events.at(-1)).toMatchObject({
    operationId: currentOperationId,
    pageId: currentPage.id,
    completed: 1,
    status: 'completed'
  })
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
  const progressStarted = Promise.withResolvers<number>()
  const progress: Array<{ operationId: number; status: string }> = []
  editor.onEditorEvent('font:load-progress', (event) => {
    progress.push(event)
    if (event.status === 'loading') progressStarted.resolve(event.operationId)
  })
  const renderer = {
    clearDocumentCaches: mock(() => undefined),
    invalidateAllPictures: mock(() => undefined)
  }
  editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer as SkiaRenderer)
  let renders = 0
  editor.onEditorEvent('render:requested', () => renders++)

  await editor.switchPage(page.id)
  const operationId = await progressStarted.promise
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
  expect(progress).toEqual([
    { operationId, pageId: page.id, completed: 0, total: 1, failed: 0, status: 'loading' },
    { operationId, pageId: page.id, completed: 0, total: 1, failed: 0, status: 'cancelled' }
  ])
})
