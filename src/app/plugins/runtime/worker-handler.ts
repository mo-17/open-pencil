import {
  PLUGIN_RUNTIME_COMPUTE_ABI,
  PLUGIN_RUNTIME_PACKAGE_LIMITS,
  validateWasmComputeRuntimeAsset
} from '@open-pencil/plugin-contracts'

import {
  PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION,
  type PluginRuntimeWorkerLimits,
  type PluginRuntimeWorkerRequest,
  type PluginRuntimeWorkerResponse
} from './protocol'
import { executeWasmPluginCompute } from './wasm-host'

interface WorkerRecord {
  [key: string]: unknown
}

const REQUEST_KEYS = new Set([
  'version',
  'type',
  'requestId',
  'abi',
  'limits',
  'wasmBytes',
  'inputJson'
])
const LIMIT_KEYS = new Set([
  'maxArtifactBytes',
  'maxInputBytes',
  'maxOutputBytes',
  'maxMemoryPages'
])
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const encoder = new TextEncoder()

function record(value: unknown, label: string): WorkerRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`)
  }
  return value as WorkerRecord
}

function exactRecord(value: unknown, keys: ReadonlySet<string>, label: string): WorkerRecord {
  const source = record(value, label)
  const sourceKeys = Object.keys(source)
  if (
    sourceKeys.length !== keys.size ||
    sourceKeys.some((key) => !keys.has(key)) ||
    [...keys].some((key) => !Object.hasOwn(source, key))
  ) {
    throw new TypeError(`${label} must contain exactly the supported fields`)
  }
  return source
}

function boundedLimit(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    throw new TypeError(`${label} must be between 1 and ${maximum}`)
  }
  return value as number
}

function workerLimits(value: unknown): PluginRuntimeWorkerLimits {
  const source = exactRecord(value, LIMIT_KEYS, 'Plugin runtime Worker limits')
  return Object.freeze({
    maxArtifactBytes: boundedLimit(
      source.maxArtifactBytes,
      PLUGIN_RUNTIME_PACKAGE_LIMITS.maxAssetBytes,
      'Plugin runtime Worker artifact limit'
    ),
    maxInputBytes: boundedLimit(
      source.maxInputBytes,
      PLUGIN_RUNTIME_PACKAGE_LIMITS.maxInputBytes,
      'Plugin runtime Worker input limit'
    ),
    maxOutputBytes: boundedLimit(
      source.maxOutputBytes,
      PLUGIN_RUNTIME_PACKAGE_LIMITS.maxOutputBytes,
      'Plugin runtime Worker output limit'
    ),
    maxMemoryPages: boundedLimit(
      source.maxMemoryPages,
      PLUGIN_RUNTIME_PACKAGE_LIMITS.maxMemoryPages,
      'Plugin runtime Worker memory limit'
    )
  })
}

async function parseWorkerRequest(value: unknown): Promise<PluginRuntimeWorkerRequest> {
  const source = exactRecord(value, REQUEST_KEYS, 'Plugin runtime Worker request')
  if (source.version !== PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION || source.type !== 'execute-wasm') {
    throw new TypeError('Plugin runtime Worker protocol is not supported')
  }
  if (typeof source.requestId !== 'string' || !REQUEST_ID_PATTERN.test(source.requestId)) {
    throw new TypeError('Plugin runtime Worker request id is invalid')
  }
  if (source.abi !== PLUGIN_RUNTIME_COMPUTE_ABI) {
    throw new TypeError('Plugin runtime Worker ABI is not supported')
  }
  const limits = workerLimits(source.limits)
  if (!(source.wasmBytes instanceof ArrayBuffer)) {
    throw new TypeError('Plugin runtime Worker artifact must be an ArrayBuffer')
  }
  if (source.wasmBytes.byteLength === 0 || source.wasmBytes.byteLength > limits.maxArtifactBytes) {
    throw new TypeError('Plugin runtime Worker artifact exceeds its byte limit')
  }
  if (
    typeof source.inputJson !== 'string' ||
    encoder.encode(source.inputJson).byteLength > limits.maxInputBytes
  ) {
    throw new TypeError('Plugin runtime Worker input exceeds its byte limit')
  }
  try {
    JSON.parse(source.inputJson)
  } catch (cause) {
    throw new TypeError('Plugin runtime Worker input must contain valid JSON', { cause })
  }
  await validateWasmComputeRuntimeAsset(new Uint8Array(source.wasmBytes), {
    timeoutMs: 1,
    maxInputBytes: limits.maxInputBytes,
    maxOutputBytes: limits.maxOutputBytes,
    maxMemoryPages: limits.maxMemoryPages
  })
  return Object.freeze({
    version: PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION,
    type: 'execute-wasm',
    requestId: source.requestId,
    abi: PLUGIN_RUNTIME_COMPUTE_ABI,
    limits,
    wasmBytes: source.wasmBytes,
    inputJson: source.inputJson
  })
}

function candidateRequestId(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const requestId = Reflect.get(value, 'requestId')
  return typeof requestId === 'string' && REQUEST_ID_PATTERN.test(requestId) ? requestId : null
}

export function createPluginRuntimeWorkerRequestHandler(
  post: (response: PluginRuntimeWorkerResponse) => void
) {
  let consumed = false
  return async (value: unknown): Promise<boolean> => {
    if (consumed) return false
    consumed = true
    const fallbackRequestId = candidateRequestId(value)
    try {
      const request = await parseWorkerRequest(value)
      const outputJSON = await executeWasmPluginCompute({
        wasmBytes: request.wasmBytes,
        inputJson: request.inputJson,
        maxOutputBytes: request.limits.maxOutputBytes
      })
      if (encoder.encode(outputJSON).byteLength > request.limits.maxOutputBytes) {
        throw new Error('Plugin runtime Worker output exceeds its byte limit')
      }
      post({
        version: PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'result',
        requestId: request.requestId,
        outputJson: outputJSON
      })
    } catch (cause) {
      if (fallbackRequestId) {
        post({
          version: PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION,
          type: 'error',
          requestId: fallbackRequestId,
          error: cause instanceof Error ? cause.message : 'Plugin runtime Worker failed'
        })
      }
    }
    return true
  }
}
