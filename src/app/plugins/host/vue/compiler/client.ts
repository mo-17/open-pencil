import type { CompilerInput, CompilerOutput } from '@open-pencil/compiler'

import { createPluginExportAbortError } from '@/app/plugins/host/exporter-abort'

import {
  resolveVueSourceWorkerTimeout,
  runVueSourceWorkerRequest,
  type VueSourceWorkerClientOptions,
  type VueSourceWorkerLike
} from '../worker/client'
import {
  createVueSourceCompilerWorkerRequest,
  parseVueSourceCompilerWorkerResponse,
  type VueSourceCompilerWorkerRequest
} from './protocol'

export type VueSourceCompilerWorkerLike = VueSourceWorkerLike
export type CreateVueSourceCompilerOptions = VueSourceWorkerClientOptions

function defaultWorkerFactory(): VueSourceCompilerWorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), {
    name: 'openpencil-vue-source-compiler',
    type: 'module'
  })
}

export function createVueSourceCompiler(options: CreateVueSourceCompilerOptions = {}) {
  const workerFactory = options.workerFactory ?? defaultWorkerFactory
  const timeoutMs = resolveVueSourceWorkerTimeout(options.timeoutMs, 'Vue compiler Worker')

  async function compile(input: CompilerInput, signal?: AbortSignal): Promise<CompilerOutput> {
    if (signal?.aborted) throw createPluginExportAbortError()
    const request: VueSourceCompilerWorkerRequest = createVueSourceCompilerWorkerRequest(
      input,
      crypto.randomUUID()
    )
    return runVueSourceWorkerRequest({
      label: 'Vue compiler Worker',
      parseResponse: parseVueSourceCompilerWorkerResponse,
      readResponse(response) {
        if (response.type === 'error') {
          throw new Error(`Vue compiler Worker failed: ${response.error}`)
        }
        return response.output
      },
      request,
      requestId: request.requestId,
      signal,
      timeoutMs,
      workerFactory
    })
  }

  return Object.freeze({ compile })
}

const DEFAULT_VUE_SOURCE_COMPILER = createVueSourceCompiler()

export function compileVueSourceProjectInWorker(
  input: CompilerInput,
  signal?: AbortSignal
): Promise<CompilerOutput> {
  return DEFAULT_VUE_SOURCE_COMPILER.compile(input, signal)
}
