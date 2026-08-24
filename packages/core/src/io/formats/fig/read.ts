import { assertFigArchiveByteLength, parseFigBuffer, type FigArchiveLimits } from '@open-pencil/fig'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { DynamicConcurrencyLimiter, type ConcurrencyLimiterState } from '#core/async-work'
import { IS_BROWSER } from '#core/constants'
import { importNodeChanges } from '#core/kiwi/fig/import'
import { deserializeSceneGraph } from '#core/kiwi/fig/parse/transfer'
import type { SerializedSceneGraph } from '#core/kiwi/fig/parse/transfer'
import { registerFigPopulationWorker } from '#core/kiwi/fig/population/client'

export interface ParseFigFileOptions {
  populate?: 'all' | 'first-page' | 'none'
  /** Override the finite ordinary-file archive and decompression quotas. */
  archiveLimits?: FigArchiveLimits
  /** Cancel queued or active dedicated-worker parsing. */
  signal?: AbortSignal
  /** Explicitly enable UI-thread recovery only for trusted input. Ordinary readers default false. */
  allowMainThreadFallback?: boolean
}

/**
 * Finite defaults for user-selected, local, cloud, reload, and CLI `.fig` inputs.
 * These are intentionally higher than remote-library limits so known large design
 * systems remain loadable while compressed, decoded, and expanded graph growth is
 * still bounded. Low-level parseFigFile/parseFigBuffer callers may omit limits only
 * for explicitly trusted application-generated round trips.
 */
export const ORDINARY_FIG_ARCHIVE_LIMITS: Readonly<Required<FigArchiveLimits>> = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntries: 8_192,
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalEntryBytes: 512 * 1024 * 1024,
  maxImageBytes: 64 * 1024 * 1024,
  maxTotalImageBytes: 384 * 1024 * 1024,
  maxSchemaBytes: 32 * 1024 * 1024,
  maxDataBytes: 384 * 1024 * 1024,
  maxNodeChanges: 1_000_000,
  maxArrayLength: 1_000_000,
  // material3.fig needs more than 1m aggregate Kiwi array items despite
  // containing only 87,237 nodeChanges; 2m is the measured compatibility floor.
  maxArrayItems: 2_000_000,
  maxDecodeDepth: 128,
  maxSchemaDefinitions: 8_192,
  maxFieldsPerDefinition: 8_192,
  maxSchemaFields: 131_072,
  maxGraphNodes: 400_000,
  maxTreeDepth: 512
})

export const MAX_FIG_PARSE_WORKER_CONCURRENCY = 2

export function figParseWorkerConcurrencyForDeviceMemory(deviceMemoryGiB?: number | null): 1 | 2 {
  return typeof deviceMemoryGiB === 'number' &&
    Number.isFinite(deviceMemoryGiB) &&
    deviceMemoryGiB > 8
    ? 2
    : 1
}

export type FigSourceData = ArrayBuffer | Uint8Array

export interface ReloadableFigSource {
  /** Optional known size used to reject oversized input before allocating it. */
  size?: number | (() => number | Promise<number>)
  /** Return fresh data on every call. The result may be transferred and detached. */
  read(): Promise<FigSourceData>
}

function ordinaryFigReadOptions(options: ParseFigFileOptions): ParseFigFileOptions {
  return {
    ...options,
    archiveLimits: { ...ORDINARY_FIG_ARCHIVE_LIMITS, ...options.archiveLimits },
    allowMainThreadFallback: options.allowMainThreadFallback ?? false
  }
}

async function declaredFigSourceSize(source: ReloadableFigSource): Promise<number | undefined> {
  return typeof source.size === 'function' ? source.size() : source.size
}

function parseFigFileSync(buffer: ArrayBuffer, options: ParseFigFileOptions = {}): SceneGraph {
  const {
    nodeChanges,
    blobs,
    images: imageEntries,
    figKiwiVersion,
    figSchemaDeflated,
    objectAnimations
  } = parseFigBuffer(buffer, { limits: options.archiveLimits })
  const graph = importNodeChanges(nodeChanges, blobs, new Map(imageEntries), {
    populate: options.populate,
    maxGraphNodes: options.archiveLimits?.maxGraphNodes,
    maxTreeDepth: options.archiveLimits?.maxTreeDepth
  })
  graph.figKiwiVersion = figKiwiVersion
  graph.figSchemaDeflated = figSchemaDeflated
  graph.figMessageObjectAnimations = objectAnimations
  return graph
}

interface WorkerParseResult {
  graph?: SerializedSceneGraph
  error?: string
  phase?: 'parse' | 'import' | 'transport'
}

type ReloadFigBuffer = () => Promise<ArrayBuffer>

const figParseWorkerLimiter = new DynamicConcurrencyLimiter(
  figParseWorkerConcurrencyForDeviceMemory()
)

/**
 * Change capacity for workers that have not started yet. Active workers keep
 * ownership of their transferred buffers and always settle normally.
 */
export function setFigParseWorkerConcurrency(concurrency: number): void {
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new RangeError('FIG parse worker concurrency must be at least 1')
  }
  figParseWorkerLimiter.setConcurrency(
    Math.min(MAX_FIG_PARSE_WORKER_CONCURRENCY, Math.floor(concurrency))
  )
}

export function figParseWorkerQueueState(): ConcurrencyLimiterState {
  return figParseWorkerLimiter.state()
}

function workerParseError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

class DeterministicFigWorkerError extends Error {
  override name = 'DeterministicFigWorkerError'

  constructor(
    message: string,
    readonly phase: 'parse' | 'import'
  ) {
    super(message)
  }
}

function isDeterministicWorkerPhase(
  phase: WorkerParseResult['phase']
): phase is 'parse' | 'import' {
  return phase === 'parse' || phase === 'import'
}

function isExplicitOutOfMemoryError(error: Error): boolean {
  return /\b(?:out[- ]of[- ]memory|oom|heap limit|memory limit|(?:cannot|could not) allocate memory|memory allocation failed|array buffer allocation failed)\b/i.test(
    `${error.name}: ${error.message}`
  )
}

function canRetainFigPopulationWorker(meta: { env?: { DEV?: boolean } }): boolean {
  return meta.env?.DEV ?? false
}

function transferableFigBuffer(data: FigSourceData): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data
  if (
    data.buffer instanceof ArrayBuffer &&
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength
  ) {
    return data.buffer
  }
  // `Buffer.slice()` is a zero-copy view in Node/Bun, unlike Uint8Array.slice(). Allocate
  // explicitly so Buffer subviews and SharedArrayBuffer views cannot expose padded bytes.
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

function parseViaWorker(buffer: ArrayBuffer, options: ParseFigFileOptions): Promise<SceneGraph> {
  const pending = figParseWorkerLimiter.run(() => {
    throwIfFigParseAborted(options.signal)
    return parseViaStartedWorker(buffer, options)
  })
  return abortableFigParse(pending, options.signal)
}

function parseViaStartedWorker(
  buffer: ArrayBuffer,
  options: ParseFigFileOptions
): Promise<SceneGraph> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../../kiwi/fig/parse/worker.ts', import.meta.url), {
      type: 'module'
    })

    let settled = false
    const abort = () => fail(figParseAbortReason(options.signal))

    const cleanup = () => {
      options.signal?.removeEventListener('abort', abort)
    }

    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      worker.terminate()
      reject(workerParseError(error))
    }

    const succeed = (graph: SceneGraph) => {
      if (settled) return
      if (options.populate === 'first-page' && canRetainFigPopulationWorker(import.meta)) {
        worker.onmessage = null
        worker.onerror = null
        worker.onmessageerror = null
        registerFigPopulationWorker(graph, worker)
      } else {
        worker.terminate()
      }
      settled = true
      cleanup()
      resolve(graph)
    }

    worker.onmessage = (e: MessageEvent<WorkerParseResult>) => {
      if (typeof e.data.error === 'string') {
        fail(
          isDeterministicWorkerPhase(e.data.phase)
            ? new DeterministicFigWorkerError(e.data.error, e.data.phase)
            : new Error(e.data.error)
        )
        return
      }
      if (!e.data.graph) {
        fail(new Error('Worker failed to parse .fig file'))
        return
      }
      try {
        succeed(deserializeSceneGraph(e.data.graph))
      } catch (error) {
        fail(error)
      }
    }

    worker.onerror = (err) => {
      fail(new Error(err.message || 'Worker failed to parse .fig file'))
    }

    worker.onmessageerror = () => {
      fail(new Error('Worker .fig parse response could not be deserialized'))
    }

    if (options.signal?.aborted) {
      fail(figParseAbortReason(options.signal))
      return
    }
    options.signal?.addEventListener('abort', abort, { once: true })

    try {
      const workerOptions = {
        populate: options.populate,
        archiveLimits: options.archiveLimits
      }
      worker.postMessage({ buffer, options: workerOptions }, [buffer])
    } catch (error) {
      fail(error)
    }
  })
}

async function parseFigFileWithFallback(
  buffer: ArrayBuffer,
  options: ParseFigFileOptions,
  reloadBuffer?: ReloadFigBuffer
): Promise<SceneGraph> {
  try {
    return await parseViaWorker(buffer, options)
  } catch (error) {
    const workerError = workerParseError(error)
    if (options.signal?.aborted) throw figParseAbortReason(options.signal)
    if (workerError instanceof DeterministicFigWorkerError) throw workerError
    if (options.allowMainThreadFallback === false) {
      throw new Error(
        `${workerError.message}. Main-thread fallback is disabled for untrusted .fig input`,
        { cause: workerError }
      )
    }
    if (isExplicitOutOfMemoryError(workerError)) {
      throw new Error(
        `${workerError.message}. Main-thread fallback was skipped to avoid increasing memory pressure`,
        { cause: workerError }
      )
    }

    // A successful transferable post detaches `buffer`. Reuse it when worker
    // startup failed before the transfer; otherwise reload only on the rare
    // failure path instead of retaining a full-size copy for every import.
    let fallbackBuffer = buffer.byteLength > 0 ? buffer : undefined
    if (!fallbackBuffer && reloadBuffer) {
      try {
        fallbackBuffer = await reloadBuffer()
      } catch (reloadError) {
        const sourceError = workerParseError(reloadError)
        throw new Error(
          `Worker parsing failed: ${workerError.message}. Reloading the .fig source also failed: ${sourceError.message}`,
          {
            cause: new AggregateError(
              [workerError, sourceError],
              'Worker parsing and .fig source reload both failed'
            )
          }
        )
      }
    }
    if (!fallbackBuffer) {
      throw new Error(
        `${workerError.message}. Main-thread fallback is unavailable after the .fig input buffer was transferred; retry with readFigFile() or a fresh ArrayBuffer`,
        { cause: workerError }
      )
    }
    console.warn('Worker parsing failed, falling back to main thread:', error)
    return parseFigFileSync(fallbackBuffer, options)
  }
}

export async function parseFigFile(
  buffer: ArrayBuffer,
  options: ParseFigFileOptions = {}
): Promise<SceneGraph> {
  if (typeof Worker !== 'undefined' && IS_BROWSER) {
    return parseFigFileWithFallback(buffer, options)
  }
  if (IS_BROWSER && options.allowMainThreadFallback === false) {
    throw new Error('A dedicated Worker is required to parse untrusted .fig input')
  }
  throwIfFigParseAborted(options.signal)
  return parseFigFileSync(buffer, options)
}

export async function readFigSource(
  source: ReloadableFigSource,
  options: ParseFigFileOptions = {}
): Promise<SceneGraph> {
  const readOptions = ordinaryFigReadOptions(options)
  const declaredSize = await declaredFigSourceSize(source)
  if (declaredSize !== undefined) {
    assertFigArchiveByteLength(declaredSize, readOptions.archiveLimits)
  }
  const readBuffer = async () => transferableFigBuffer(await source.read())
  const buffer = await readBuffer()
  if (typeof Worker !== 'undefined' && IS_BROWSER) {
    return parseFigFileWithFallback(buffer, readOptions, readBuffer)
  }
  if (IS_BROWSER && readOptions.allowMainThreadFallback === false) {
    throw new Error('A dedicated Worker is required to parse untrusted .fig input')
  }
  throwIfFigParseAborted(readOptions.signal)
  return parseFigFileSync(buffer, readOptions)
}

export async function readFigFile(
  file: File,
  options: ParseFigFileOptions = {}
): Promise<SceneGraph> {
  return readFigSource({ size: file.size, read: () => file.arrayBuffer() }, options)
}

function figParseAbortReason(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason
  return reason instanceof Error
    ? reason
    : new DOMException('FIG parsing was aborted', 'AbortError')
}

function throwIfFigParseAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw figParseAbortReason(signal)
}

function abortableFigParse<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(figParseAbortReason(signal))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(figParseAbortReason(signal))
    signal.addEventListener('abort', abort, { once: true })
    void promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
      .catch(reject)
  })
}
