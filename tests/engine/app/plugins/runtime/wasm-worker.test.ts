import { describe, expect, test } from 'bun:test'

import { PLUGIN_RUNTIME_COMPUTE_ABI } from '@open-pencil/core/plugins'

import {
  PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION,
  PLUGIN_WASM_EXECUTOR_LIMITS,
  type PluginRuntimeWorkerRequest,
  type PluginRuntimeWorkerResponse
} from '@/app/plugins/runtime'
import { createPluginRuntimeWorkerRequestHandler } from '@/app/plugins/runtime/worker-handler'

function unsignedLeb(value: number): number[] {
  const encoded: number[] = []
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value !== 0) byte |= 0x80
    encoded.push(byte)
  } while (value !== 0)
  return encoded
}

function signedLeb(value: number): number[] {
  const encoded: number[] = []
  let remaining = value
  let more = true
  while (more) {
    let byte = remaining & 0x7f
    remaining >>= 7
    const signBit = (byte & 0x40) !== 0
    more = !((remaining === 0 && !signBit) || (remaining === -1 && signBit))
    if (more) byte |= 0x80
    encoded.push(byte)
  }
  return encoded
}

function text(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)]
  return [...unsignedLeb(bytes.length), ...bytes]
}

function section(id: number, payload: number[]): number[] {
  return [id, ...unsignedLeb(payload.length), ...payload]
}

function jsonRuntime(outputJson: string): ArrayBuffer {
  const output = [...new TextEncoder().encode(outputJson)]
  const typeSection = section(
    1,
    [3, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 0, 0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f]
  )
  const functionSection = section(3, [3, 0, 1, 2])
  const memorySection = section(5, [1, 1, 1, 4])
  const exports = [
    [...text('memory'), 2, 0],
    [...text('openpencil_alloc'), 0, 0],
    [...text('openpencil_dealloc'), 0, 1],
    [...text('openpencil_compute'), 0, 2]
  ]
  const exportSection = section(7, [exports.length, ...exports.flat()])
  const stores = output.flatMap((value, index) => [
    0x20,
    0x02,
    ...(index === 0 ? [] : [0x41, ...signedLeb(index), 0x6a]),
    0x41,
    ...signedLeb(value),
    0x3a,
    0,
    0
  ])
  const bodies = [
    [0, 0x41, ...signedLeb(1_024), 0x0b],
    [0, 0x0b],
    [0, ...stores, 0x41, ...signedLeb(output.length), 0x0b]
  ]
  const codeSection = section(10, [
    bodies.length,
    ...bodies.flatMap((body) => [...unsignedLeb(body.length), ...body])
  ])
  return new Uint8Array([
    0,
    0x61,
    0x73,
    0x6d,
    1,
    0,
    0,
    0,
    ...typeSection,
    ...functionSection,
    ...memorySection,
    ...exportSection,
    ...codeSection
  ]).buffer
}

function request(wasmBytes = jsonRuntime('{"ok":true}')): PluginRuntimeWorkerRequest {
  return {
    version: PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION,
    type: 'execute-wasm',
    requestId: '0123456789abcdef0123456789abcdef',
    abi: PLUGIN_RUNTIME_COMPUTE_ABI,
    limits: {
      maxArtifactBytes: PLUGIN_WASM_EXECUTOR_LIMITS.maxArtifactBytes,
      maxInputBytes: PLUGIN_WASM_EXECUTOR_LIMITS.maxInputBytes,
      maxOutputBytes: 64,
      maxMemoryPages: 4
    },
    wasmBytes,
    inputJson: '{"request":1}'
  }
}

async function handlerResponse(value: unknown): Promise<PluginRuntimeWorkerResponse> {
  const responses: PluginRuntimeWorkerResponse[] = []
  const handle = createPluginRuntimeWorkerRequestHandler((response) => responses.push(response))
  expect(await handle(value)).toBe(true)
  expect(responses).toHaveLength(1)
  return responses[0]
}

async function actualWorkerResponse(
  value: PluginRuntimeWorkerRequest
): Promise<PluginRuntimeWorkerResponse> {
  const worker = new Worker(
    new URL('../../../../../src/app/plugins/runtime/wasm-worker.ts', import.meta.url),
    { type: 'module' }
  )
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('Plugin runtime Worker regression timed out'))
    }, 2_000)
    worker.onmessage = (event: MessageEvent<PluginRuntimeWorkerResponse>) => {
      clearTimeout(timer)
      worker.terminate()
      resolve(event.data)
    }
    worker.onerror = (event) => {
      clearTimeout(timer)
      worker.terminate()
      reject(new Error(event.message || 'Plugin runtime Worker regression failed'))
    }
    worker.postMessage(value, [value.wasmBytes])
  })
}

describe('WASM plugin Worker', () => {
  test('executes a real one-shot Worker request', async () => {
    await expect(actualWorkerResponse(request())).resolves.toMatchObject({
      version: PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'result',
      outputJson: '{"ok":true}'
    })
  })

  test('accepts only one message per request handler', async () => {
    const responses: PluginRuntimeWorkerResponse[] = []
    const handle = createPluginRuntimeWorkerRequestHandler((response) => responses.push(response))
    expect(await handle(request())).toBe(true)
    expect(await handle(request())).toBe(false)
    expect(responses).toHaveLength(1)
  })

  test('revalidates ABI and every transferred resource limit inside the Worker', async () => {
    const invalidAbi = { ...request(), abi: 'hostile.compute.v1' }
    expect(await handlerResponse(invalidAbi)).toMatchObject({
      type: 'error',
      error: expect.stringContaining('ABI is not supported')
    })

    const artifactRequest = request()
    const artifact = {
      ...artifactRequest,
      limits: { ...artifactRequest.limits, maxArtifactBytes: 8 }
    }
    expect(await handlerResponse(artifact)).toMatchObject({
      type: 'error',
      error: expect.stringContaining('artifact exceeds')
    })

    const inputRequest = request()
    const input = { ...inputRequest, limits: { ...inputRequest.limits, maxInputBytes: 1 } }
    expect(await handlerResponse(input)).toMatchObject({
      type: 'error',
      error: expect.stringContaining('input exceeds')
    })

    const outputRequest = request()
    const output = { ...outputRequest, limits: { ...outputRequest.limits, maxOutputBytes: 1 } }
    expect(await handlerResponse(output)).toMatchObject({
      type: 'error',
      error: expect.stringContaining('invalid pointer or length')
    })

    const memoryRequest = request()
    const memory = { ...memoryRequest, limits: { ...memoryRequest.limits, maxMemoryPages: 3 } }
    expect(await handlerResponse(memory)).toMatchObject({
      type: 'error',
      error: expect.stringContaining('maximum page limit')
    })
  })
})
