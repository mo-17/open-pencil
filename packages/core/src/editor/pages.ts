import type { Color } from '@open-pencil/scene-graph/primitives'

import { populateLazyFigImportRoots } from '#core/kiwi/fig/lazy-import'
import { computeAllLayoutsAsync } from '#core/layout'
import { fontManager } from '#core/text/fonts'
import { collectGraphFontRequirements } from '#core/text/requirements'
import { missingGraphFontScripts } from '#core/text/resolved-requirements'

import { createPageViewportStore } from './page-viewports'
import type { EditorContext } from './types'

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
    const finishLoading = ctx.beginLoading({ releaseDocumentCaches: false })
    const isCurrentSwitch = () =>
      activeSwitch === switchController && !signal.aborted && ctx.state.currentPageId === pageId

    try {
      pageViewportStore.saveCurrentPageViewport()

      const previousPageId = ctx.state.currentPageId
      ctx.state.currentPageId = pageId
      ctx.state.enteredContainerId = null
      ctx.setSelectedIds(new Set())
      if (previousPageId !== pageId) ctx.emitEditorEvent('page:changed', pageId, previousPageId)

      pageViewportStore.restorePageViewport(pageId)
      populateLazyFigImportRoots(ctx.graph, [pageId])

      const childIds = ctx.graph.getChildren(pageId).map((node) => node.id)
      const toLoad = fontManager.collectFontKeys(ctx.graph, childIds)
      const requirements = collectGraphFontRequirements(ctx.graph, childIds)
      fontManager.blockNodesUntilFontsResolve(childIds)
      try {
        const results = await waitUnlessAborted(
          Promise.all(
            toLoad.map(([family, style]) => ctx.loadFont(family, style, requirements.characters))
          ),
          signal
        )
        const requiredFallbacks = missingGraphFontScripts(requirements)
        const fallbacks = await waitUnlessAborted(
          fontManager.ensureFallbackPack(requiredFallbacks, requirements.characters),
          signal
        )
        const facesReady = results.every((result) => result !== null)
        const fallbacksReady = requiredFallbacks.every(
          (script) => (fallbacks[script]?.length ?? 0) > 0
        )
        if (facesReady && fallbacksReady) {
          for (const node of requirements.nodes) if (node.type === 'TEXT') node.textPicture = null
        }
      } finally {
        fontManager.unblockNodes(childIds)
      }

      if (!isCurrentSwitch()) return
      for (const renderer of ctx.getRenderers()) renderer.invalidateAllPictures()
      await computeAllLayoutsAsync(ctx.graph, pageId, signal)
      if (isCurrentSwitch()) ctx.requestRender()
    } catch (error) {
      if (!signal.aborted) throw error
    } finally {
      if (activeSwitch === switchController) activeSwitch = null
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
