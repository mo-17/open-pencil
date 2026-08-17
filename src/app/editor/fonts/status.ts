import { computed, ref } from 'vue'

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
import { useEditor, useEditorEvent } from '@open-pencil/vue'

import {
  loadFont,
  requestLocalFontAccess,
  resetBrowserWebFontFetchSession
} from '@/app/editor/fonts'

export interface DocumentFontRetryActions {
  clearFontLoadFailure(family: string, style: string, characters: string): void
  resetDemand(demand: FontResolutionDemand): void
  load(family: string, style: string, characters: string): Promise<ArrayBuffer | null>
}

export interface DocumentFontRetryBatchActions extends DocumentFontRetryActions {
  resetWebFontFetchSession(): void
}

const defaultRetryActions: DocumentFontRetryActions = {
  clearFontLoadFailure: (family, style, characters) =>
    fontManager.clearFontLoadFailure(family, style, characters),
  resetDemand: (demand) => fontResolver.reset(demand),
  load: (family, style, characters) => loadFont(family, style, characters)
}

const defaultRetryBatchActions: DocumentFontRetryBatchActions = {
  ...defaultRetryActions,
  resetWebFontFetchSession: resetBrowserWebFontFetchSession
}

export async function retryDocumentFontIssue(
  graph: SceneGraph,
  issue: Pick<DocumentFontFaceStatus, 'family' | 'style' | 'nodeIds'>,
  actions: DocumentFontRetryActions = defaultRetryActions
): Promise<void> {
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
  await actions.load(issue.family, issue.style, characters)
}

export async function retryDocumentFontIssues(
  graph: SceneGraph,
  issues: ReadonlyArray<Pick<DocumentFontFaceStatus, 'family' | 'style' | 'nodeIds'>>,
  actions: DocumentFontRetryBatchActions = defaultRetryBatchActions
): Promise<void> {
  if (issues.length === 0) return
  actions.resetWebFontFetchSession()
  await Promise.all(issues.map((issue) => retryDocumentFontIssue(graph, issue, actions)))
}

export function useDocumentFontStatus() {
  const editor = useEditor()
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
    try {
      if (fontManager.localAccessState() === 'prompt') {
        await requestLocalFontAccess().catch(() => [])
      }
      const issues = status.value.issues
      await retryDocumentFontIssues(editor.graph, issues)
      editor.requestRender()
      refresh()
    } finally {
      retrying.value = false
    }
  }

  function selectAffectedNodes() {
    editor.select(status.value.issues.flatMap((issue) => issue.nodeIds))
  }

  return { status, retrying, retry, selectAffectedNodes }
}
