import { parseFigBuffer } from '@open-pencil/fig'

import { importNodeChanges } from '#core/kiwi/fig/import'
import {
  serializeSceneGraph,
  serializedSceneGraphTransferList
} from '#core/kiwi/fig/parse/transfer'

interface WorkerParseRequest {
  buffer: ArrayBuffer
  options?: { populate?: 'all' | 'first-page' }
}

type WorkerErrorPhase = 'parse' | 'import' | 'transport'

type WorkerScope = typeof self & {
  postMessage(message: unknown, transfer: Transferable[]): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function postError(error: unknown, phase: WorkerErrorPhase): void {
  self.postMessage({ error: errorMessage(error), phase })
}

self.onmessage = (e: MessageEvent<ArrayBuffer | WorkerParseRequest>) => {
  const request = e.data instanceof ArrayBuffer ? { buffer: e.data } : e.data
  let parsed: ReturnType<typeof parseFigBuffer>
  try {
    parsed = parseFigBuffer(request.buffer)
  } catch (error) {
    postError(error, 'parse')
    return
  }

  let graph: ReturnType<typeof importNodeChanges>
  try {
    const { nodeChanges, blobs, images, figKiwiVersion, figSchemaDeflated, objectAnimations } =
      parsed
    graph = importNodeChanges(nodeChanges, blobs, new Map(images), request.options)
    graph.figKiwiVersion = figKiwiVersion
    graph.figSchemaDeflated = figSchemaDeflated
    graph.figMessageObjectAnimations = objectAnimations
  } catch (error) {
    postError(error, 'import')
    return
  }

  try {
    const serialized = serializeSceneGraph(graph)
    ;(self as WorkerScope).postMessage(
      { graph: serialized },
      serializedSceneGraphTransferList(serialized)
    )
  } catch (error) {
    postError(error, 'transport')
  }
}
