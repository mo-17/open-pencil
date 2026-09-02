import { parseFigBuffer } from '@open-pencil/fig'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { importNodeChanges } from '#core/kiwi/fig/import'
import { getLazyFigImportContext, populateLazyFigImportRoots } from '#core/kiwi/fig/lazy-import'
import { serializeSceneGraph } from '#core/kiwi/fig/parse/transfer'
import { buildFigPopulationDelta, installFigMutationJournal } from '#core/kiwi/fig/population/delta'
import type {
  FigSessionOpenRequest,
  FigSessionRequest,
  FigSessionResponse,
  FigSessionWorkerPhase
} from '#core/kiwi/fig/session/protocol'

let graph: SceneGraph | undefined
let originalArchive: Uint8Array | undefined
let port: MessagePort | undefined

function respond(message: FigSessionResponse): void {
  port?.postMessage(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function respondGraphError(error: unknown, phase: FigSessionWorkerPhase): void {
  respond({ type: 'graph', error: errorMessage(error), phase })
}

class FigSessionTransportError extends Error {
  override name = 'FigSessionTransportError'
}

function populate(request: Extract<FigSessionRequest, { type: 'populate' }>): void {
  if (!graph) throw new Error('FIG session has no retained graph')
  const context = getLazyFigImportContext(graph)
  if (!context) throw new Error('FIG session has no lazy import context')
  const journal = installFigMutationJournal(graph)
  try {
    const populated = populateLazyFigImportRoots(graph, [request.pageId])
    respond({
      type: 'population-result',
      requestId: request.requestId,
      baseRevision: request.baseRevision,
      populated,
      delta: buildFigPopulationDelta(graph, journal, context.populatedRootIds)
    })
  } finally {
    journal.stop()
  }
}

function handleRequest(request: FigSessionRequest): void {
  try {
    if (request.type === 'original-archive') {
      if (!originalArchive) throw new Error('FIG session has no original archive')
      const bytes = originalArchive.slice()
      port?.postMessage({ type: 'original-archive-result', requestId: request.requestId, bytes }, [
        bytes.buffer
      ])
      return
    }
    if (request.type === 'dispose') {
      graph = undefined
      originalArchive = undefined
      try {
        respond({ type: 'disposed' })
      } finally {
        port?.close()
        port = undefined
        self.close()
      }
      return
    }
    if (request.type === 'cancel') return
    populate(request)
  } catch (error) {
    respond({
      type: 'population-error',
      requestId: 'requestId' in request ? request.requestId : undefined,
      error: errorMessage(error)
    })
  }
}

self.onmessage = (event: MessageEvent<FigSessionOpenRequest>) => {
  const request = event.data
  port = request.port
  port.onmessage = (message: MessageEvent<FigSessionRequest>) => handleRequest(message.data)
  port.start()
  let parsed: ReturnType<typeof parseFigBuffer>
  try {
    parsed = parseFigBuffer(request.buffer, {
      limits: request.options?.archiveLimits,
      onPages: (pages) => {
        try {
          respond({ type: 'page-manifest', pages })
        } catch (error) {
          throw new FigSessionTransportError(errorMessage(error))
        }
      }
    })
  } catch (error) {
    respondGraphError(error, error instanceof FigSessionTransportError ? 'transport' : 'parse')
    return
  }
  try {
    originalArchive = new Uint8Array(request.buffer.slice(0))
  } catch (error) {
    respondGraphError(error, 'transport')
    return
  }

  let parsedGraph: SceneGraph
  try {
    const { nodeChanges, blobs, images, figKiwiVersion, figSchemaDeflated, objectAnimations } =
      parsed
    parsedGraph = importNodeChanges(nodeChanges, blobs, new Map(images), {
      populate: request.options?.populate,
      maxGraphNodes: request.options?.archiveLimits?.maxGraphNodes,
      maxTreeDepth: request.options?.archiveLimits?.maxTreeDepth
    })
    parsedGraph.figKiwiVersion = figKiwiVersion
    parsedGraph.figSchemaDeflated = figSchemaDeflated
    parsedGraph.figMessageObjectAnimations = objectAnimations
    graph = request.options?.populate === 'first-page' ? parsedGraph : undefined
  } catch (error) {
    graph = undefined
    respondGraphError(error, 'import')
    return
  }

  try {
    // Do not transfer serialized buffers: the retained graph remains the source
    // for later lazy-population deltas in this per-document session.
    respond({ type: 'graph', graph: serializeSceneGraph(parsedGraph) })
  } catch (error) {
    graph = undefined
    respondGraphError(error, 'transport')
  }
}
