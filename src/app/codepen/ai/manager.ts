import {
  createAIShadowDraftWorkspace,
  forkAIShadowDraftWorkspace,
  sealAIShadowDraft,
  type AIShadowCommitResult,
  type AIShadowDraftWorkspace
} from '@open-pencil/core/ai-draft'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import { CORE_TOOLS } from '@open-pencil/core/tools'

import type { EditorStore } from '@/app/editor/session'

import { parseCodePenURL, type CodePenStaticEvidence } from '../contracts'
import { loadCodePenStaticEvidenceFromTauri } from '../tauri'
import {
  codePenCommitFailure as commitFailure,
  codePenDocumentIdentity as documentIdentity,
  codePenSealedSummary as sealedSummary,
  createCodePenDraftID as draftID,
  finiteCodePenCoordinate as finiteCoordinate,
  throwIfCodePenOperationAborted as throwIfAborted,
  validateCodePenDigest as validateDigest,
  validateCodePenID as validateID
} from './authority'
import {
  CODEPEN_AI_LIMITS,
  type CommitCodePenShadowDraftInput,
  type CodePenAIAnalyzeResult,
  type CodePenAIDocumentBinding,
  type CodePenAIDraftRecord,
  type CodePenAIEvidenceRecord,
  type CodePenAIEvidenceSummary,
  type CodePenAIManager,
  type CodePenAIManagerOptions,
  type CodePenAIRenderResult,
  type CodePenAISealedDraftReview,
  type CodePenAISealedDraftSummary,
  type RenderCodePenShadowDraftInput,
  type SealCodePenShadowDraftInput
} from './contracts'
import { normalizeCodePenAIEvidence, summarizeCodePenEvidence } from './evidence'
import { validateSafeCodePenShadowJSX } from './safe-jsx'
import { assertKnownCodePenTextTokens, substituteCodePenEvidenceText } from './text-substitution'
import { createCodePenAIVisualOutlineBundle } from './visual-outline'

const renderTool = (() => {
  const candidate = CORE_TOOLS.find((tool) => tool.name === 'render')
  if (!candidate) throw new Error('The core render tool is unavailable')
  return candidate
})()

export function createCodePenAIManager(
  store: EditorStore,
  options: CodePenAIManagerOptions = {}
): CodePenAIManager {
  const evidence = new Map<string, CodePenAIEvidenceRecord>()
  const drafts = new Map<string, CodePenAIDraftRecord>()
  const listeners = new Set<() => void>()
  let sourceEpoch = 0
  let lifecycleEpoch = 0
  let disposed = false
  let queuedOperations = 0
  let tail: Promise<void> = Promise.resolve()

  const unbindSource = store.onSourceChanged(() => {
    sourceEpoch++
    evidence.clear()
    drafts.clear()
    notify()
  })
  const unbindRevision = store.onEditorEvent('render:requested', () => {
    pruneStaleState()
  })

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        console.warn('[CodePen AI] Listener failed:', error)
      }
    }
  }

  function currentBinding(): CodePenAIDocumentBinding {
    return Object.freeze({
      graph: store.graph,
      sourceEpoch,
      identity: documentIdentity(store)
    })
  }

  function documentBindingMatches(binding: CodePenAIDocumentBinding): boolean {
    return binding.sourceEpoch === sourceEpoch && binding.identity === documentIdentity(store)
  }

  function assertManagerActive(epoch = lifecycleEpoch): void {
    if (disposed || epoch !== lifecycleEpoch) {
      throw new Error('CodePen AI manager is disposed')
    }
  }

  function draftBindingMatches(binding: CodePenAIDocumentBinding): boolean {
    return binding.graph === store.graph && documentBindingMatches(binding)
  }

  function assertDocumentBinding(binding: CodePenAIDocumentBinding): void {
    assertManagerActive()
    if (!documentBindingMatches(binding)) {
      throw new Error('The live document identity changed; CodePen AI state was invalidated')
    }
  }

  function assertDraftBinding(binding: CodePenAIDocumentBinding): void {
    assertDocumentBinding(binding)
    if (binding.graph !== store.graph) {
      throw new Error('The live document graph changed; CodePen AI shadow drafts were invalidated')
    }
  }

  function pruneStaleState(): Readonly<{ evidence: number; drafts: number }> {
    let evidenceRemoved = 0
    let draftsRemoved = 0
    for (const [digest, record] of evidence) {
      if (documentBindingMatches(record.binding)) continue
      evidence.delete(digest)
      evidenceRemoved++
    }
    for (const [draftId, record] of drafts) {
      const valid =
        evidence.has(record.evidenceDigest) &&
        draftBindingMatches(record.binding) &&
        record.workspace.expectedRevision === store.state.sceneVersion
      if (valid) continue
      drafts.delete(draftId)
      draftsRemoved++
    }
    if (evidenceRemoved > 0 || draftsRemoved > 0) notify()
    return Object.freeze({ evidence: evidenceRemoved, drafts: draftsRemoved })
  }

  function pruneStaleDrafts(): number {
    return pruneStaleState().drafts
  }

  function exclusive<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (disposed) return Promise.reject(new Error('CodePen AI manager is disposed'))
    if (queuedOperations >= CODEPEN_AI_LIMITS.maxQueuedOperations) {
      return Promise.reject(new Error('Too many queued CodePen AI operations'))
    }
    queuedOperations++
    const operationEpoch = lifecycleEpoch
    const previous = tail
    let release!: () => void
    tail = new Promise<void>((resolve) => {
      release = resolve
    })
    return (async () => {
      try {
        await previous
        assertManagerActive(operationEpoch)
        throwIfAborted(signal)
        const result = await operation()
        assertManagerActive(operationEpoch)
        return result
      } finally {
        queuedOperations--
        release()
      }
    })()
  }

  function requireEvidence(digest: string): CodePenAIEvidenceRecord {
    const record = evidence.get(validateDigest(digest))
    if (!record) throw new Error('CodePen evidence is not registered for this document')
    assertDocumentBinding(record.binding)
    return record
  }

  function requireDraft(input: SealCodePenShadowDraftInput): CodePenAIDraftRecord {
    const id = validateID(input.draftId, 'draftId')
    const digest = validateDigest(input.evidenceDigest)
    const record = drafts.get(id)
    if (!record || record.evidenceDigest !== digest) {
      throw new Error('CodePen shadow draft does not match the exact evidence digest')
    }
    assertDraftBinding(record.binding)
    requireEvidence(digest)
    if (store.state.sceneVersion !== record.workspace.expectedRevision) {
      throw new Error('The live document changed after the shadow draft began')
    }
    return record
  }

  async function storeEvidence(
    candidate: CodePenStaticEvidence,
    binding: CodePenAIDocumentBinding
  ): Promise<CodePenAIEvidenceSummary> {
    const normalized = await normalizeCodePenAIEvidence(candidate)
    assertDocumentBinding(binding)
    pruneStaleState()
    const digest = normalized.integrity.digest
    const existing = evidence.get(digest)
    if (!existing && evidence.size >= CODEPEN_AI_LIMITS.maxEvidenceEntries) {
      const evictable = [...evidence.keys()].find(
        (entryDigest) => ![...drafts.values()].some((draft) => draft.evidenceDigest === entryDigest)
      )
      if (!evictable)
        throw new Error('CodePen evidence limit reached; discard a shadow draft first')
      evidence.delete(evictable)
    }
    const visualOutline = createCodePenAIVisualOutlineBundle({
      html: normalized.payload.sources.html.text,
      css: normalized.payload.sources.css.text,
      js: normalized.payload.sources.js.text
    })
    const summary = summarizeCodePenEvidence(normalized, visualOutline.outline)
    evidence.delete(digest)
    evidence.set(digest, Object.freeze({ evidence: normalized, summary, visualOutline, binding }))
    notify()
    return summary
  }

  function listRegisteredEvidence(): readonly CodePenAIEvidenceSummary[] {
    pruneStaleState()
    return Object.freeze([...evidence.values()].map((record) => record.summary))
  }

  async function analyze(url?: string, signal?: AbortSignal): Promise<CodePenAIAnalyzeResult> {
    return exclusive(async () => {
      const binding = currentBinding()
      if (url === undefined || url === '') {
        return Object.freeze({ evidence: null, registeredEvidence: listRegisteredEvidence() })
      }
      if (typeof url !== 'string') throw new TypeError('CodePen URL must be text')
      const requestedPen = parseCodePenURL(url)
      const load =
        options.loadEvidence ??
        ((value: string) => loadCodePenStaticEvidenceFromTauri(value, options.tauriInvoker))
      const loaded = await load(requestedPen.url, signal)
      throwIfAborted(signal)
      if (loaded.payload.pen.url !== requestedPen.url) {
        throw new Error('Loaded CodePen evidence does not match the requested canonical Pen')
      }
      const summary = await storeEvidence(loaded, binding)
      return Object.freeze({ evidence: summary, registeredEvidence: listRegisteredEvidence() })
    }, signal)
  }

  async function registerEvidence(
    candidate: CodePenStaticEvidence
  ): Promise<CodePenAIEvidenceSummary> {
    return exclusive(() => storeEvidence(candidate, currentBinding()))
  }

  async function createShadowDraft(
    evidenceDigest: string,
    signal?: AbortSignal
  ): Promise<Readonly<{ draftId: string; evidenceDigest: string; expectedRevision: number }>> {
    return exclusive(async () => {
      pruneStaleState()
      const evidenceRecord = requireEvidence(evidenceDigest)
      if (drafts.size >= CODEPEN_AI_LIMITS.maxShadowDrafts) {
        throw new Error('CodePen shadow draft limit reached; discard an existing draft first')
      }
      const binding = currentBinding()
      assertDocumentBinding(evidenceRecord.binding)
      const expectedRevision = store.state.sceneVersion
      const workspace = await createAIShadowDraftWorkspace({
        graph: store.graph,
        pageId: store.state.currentPageId,
        expectedRevision,
        limits: CODEPEN_AI_LIMITS.shadowDraft
      })
      throwIfAborted(signal)
      assertDraftBinding(binding)
      if (store.state.sceneVersion !== expectedRevision) {
        throw new Error('The live document changed while creating the shadow draft')
      }
      const draftId = draftID()
      drafts.set(draftId, {
        draftId,
        evidenceDigest,
        binding,
        workspace,
        renderOperations: 0,
        state: 'open'
      })
      notify()
      return Object.freeze({ draftId, evidenceDigest, expectedRevision })
    }, signal)
  }

  function validateRenderPlacement(
    record: CodePenAIDraftRecord,
    input: RenderCodePenShadowDraftInput
  ): Readonly<{ parentId: string; replaceId?: string; x?: number; y?: number }> {
    const graph = record.workspace.graph
    const parentId = input.parentId
      ? validateID(input.parentId, 'parentId')
      : record.workspace.pageId
    const parent = graph.getNode(parentId)
    if (
      !parent ||
      (parentId !== record.workspace.pageId &&
        graph.getPageId(parentId) !== record.workspace.pageId)
    ) {
      throw new Error('Shadow draft parent must belong to the bound page')
    }
    const replaceId = input.replaceId ? validateID(input.replaceId, 'replaceId') : undefined
    if (replaceId && graph.getPageId(replaceId) !== record.workspace.pageId) {
      throw new Error('Shadow draft replacement must belong to the bound page')
    }
    if (
      input.insertIndex !== undefined &&
      (!Number.isSafeInteger(input.insertIndex) ||
        input.insertIndex < 0 ||
        input.insertIndex > parent.childIds.length)
    ) {
      throw new TypeError('insertIndex is outside the parent child bound')
    }
    return Object.freeze({
      parentId,
      ...(replaceId ? { replaceId } : {}),
      ...(input.x !== undefined ? { x: finiteCoordinate(input.x, 'x') } : {}),
      ...(input.y !== undefined ? { y: finiteCoordinate(input.y, 'y') } : {})
    })
  }

  async function renderShadowDraft(
    input: RenderCodePenShadowDraftInput,
    signal?: AbortSignal
  ): Promise<CodePenAIRenderResult> {
    return exclusive(async () => {
      const record = requireDraft(input)
      if (record.state !== 'open') throw new Error('A sealed shadow draft cannot be modified by AI')
      if (record.renderOperations >= CODEPEN_AI_LIMITS.maxRenderOperationsPerDraft) {
        throw new Error('Shadow draft render operation limit reached')
      }
      const validation = validateSafeCodePenShadowJSX(input.jsx)
      const evidenceRecord = requireEvidence(record.evidenceDigest)
      const resolveTextToken = (token: string) =>
        evidenceRecord.visualOutline.resolveTextToken(token)
      assertKnownCodePenTextTokens(input.jsx, resolveTextToken)
      const projectedNodes =
        record.workspace.graph.getNodeCount() +
        validation.elementCount +
        validation.textNodeEstimate
      if (projectedNodes > record.workspace.limits.maxNodes) {
        throw new Error('Shadow draft JSX would exceed the node limit')
      }
      const placement = validateRenderPlacement(record, input)
      const originalWorkspace = record.workspace
      const staged = forkAIShadowDraftWorkspace(originalWorkspace)
      const figma = new FigmaAPI(staged.graph)
      figma.currentPage = figma.wrapNode(staged.pageId)
      const result = (await renderTool.execute(
        figma,
        {
          jsx: input.jsx,
          parent_id: placement.parentId,
          ...(placement.replaceId ? { replace_id: placement.replaceId } : {}),
          ...(input.insertIndex !== undefined ? { insert_index: input.insertIndex } : {}),
          ...(placement.x !== undefined ? { x: placement.x } : {}),
          ...(placement.y !== undefined ? { y: placement.y } : {})
        },
        { signal, deferLayout: false }
      )) as { id: string; name: string; type: string }
      substituteCodePenEvidenceText(staged.graph, result.id, resolveTextToken)
      // Enforce actual graph/image/canonical budgets before adopting the staged transaction.
      await sealAIShadowDraft(staged)
      throwIfAborted(signal)
      const current = requireDraft(input)
      if (current !== record) throw new Error('Shadow draft identity changed while rendering')
      if (current.workspace !== originalWorkspace || current.state !== 'open') {
        throw new Error('Shadow draft changed while rendering')
      }
      record.workspace = staged
      record.renderOperations++
      notify()
      return Object.freeze({
        draftId: record.draftId,
        evidenceDigest: record.evidenceDigest,
        root: Object.freeze({ id: result.id, name: result.name, type: result.type }),
        renderOperations: record.renderOperations,
        nodeCount: staged.graph.getNodeCount()
      })
    }, signal)
  }

  async function sealShadowDraft(
    input: SealCodePenShadowDraftInput,
    signal?: AbortSignal
  ): Promise<CodePenAISealedDraftSummary> {
    return exclusive(async () => {
      const record = requireDraft(input)
      if (record.state === 'sealed') return sealedSummary(record)
      const sealed = await sealAIShadowDraft(record.workspace)
      throwIfAborted(signal)
      requireDraft(input)
      record.sealed = sealed
      record.state = 'sealed'
      notify()
      return sealedSummary(record)
    }, signal)
  }

  async function discardShadowDraft(
    input: SealCodePenShadowDraftInput
  ): Promise<Readonly<{ discarded: true }>> {
    return exclusive(async () => {
      const record = requireDraft(input)
      drafts.delete(record.draftId)
      notify()
      return Object.freeze({ discarded: true as const })
    })
  }

  function listSealedDraftsForReview(): readonly CodePenAISealedDraftSummary[] {
    pruneStaleState()
    return Object.freeze(
      [...drafts.values()]
        .filter((record) => record.state === 'sealed')
        .map((record) => sealedSummary(record))
    )
  }

  function getSealedDraftForReview(
    draftId: string,
    evidenceDigest: string
  ): CodePenAISealedDraftReview {
    const record = requireDraft({ draftId, evidenceDigest })
    if (!record.sealed || record.state !== 'sealed') throw new Error('Shadow draft is not sealed')
    return Object.freeze({ metadata: sealedSummary(record) })
  }

  async function getShadowWorkspaceForReview(
    draftId: string,
    evidenceDigest: string
  ): Promise<AIShadowDraftWorkspace> {
    return exclusive(async () => {
      const record = requireDraft({ draftId, evidenceDigest })
      if (record.state !== 'sealed')
        throw new Error('Shadow draft must be sealed before host review')
      // Comparison receives the desired graph but not its live-base commit authority.
      // Only commitSealedDraftForReview may cross the final host mutation boundary.
      return createAIShadowDraftWorkspace({
        graph: record.workspace.graph,
        pageId: record.workspace.pageId,
        expectedRevision: record.workspace.expectedRevision,
        limits: record.workspace.limits
      })
    })
  }

  async function commitSealedDraftForReview(
    input: CommitCodePenShadowDraftInput,
    signal?: AbortSignal
  ): Promise<AIShadowCommitResult> {
    return exclusive(async () => {
      const record = requireDraft(input)
      if (!record.sealed || record.state !== 'sealed') {
        throw new Error('Shadow draft must be sealed before host commit')
      }
      const summary = sealedSummary(record)
      const draftDigest = validateDigest(input.draftDigest, 'draftDigest')
      const approved: unknown = Reflect.get(input, 'approved')
      if (approved !== true || draftDigest !== summary.draftDigest) {
        throw new Error('Exact sealed draft digest approval is required')
      }
      const verifiedDraft = await sealAIShadowDraft(record.workspace)
      throwIfAborted(signal)
      if (verifiedDraft.draftDigest !== draftDigest) {
        return commitFailure(store, 'digest-mismatch', 'The sealed shadow draft digest changed.')
      }
      const liveWorkspace = await createAIShadowDraftWorkspace({
        graph: store.graph,
        pageId: record.workspace.pageId,
        expectedRevision: summary.expectedRevision,
        limits: record.workspace.limits
      })
      throwIfAborted(signal)
      const current = requireDraft(input)
      if (current !== record || current.sealed !== record.sealed) {
        return commitFailure(store, 'revision-conflict', 'Shadow draft authority changed.')
      }
      if (liveWorkspace.baseDigest !== record.sealed.baseDigest) {
        return commitFailure(
          store,
          'revision-conflict',
          'The live document content differs from the draft base.'
        )
      }

      const before = store.snapshotDocument()
      const afterGraph = forkAIShadowDraftWorkspace(record.workspace).graph
      // Final authority check is intentionally adjacent to the only live mutation.
      throwIfAborted(signal)
      if (requireDraft(input) !== record || record.sealed.draftDigest !== draftDigest) {
        return commitFailure(store, 'revision-conflict', 'Shadow draft authority changed.')
      }
      try {
        store.replaceGraph(afterGraph, { currentPageId: record.workspace.pageId })
        const after = store.snapshotDocument()
        store.pushUndoEntry({
          label: input.label?.trim() || 'AI: Apply reviewed CodePen reconstruction',
          forward: () => store.restoreDocumentFromSnapshot(after),
          inverse: () => store.restoreDocumentFromSnapshot(before)
        })
      } catch (error) {
        try {
          store.restoreDocumentFromSnapshot(before)
        } catch (restoreError) {
          return commitFailure(
            store,
            'invalid-input',
            `The CodePen draft commit and rollback both failed: ${restoreError instanceof Error ? restoreError.message : 'unknown rollback error'}`
          )
        }
        return commitFailure(
          store,
          'invalid-input',
          error instanceof Error
            ? error.message
            : 'The CodePen shadow draft could not be committed.'
        )
      }
      drafts.delete(record.draftId)
      notify()
      return Object.freeze({
        ok: true,
        draftDigest,
        revision: store.state.sceneVersion,
        diagnostics: Object.freeze([])
      })
    }, signal)
  }

  function hasActiveReconstruction(): boolean {
    pruneStaleState()
    return drafts.size > 0
  }

  function subscribe(listener: () => void): () => void {
    if (disposed) throw new Error('CodePen AI manager is disposed')
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    lifecycleEpoch++
    unbindSource()
    unbindRevision()
    evidence.clear()
    drafts.clear()
    listeners.clear()
  }

  return Object.freeze({
    analyze,
    registerEvidence,
    listRegisteredEvidence,
    createShadowDraft,
    renderShadowDraft,
    sealShadowDraft,
    discardShadowDraft,
    listSealedDraftsForReview,
    getSealedDraftForReview,
    getShadowWorkspaceForReview,
    commitSealedDraftForReview,
    hasActiveReconstruction,
    pruneStaleDrafts,
    subscribe,
    dispose
  })
}
