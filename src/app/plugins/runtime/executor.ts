import { randomHex } from '@open-pencil/core/random'
import {
  PLUGIN_RUNTIME_COMPUTE_ABI,
  PLUGIN_RUNTIME_PACKAGE_LIMITS
} from '@open-pencil/plugin-contracts'
import { canonicalManifestValue } from '@open-pencil/scene-graph'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import {
  PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION,
  type PluginRuntimeWorkerRequest,
  type PluginRuntimeWorkerResponse
} from './protocol'

export const PLUGIN_WASM_EXECUTOR_LIMITS = Object.freeze({
  maxArtifactBytes: 2 * 1024 * 1024,
  maxInputBytes: 256 * 1024,
  maxOutputBytes: 256 * 1024,
  maxMemoryPages: PLUGIN_RUNTIME_PACKAGE_LIMITS.maxMemoryPages,
  defaultTimeoutMs: 2_000,
  maxTimeoutMs: 5_000
})

export interface PluginRuntimeWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
  terminate(): void
}

export interface ExecuteWasmPluginOptions {
  wasmBytes: Uint8Array
  input: JSONValue
  timeoutMs?: number
  maxInputBytes?: number
  maxOutputBytes?: number
  maxMemoryPages?: number
  signal?: AbortSignal
}

export interface CreateWasmPluginExecutorOptions {
  workerFactory?: () => PluginRuntimeWorkerLike
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function defaultWorkerFactory(): PluginRuntimeWorkerLike {
  return new Worker(new URL('./wasm-worker.ts', import.meta.url), {
    name: 'openpencil-plugin-wasm-runtime',
    type: 'module'
  })
}

function boundedTimeout(value: number | undefined): number {
  const resolved = value ?? PLUGIN_WASM_EXECUTOR_LIMITS.defaultTimeoutMs
  if (
    !Number.isSafeInteger(resolved) ||
    resolved <= 0 ||
    resolved > PLUGIN_WASM_EXECUTOR_LIMITS.maxTimeoutMs
  ) {
    throw new TypeError(
      `Plugin runtime timeout must be between 1 and ${PLUGIN_WASM_EXECUTOR_LIMITS.maxTimeoutMs}ms`
    )
  }
  return resolved
}

function boundedByteLimit(value: number | undefined, maximum: number, label: string): number {
  const resolved = value ?? maximum
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new TypeError(`${label} must be between 1 and ${maximum} bytes`)
  }
  return resolved
}

function boundedMemoryPageLimit(value: number | undefined): number {
  const resolved = value ?? PLUGIN_WASM_EXECUTOR_LIMITS.maxMemoryPages
  if (
    !Number.isSafeInteger(resolved) ||
    resolved <= 0 ||
    resolved > PLUGIN_WASM_EXECUTOR_LIMITS.maxMemoryPages
  ) {
    throw new TypeError(
      `Plugin runtime memory limit must be between 1 and ${PLUGIN_WASM_EXECUTOR_LIMITS.maxMemoryPages} pages`
    )
  }
  return resolved
}

function boundedInput(value: JSONValue, maximum: number): string {
  const json = JSON.stringify(canonicalManifestValue(value))
  if (new TextEncoder().encode(json).byteLength > maximum) {
    throw new TypeError('Plugin runtime input exceeds the byte limit')
  }
  return json
}

function parseOutput(value: string, maximum: number): JSONValue {
  if (new TextEncoder().encode(value).byteLength > maximum) {
    throw new Error('Plugin runtime output exceeds the byte limit')
  }
  return canonicalManifestValue(JSON.parse(value)) as JSONValue
}

function validateRequestBytes(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError('Plugin WASM artifact must be bytes')
  if (value.byteLength === 0 || value.byteLength > PLUGIN_WASM_EXECUTOR_LIMITS.maxArtifactBytes) {
    throw new TypeError('Plugin WASM artifact exceeds the byte limit')
  }
  return new Uint8Array(value)
}

function workerResponse(value: unknown, requestId: string): PluginRuntimeWorkerResponse | null {
  if (typeof value !== 'object' || value === null) return null
  const response = value as Partial<PluginRuntimeWorkerResponse>
  if (
    response.version !== PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION ||
    response.requestId !== requestId ||
    (response.type !== 'result' && response.type !== 'error')
  ) {
    return null
  }
  if (response.type === 'result' && typeof response.outputJson === 'string') {
    return response as PluginRuntimeWorkerResponse
  }
  if (response.type === 'error' && typeof response.error === 'string') {
    return response as PluginRuntimeWorkerResponse
  }
  return null
}

export function createWasmPluginExecutor(options: CreateWasmPluginExecutorOptions = {}) {
  const workerFactory = options.workerFactory ?? defaultWorkerFactory
  async function execute(execution: ExecuteWasmPluginOptions): Promise<JSONValue> {
    const wasmBytes = validateRequestBytes(execution.wasmBytes)
    const maxInputBytes = boundedByteLimit(
      execution.maxInputBytes,
      PLUGIN_WASM_EXECUTOR_LIMITS.maxInputBytes,
      'Plugin runtime input limit'
    )
    const maxOutputBytes = boundedByteLimit(
      execution.maxOutputBytes,
      PLUGIN_WASM_EXECUTOR_LIMITS.maxOutputBytes,
      'Plugin runtime output limit'
    )
    const inputJSON = boundedInput(execution.input, maxInputBytes)
    const maxMemoryPages = boundedMemoryPageLimit(execution.maxMemoryPages)
    const timeoutMs = boundedTimeout(execution.timeoutMs)
    const requestId = randomHex(16)
    const worker = workerFactory()
    const buffer = wasmBytes.buffer.slice(
      wasmBytes.byteOffset,
      wasmBytes.byteOffset + wasmBytes.byteLength
    ) as ArrayBuffer
    const request: PluginRuntimeWorkerRequest = {
      version: PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'execute-wasm',
      requestId,
      abi: PLUGIN_RUNTIME_COMPUTE_ABI,
      limits: {
        maxArtifactBytes: PLUGIN_WASM_EXECUTOR_LIMITS.maxArtifactBytes,
        maxInputBytes,
        maxOutputBytes,
        maxMemoryPages
      },
      wasmBytes: buffer,
      inputJson: inputJSON
    }
    return new Promise<JSONValue>((resolve, reject) => {
      let settled = false
      const finish = (operation: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        execution.signal?.removeEventListener('abort', abort)
        worker.terminate()
        operation()
      }
      const abort = () =>
        finish(() => reject(asError(execution.signal?.reason ?? new Error('Aborted'))))
      const timer = setTimeout(
        () => finish(() => reject(new Error(`Plugin runtime exceeded ${timeoutMs}ms`))),
        timeoutMs
      )
      worker.onmessage = (event) => {
        const response = workerResponse(event.data, requestId)
        if (!response) return
        if (response.type === 'error') {
          finish(() => reject(new Error(`Plugin runtime failed: ${response.error}`)))
          return
        }
        try {
          const output = parseOutput(response.outputJson, maxOutputBytes)
          finish(() => resolve(output))
        } catch (cause) {
          finish(() => reject(asError(cause)))
        }
      }
      worker.onerror = (event) =>
        finish(() => reject(new Error(event.message || 'Plugin runtime worker failed')))
      if (execution.signal?.aborted) {
        abort()
        return
      }
      execution.signal?.addEventListener('abort', abort, { once: true })
      try {
        worker.postMessage(request, [buffer])
      } catch (cause) {
        finish(() => reject(asError(cause)))
      }
    })
  }
  return { execute }
}
