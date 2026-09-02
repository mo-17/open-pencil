import type { FigArchiveLimits } from '@open-pencil/fig'
import type { FigPageManifestEntry } from '@open-pencil/kiwi/fig'

import type { SerializedSceneGraph } from '#core/kiwi/fig/parse/transfer'
import type { FigPopulationDelta } from '#core/kiwi/fig/population/delta'

export type FigSessionWorkerPhase = 'parse' | 'import' | 'transport'

export interface FigSessionOpenOptions {
  populate?: 'all' | 'first-page' | 'none'
  archiveLimits?: FigArchiveLimits
}

export interface FigSessionOpenRequest {
  type: 'open'
  buffer: ArrayBuffer
  options?: FigSessionOpenOptions
  port: MessagePort
}

export interface FigSessionPopulateRequest {
  type: 'populate'
  requestId: string
  baseRevision: number
  pageId: string
}

export interface FigSessionOriginalArchiveRequest {
  type: 'original-archive'
  requestId: string
}

export interface FigSessionCancelRequest {
  type: 'cancel'
  requestId?: string
}

export interface FigSessionDisposeRequest {
  type: 'dispose'
}

export type FigSessionRequest =
  | FigSessionPopulateRequest
  | FigSessionOriginalArchiveRequest
  | FigSessionCancelRequest
  | FigSessionDisposeRequest

export type FigSessionResponse =
  | { type: 'page-manifest'; pages: FigPageManifestEntry[] }
  | { type: 'graph'; graph: SerializedSceneGraph }
  | { type: 'graph'; error: string; phase: FigSessionWorkerPhase }
  | {
      type: 'population-result'
      requestId: string
      baseRevision: number
      populated: boolean
      delta: FigPopulationDelta
    }
  | { type: 'population-error'; requestId?: string; error: string }
  | { type: 'original-archive-result'; requestId: string; bytes: Uint8Array }
  | { type: 'disposed' }
