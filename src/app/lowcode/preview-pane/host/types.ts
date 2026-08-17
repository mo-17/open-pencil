import type { CompilerOptions } from '@open-pencil/compiler'
import type { SceneGraph } from '@open-pencil/scene-graph'

export type PreviewTarget = 'react' | 'vue'

export interface PreviewDiagnostic {
  code: string
  severity: 'warning' | 'error'
  message: string
  nodeId?: string
  path?: string
  line?: number
  column?: number
}

export interface PreviewHostBuildMetrics {
  compileMs: number
  bundleMs: number
  totalMs: number
  inputBytes: number
  outputBytes: number
  fileCount: number
  dependencyCount: number
}

export interface PreviewFrameDescriptor {
  /** Actual iframe source. Browser builds use a host-owned Blob URL. */
  src: string
  /** Stable, non-secret URL text suitable for the preview toolbar. */
  displayURL: string
  /** Tauri sidecars expose their loopback port; browser builds do not. */
  port: number | null
  /** Sandboxed browser frames have an opaque origin (`"null"`). */
  expectedMessageOrigin: string
  /** Opaque origins cannot be addressed as `"null"`; channel + source gate `"*"`. */
  postMessageTargetOrigin: string
  /** Browser builds deliberately grant scripts and no other sandbox token. */
  sandbox: 'allow-scripts' | null
  /** Per-build capability echoed by the generated preview bridge. */
  channelId: string
}

export interface PreviewHostBuildRequest {
  generation: number
  graph: SceneGraph
  pageIds: string[]
  options: CompilerOptions
  refreshFonts: boolean
  signal?: AbortSignal
}

interface PreviewHostBuildBase {
  generation: number
  diagnostics: PreviewDiagnostic[]
  metrics: PreviewHostBuildMetrics
}

export interface PreviewHostReadyResult extends PreviewHostBuildBase {
  status: 'ready'
  frame: PreviewFrameDescriptor
}

export interface PreviewHostErrorResult extends PreviewHostBuildBase {
  status: 'error'
  reason: string
}

export interface PreviewHostUnsupportedResult extends PreviewHostBuildBase {
  status: 'unsupported'
  reason: string
}

/** Internal scheduling outcome. It must never be surfaced as a user state. */
export interface PreviewHostStaleResult extends PreviewHostBuildBase {
  status: 'stale'
}

export type PreviewHostBuildResult =
  | PreviewHostReadyResult
  | PreviewHostErrorResult
  | PreviewHostUnsupportedResult
  | PreviewHostStaleResult

export interface PreviewHostTerminal {
  code: number | null
  message: string
}

export interface PreviewHost {
  readonly kind: 'tauri-sidecar' | 'browser-worker'
  readonly target: PreviewTarget
  readonly terminal: Promise<PreviewHostTerminal> | null
  build(request: PreviewHostBuildRequest): Promise<PreviewHostBuildResult>
  releaseFrame(frame: PreviewFrameDescriptor): void
  isAlive(): boolean
  dispose(): Promise<void>
}

export const EMPTY_PREVIEW_HOST_METRICS: PreviewHostBuildMetrics = Object.freeze({
  compileMs: 0,
  bundleMs: 0,
  totalMs: 0,
  inputBytes: 0,
  outputBytes: 0,
  fileCount: 0,
  dependencyCount: 0
})
