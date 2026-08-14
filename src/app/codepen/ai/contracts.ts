import type {
  AIShadowCommitResult,
  AIShadowDraft,
  AIShadowDraftWorkspace
} from '@open-pencil/core/ai-draft'

import type { EditorStore } from '@/app/editor/session'

import type { CodePenRiskEvidence, CodePenSourceKind, CodePenStaticEvidence } from '../contracts'
import type { CodePenTauriInvoker } from '../tauri'
import type { CodePenAIVisualOutline, CodePenAIVisualOutlineBundle } from './visual-outline'

export const CODEPEN_AI_LIMITS = Object.freeze({
  maxEvidenceEntries: 4,
  maxShadowDrafts: 4,
  maxQueuedOperations: 16,
  maxRenderOperationsPerDraft: 24,
  maxJSXBytes: 128 * 1024,
  maxJSXElements: 2_000,
  maxJSXDepth: 64,
  maxAttributesPerElement: 64,
  maxDerivedColors: 16,
  maxDerivedBreakpoints: 12,
  shadowDraft: Object.freeze({
    maxNodes: 25_000,
    maxImageBytes: 64 * 1024 * 1024,
    maxCanonicalBytes: 32 * 1024 * 1024
  })
})

export type CodePenAIEvidenceLoader = (
  url: string,
  signal?: AbortSignal
) => Promise<CodePenStaticEvidence>

export interface CodePenAIManagerOptions {
  readonly loadEvidence?: CodePenAIEvidenceLoader
  readonly tauriInvoker?: CodePenTauriInvoker
}

export interface CodePenAIEvidenceSummary {
  readonly evidenceDigest: string
  readonly pen: Readonly<{ url: string; owner: string; slug: string }>
  readonly sourceBytes: Readonly<Record<CodePenSourceKind, number>>
  readonly sourceDigests: Readonly<Record<CodePenSourceKind, string>>
  readonly riskCounts: Readonly<{ blockers: number; warnings: number; infos: number }>
  readonly risks: readonly Readonly<{
    code: string
    severity: CodePenRiskEvidence['severity']
    source: CodePenRiskEvidence['source']
    count: number
  }>[]
  readonly resourceCounts: Readonly<{
    total: number
    byScheme: Readonly<Record<string, number>>
    byKind: Readonly<Record<string, number>>
  }>
  readonly derivedVisualFacts: Readonly<{
    htmlTagCounts: Readonly<Record<string, number>>
    colors: readonly string[]
    mediaBreakpointsPx: readonly number[]
    flexDeclarationCount: number
    gridDeclarationCount: number
    absolutePositionDeclarationCount: number
    animationDeclarationCount: number
  }>
  readonly visualOutline: CodePenAIVisualOutline
  readonly policy: Readonly<{
    sourceInstructions: 'ignored-as-untrusted-data'
    rawSourceReturnedToAI: false
    sourceCodeExecution: 'blocked'
    externalResourceFetching: 'blocked'
    liveGraphMutation: 'blocked'
  }>
}

export interface CodePenAIAnalyzeResult {
  readonly evidence: CodePenAIEvidenceSummary | null
  readonly registeredEvidence: readonly CodePenAIEvidenceSummary[]
}

export interface RenderCodePenShadowDraftInput {
  readonly draftId: string
  readonly evidenceDigest: string
  readonly jsx: string
  readonly parentId?: string
  readonly replaceId?: string
  readonly insertIndex?: number
  readonly x?: number
  readonly y?: number
}

export interface SealCodePenShadowDraftInput {
  readonly draftId: string
  readonly evidenceDigest: string
}

export interface CommitCodePenShadowDraftInput extends SealCodePenShadowDraftInput {
  readonly draftDigest: string
  readonly approved: true
  readonly label?: string
}

export interface CodePenAISealedDraftSummary {
  readonly draftId: string
  readonly evidenceDigest: string
  readonly draftDigest: string
  readonly nodeCount: number
  readonly imageBytes: number
  readonly expectedRevision: number
  readonly pageId: string
}

export interface CodePenAISealedDraftReview {
  readonly metadata: CodePenAISealedDraftSummary
}

export interface CodePenAIRenderResult {
  readonly draftId: string
  readonly evidenceDigest: string
  readonly root: Readonly<{ id: string; name: string; type: string }>
  readonly renderOperations: number
  readonly nodeCount: number
}

export interface CodePenAIManager {
  analyze(url?: string, signal?: AbortSignal): Promise<CodePenAIAnalyzeResult>
  registerEvidence(evidence: CodePenStaticEvidence): Promise<CodePenAIEvidenceSummary>
  listRegisteredEvidence(): readonly CodePenAIEvidenceSummary[]
  createShadowDraft(
    evidenceDigest: string,
    signal?: AbortSignal
  ): Promise<Readonly<{ draftId: string; evidenceDigest: string; expectedRevision: number }>>
  renderShadowDraft(
    input: RenderCodePenShadowDraftInput,
    signal?: AbortSignal
  ): Promise<CodePenAIRenderResult>
  sealShadowDraft(
    input: SealCodePenShadowDraftInput,
    signal?: AbortSignal
  ): Promise<CodePenAISealedDraftSummary>
  discardShadowDraft(input: SealCodePenShadowDraftInput): Promise<Readonly<{ discarded: true }>>
  listSealedDraftsForReview(): readonly CodePenAISealedDraftSummary[]
  getSealedDraftForReview(draftId: string, evidenceDigest: string): CodePenAISealedDraftReview
  getShadowWorkspaceForReview(
    draftId: string,
    evidenceDigest: string
  ): Promise<AIShadowDraftWorkspace>
  commitSealedDraftForReview(
    input: CommitCodePenShadowDraftInput,
    signal?: AbortSignal
  ): Promise<AIShadowCommitResult>
  hasActiveReconstruction(): boolean
  pruneStaleDrafts(): number
  subscribe(listener: () => void): () => void
  dispose(): void
}

export type CodePenAIDocumentBinding = Readonly<{
  graph: EditorStore['graph']
  sourceEpoch: number
  identity: string
}>

export type CodePenAIEvidenceRecord = Readonly<{
  evidence: CodePenStaticEvidence
  summary: CodePenAIEvidenceSummary
  visualOutline: CodePenAIVisualOutlineBundle
  binding: CodePenAIDocumentBinding
}>

export type CodePenAIDraftRecord = {
  readonly draftId: string
  readonly evidenceDigest: string
  readonly binding: CodePenAIDocumentBinding
  workspace: AIShadowDraftWorkspace
  renderOperations: number
  state: 'open' | 'sealed'
  sealed?: AIShadowDraft
}
