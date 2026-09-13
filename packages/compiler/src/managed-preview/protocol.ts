import type { BackendApplicationSpecV1, BackendDiagnostic } from '@open-pencil/lowcode/backend'

import type { PreviewLocalBackendConnection } from '../local-backend-preview/connection'

export {
  parseManagedPreviewCommand,
  parseManagedPreviewEvent,
  parseManagedPreviewConfig,
  parseManagedPreviewSessionId
} from './parse'

export const MANAGED_PREVIEW_PROTOCOL_VERSION = 1 as const
export const MANAGED_PREVIEW_MAX_COMMAND_BYTES = 2 * 1024 * 1024
export const MANAGED_PREVIEW_MAX_EVENT_BYTES = 2 * 1024 * 1024

/** Public identity settings plus the operator's explicit local CA file selection. */
export interface ManagedPreviewConfig {
  readonly previewPort: number
  readonly apiPort: number
  readonly dbPort: number
  readonly audience: string
  readonly jwksURL: string
  readonly caFile: string
}

export type ManagedPreviewPhase =
  | 'empty'
  | 'prepared'
  | 'installing'
  | 'building'
  | 'migrating'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'blocked'
  | 'failed'

export interface ManagedPreviewPlan {
  readonly planId: string
  readonly kind: 'initial' | 'migration' | 'runtime' | 'blocked'
  readonly fromApplicationDigest: string | null
  readonly toApplicationDigest: string
  readonly sql: string
  readonly summary: readonly string[]
  readonly diagnostics: readonly BackendDiagnostic[]
  readonly requiresApproval: boolean
}

export interface ManagedPreviewState {
  readonly sessionId: string
  readonly phase: ManagedPreviewPhase
  readonly initialized: boolean
  readonly applicationId: string | null
  readonly applicationDigest: string | null
  /** Present only while the API is ready for the frontend VFS connection. */
  readonly connection: PreviewLocalBackendConnection | null
  readonly plan: ManagedPreviewPlan | null
}

interface CommandBase {
  readonly version: 1
  readonly id: string
}
export type ManagedPreviewCommand =
  | (CommandBase & {
      readonly command: 'prepare'
      readonly application: BackendApplicationSpecV1
      readonly config: ManagedPreviewConfig
    })
  | (CommandBase & { readonly command: 'setup' | 'apply'; readonly planId: string })
  | (CommandBase & { readonly command: 'start' | 'stop' | 'status' | 'close' })

export type ManagedPreviewEvent =
  | { readonly version: 1; readonly type: 'ready'; readonly sessionId: string }
  | {
      readonly version: 1
      readonly type: 'result'
      readonly id: string
      readonly state: ManagedPreviewState
    }
  | {
      readonly version: 1
      readonly type: 'progress'
      readonly id: string
      readonly phase: ManagedPreviewPhase
      readonly message: string
    }
  | {
      readonly version: 1
      readonly type: 'error'
      readonly id: string | null
      readonly code: string
      readonly message: string
      readonly state: ManagedPreviewState | null
    }
