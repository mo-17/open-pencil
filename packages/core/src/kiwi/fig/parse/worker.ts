import { parseFigBuffer } from '@open-pencil/fig'
import type { FigArchiveLimits } from '@open-pencil/fig'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { importNodeChanges } from '#core/kiwi/fig/import'
import { getLazyFigImportContext, populateLazyFigImportRoots } from '#core/kiwi/fig/lazy-import'
import {
  serializeSceneGraph,
  serializedSceneGraphTransferList
} from '#core/kiwi/fig/parse/transfer'
import { buildFigPopulationDelta, installFigMutationJournal } from '#core/kiwi/fig/population/delta'

interface WorkerParseRequest {
  buffer: ArrayBuffer
  options?: { populate?: 'all' | 'first-page' | 'none'; archiveLimits?: FigArchiveLimits }
}
interface PopulateRequest {
  type: 'populate'
  requestId: string
  baseRevision: number
  pageId: string
}
type WorkerRequest = ArrayBuffer | WorkerParseRequest | PopulateRequest
type WorkerPostMessage = (message: unknown, transfer: Transferable[]) => void
const postWorkerMessage: WorkerPostMessage = (message, transfer) => {
  globalThis.postMessage(message, { transfer })
}
let graph: SceneGraph | undefined

type WorkerErrorPhase = 'parse' | 'import' | 'transport'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function postError(error: unknown, phase: WorkerErrorPhase): void {
  postWorkerMessage({ error: errorMessage(error), phase }, [])
}

function isPopulateRequest(request: WorkerRequest): request is PopulateRequest {
  return !(request instanceof ArrayBuffer) && 'type' in request
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  if (isPopulateRequest(request)) {
    try {
      if (!graph) throw new Error('FIG parse worker has no retained graph')
      const journal = installFigMutationJournal(graph)
      try {
        const populated = populateLazyFigImportRoots(graph, [request.pageId])
        const context = getLazyFigImportContext(graph)
        if (!context) throw new Error('FIG population worker has no lazy import context')
        postWorkerMessage(
          {
            type: 'population-result',
            requestId: request.requestId,
            baseRevision: request.baseRevision,
            populated,
            delta: buildFigPopulationDelta(graph, journal, context.populatedRootIds)
          },
          []
        )
      } finally {
        journal.stop()
      }
    } catch (error) {
      postWorkerMessage({ type: 'population-error', error: errorMessage(error) }, [])
    }
    return
  }

  const parseRequest: WorkerParseRequest =
    request instanceof ArrayBuffer ? { buffer: request } : request
  let parsed: ReturnType<typeof parseFigBuffer>
  try {
    parsed = parseFigBuffer(parseRequest.buffer, {
      limits: parseRequest.options?.archiveLimits,
      onPages: (pages) => postWorkerMessage({ type: 'page-manifest', pages }, [])
    })
  } catch (error) {
    postError(error, 'parse')
    return
  }

  let parsedGraph: ReturnType<typeof importNodeChanges>
  try {
    const { nodeChanges, blobs, images, figKiwiVersion, figSchemaDeflated, objectAnimations } =
      parsed
    parsedGraph = importNodeChanges(nodeChanges, blobs, new Map(images), {
      populate: parseRequest.options?.populate,
      maxGraphNodes: parseRequest.options?.archiveLimits?.maxGraphNodes,
      maxTreeDepth: parseRequest.options?.archiveLimits?.maxTreeDepth
    })
    parsedGraph.figKiwiVersion = figKiwiVersion
    parsedGraph.figSchemaDeflated = figSchemaDeflated
    parsedGraph.figMessageObjectAnimations = objectAnimations
    graph = parseRequest.options?.populate === 'first-page' ? parsedGraph : undefined
  } catch (error) {
    graph = undefined
    postError(error, 'import')
    return
  }

  try {
    const serialized = serializeSceneGraph(parsedGraph)
    const transfer =
      parseRequest.options?.populate === 'first-page'
        ? []
        : serializedSceneGraphTransferList(serialized)
    postWorkerMessage({ type: 'graph', graph: serialized }, transfer)
  } catch (error) {
    postError(error, 'transport')
  }
}
