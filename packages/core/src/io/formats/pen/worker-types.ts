import type { PenParseLimits } from '@open-pencil/pen'

import type { SerializedSceneGraph } from '#core/kiwi/fig/parse/transfer'

export interface PenWorkerRequest {
  buffer: ArrayBuffer
  limits: PenParseLimits
}

export interface PenWorkerError {
  name: string
  message: string
}

export interface PenWorkerResponse {
  graph?: SerializedSceneGraph
  error?: PenWorkerError
}
