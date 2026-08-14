import type { SceneGraph } from '@open-pencil/scene-graph'

import type { Editor } from '#core/editor'

export const AI_SHADOW_DRAFT_DIGEST_ALGORITHM = 'SHA-256' as const

export const AI_VISUAL_COMPARE_VIEWPORTS = Object.freeze([
  Object.freeze({ id: 'mobile', width: 360, height: 800 }),
  Object.freeze({ id: 'tablet', width: 768, height: 1024 }),
  Object.freeze({ id: 'desktop', width: 1280, height: 800 })
] as const)

export type AIVisualViewport = (typeof AI_VISUAL_COMPARE_VIEWPORTS)[number]
export type AIVisualViewportId = AIVisualViewport['id']

export type AIShadowDiagnosticCode =
  | 'aborted'
  | 'approval-required'
  | 'artifact-budget-exceeded'
  | 'capture-failed'
  | 'compare-failed'
  | 'digest-mismatch'
  | 'diagnostic-budget-exceeded'
  | 'draft-not-sealed'
  | 'duration-budget-exceeded'
  | 'invalid-artifact'
  | 'invalid-input'
  | 'pixel-budget-exceeded'
  | 'repair-failed'
  | 'repair-limit-reached'
  | 'revision-conflict'
  | 'threshold-not-met'
  | 'workspace-limit-exceeded'

export interface AIShadowDiagnostic {
  readonly code: AIShadowDiagnosticCode
  readonly message: string
  readonly severity: 'error' | 'warning' | 'info'
  readonly round?: number
  readonly viewportId?: AIVisualViewportId
}

export interface AIShadowDraftLimits {
  readonly maxNodes: number
  readonly maxImageBytes: number
  readonly maxCanonicalBytes: number
}

export interface CreateAIShadowDraftWorkspaceOptions {
  readonly graph: SceneGraph
  readonly pageId: string
  readonly expectedRevision: number
  readonly limits?: Partial<AIShadowDraftLimits>
}

export interface AIShadowDraftWorkspace {
  /** The only mutable graph exposed to the AI. It never aliases the live editor graph. */
  readonly graph: SceneGraph
  readonly pageId: string
  readonly expectedRevision: number
  readonly baseDigest: string
  readonly digestAlgorithm: typeof AI_SHADOW_DRAFT_DIGEST_ALGORITHM
  readonly limits: Readonly<AIShadowDraftLimits>
}

export interface AIShadowDraft {
  readonly pageId: string
  readonly expectedRevision: number
  readonly baseDigest: string
  readonly draftDigest: string
  readonly digestAlgorithm: typeof AI_SHADOW_DRAFT_DIGEST_ALGORITHM
  readonly nodeCount: number
  readonly imageBytes: number
  readonly limits: Readonly<AIShadowDraftLimits>
}

export interface AIShadowDraftApproval {
  readonly approved: true
  readonly draftDigest: string
}

export interface CommitAIShadowDraftOptions {
  readonly expectedRevision: number
  readonly approval: AIShadowDraftApproval
  readonly label?: string
}

export type AIShadowCommitResult =
  | {
      readonly ok: true
      readonly draftDigest: string
      readonly revision: number
      readonly diagnostics: readonly AIShadowDiagnostic[]
    }
  | {
      readonly ok: false
      readonly revision: number
      readonly diagnostics: readonly AIShadowDiagnostic[]
    }

export interface AIVisualArtifact {
  readonly mediaType: 'image/png' | 'image/webp'
  readonly bytes: Uint8Array
  readonly width: number
  readonly height: number
}

export interface AIVisualReference {
  readonly viewportId: AIVisualViewportId
  readonly artifact: AIVisualArtifact
}

export interface AIVisualCaptureRequest {
  /** A fresh detached graph. Capture backends cannot mutate the workspace through it. */
  readonly graph: SceneGraph
  readonly pageId: string
  readonly viewport: AIVisualViewport
  readonly round: number
  readonly signal: AbortSignal
}

export interface AIVisualCaptureBackend {
  capture(request: AIVisualCaptureRequest): Promise<AIVisualArtifact>
}

export interface AIVisualCompareRequest {
  readonly reference: AIVisualArtifact
  readonly candidate: AIVisualArtifact
  readonly viewport: AIVisualViewport
  readonly round: number
  readonly signal: AbortSignal
}

export interface AIVisualCompareValue {
  /** Zero is identical and one is maximally different. */
  readonly differenceRatio: number
}

export interface AIVisualComparator {
  compare(request: AIVisualCompareRequest): Promise<AIVisualCompareValue>
}

export interface AIVisualViewportComparison {
  readonly viewport: AIVisualViewport
  readonly reference: AIVisualArtifact
  readonly candidate: AIVisualArtifact
  readonly differenceRatio: number
  readonly passed: boolean
}

export interface AIVisualComparisonRound {
  readonly round: number
  readonly comparisons: readonly AIVisualViewportComparison[]
  readonly passed: boolean
}

export interface AIVisualRepairRequest {
  /** Repair is the only callback intentionally allowed to mutate the shadow graph. */
  readonly graph: SceneGraph
  readonly pageId: string
  readonly round: number
  readonly comparisons: readonly AIVisualViewportComparison[]
  readonly signal: AbortSignal
}

export type AIVisualRepair = (request: AIVisualRepairRequest) => Promise<void> | void

export interface AIVisualComparisonBudget {
  /** Additional repair attempts after the initial capture. Hard-capped at two. */
  readonly maxRepairRounds: number
  readonly maxTotalPixels: number
  readonly maxArtifactBytes: number
  readonly maxTotalArtifactBytes: number
  readonly maxDurationMs: number
  readonly maxDiagnostics: number
  readonly differenceThreshold: number
}

export interface RunAIShadowVisualComparisonOptions {
  readonly workspace: AIShadowDraftWorkspace
  readonly references: readonly AIVisualReference[]
  readonly captureBackend: AIVisualCaptureBackend
  readonly comparator: AIVisualComparator
  readonly repair?: AIVisualRepair
  readonly budget?: Partial<AIVisualComparisonBudget>
  readonly signal?: AbortSignal
}

export interface AIShadowVisualComparisonResult {
  readonly status: 'passed' | 'not-passed' | 'budget-exhausted' | 'failed' | 'aborted'
  readonly rounds: readonly AIVisualComparisonRound[]
  readonly repairRounds: number
  readonly totalPixels: number
  readonly totalArtifactBytes: number
  readonly elapsedMs: number
  readonly diagnostics: readonly AIShadowDiagnostic[]
}

/** Narrow editor surface required by atomic draft commit. */
export type AIShadowCommitEditor = Pick<
  Editor,
  'graph' | 'replaceGraph' | 'pushUndoEntry' | 'state' | 'undo'
>
