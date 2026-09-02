import { limitAsync } from 'es-toolkit/promise'

import type { Color } from '@open-pencil/scene-graph/primitives'

import { populateLazyFigImportRoots } from '#core/kiwi/fig/lazy-import'
import {
  canUseFigPopulationWorker,
  createFigPopulationWorker
} from '#core/kiwi/fig/population/client'
import { computeAllLayoutsAsync } from '#core/layout'
import { fontManager } from '#core/text/fonts'
import { collectGraphFontRequirements } from '#core/text/requirements'
import { missingGraphFontScripts } from '#core/text/resolved-requirements'

import { createPageViewportStore } from './page-viewports'
import type { EditorContext, FontLoadProgress } from './types'

const PAGE_FONT_BACKGROUND_DELAY_MS = 32

async function waitUnlessAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DOMException('Page switch was superseded', 'AbortError')
  let abort: () => void = () => undefined
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(new DOMException('Page switch was superseded', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

type GraphFontRequirements = ReturnType<typeof collectGraphFontRequirements>
type PageFontLoadResult = {
  attemptedFaces: Array<ArrayBuffer | null>
  requiredFallbacks: ReturnType<typeof missingGraphFontScripts>
  fallbacks?: Awaited<ReturnType<typeof fontManager.ensureFallbackPack>>
  generation: number
  cjkFallbackFamilies: string[]
  arabicFallbackFamilies: string[]
}

interface PageFontProgressReporter {
  start(total: number): void
  settle(failed: boolean): void
}

interface ActiveFontLoadProgress {
  controller: AbortController
  operationId: number
  pageId: string
  completed: number
  total: number
  failed: number
  status: FontLoadProgress['status']
}

async function loadPageFontsInBackground(
  ctx: EditorContext,
  fontKeys: ReturnType<typeof fontManager.collectFontKeys>,
  requirements: GraphFontRequirements,
  signal: AbortSignal,
  progress: PageFontProgressReporter
): Promise<PageFontLoadResult> {
  const requiredCharacters = Array.from(requirements.characters)
  const attemptedFontKeys = fontKeys.filter(
    ([family, style]) =>
      !fontManager.isStyleLoaded(family, style) ||
      fontManager.remoteStyleNeedsCoverage(family, style, requiredCharacters)
  )
  const before = {
    generation: fontManager.generation(),
    cjkFallbackFamilies: [...fontManager.getCJKFallbackFamilies()],
    arabicFallbackFamilies: [...fontManager.getArabicFallbackFamilies()]
  }
  const evaluatesFallbacks = requirements.scripts.length > 0
  progress.start(attemptedFontKeys.length + (evaluatesFallbacks ? 1 : 0))

  const attemptedFaces = await Promise.all(
    attemptedFontKeys.map(async ([family, style]) => {
      let face: ArrayBuffer | null
      try {
        face = await ctx.loadFont(family, style, requirements.characters, { signal })
      } catch {
        face = null
      }
      progress.settle(face === null)
      return face
    })
  )
  if (signal.aborted) throw new DOMException('Page switch was superseded', 'AbortError')

  // Coverage for an unregistered authored face is intentionally treated as unknown. Re-evaluate
  // only after those faces settle so a face such as Bebas Neue can reveal its missing CJK glyphs
  // before the progress operation is allowed to complete.
  const requiredFallbacks = missingGraphFontScripts(requirements)
  let fallbacks: PageFontLoadResult['fallbacks']
  if (evaluatesFallbacks) {
    if (requiredFallbacks.length === 0) {
      progress.settle(false)
    } else {
      try {
        fallbacks = await fontManager.ensureFallbackPack(
          requiredFallbacks,
          requirements.characters,
          { signal }
        )
        progress.settle(
          requiredFallbacks.some((script) => (fallbacks?.[script]?.length ?? 0) === 0)
        )
      } catch {
        progress.settle(true)
      }
    }
  }

  return {
    ...before,
    attemptedFaces,
    requiredFallbacks,
    fallbacks
  }
}

function arraysEqual(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index])
}

function pageFontStateChanged(before: PageFontLoadResult): boolean {
  return (
    before.attemptedFaces.some((face) => face !== null) ||
    fontManager.generation() !== before.generation ||
    !arraysEqual(before.cjkFallbackFamilies, fontManager.getCJKFallbackFamilies()) ||
    !arraysEqual(before.arabicFallbackFamilies, fontManager.getArabicFallbackFamilies())
  )
}

function pageFontRequirementsResolved(result: PageFontLoadResult): boolean {
  return (
    result.attemptedFaces.every((face) => face !== null) &&
    result.requiredFallbacks.every((script) => (result.fallbacks?.[script]?.length ?? 0) > 0)
  )
}

function clearTextPictures(requirements: GraphFontRequirements): void {
  for (const node of requirements.nodes) if (node.type === 'TEXT') node.textPicture = null
}

export interface PageSwitchProgress {
  phase: 'populating-page' | 'resolving-fonts' | 'resolving-fallbacks' | 'layout'
  detail?: string
  completed?: number
  total?: number
}

export interface PreparePageOptions {
  onProgress?: (progress: PageSwitchProgress) => void
  signal?: AbortSignal
}

export interface PreparedPage {
  pageId: string
  generation: number
}

export type SwitchPageOptions = PreparePageOptions

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}

const MAX_CONCURRENT_FONT_LOADS = 4
export function createPageActions(ctx: EditorContext) {
  const pageViewportStore = createPageViewportStore(ctx)
  let activeSwitch: AbortController | null = null
  let activeFontProgress: ActiveFontLoadProgress | null = null
  let nextFontOperationId = 0
  let populationWorkerInstance: ReturnType<typeof createFigPopulationWorker> | undefined
  let populationWorkerGeneration = 0
  let pageSwitchGeneration = 0

  function emitFontProgress(progress: ActiveFontLoadProgress): void {
    const { operationId, pageId, completed, total, failed, status } = progress
    ctx.emitEditorEvent('font:load-progress', {
      operationId,
      pageId,
      completed,
      total,
      failed,
      status
    })
  }

  function cancelFontProgress(controller: AbortController): void {
    const progress = activeFontProgress
    if (progress?.controller !== controller || progress.status !== 'loading') return
    progress.status = 'cancelled'
    activeFontProgress = null
    emitFontProgress(progress)
  }

  function createFontProgressReporter(
    controller: AbortController,
    pageId: string,
    isCurrentSwitch: () => boolean
  ): PageFontProgressReporter {
    let operation: ActiveFontLoadProgress | null = null

    return {
      start(total) {
        if (total <= 0 || !isCurrentSwitch()) return
        operation = {
          controller,
          operationId: ++nextFontOperationId,
          pageId,
          completed: 0,
          total,
          failed: 0,
          status: 'loading'
        }
        activeFontProgress = operation
        emitFontProgress(operation)
      },
      settle(failed) {
        const current = operation
        if (current?.status !== 'loading' || activeFontProgress !== current || !isCurrentSwitch())
          return
        current.completed++
        if (failed) current.failed++
        if (current.completed === current.total) {
          current.status = 'completed'
          activeFontProgress = null
        }
        emitFontProgress(current)
      }
    }
  }

  function cancelPendingSwitch() {
    const controller = activeSwitch
    if (!controller) return
    cancelFontProgress(controller)
    controller.abort()
    activeSwitch = null
  }

  function populationWorker() {
    if (!canUseFigPopulationWorker(ctx.graph)) return null
    populationWorkerInstance ??= createFigPopulationWorker(ctx.graph)
    return populationWorkerInstance
  }

  async function switchPageLegacy(pageId: string) {
    const page = ctx.graph.getNode(pageId)
    if (page?.type !== 'CANVAS') return
    const switchGeneration = ++pageSwitchGeneration

    cancelPendingSwitch()
    const switchController = new AbortController()
    activeSwitch = switchController
    const { signal } = switchController
    const switchGraph = ctx.graph
    const finishLoading = ctx.beginLoading({ releaseDocumentCaches: false })
    const isCurrentSwitch = () =>
      activeSwitch === switchController &&
      !signal.aborted &&
      ctx.graph === switchGraph &&
      ctx.graph.getNode(pageId) === page &&
      ctx.state.currentPageId === pageId
    let backgroundOwnsSwitch = false

    try {
      pageViewportStore.saveCurrentPageViewport()

      const previousPageId = ctx.state.currentPageId
      ctx.state.currentPageId = pageId
      ctx.state.enteredContainerId = null
      ctx.setSelectedIds(new Set())
      if (previousPageId !== pageId) ctx.emitEditorEvent('page:changed', pageId, previousPageId)

      pageViewportStore.restorePageViewport(pageId)
      const worker = populationWorker()
      const workerGeneration = populationWorkerGeneration
      const workerResult = worker ? await worker.populate(pageId) : null
      if (
        workerGeneration !== populationWorkerGeneration ||
        switchGeneration !== pageSwitchGeneration ||
        !isCurrentSwitch()
      ) {
        return
      }
      if (workerResult === null) {
        worker?.terminate()
        populationWorkerInstance = undefined
        populateLazyFigImportRoots(switchGraph, [pageId])
      }

      const childIds = switchGraph.getChildren(pageId).map((node) => node.id)
      const toLoad = fontManager.collectFontKeys(switchGraph, childIds)
      const requirements = collectGraphFontRequirements(switchGraph, childIds)

      if (!isCurrentSwitch()) return
      for (const renderer of ctx.getRenderers()) renderer.invalidateAllPictures()
      // A .fig archive already carries Figma's resolved geometry. Re-running Yoga here is both
      // redundant and harmful: fallback font metrics can move imported nodes before their exact
      // faces are ready, while hundreds of reactive graph writes stall the editor shell.
      if (page.source.format !== 'fig') await computeAllLayoutsAsync(switchGraph, pageId, signal)
      if (!isCurrentSwitch()) return
      ctx.requestRender()

      backgroundOwnsSwitch = true
      void (async () => {
        try {
          // Cooperative layout yields to microtasks. Starting font work before it completes lets a
          // large CanvasKit registration run inside the opening/loading window even when it is not
          // awaited. Give the usable fallback frame two 60 Hz frame intervals to present first.
          await waitUnlessAborted(
            new Promise<void>((resolve) => {
              setTimeout(resolve, PAGE_FONT_BACKGROUND_DELAY_MS)
            }),
            signal
          )
          const result = await waitUnlessAborted(
            loadPageFontsInBackground(
              ctx,
              toLoad,
              requirements,
              signal,
              createFontProgressReporter(switchController, pageId, isCurrentSwitch)
            ),
            signal
          )
          if (!pageFontStateChanged(result) || !isCurrentSwitch()) return

          if (pageFontRequirementsResolved(result)) clearTextPictures(requirements)
          if (page.source.format !== 'fig')
            await computeAllLayoutsAsync(switchGraph, pageId, signal)
          if (!isCurrentSwitch()) return

          for (const renderer of ctx.getRenderers()) renderer.invalidateAllPictures()
          ctx.requestRender()
        } finally {
          if (activeSwitch === switchController) activeSwitch = null
        }
      })().catch(() => undefined)
    } catch (error) {
      if (!signal.aborted) throw error
    } finally {
      if (!backgroundOwnsSwitch && activeSwitch === switchController) activeSwitch = null
      finishLoading()
    }
  }

  async function populatePage(
    pageId: string,
    switchGeneration: number,
    signal?: AbortSignal
  ): Promise<boolean | null> {
    throwIfAborted(signal)
    const worker = populationWorker()
    const workerGeneration = populationWorkerGeneration
    const workerResult = worker ? await worker.populate(pageId, signal) : null
    throwIfAborted(signal)
    if (
      workerGeneration !== populationWorkerGeneration ||
      switchGeneration !== pageSwitchGeneration
    ) {
      return null
    }
    if (workerResult !== null) return workerResult
    worker?.terminate()
    populationWorkerInstance = undefined
    return populateLazyFigImportRoots(ctx.graph, [pageId])
  }

  async function resolvePageFonts(
    pageId: string,
    pageName: string,
    options: PreparePageOptions
  ): Promise<void> {
    const childIds = ctx.graph.getChildren(pageId).map((node) => node.id)
    const toLoad = fontManager.collectFontKeys(ctx.graph, childIds)
    const requirements = collectGraphFontRequirements(ctx.graph, childIds)
    options.onProgress?.({
      phase: 'resolving-fonts',
      detail: pageName,
      completed: 0,
      total: toLoad.length
    })
    fontManager.blockNodesUntilFontsResolve(childIds)
    try {
      let completedFaces = 0
      const loadFace = limitAsync(async ([family, style]: [string, string]) => {
        throwIfAborted(options.signal)
        const result = await ctx.loadFont(family, style, requirements.characters, {
          signal: options.signal
        })
        throwIfAborted(options.signal)
        completedFaces++
        options.onProgress?.({
          phase: 'resolving-fonts',
          detail: `${family} ${style}`,
          completed: completedFaces,
          total: toLoad.length
        })
        return result
      }, MAX_CONCURRENT_FONT_LOADS)
      const results = await Promise.all(toLoad.map(loadFace))
      throwIfAborted(options.signal)
      const requiredFallbacks = missingGraphFontScripts(requirements)
      options.onProgress?.({
        phase: 'resolving-fallbacks',
        detail: pageName,
        completed: 0,
        total: requiredFallbacks.length
      })
      const fallbacks = await fontManager.ensureFallbackPack(
        requiredFallbacks,
        requirements.characters,
        { signal: options.signal }
      )
      throwIfAborted(options.signal)
      options.onProgress?.({
        phase: 'resolving-fallbacks',
        detail: pageName,
        completed: requiredFallbacks.length,
        total: requiredFallbacks.length
      })
      const facesReady = results.every((result) => result !== null)
      const fallbacksReady = requiredFallbacks.every(
        (script) => (fallbacks[script]?.length ?? 0) > 0
      )
      if (facesReady && fallbacksReady) {
        for (const node of requirements.nodes) if (node.type === 'TEXT') node.textPicture = null
      }
    } finally {
      fontManager.unblockNodes(childIds)
      for (const renderer of ctx.getRenderers()) renderer.invalidateAllPictures()
    }
  }

  async function preparePage(
    pageId: string,
    options: PreparePageOptions = {}
  ): Promise<PreparedPage | null> {
    const page = ctx.graph.getNode(pageId)
    if (page?.type !== 'CANVAS') return null
    throwIfAborted(options.signal)
    cancelPendingSwitch()
    const switchController = new AbortController()
    const forwardAbort = () => switchController.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', forwardAbort, { once: true })
    if (options.signal?.aborted) forwardAbort()
    activeSwitch = switchController
    const signal = switchController.signal
    const generation = ++pageSwitchGeneration
    const switchGraph = ctx.graph
    const prepareOptions = { ...options, signal }

    try {
      prepareOptions.onProgress?.({ phase: 'populating-page', detail: page.name })
      const populated = await populatePage(pageId, generation, signal)
      if (
        populated === null ||
        generation !== pageSwitchGeneration ||
        ctx.graph !== switchGraph ||
        signal.aborted
      ) {
        return null
      }

      await resolvePageFonts(pageId, page.name, prepareOptions)
      throwIfAborted(signal)
      if (generation !== pageSwitchGeneration || ctx.graph !== switchGraph) return null
      if (page.source.format !== 'fig' && (ctx.getRenderer() || populated)) {
        prepareOptions.onProgress?.({ phase: 'layout', detail: page.name })
        await computeAllLayoutsAsync(switchGraph, pageId, signal)
      }
      throwIfAborted(signal)
      return generation === pageSwitchGeneration && ctx.graph === switchGraph
        ? { pageId, generation }
        : null
    } finally {
      options.signal?.removeEventListener('abort', forwardAbort)
      if (activeSwitch === switchController) activeSwitch = null
    }
  }

  function commitPageSwitch(prepared: PreparedPage): boolean {
    if (prepared.generation !== pageSwitchGeneration) return false
    const page = ctx.graph.getNode(prepared.pageId)
    if (page?.type !== 'CANVAS') return false

    pageViewportStore.saveCurrentPageViewport()
    const previousPageId = ctx.state.currentPageId
    ctx.state.currentPageId = prepared.pageId
    ctx.state.enteredContainerId = null
    ctx.setSelectedIds(new Set())
    pageViewportStore.restorePageViewport(prepared.pageId)
    if (previousPageId !== prepared.pageId) {
      ctx.emitEditorEvent('page:changed', prepared.pageId, previousPageId)
    }
    ctx.requestRender()
    return true
  }

  async function switchPage(pageId: string, options: SwitchPageOptions = {}): Promise<void> {
    if (!options.signal && !options.onProgress) return switchPageLegacy(pageId)
    const prepared = await preparePage(pageId, options)
    if (prepared) commitPageSwitch(prepared)
  }

  function clearPageViewports() {
    populationWorkerGeneration++
    pageSwitchGeneration++
    cancelPendingSwitch()
    populationWorkerInstance?.terminate()
    populationWorkerInstance = undefined
    pageViewportStore.clearPageViewports()
  }

  function addPage(name?: string) {
    const pages = ctx.graph.getPages()
    const pageName = name ?? `Page ${pages.length + 1}`
    const page = ctx.graph.addPage(pageName)
    void switchPage(page.id)
    return page.id
  }

  function deletePage(pageId: string) {
    const pages = ctx.graph.getPages()
    if (pages.length <= 1) return
    const idx = pages.findIndex((p) => p.id === pageId)
    ctx.graph.deleteNode(pageId)
    pageViewportStore.deletePageViewport(pageId)
    if (ctx.state.currentPageId === pageId) {
      const newIdx = Math.min(idx, pages.length - 2)
      const remaining = ctx.graph.getPages()
      void switchPage(remaining[newIdx].id)
    }
  }

  function movePage(pageId: string, index: number) {
    const pages = ctx.graph.getPages()
    const currentIndex = pages.findIndex((page) => page.id === pageId)
    if (currentIndex === -1) return

    const nextIndex = Math.max(0, Math.min(index, pages.length - 1))
    if (nextIndex === currentIndex) return

    ctx.graph.insertChildAt(pageId, ctx.graph.rootId, nextIndex)
  }

  function renamePage(pageId: string, name: string) {
    ctx.graph.updateNode(pageId, { name })
  }

  function setPageColor(color: Color) {
    ctx.state.pageColor = color
    ctx.requestRender()
  }

  return {
    preparePage,
    commitPageSwitch,
    switchPage,
    addPage,
    deletePage,
    movePage,
    renamePage,
    setPageColor,
    cancelPendingSwitch,
    clearPageViewports
  }
}
