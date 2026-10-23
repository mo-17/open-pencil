import { compile } from '@open-pencil/compiler'

import {
  assertVueCompilerOutputWithinLimits,
  restoreVueCompilerGraph,
  validateVueSourceCompilerWorkerRequest,
  type VueSourceCompilerWorkerResponse
} from './protocol'
import { VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION } from './version'

export function executeVueSourceCompilerWorkerRequest(
  value: unknown
): VueSourceCompilerWorkerResponse {
  validateVueSourceCompilerWorkerRequest(value)
  const request = value
  const output = compile({
    graph: restoreVueCompilerGraph(request.graph),
    pageIds: request.pageIds,
    options: request.options,
    fontManifest: request.fontManifest
  })
  assertVueCompilerOutputWithinLimits(output)
  return {
    version: VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
    type: 'result',
    requestId: request.requestId,
    output
  }
}
