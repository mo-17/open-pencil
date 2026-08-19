import type { CompilerInput, CompilerOutput } from '@open-pencil/compiler'

import { createPluginExportAbortError } from '@/app/plugins/host/exporter-abort'
import {
  resolveVueSourceWorkerTimeout,
  type VueSourceWorkerLike
} from '@/app/plugins/host/vue/worker/client'
import {
  hasCorrelatedWorkerRequestId,
  normalizeWorkerError,
  postWorkerRequestWithoutTransfer
} from '@/app/workers/correlation'

import { MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS } from './limits'
import {
  createMiniProgramSourceCompilerWorkerRequest,
  parseMiniProgramSourceCompilerWorkerResponse,
  type MiniProgramSourceCompilerWorkerRequest,
  type MiniProgramSourceCompilerWorkerStage
} from './protocol'

export type MiniProgramSourceCompilerWorkerLike = VueSourceWorkerLike
export interface CreateMiniProgramSourceCompilerOptions {
  workerFactory?: () => MiniProgramSourceCompilerWorkerLike
  /** Maximum silence between validated Worker stage messages. */
  timeoutMs?: number
  /** Hard request ceiling even when validated progress continues. */
  totalTimeoutMs?: number
  onProgress?: (stage: MiniProgramSourceCompilerWorkerStage, elapsedMs: number) => void
}

function defaultWorkerFactory(): MiniProgramSourceCompilerWorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), {
    name: 'openpencil-miniprogram-source-compiler',
    type: 'module'
  })
}

function resolveTotalTimeout(value: number | undefined, stageTimeoutMs: number): number {
  const timeout = value ?? MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.totalTimeoutMs
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < stageTimeoutMs ||
    timeout > MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.totalTimeoutMs
  ) {
    throw new TypeError(
      `Mini-program compiler Worker total timeout must be between ${stageTimeoutMs} and ${MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.totalTimeoutMs}ms`
    )
  }
  return timeout
}

export function createMiniProgramSourceCompiler(
  options: CreateMiniProgramSourceCompilerOptions = {}
) {
  const workerFactory = options.workerFactory ?? defaultWorkerFactory
  const timeoutMs = resolveVueSourceWorkerTimeout(
    options.timeoutMs ?? MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.timeoutMs,
    'Mini-program compiler Worker'
  )
  const totalTimeoutMs = resolveTotalTimeout(options.totalTimeoutMs, timeoutMs)

  function runRequest(
    request: MiniProgramSourceCompilerWorkerRequest,
    signal?: AbortSignal
  ): Promise<CompilerOutput> {
    if (signal?.aborted) return Promise.reject(createPluginExportAbortError())
    let worker: MiniProgramSourceCompilerWorkerLike
    try {
      worker = workerFactory()
    } catch (cause) {
      return Promise.reject(normalizeWorkerError(cause))
    }

    return new Promise<CompilerOutput>((resolve, reject) => {
      let settled = false
      let stageTimer: ReturnType<typeof setTimeout> | null = null
      let totalTimer: ReturnType<typeof setTimeout> | null = null
      let currentStage = 'starting'

      const finish = (operation: () => void): void => {
        if (settled) return
        settled = true
        if (stageTimer !== null) clearTimeout(stageTimer)
        if (totalTimer !== null) clearTimeout(totalTimer)
        signal?.removeEventListener('abort', abort)
        worker.onmessage = null
        worker.onerror = null
        worker.terminate()
        operation()
      }
      const abort = (): void => finish(() => reject(createPluginExportAbortError()))
      const scheduleStageTimeout = (): void => {
        if (stageTimer !== null) clearTimeout(stageTimer)
        stageTimer = setTimeout(
          () =>
            finish(() =>
              reject(
                new Error(
                  `Mini-program compiler Worker exceeded ${timeoutMs}ms during stage "${currentStage}"`
                )
              )
            ),
          timeoutMs
        )
      }

      scheduleStageTimeout()
      totalTimer = setTimeout(
        () =>
          finish(() =>
            reject(
              new Error(
                `Mini-program compiler Worker exceeded the ${totalTimeoutMs}ms total limit during stage "${currentStage}"`
              )
            )
          ),
        totalTimeoutMs
      )

      worker.onmessage = (event) => {
        try {
          const response = parseMiniProgramSourceCompilerWorkerResponse(
            event.data,
            request.requestId
          )
          if (!response) {
            if (hasCorrelatedWorkerRequestId(event.data, request.requestId)) {
              finish(() =>
                reject(new Error('Mini-program compiler Worker returned an invalid response'))
              )
            }
            return
          }
          if (response.type === 'error') {
            finish(() =>
              reject(new Error(`Mini-program compiler Worker failed: ${response.error}`))
            )
            return
          }
          if (response.type === 'progress') {
            currentStage = response.stage
            options.onProgress?.(response.stage, response.elapsedMs)
            scheduleStageTimeout()
            return
          }
          finish(() => resolve(response.output))
        } catch (cause) {
          finish(() => reject(normalizeWorkerError(cause)))
        }
      }
      worker.onerror = (event) =>
        finish(() => reject(new Error(event.message || 'Mini-program compiler Worker failed')))
      postWorkerRequestWithoutTransfer({
        worker,
        request,
        signal,
        abort,
        fail: (error) => finish(() => reject(error))
      })
    })
  }

  async function compile(input: CompilerInput, signal?: AbortSignal): Promise<CompilerOutput> {
    if (signal?.aborted) throw createPluginExportAbortError()
    const request: MiniProgramSourceCompilerWorkerRequest =
      createMiniProgramSourceCompilerWorkerRequest(input, crypto.randomUUID())
    return runRequest(request, signal)
  }

  return Object.freeze({ compile })
}

const DEFAULT_MINIPROGRAM_SOURCE_COMPILER = createMiniProgramSourceCompiler()

export function compileMiniProgramSourceProjectInWorker(
  input: CompilerInput,
  signal?: AbortSignal
): Promise<CompilerOutput> {
  return DEFAULT_MINIPROGRAM_SOURCE_COMPILER.compile(input, signal)
}
