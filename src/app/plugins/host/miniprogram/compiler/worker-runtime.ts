/* oxlint-disable unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope has no target origin. */

import { compile, type CompilerFontManifest } from '@open-pencil/compiler'

import { safeMiniProgramWorkerErrorMessage } from '../artifact-security'
import type { MiniProgramSourceCompilerWorkerBootstrapScope } from './bootstrap'
import { miniProgramSourceCompilerWorkerCorrelation } from './bootstrap'
import {
  MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
  assertMiniProgramCompilerOutputForTransfer,
  restoreMiniProgramCompilerGraph,
  validateMiniProgramSourceCompilerWorkerRequest,
  type MiniProgramSourceCompilerWorkerRequest,
  type MiniProgramSourceCompilerWorkerResponse,
  type MiniProgramSourceCompilerWorkerStage
} from './protocol'

const EMPTY_FONT_MANIFEST: CompilerFontManifest = Object.freeze({ faces: [] })

function now(): number {
  return performance.now()
}

function postProgress(
  scope: MiniProgramSourceCompilerWorkerBootstrapScope,
  requestId: string,
  stage: MiniProgramSourceCompilerWorkerStage,
  startedAt: number
): void {
  scope.postMessage({
    version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
    type: 'progress',
    requestId,
    stage,
    elapsedMs: Math.max(0, now() - startedAt)
  } satisfies MiniProgramSourceCompilerWorkerResponse)
}

function postError(
  scope: MiniProgramSourceCompilerWorkerBootstrapScope,
  requestId: string,
  cause: unknown
): void {
  const message = cause instanceof Error && cause.message ? cause.message : 'Worker failed'
  scope.postMessage({
    version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
    type: 'error',
    requestId,
    error: safeMiniProgramWorkerErrorMessage(message).slice(0, 2_048)
  } satisfies MiniProgramSourceCompilerWorkerResponse)
}

export async function executeMiniProgramSourceCompilerWorkerRequest(
  value: unknown,
  scope: MiniProgramSourceCompilerWorkerBootstrapScope = globalThis
): Promise<void> {
  const correlation = miniProgramSourceCompilerWorkerCorrelation(value)
  if (!correlation) return
  const startedAt = now()
  try {
    postProgress(scope, correlation.requestId, 'validate', startedAt)
    validateMiniProgramSourceCompilerWorkerRequest(value)
    const request: MiniProgramSourceCompilerWorkerRequest = value

    postProgress(scope, request.requestId, 'restore', startedAt)
    const graph = restoreMiniProgramCompilerGraph(request.graph)

    postProgress(scope, request.requestId, 'compile', startedAt)
    const output = compile({
      graph,
      pageIds: request.pageIds,
      options: request.options,
      // Source-only mini-program exports deliberately receive no host font
      // objects, downloaded bytes, credentials, or provider state. Passing an
      // explicit empty manifest preserves authored family names and makes every
      // omitted custom face visible as a compiler warning.
      fontManifest: EMPTY_FONT_MANIFEST
    })

    postProgress(scope, request.requestId, 'audit', startedAt)
    assertMiniProgramCompilerOutputForTransfer(output)
    scope.postMessage({
      version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      output
    } satisfies MiniProgramSourceCompilerWorkerResponse)
  } catch (cause) {
    postError(scope, correlation.requestId, cause)
  }
}
