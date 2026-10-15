import type { NodeMutationOrigin, SceneGraph } from '@open-pencil/scene-graph'
import { randomHex } from '@open-pencil/scene-graph/random'

import { releaseFigArchive } from '#core/kiwi/fig/session/archive'
import { trackArchiveChanges } from '#core/kiwi/fig/session/archive-changes'
import { updateReaderRecovery, releaseReaderRecovery } from '#core/kiwi/fig/session/document-state'
import type { FigSessionResponse } from '#core/kiwi/fig/session/protocol'

import { applyFigPopulationDelta } from './delta'
import { persistentGraphLevelSignature } from './state-signature'

/** The two responses this client acts on, taken from the session protocol itself. */
type WorkerResult = Extract<FigSessionResponse, { type: 'population-result' | 'population-error' }>

const MAX_FIG_POPULATION_WORKER_NODES = 200_000
const FIG_POPULATION_WORKER_TIMEOUT_MS = 30_000
const LAYOUT_DERIVED_NODE_UPDATE_FIELDS = new Set([
  'counterAxisSizing',
  'derivedLayout',
  'height',
  'primaryAxisSizing',
  'width',
  'x',
  'y'
])
interface FigPopulationWorkerRegistration {
  client: FigPopulationWorker
  populationCapable: boolean
  retired?: boolean
}
const populationWorkers = new WeakMap<SceneGraph, FigPopulationWorkerRegistration>()
interface OriginalArchiveRequest {
  imageRefs: Map<string, Uint8Array>
  request: () => Promise<Uint8Array>
  schemaRef: Uint8Array | null
  signature: string
  valid: boolean
  release: () => void
  unbind: () => void
}
const originalArchiveRequests = new WeakMap<SceneGraph, OriginalArchiveRequest>()

function invalidateOriginalArchiveRequest(graph: SceneGraph): void {
  const entry = originalArchiveRequests.get(graph)
  if (!entry) return
  entry.valid = false
  entry.unbind()
  entry.release()
  originalArchiveRequests.delete(graph)
}

function originalImageRefsMatch(
  images: ReadonlyMap<string, Uint8Array>,
  expected: ReadonlyMap<string, Uint8Array>
): boolean {
  if (images.size !== expected.size) return false
  for (const [key, bytes] of images) {
    const original = expected.get(key)
    if (original !== bytes || original.byteLength !== bytes.byteLength) return false
  }
  return true
}

function immutableBytesRefMatches(bytes: Uint8Array | null, expected: Uint8Array | null): boolean {
  return bytes === expected && (bytes === null || bytes.byteLength === expected?.byteLength)
}

function isTrustedHydration(origin: NodeMutationOrigin | undefined): boolean {
  return origin === 'source-hydration'
}

function isTrustedDerivedComponentSync(origin: NodeMutationOrigin | undefined): boolean {
  return origin === 'derived-component-sync'
}

function onArchiveEdits(
  graph: SceneGraph,
  invalidate: (origin?: NodeMutationOrigin) => void
): () => void {
  return graph.onNodeEvents({
    created: (_node, origin) => invalidate(origin),
    updated: (_id, changes, origin) => {
      const layoutDerived =
        origin === 'derived-layout' &&
        Object.keys(changes).every((key) => LAYOUT_DERIVED_NODE_UPDATE_FIELDS.has(key))
      if (!layoutDerived) invalidate(origin)
    },
    deleted: (_id, _parentId, origin) => invalidate(origin),
    reparented: (_id, _oldParentId, _newParentId, origin) => invalidate(origin),
    reordered: (_id, _parentId, _index, _previousParentId, origin) => invalidate(origin)
  })
}

function originalArchiveMatches(graph: SceneGraph, entry: OriginalArchiveRequest): boolean {
  if (
    !entry.valid ||
    !originalImageRefsMatch(graph.images, entry.imageRefs) ||
    !immutableBytesRefMatches(graph.figSchemaDeflated, entry.schemaRef)
  )
    return false
  const signature = persistentGraphLevelSignature(graph)
  return signature !== null && signature === entry.signature
}

export interface FigPopulationWorkerTelemetry {
  event: 'registered' | 'populate' | 'fallback' | 'stale' | 'terminated'
  reason?: 'oversized' | 'graph-mutation' | 'worker-error'
  durationMs?: number
  applyMs?: number
  created?: number
  updated?: number
  deleted?: number
}

function emitTelemetry(detail: FigPopulationWorkerTelemetry): void {
  if (typeof globalThis.dispatchEvent !== 'function') return
  try {
    globalThis.dispatchEvent(new CustomEvent('openpencil:fig-population-worker', { detail }))
  } catch {
    console.warn('[fig] Could not publish worker diagnostic event.')
  }
}

export function registerFigPopulationWorker(
  graph: SceneGraph,
  worker: Worker,
  port?: MessagePort,
  stopWorker?: () => void
): void {
  if (graph.nodes.size > MAX_FIG_POPULATION_WORKER_NODES) {
    emitTelemetry({ event: 'fallback', reason: 'oversized' })
    if (!port) {
      worker.terminate()
      return
    }
    populationWorkers.set(graph, {
      client: createDisposalOnlyWorker(graph, worker, port),
      populationCapable: false
    })
    return
  }
  const client = createPopulationWorkerClient(graph, worker, port, stopWorker)
  populationWorkers.set(graph, { client, populationCapable: true })
  emitTelemetry({ event: 'registered' })
}

export function canUseFigPopulationWorker(graph: SceneGraph): boolean {
  return populationWorkers.get(graph)?.populationCapable === true
}

export function registerOriginalArchiveRequest(
  graph: SceneGraph,
  request: () => Promise<Uint8Array>,
  release: () => void = () => undefined
): void {
  const previous = originalArchiveRequests.get(graph)
  previous?.unbind()
  previous?.release()
  const signature = persistentGraphLevelSignature(graph)
  const entry: OriginalArchiveRequest = {
    imageRefs: new Map(graph.images),
    request,
    schemaRef: graph.figSchemaDeflated,
    signature: signature ?? '',
    valid: signature !== null,
    release,
    unbind: () => undefined
  }
  const invalidate = (origin?: NodeMutationOrigin) => {
    if (isTrustedHydration(origin) || isTrustedDerivedComponentSync(origin)) return
    entry.valid = false
  }
  entry.unbind = onArchiveEdits(graph, invalidate)
  originalArchiveRequests.set(graph, entry)
  trackArchiveChanges(graph)
}

export async function requestOriginalArchive(graph: SceneGraph): Promise<Uint8Array | null> {
  const entry = originalArchiveRequests.get(graph)
  if (!entry) return null
  const rejectEntry = () => {
    if (originalArchiveRequests.get(graph) === entry) {
      // Close a stale transport while retaining recovery for unloaded-page export.
      populationWorkers.get(graph)?.client.terminate()
      populationWorkers.delete(graph)
      invalidateOriginalArchiveRequest(graph)
    }
    return null
  }
  if (!originalArchiveMatches(graph, entry)) return rejectEntry()
  let archive: Uint8Array
  try {
    archive = await entry.request()
  } catch {
    return rejectEntry()
  }
  if (originalArchiveRequests.get(graph) !== entry) return null
  if (!originalArchiveMatches(graph, entry)) return rejectEntry()
  return archive
}

export function releaseFigPopulationWorker(graph: SceneGraph): void {
  releaseReaderRecovery(graph)
  populationWorkers.get(graph)?.client.terminate()
  populationWorkers.delete(graph)
  const originalArchive = originalArchiveRequests.get(graph)
  originalArchive?.unbind()
  originalArchive?.release()
  originalArchiveRequests.delete(graph)
  releaseFigArchive(graph)
}

export interface FigPopulationWorker {
  populate: (pageId: string, signal?: AbortSignal) => Promise<boolean | null>
  /**
   * Stop loading pages through the worker. The worker itself keeps serving the document's
   * archive until the document closes, which releases it with the archive.
   */
  terminate: () => void
}

function createDisposalOnlyWorker(
  graph: SceneGraph,
  worker: Worker,
  port: MessagePort
): FigPopulationWorker {
  let disposed = false
  let unbind: (() => void) | undefined
  const dispose = (invalidated: boolean) => {
    if (disposed) return
    disposed = true
    unbind?.()
    unbind = undefined
    if (invalidated) invalidateOriginalArchiveRequest(graph)
    port.onmessageerror = null
    worker.onerror = null
    worker.onmessageerror = null
    emitTelemetry({ event: 'terminated' })
    try {
      port.postMessage({ type: 'dispose' })
    } catch {
      console.warn('[fig] Worker disposal message could not be delivered; closing resources.')
    } finally {
      port.close()
      worker.terminate()
      populationWorkers.delete(graph)
    }
  }
  const invalidate = (origin?: NodeMutationOrigin) => {
    if (isTrustedHydration(origin) || isTrustedDerivedComponentSync(origin)) return
    emitTelemetry({ event: 'stale', reason: 'graph-mutation' })
    dispose(true)
  }
  unbind = onArchiveEdits(graph, invalidate)
  port.onmessageerror = () => dispose(true)
  worker.onerror = () => dispose(true)
  worker.onmessageerror = () => dispose(true)
  return {
    populate: () => Promise.resolve(null),
    terminate: () => dispose(false)
  }
}

export function createFigPopulationWorker(graph: SceneGraph): FigPopulationWorker | null {
  const entry = populationWorkers.get(graph)
  return entry?.populationCapable || entry?.retired ? entry.client : null
}

/**
 * The client owns the worker unless `stopWorker` is given: a document whose archive the worker
 * also holds passes the archive's, so that retiring page loading leaves the worker serving it
 * and stopping the worker lets the archive carry on without it.
 */
export function createPopulationWorkerClient(
  graph: SceneGraph,
  worker: Pick<Worker, 'postMessage' | 'terminate' | 'onerror' | 'onmessage' | 'onmessageerror'>,
  port?: Pick<MessagePort, 'postMessage' | 'start' | 'close' | 'onmessage' | 'onmessageerror'>,
  stopWorker?: () => void
): FigPopulationWorker {
  const sharedWorker = !!stopWorker
  const stopWorkerNow = stopWorker ?? (() => worker.terminate())
  const pending = new Map<
    string,
    {
      resolve: (value: boolean | null) => void
      abort?: () => void
      revision: number
      startedAt: number
      timeout: ReturnType<typeof setTimeout>
    }
  >()
  let revision = 0
  let stale = false
  const isStale = () => stale
  let disposed = false
  let failed = false
  let unbind: (() => void) | undefined
  const releaseSubscription = () => {
    unbind?.()
    unbind = undefined
  }
  const fail = (emit = true, stop = true) => {
    if (failed) return
    failed = true
    stale = true
    if (emit) emitTelemetry({ event: 'fallback', reason: 'worker-error' })
    for (const request of pending.values()) {
      clearTimeout(request.timeout)
      request.abort?.()
      request.resolve(null)
    }
    pending.clear()
    releaseSubscription()
    // A session port owns both population and the raw archive. Legacy workers
    // use an independent main-thread archive and must not invalidate it here.
    if (port && !sharedWorker) invalidateOriginalArchiveRequest(graph)
    if (port) {
      port.onmessage = null
      port.onmessageerror = null
    } else worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    if (stop || !sharedWorker) {
      port?.close()
      stopWorkerNow()
    } else port?.postMessage({ type: 'retire' })
    const registered = populationWorkers.get(graph)
    if (!stop && registered) {
      // Retain only a tiny fallback handle. Legacy sessions have already released
      // their worker; shared archive sessions keep serving bytes through their owner.
      registered.client = {
        populate: (_pageId, signal) => {
          signal?.throwIfAborted()
          return Promise.resolve(null)
        },
        terminate: () => undefined
      }
      registered.populationCapable = false
      registered.retired = true
    } else populationWorkers.delete(graph)
  }
  const invalidate = (origin?: NodeMutationOrigin) => {
    if (stale || isTrustedHydration(origin) || isTrustedDerivedComponentSync(origin)) return
    revision++
    stale = true
    emitTelemetry({ event: 'stale', reason: 'graph-mutation' })
    // A stale retained graph and its raw archive can never be used again.
    // Release the shared session immediately instead of holding large import
    // structures until the document closes.
    fail(false, false)
  }
  unbind = onArchiveEdits(graph, invalidate)
  const receive = (result: WorkerResult) => {
    if (result.type === 'population-error') return fail(true, false)
    const request = pending.get(result.requestId)
    if (!request) return
    clearTimeout(request.timeout)
    request.abort?.()
    pending.delete(result.requestId)
    if (stale || revision !== request.revision || result.baseRevision !== request.revision) {
      emitTelemetry({ event: 'stale', reason: 'graph-mutation' })
      return request.resolve(null)
    }
    const applyStartedAt = performance.now()
    try {
      applyFigPopulationDelta(graph, result.delta)
      if (result.checkpoint) updateReaderRecovery(graph, result.checkpoint)
    } catch {
      fail()
      return request.resolve(null)
    }
    if (isStale()) return request.resolve(null)
    request.resolve(result.populated)
    emitTelemetry({
      event: 'populate',
      durationMs: performance.now() - request.startedAt,
      applyMs: performance.now() - applyStartedAt,
      created: result.delta.created.length,
      updated: result.delta.updated.length,
      deleted: result.delta.deleted.length
    })
  }
  if (port) {
    port.onmessage = (event: MessageEvent<WorkerResult>) => receive(event.data)
    port.start()
  } else {
    worker.onmessage = (event: MessageEvent<WorkerResult>) => receive(event.data)
  }
  if (port) port.onmessageerror = () => fail()
  worker.onerror = () => fail()
  worker.onmessageerror = () => fail()
  return {
    populate(pageId, signal) {
      signal?.throwIfAborted()
      if (stale) return Promise.resolve(null)
      const requestId = randomHex()
      const baseRevision = revision
      return new Promise((resolve, reject) => {
        const abort = () => {
          const request = pending.get(requestId)
          if (!request) return
          clearTimeout(request.timeout)
          pending.delete(requestId)
          fail(false)
          reject(new DOMException('Aborted', 'AbortError'))
        }
        signal?.addEventListener('abort', abort, { once: true })
        const timeout = setTimeout(() => fail(), FIG_POPULATION_WORKER_TIMEOUT_MS)
        pending.set(requestId, {
          resolve,
          abort: () => signal?.removeEventListener('abort', abort),
          revision: baseRevision,
          startedAt: performance.now(),
          timeout
        })
        if (port)
          port.postMessage({
            type: 'populate',
            requestId,
            baseRevision,
            pageId
          })
        else worker.postMessage({ type: 'populate', requestId, baseRevision, pageId }, [])
      })
    },
    terminate() {
      if (disposed) return
      disposed = true
      emitTelemetry({ event: 'terminated' })
      try {
        port?.postMessage({ type: 'dispose' })
      } catch {
        console.warn('[fig] Worker disposal message could not be delivered; closing resources.')
      }
      fail(false)
    }
  }
}
