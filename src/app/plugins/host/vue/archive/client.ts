import { createPluginExportAbortError } from '@/app/plugins/host/exporter-abort'

import {
  resolveVueSourceWorkerTimeout,
  runVueSourceWorkerRequest,
  type VueSourceWorkerClientOptions,
  type VueSourceWorkerLike
} from '../worker/client'
import {
  VUE_SOURCE_ARCHIVE_WORKER_PROTOCOL_VERSION,
  createVueSourceArchiveWorkerRequest,
  parseVueSourceArchiveWorkerResponse,
  type VueSourceArchiveWorkerRequest
} from './protocol'

export type VueSourceArchiveWorkerLike = VueSourceWorkerLike
export type CreateVueSourceArchiverOptions = VueSourceWorkerClientOptions

function defaultWorkerFactory(): VueSourceArchiveWorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), {
    name: 'openpencil-vue-source-archive',
    type: 'module'
  })
}

export function createVueSourceArchiver(options: CreateVueSourceArchiverOptions = {}) {
  const workerFactory = options.workerFactory ?? defaultWorkerFactory
  const timeoutMs = resolveVueSourceWorkerTimeout(options.timeoutMs, 'Vue archive Worker')

  async function archive(
    files: ReadonlyMap<string, string | Uint8Array>,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    if (signal?.aborted) throw createPluginExportAbortError()
    const request: VueSourceArchiveWorkerRequest = createVueSourceArchiveWorkerRequest(
      files,
      crypto.randomUUID()
    )
    return runVueSourceWorkerRequest({
      label: 'Vue archive Worker',
      parseResponse: parseVueSourceArchiveWorkerResponse,
      readResponse(response) {
        if (response.type === 'error') {
          throw new Error(`Vue archive Worker failed: ${response.error}`)
        }
        return response.bytes
      },
      request,
      requestId: request.requestId,
      signal,
      timeoutMs,
      workerFactory
    })
  }

  return Object.freeze({ archive })
}

const DEFAULT_VUE_SOURCE_ARCHIVER = createVueSourceArchiver()

export function archiveVueSourceProjectInWorker(
  files: ReadonlyMap<string, string | Uint8Array>,
  signal?: AbortSignal
): Promise<Uint8Array> {
  return DEFAULT_VUE_SOURCE_ARCHIVER.archive(files, signal)
}

export { VUE_SOURCE_ARCHIVE_WORKER_PROTOCOL_VERSION }
