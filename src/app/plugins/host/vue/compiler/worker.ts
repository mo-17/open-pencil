/// <reference lib="webworker" />
/* oxlint-disable unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope postMessage has no target origin. */

import { compile } from '@open-pencil/compiler'

import { installVueSourceWorkerEntry, vueSourceWorkerErrorResponse } from '../worker/entry'
import {
  VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
  assertVueCompilerOutputWithinLimits,
  restoreVueCompilerGraph,
  validateVueSourceCompilerWorkerRequest,
  type VueSourceCompilerWorkerResponse
} from './protocol'

installVueSourceWorkerEntry({
  defaultError: 'Vue compiler Worker failed',
  execute(value) {
    validateVueSourceCompilerWorkerRequest(value)
    const request = value
    const output = compile({
      graph: restoreVueCompilerGraph(request.graph),
      pageIds: request.pageIds,
      options: request.options,
      fontManifest: request.fontManifest
    })
    // Bound output before structured clone copies it back into the editor.
    assertVueCompilerOutputWithinLimits(output)
    globalThis.postMessage({
      version: VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      output
    } satisfies VueSourceCompilerWorkerResponse)
  },
  errorResponse(requestId, error) {
    return vueSourceWorkerErrorResponse(
      VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
      requestId,
      error
    ) satisfies VueSourceCompilerWorkerResponse
  }
})
