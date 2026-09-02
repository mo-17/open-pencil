import { computed, ref } from 'vue'

import { computeAllLayouts } from '@open-pencil/core/layout'
import {
  collectGraphFontRequirements,
  documentFontStatus,
  fontCandidateCoverageText,
  fontFaceDemand,
  fontManager,
  fontResolver,
  type DocumentFontFaceStatus,
  type FontResolutionDemand
} from '@open-pencil/core/text'
import type { SceneGraph } from '@open-pencil/scene-graph'
import { useEditorEvent } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  loadFont,
  requestLocalFontAccess,
  resetBrowserWebFontFetchSession
} from '@/app/editor/fonts'

export interface DocumentFontRetryActions {
  clearFontLoadFailure(family: string, style: string, characters: string): void
  resetDemand(demand: FontResolutionDemand): void
  load(
    family: string,
    style: string,
    characters: string,
    signal?: AbortSignal
  ): Promise<ArrayBuffer | null>
}

export interface DocumentFontRetryBatchActions extends DocumentFontRetryActions {
  resetWebFontFetchSession(): void
}

const defaultRetryActions: DocumentFontRetryActions = {
  clearFontLoadFailure: (family, style, characters) =>
    fontManager.clearFontLoadFailure(family, style, characters),
  resetDemand: (demand) => fontResolver.reset(demand),
  load: (family, style, characters, signal) => loadFont(family, style, characters, signal)
}

const defaultRetryBatchActions: DocumentFontRetryBatchActions = {
  ...defaultRetryActions,
  resetWebFontFetchSession: resetBrowserWebFontFetchSession
}

export async function retryDocumentFontIssue(
  graph: SceneGraph,
  issue: Pick<DocumentFontFaceStatus, 'family' | 'style' | 'nodeIds'>,
  actions: DocumentFontRetryActions = defaultRetryActions,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  const characters = collectGraphFontRequirements(graph, issue.nodeIds).characters
  const demand = fontFaceDemand(issue.family, issue.style, characters)
  for (const candidate of demand.candidates) {
    if (candidate.source !== 'remote') continue
    actions.clearFontLoadFailure(
      candidate.family,
      candidate.style,
      fontCandidateCoverageText(demand, candidate)
    )
  }
  actions.resetDemand(demand)
  await actions.load(issue.family, issue.style, characters, signal)
}

export async function retryDocumentFontIssues(
  graph: SceneGraph,
  issues: ReadonlyArray<Pick<DocumentFontFaceStatus, 'family' | 'style' | 'nodeIds'>>,
  actions: DocumentFontRetryBatchActions = defaultRetryBatchActions,
  signal?: AbortSignal
): Promise<void> {
  if (issues.length === 0) return
  signal?.throwIfAborted()
  actions.resetWebFontFetchSession()
  await Promise.all(
    issues.map((issue) => retryDocumentFontIssue(graph, issue, actions, signal))
  )
}

export function useDocumentFontStatus() {
  const editor = useEditorStore()
  const revision = ref(0)
  const retrying = ref(false)

  const refresh = () => {
    revision.value++
  }

  useEditorEvent('font:resolution-changed', refresh)
  useEditorEvent('font:load-progress', (progress) => {
    // Page opening loads exact faces through EditorContext.loadFont rather than FontResolver.
    // Refresh once that background batch settles so a banner computed during graph replacement
    // cannot keep reporting faces that CanvasKit has already registered.
    if (progress.status !== 'loading') refresh()
  })
  useEditorEvent('graph:replaced', refresh)
  useEditorEvent('page:changed', refresh)
  useEditorEvent('node:created', refresh)
  useEditorEvent('node:updated', refresh)
  useEditorEvent('node:deleted', refresh)

  const status = computed(() => {
    void revision.value
    return documentFontStatus(editor.graph, editor.state.currentPageId)
  })

  async function retry() {
    if (retrying.value) return
    retrying.value = true
    const preparation = editor.preparationController.begin({ kind: 'font-retry' })
    let succeeded = false
    try {
      if (fontManager.localAccessState() === 'prompt') {
        await requestLocalFontAccess().catch(() => [])
      }
      const issues = status.value.issues
      await retryDocumentFontIssues(
        editor.graph,
        issues,
        defaultRetryBatchActions,
        preparation.signal
      )
      preparation.signal.throwIfAborted()
      editor.renderer?.invalidateAllPictures()
      computeAllLayouts(editor.graph, editor.state.currentPageId)
      preparation.update({ phase: 'preparing-render' })
      editor.requestRender()
      if (editor.renderer) {
        await editor.preparationController.waitForPresentation(
          preparation.id,
          editor.state.sceneVersion
        )
      }
      refresh()
      succeeded = true
    } catch (error) {
      if (!preparation.signal.aborted) {
        preparation.fail({
          code: 'font-failed',
          message: error instanceof Error ? error.message : String(error),
          retryable: true
        })
      }
    } finally {
      if (succeeded) preparation.complete()
      retrying.value = false
    }
  }

  function selectAffectedNodes() {
    editor.select(status.value.issues.flatMap((issue) => issue.nodeIds))
  }

  return { status, retrying, retry, selectAffectedNodes }
}
