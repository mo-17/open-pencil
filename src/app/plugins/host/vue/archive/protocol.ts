import { validateProjectArchivePath } from '@/app/plugins/host/project-archive'

import { assertVueCompilerOutputWithinLimits } from '../compiler/protocol'

export const VUE_SOURCE_ARCHIVE_WORKER_PROTOCOL_VERSION = 1

export interface VueSourceArchiveWorkerRequest {
  version: typeof VUE_SOURCE_ARCHIVE_WORKER_PROTOCOL_VERSION
  type: 'archive-vue'
  requestId: string
  files: Map<string, string | Uint8Array>
}

export type VueSourceArchiveWorkerResponse =
  | {
      version: typeof VUE_SOURCE_ARCHIVE_WORKER_PROTOCOL_VERSION
      type: 'result'
      requestId: string
      bytes: Uint8Array
    }
  | {
      version: typeof VUE_SOURCE_ARCHIVE_WORKER_PROTOCOL_VERSION
      type: 'error'
      requestId: string
      error: string
    }

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value)
}

function boundedFiles(files: Map<string, string | Uint8Array>): void {
  assertVueCompilerOutputWithinLimits({ files, warnings: [] })
  for (const path of files.keys()) validateProjectArchivePath(path)
}

export function createVueSourceArchiveWorkerRequest(
  files: ReadonlyMap<string, string | Uint8Array>,
  requestId: string
): VueSourceArchiveWorkerRequest {
  if (!validRequestId(requestId)) throw new TypeError('Vue archive Worker request id is invalid')
  const mutableFiles = files instanceof Map ? files : new Map(files)
  boundedFiles(mutableFiles)
  return {
    version: VUE_SOURCE_ARCHIVE_WORKER_PROTOCOL_VERSION,
    type: 'archive-vue',
    requestId,
    files: mutableFiles
  }
}

export function validateVueSourceArchiveWorkerRequest(
  value: unknown
): asserts value is VueSourceArchiveWorkerRequest {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('Vue archive Worker request is invalid')
  }
  const request = value as Partial<VueSourceArchiveWorkerRequest>
  if (
    request.version !== VUE_SOURCE_ARCHIVE_WORKER_PROTOCOL_VERSION ||
    request.type !== 'archive-vue' ||
    !validRequestId(request.requestId) ||
    !(request.files instanceof Map)
  ) {
    throw new TypeError('Vue archive Worker request is invalid')
  }
  boundedFiles(request.files)
}

function boundedArchive(bytes: Uint8Array): void {
  assertVueCompilerOutputWithinLimits({
    files: new Map([['vue-project.zip', bytes]]),
    warnings: []
  })
}

export function parseVueSourceArchiveWorkerResponse(
  value: unknown,
  expectedRequestId: string
): VueSourceArchiveWorkerResponse | null {
  if (value === null || typeof value !== 'object') return null
  const response = value as Partial<VueSourceArchiveWorkerResponse>
  if (
    response.version !== VUE_SOURCE_ARCHIVE_WORKER_PROTOCOL_VERSION ||
    response.requestId !== expectedRequestId
  ) {
    return null
  }
  if (
    response.type === 'error' &&
    typeof response.error === 'string' &&
    response.error.length <= 2_048
  ) {
    return response as VueSourceArchiveWorkerResponse
  }
  if (response.type !== 'result' || !(response.bytes instanceof Uint8Array)) return null
  boundedArchive(response.bytes)
  return response as VueSourceArchiveWorkerResponse
}

export function assertVueSourceArchiveWorkerOutput(bytes: Uint8Array): void {
  boundedArchive(bytes)
}
