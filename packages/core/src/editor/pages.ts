import type { Color } from '@open-pencil/scene-graph/primitives'

import { populateLazyFigImportRoots } from '#core/kiwi/fig/lazy-import'
import { computeAllLayoutsAsync } from '#core/layout'
import { fontManager } from '#core/text/fonts'
import { collectGraphFontRequirements } from '#core/text/requirements'
import { missingGraphFontScripts } from '#core/text/resolved-requirements'

import { createPageViewportStore } from './page-viewports'
import type { EditorContext } from './types'

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

function loadPageFontsInBackground(
  ctx: EditorContext,
  fontKeys: ReturnType<typeof fontManager.collectFontKeys>,
  requirements: GraphFontRequirements,
  signal: AbortSignal
): Promise<PageFontLoadResult> {
  const requiredFallbacks = missingGraphFontScripts(requirements)
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
  return Promise.all([
    Promise.all(
      attemptedFontKeys.map(([family, style]) =>
        Promise.resolve()
          .then(() => ctx.loadFont(family, style, requirements.characters, { signal }))
          .catch(() => null)
      )
    ),
    fontManager
      .ensureFallbackPack(requiredFallbacks, requirements.characters, { signal })
      .catch(() => undefined)
  ]).then(([attemptedFaces, fallbacks]) => ({
    ...before,
    attemptedFaces,
    requiredFallbacks,
    fallbacks
  }))
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

export function createPageActions(ctx: EditorContext) {
  const pageViewportStore = createPageViewportStore(ctx)
  let activeSwitch: AbortController | null = null

  async function switchPage(pageId: string) {
    const page = ctx.graph.getNode(pageId)
    if (page?.type !== 'CANVAS') return

    activeSwitch?.abort()
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
      populateLazyFigImportRoots(switchGraph, [pageId])

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
            loadPageFontsInBackground(ctx, toLoad, requirements, signal),
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

  function cancelPendingSwitch() {
    activeSwitch?.abort()
    activeSwitch = null
  }

  return {
    switchPage,
    addPage,
    deletePage,
    movePage,
    renamePage,
    setPageColor,
    cancelPendingSwitch,
    clearPageViewports: pageViewportStore.clearPageViewports
  }
}
