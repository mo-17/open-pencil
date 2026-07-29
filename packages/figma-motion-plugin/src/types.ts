import type {
  FigmaNativeMotionFieldName,
  FigmaNativeMotionIssue,
  FigmaNativeMotionTransactionHost,
  FigmaNativeMotionWarning
} from '@open-pencil/fig'

export type FigmaMotionAdapterStatus =
  | 'applied'
  | 'unchanged'
  | 'skipped'
  | 'unsupported'
  | 'conflict'
  | 'failed'

export interface FigmaMotionNodeResult {
  nodeId: string
  nodeName: string
  status: FigmaMotionAdapterStatus
  code: string | null
  message: string | null
  rolledBack: boolean
  timelineId: string | null
  durationSeconds: number | null
  managedFields: FigmaNativeMotionFieldName[]
  issues: FigmaNativeMotionIssue[]
  warnings: FigmaNativeMotionWarning[]
}

export interface FigmaMotionAdapterCounts {
  applied: number
  unchanged: number
  skipped: number
  unsupported: number
  conflict: number
  failed: number
}

export interface FigmaMotionAdapterSummary {
  schema: 'openpencil.figma-motion-adapter-result'
  version: 1
  conflictPolicy: 'replace-owned'
  selectionCount: number
  counts: FigmaMotionAdapterCounts
  results: FigmaMotionNodeResult[]
}

/** Minimal official Figma Motion surface used by the selection runner and test doubles. */
export interface FigmaMotionTarget {
  readonly id: string
  readonly name: string
  readonly opacity?: number
  readonly animationStyles: ReadonlyArray<Pick<AppliedAnimationStyle, 'id'>>
  readonly manualKeyframeTracks: ManualKeyframeTracks
  readonly timelines: ReadonlyArray<Timeline>
  getSharedPluginData(namespace: string, key: string): string
  setSharedPluginData(namespace: string, key: string, value: string): void
  applyManualKeyframeTrack(field: KeyframeField, track: ManualKeyframeTrackInput): void
  removeManualKeyframeTrack(field: KeyframeField): void
  setTimelineDuration(id: string, duration: number): void
}

export type FigmaMotionUndoHost = FigmaNativeMotionTransactionHost

export interface FigmaMotionSelectionHost extends FigmaMotionUndoHost {
  readonly currentPage: {
    readonly selection: ReadonlyArray<FigmaMotionTarget>
  }
}
