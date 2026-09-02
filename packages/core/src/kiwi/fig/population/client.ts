import type { NodeMutationOrigin, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { getLazyFigImportContext, setLazyFigImportContext } from '#core/kiwi/fig/lazy-import'
import type { FigSessionResponse } from '#core/kiwi/fig/session/protocol'
import { randomHex } from '#core/random'

import { applyFigPopulationDelta, type FigPopulationDelta } from './delta'
import { persistentGraphLevelSignature } from './state-signature'

interface PopulationResult {
  type: 'population-result'
  requestId: string
  baseRevision: number
  populated: boolean
  delta: FigPopulationDelta
}
type WorkerResult = PopulationResult | { type: 'population-error'; error: string }

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
    // Diagnostics must never change worker ownership or document behavior.
  }
}

export function registerFigPopulationWorker(
  graph: SceneGraph,
  worker: Worker,
  port?: MessagePort
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
  const client = createPopulationWorkerClient(graph, worker, port)
  populationWorkers.set(graph, { client, populationCapable: true })
  emitTelemetry({ event: 'registered' })
}

function isDevelopmentBuild(env?: { DEV?: boolean }): boolean {
  return env?.DEV ?? false
}

export function canUseFigPopulationWorker(graph: SceneGraph): boolean {
  const registration = populationWorkers.get(graph)
  return (
    isDevelopmentBuild(import.meta.env) &&
    registration?.populationCapable === true &&
    getLazyFigImportContext(graph) !== undefined
  )
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
  const invalidateUpdate = (
    _id: string,
    changes: Partial<SceneNode>,
    origin?: NodeMutationOrigin
  ) => {
    if (isTrustedHydration(origin) || isTrustedDerivedComponentSync(origin)) return
    const layoutDerived =
      origin === 'derived-layout' &&
      Object.keys(changes).every((key) => LAYOUT_DERIVED_NODE_UPDATE_FIELDS.has(key))
    if (!layoutDerived) entry.valid = false
  }
  entry.unbind = graph.onNodeEvents({
    created: (_node, origin) => invalidate(origin),
    updated: invalidateUpdate,
    deleted: (_id, _parentId, origin) => invalidate(origin),
    reparented: (_id, _oldParentId, _newParentId, origin) => invalidate(origin),
    reordered: (_id, _parentId, _index, _previousParentId, origin) => invalidate(origin)
  })
  originalArchiveRequests.set(graph, entry)
}

export async function requestOriginalArchive(graph: SceneGraph): Promise<Uint8Array | null> {
  const entry = originalArchiveRequests.get(graph)
  if (!entry) return null
  const rejectEntry = () => {
    if (originalArchiveRequests.get(graph) === entry) {
      entry.valid = false
      releaseFigPopulationWorker(graph)
    }
    return null
  }
  if (!entry.valid) return rejectEntry()
  if (!originalImageRefsMatch(graph.images, entry.imageRefs)) {
    return rejectEntry()
  }
  if (!immutableBytesRefMatches(graph.figSchemaDeflated, entry.schemaRef)) {
    return rejectEntry()
  }
  const beforeSignature = persistentGraphLevelSignature(graph)
  if (beforeSignature === null || beforeSignature !== entry.signature) {
    return rejectEntry()
  }
  let archive: Uint8Array
  try {
    archive = await entry.request()
  } catch {
    return rejectEntry()
  }
  if (originalArchiveRequests.get(graph) !== entry) return null
  if (!entry.valid) return rejectEntry()
  if (!originalImageRefsMatch(graph.images, entry.imageRefs)) {
    return rejectEntry()
  }
  if (!immutableBytesRefMatches(graph.figSchemaDeflated, entry.schemaRef)) {
    return rejectEntry()
  }
  const afterSignature = persistentGraphLevelSignature(graph)
  if (afterSignature === null || afterSignature !== entry.signature) {
    return rejectEntry()
  }
  return archive
}

export function releaseFigPopulationWorker(graph: SceneGraph): void {
  populationWorkers.get(graph)?.client.terminate()
  populationWorkers.delete(graph)
  const originalArchive = originalArchiveRequests.get(graph)
  originalArchive?.unbind()
  originalArchive?.release()
  originalArchiveRequests.delete(graph)
}

export interface FigPopulationWorker {
  populate: (pageId: string, signal?: AbortSignal) => Promise<boolean | null>
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
      // The session may already have failed or closed its port.
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
  const invalidateUpdate = (
    _id: string,
    changes: Partial<SceneNode>,
    origin?: NodeMutationOrigin
  ) => {
    const layoutDerived =
      origin === 'derived-layout' &&
      Object.keys(changes).every((key) => LAYOUT_DERIVED_NODE_UPDATE_FIELDS.has(key))
    if (!layoutDerived) invalidate(origin)
  }
  unbind = graph.onNodeEvents({
    created: (_node, origin) => invalidate(origin),
    updated: invalidateUpdate,
    deleted: (_id, _parentId, origin) => invalidate(origin),
    reparented: (_id, _oldParentId, _newParentId, origin) => invalidate(origin),
    reordered: (_id, _parentId, _index, _previousParentId, origin) => invalidate(origin)
  })
  port.onmessageerror = () => dispose(true)
  worker.onerror = () => dispose(true)
  worker.onmessageerror = () => dispose(true)
  return {
    populate: () => Promise.resolve(null),
    terminate: () => dispose(false)
  }
}

export function createFigPopulationWorker(graph: SceneGraph): FigPopulationWorker | null {
  if (!canUseFigPopulationWorker(graph)) return null
  return populationWorkers.get(graph)?.client ?? null
}

function createPopulationWorkerClient(
  graph: SceneGraph,
  worker: Worker,
  port?: MessagePort
): FigPopulationWorker {
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
  let disposed = false
  let failed = false
  let unbind: (() => void) | undefined
  const releaseSubscription = () => {
    unbind?.()
    unbind = undefined
  }
  const fail = (emit = true) => {
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
    if (port) invalidateOriginalArchiveRequest(graph)
    if (port) {
      port.onmessage = null
      port.onmessageerror = null
    } else worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    port?.close()
    worker.terminate()
    populationWorkers.delete(graph)
  }
  const invalidate = (origin?: NodeMutationOrigin) => {
    if (stale || isTrustedHydration(origin) || isTrustedDerivedComponentSync(origin)) return
    revision++
    stale = true
    emitTelemetry({ event: 'stale', reason: 'graph-mutation' })
    // A stale retained graph and its raw archive can never be used again.
    // Release the shared session immediately instead of holding large import
    // structures until the document closes.
    fail(false)
  }
  const invalidateUpdate = (
    _id: string,
    changes: Partial<SceneNode>,
    origin?: NodeMutationOrigin
  ) => {
    const layoutDerived =
      origin === 'derived-layout' &&
      Object.keys(changes).every((key) => LAYOUT_DERIVED_NODE_UPDATE_FIELDS.has(key))
    if (!layoutDerived) invalidate(origin)
  }
  unbind = graph.onNodeEvents({
    created: (_node, origin) => invalidate(origin),
    updated: invalidateUpdate,
    deleted: (_id, _parentId, origin) => invalidate(origin),
    reparented: (_id, _oldParentId, _newParentId, origin) => invalidate(origin),
    reordered: (_id, _parentId, _index, _previousParentId, origin) => invalidate(origin)
  })
  const receive = (result: WorkerResult) => {
    if (result.type === 'population-error') return fail()
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
      const context = getLazyFigImportContext(graph)
      if (context) {
        context.populatedRootIds = new Set(result.delta.populatedRootIds)
        setLazyFigImportContext(graph, context)
      }
    } catch {
      fail()
      return request.resolve(null)
    }
    if (stale) return request.resolve(null)
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
    port.onmessage = (event: MessageEvent<FigSessionResponse>) =>
      receive(event.data as WorkerResult)
    port.onmessageerror = () => fail()
    port.start()
  } else {
    worker.onmessage = (event: MessageEvent<WorkerResult>) => receive(event.data)
  }
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
        if (port) port.postMessage({ type: 'populate', requestId, baseRevision, pageId })
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
        // The session may already have failed or closed its port.
      }
      fail(false)
    }
  }
}
