import { parsePenFile, resolvePenParseLimits } from '@open-pencil/pen'

import type { PenWorkerError, PenWorkerRequest } from '#core/io/formats/pen/worker-types'
import {
  serializeSceneGraph,
  serializedSceneGraphTransferList
} from '#core/kiwi/fig/parse/transfer'

type WorkerPostMessage = (message: unknown, transfer: Transferable[]) => void

const postWorkerMessage: WorkerPostMessage = (message, transfer) => {
  globalThis.postMessage(message, { transfer })
}

self.onmessage = (event: MessageEvent<PenWorkerRequest>) => {
  try {
    if (!(event.data.buffer instanceof ArrayBuffer)) {
      throw new TypeError('Worker .pen request must contain an ArrayBuffer')
    }
    const limits = resolvePenParseLimits(event.data.limits)
    let source: string
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(event.data.buffer)
    } catch {
      throw new TypeError('Untrusted .pen input must contain valid UTF-8')
    }
    const graph = parsePenFile(source, { limits })
    const serialized = serializeSceneGraph(graph)
    postWorkerMessage({ graph: serialized }, serializedSceneGraphTransferList(serialized))
  } catch (error) {
    postWorkerMessage({ error: workerError(error) }, [])
  }
}

function workerError(error: unknown): PenWorkerError {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) }
}
