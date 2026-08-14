import type { SceneGraph } from '@open-pencil/scene-graph'

import {
  digestDetachedGraph,
  graphFromDetachedSnapshot,
  resolveAIShadowDraftLimits,
  snapshotDetachedGraph,
  type DetachedGraphSnapshot
} from './graph'
import {
  AI_SHADOW_DRAFT_DIGEST_ALGORITHM,
  type AIShadowCommitEditor,
  type AIShadowCommitResult,
  type AIShadowDiagnostic,
  type AIShadowDraft,
  type AIShadowDraftWorkspace,
  type CommitAIShadowDraftOptions,
  type CreateAIShadowDraftWorkspaceOptions
} from './types'

interface SealedDraftMetadata {
  readonly snapshot: DetachedGraphSnapshot
}

const workspaces = new WeakSet<AIShadowDraftWorkspace>()
const sealedDraftMetadata = new WeakMap<AIShadowDraft, SealedDraftMetadata>()

function diagnostic(code: AIShadowDiagnostic['code'], message: string): AIShadowDiagnostic {
  return { code, message, severity: 'error' }
}

function validRevision(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`)
  }
}

function assertPage(graph: SceneGraph, pageId: string): void {
  if (typeof pageId !== 'string' || graph.getNode(pageId)?.type !== 'CANVAS') {
    throw new TypeError('pageId must identify a page in the source graph')
  }
}

function hasExactApproval(value: unknown, draftDigest: string): boolean {
  if (!value || typeof value !== 'object') return false
  return (
    Reflect.get(value, 'approved') === true && Reflect.get(value, 'draftDigest') === draftDigest
  )
}

export async function createAIShadowDraftWorkspace(
  options: CreateAIShadowDraftWorkspaceOptions
): Promise<AIShadowDraftWorkspace> {
  validRevision(options.expectedRevision, 'expectedRevision')
  assertPage(options.graph, options.pageId)
  const limits = resolveAIShadowDraftLimits(options.limits)
  const sourceSnapshot = snapshotDetachedGraph(options.graph, limits)
  const baseDigest = await digestDetachedGraph(sourceSnapshot, limits)
  const graph = graphFromDetachedSnapshot(sourceSnapshot)
  const workspace: AIShadowDraftWorkspace = Object.freeze({
    graph,
    pageId: options.pageId,
    expectedRevision: options.expectedRevision,
    baseDigest,
    digestAlgorithm: AI_SHADOW_DRAFT_DIGEST_ALGORITHM,
    limits
  })
  workspaces.add(workspace)
  return workspace
}

/**
 * Clone the current content of a trusted shadow workspace while preserving its original live
 * document authority. Host review and repair flows can therefore operate on another detached
 * graph and seal the result without changing the base digest or expected revision.
 */
export function forkAIShadowDraftWorkspace(
  workspace: AIShadowDraftWorkspace
): AIShadowDraftWorkspace {
  if (!workspaces.has(workspace)) {
    throw new TypeError('Shadow draft workspace was not created by this runtime')
  }
  assertPage(workspace.graph, workspace.pageId)
  const snapshot = snapshotDetachedGraph(workspace.graph, workspace.limits)
  const fork: AIShadowDraftWorkspace = Object.freeze({
    graph: graphFromDetachedSnapshot(snapshot),
    pageId: workspace.pageId,
    expectedRevision: workspace.expectedRevision,
    baseDigest: workspace.baseDigest,
    digestAlgorithm: workspace.digestAlgorithm,
    limits: workspace.limits
  })
  workspaces.add(fork)
  return fork
}

export async function sealAIShadowDraft(workspace: AIShadowDraftWorkspace): Promise<AIShadowDraft> {
  if (!workspaces.has(workspace)) {
    throw new TypeError('Shadow draft workspace was not created by this runtime')
  }
  assertPage(workspace.graph, workspace.pageId)
  const snapshot = snapshotDetachedGraph(workspace.graph, workspace.limits)
  const draftDigest = await digestDetachedGraph(snapshot, workspace.limits)
  const draft: AIShadowDraft = Object.freeze({
    pageId: workspace.pageId,
    expectedRevision: workspace.expectedRevision,
    baseDigest: workspace.baseDigest,
    draftDigest,
    digestAlgorithm: AI_SHADOW_DRAFT_DIGEST_ALGORITHM,
    nodeCount: snapshot.nodeCount,
    imageBytes: snapshot.imageBytes,
    limits: workspace.limits
  })
  sealedDraftMetadata.set(draft, { snapshot })
  return draft
}

function failure(
  editor: AIShadowCommitEditor,
  code: AIShadowDiagnostic['code'],
  message: string
): AIShadowCommitResult {
  return {
    ok: false,
    revision: editor.state.sceneVersion,
    diagnostics: [diagnostic(code, message)]
  }
}

export async function commitAIShadowDraft(
  editor: AIShadowCommitEditor,
  draft: AIShadowDraft,
  options: CommitAIShadowDraftOptions
): Promise<AIShadowCommitResult> {
  const metadata = sealedDraftMetadata.get(draft)
  if (!metadata) {
    return failure(editor, 'draft-not-sealed', 'The shadow draft is not sealed by this runtime.')
  }
  if (!hasExactApproval(options.approval, draft.draftDigest)) {
    return failure(
      editor,
      'approval-required',
      'Explicit approval for the exact sealed draft digest is required.'
    )
  }
  if (options.expectedRevision !== draft.expectedRevision) {
    return failure(editor, 'revision-conflict', 'Commit revision does not match the draft base.')
  }
  if (editor.state.sceneVersion !== draft.expectedRevision) {
    return failure(editor, 'revision-conflict', 'The live document changed after the draft began.')
  }

  let sealedDigest: string
  let liveDigest: string
  let before: DetachedGraphSnapshot
  try {
    sealedDigest = await digestDetachedGraph(metadata.snapshot, draft.limits)
    before = snapshotDetachedGraph(editor.graph, draft.limits)
    liveDigest = await digestDetachedGraph(before, draft.limits)
  } catch (error) {
    return failure(
      editor,
      'workspace-limit-exceeded',
      error instanceof Error ? error.message : 'The document exceeds shadow draft limits.'
    )
  }

  if (editor.state.sceneVersion !== draft.expectedRevision) {
    return failure(editor, 'revision-conflict', 'The live document changed during verification.')
  }
  if (sealedDigest !== draft.draftDigest) {
    return failure(editor, 'digest-mismatch', 'The sealed draft content digest no longer matches.')
  }
  if (liveDigest !== draft.baseDigest) {
    return failure(
      editor,
      'revision-conflict',
      'The live document content differs from the draft base.'
    )
  }

  const after = metadata.snapshot
  const beforePageId = editor.state.currentPageId
  const afterPageId = draft.pageId
  const replaceBefore = () =>
    editor.replaceGraph(graphFromDetachedSnapshot(before), { currentPageId: beforePageId })
  const replaceAfter = () =>
    editor.replaceGraph(graphFromDetachedSnapshot(after), { currentPageId: afterPageId })

  try {
    replaceAfter()
    editor.pushUndoEntry({
      label: options.label?.trim() || 'AI: Apply shadow draft',
      forward: replaceAfter,
      inverse: replaceBefore
    })
  } catch (error) {
    try {
      replaceBefore()
    } catch (restoreError) {
      return failure(
        editor,
        'invalid-input',
        `The shadow draft commit and rollback both failed: ${restoreError instanceof Error ? restoreError.message : 'unknown rollback error'}`
      )
    }
    return failure(
      editor,
      'invalid-input',
      error instanceof Error ? error.message : 'The shadow draft could not be committed.'
    )
  }

  return {
    ok: true,
    draftDigest: draft.draftDigest,
    revision: editor.state.sceneVersion,
    diagnostics: []
  }
}
