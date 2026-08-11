/// <reference lib="webworker" />
/* oxlint-disable unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope postMessage has no target origin. */

import { archiveProjectFiles } from '@/app/plugins/host/project-archive'

import { installVueSourceWorkerEntry, vueSourceWorkerErrorResponse } from '../worker/entry'
import {
  VUE_SOURCE_ARCHIVE_WORKER_PROTOCOL_VERSION,
  assertVueSourceArchiveWorkerOutput,
  validateVueSourceArchiveWorkerRequest,
  type VueSourceArchiveWorkerResponse
} from './protocol'

installVueSourceWorkerEntry({
  defaultError: 'Vue archive Worker failed',
  async execute(value) {
    validateVueSourceArchiveWorkerRequest(value)
    const request = value
    const bytes = await archiveProjectFiles(request.files)
    assertVueSourceArchiveWorkerOutput(bytes)
    globalThis.postMessage({
      version: VUE_SOURCE_ARCHIVE_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      bytes
    } satisfies VueSourceArchiveWorkerResponse)
  },
  errorResponse(requestId, error) {
    return vueSourceWorkerErrorResponse(
      VUE_SOURCE_ARCHIVE_WORKER_PROTOCOL_VERSION,
      requestId,
      error
    ) satisfies VueSourceArchiveWorkerResponse
  }
})
