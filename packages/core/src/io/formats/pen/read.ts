import {
  assertPenByteLength,
  parsePenFile,
  REMOTE_PEN_PARSE_LIMITS,
  resolvePenParseLimits,
  type PenParseLimits,
  type ResolvedPenParseLimits
} from '@open-pencil/pen'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { IS_BROWSER } from '#core/constants'
import type { PenWorkerResponse } from '#core/io/formats/pen/worker-types'
import { deserializeSceneGraph, type SerializedSceneGraph } from '#core/kiwi/fig/parse/transfer'

export interface ReadPenDocumentOptions {
  limits?: PenParseLimits
  signal?: AbortSignal
  allowMainThreadFallback?: boolean
}

export async function readPenDocument(
  data: Uint8Array,
  options: ReadPenDocumentOptions = {}
): Promise<SceneGraph> {
  const untrusted =
    options.signal !== undefined ||
    options.limits !== undefined ||
    options.allowMainThreadFallback !== undefined
  if (!untrusted) return parseLegacyPenDocument(data)

  throwIfPenParseAborted(options.signal)
  const limits = resolvePenParseLimits(options.limits ?? REMOTE_PEN_PARSE_LIMITS)
  assertPenByteLength(data.byteLength, limits)

  if (typeof Worker !== 'undefined' && (IS_BROWSER || options.allowMainThreadFallback !== true)) {
    return parsePenViaWorker(copyToArrayBuffer(data), limits, options.signal)
  }
  if (IS_BROWSER || options.allowMainThreadFallback !== true) {
    throw new Error('A dedicated Worker is required to parse untrusted .pen input')
  }

  const graph = parseBoundedPenDocument(data, limits)
  throwIfPenParseAborted(options.signal)
  return graph
}

function parseLegacyPenDocument(data: Uint8Array): SceneGraph {
  return parsePenFile(new TextDecoder().decode(data))
}

function parseBoundedPenDocument(data: Uint8Array, limits: ResolvedPenParseLimits): SceneGraph {
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    throw new TypeError('Untrusted .pen input must contain valid UTF-8')
  }
  return parsePenFile(source, { limits })
}

function parsePenViaWorker(
  buffer: ArrayBuffer,
  limits: ResolvedPenParseLimits,
  signal?: AbortSignal
): Promise<SceneGraph> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      reject(asError(error, 'Failed to start the .pen parse Worker'))
      return
    }

    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      worker.terminate()
      reject(asError(error, 'Worker failed to parse .pen input'))
    }
    const abort = () => fail(penParseAbortReason(signal))
    const succeed = (serialized: SerializedSceneGraph) => {
      if (settled) return
      let graph: SceneGraph
      try {
        graph = deserializeSceneGraph(serialized)
      } catch (error) {
        fail(error)
        return
      }
      settled = true
      cleanup()
      worker.terminate()
      resolve(graph)
    }

    worker.onmessage = (event: MessageEvent<PenWorkerResponse>) => {
      if (event.data.error) {
        const error = new Error(event.data.error.message)
        error.name = event.data.error.name
        fail(error)
        return
      }
      if (!event.data.graph) {
        fail(new Error('Worker returned no .pen graph'))
        return
      }
      succeed(event.data.graph)
    }
    worker.onerror = (event) =>
      fail(new Error(event.message || 'Worker failed to parse .pen input'))
    worker.onmessageerror = () => fail(new Error('Worker .pen response could not be deserialized'))

    if (signal?.aborted) {
      fail(penParseAbortReason(signal))
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      worker.postMessage({ buffer, limits }, [buffer])
    } catch (error) {
      fail(error)
    }
  })
}

function copyToArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

function throwIfPenParseAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw penParseAbortReason(signal)
}

function penParseAbortReason(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) return signal.reason
  const message = signal?.reason === undefined ? '.pen parsing was aborted' : String(signal.reason)
  return new DOMException(message, 'AbortError')
}

function asError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) return error
  return new Error(typeof error === 'string' ? error : fallbackMessage)
}
