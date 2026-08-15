import { describe, expect, test } from 'bun:test'

import { PLUGIN_RUNTIME_COMPUTE_ABI } from '@open-pencil/plugin-contracts'

import {
  PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION,
  PLUGIN_WASM_EXECUTOR_LIMITS,
  createWasmPluginExecutor,
  type PluginRuntimeWorkerLike,
  type PluginRuntimeWorkerRequest
} from '@/app/plugins/runtime'

class FakeWorker implements PluginRuntimeWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false

  constructor(
    private readonly respond: (
      request: PluginRuntimeWorkerRequest,
      worker: FakeWorker
    ) => void = () => undefined
  ) {}

  postMessage(message: unknown): void {
    this.respond(message as PluginRuntimeWorkerRequest, this)
  }

  terminate(): void {
    this.terminated = true
  }
}

const wasmHeader = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])

describe('WASM plugin executor', () => {
  test('accepts only a correlated bounded worker response and terminates the isolate', async () => {
    const worker = new FakeWorker((request, current) => {
      expect(request.abi).toBe(PLUGIN_RUNTIME_COMPUTE_ABI)
      expect(request.limits).toEqual({
        maxArtifactBytes: PLUGIN_WASM_EXECUTOR_LIMITS.maxArtifactBytes,
        maxInputBytes: 32,
        maxOutputBytes: 64,
        maxMemoryPages: 4
      })
      queueMicrotask(() =>
        current.onmessage?.({
          data: {
            version: PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            outputJson: '{"ok":true}'
          }
        } as MessageEvent)
      )
    })
    const executor = createWasmPluginExecutor({ workerFactory: () => worker })

    await expect(
      executor.execute({
        wasmBytes: wasmHeader,
        input: { value: 1 },
        maxInputBytes: 32,
        maxOutputBytes: 64,
        maxMemoryPages: 4
      })
    ).resolves.toEqual({ ok: true })
    expect(worker.terminated).toBe(true)
  })

  test('terminates a worker that exceeds its invocation deadline', async () => {
    const worker = new FakeWorker()
    const executor = createWasmPluginExecutor({ workerFactory: () => worker })

    await expect(
      executor.execute({ wasmBytes: wasmHeader, input: null, timeoutMs: 5 })
    ).rejects.toThrow('exceeded 5ms')
    expect(worker.terminated).toBe(true)
  })

  test('fails before creating a worker for oversized input or artifacts', async () => {
    let workers = 0
    const executor = createWasmPluginExecutor({
      workerFactory: () => {
        workers += 1
        return new FakeWorker()
      }
    })

    await expect(
      executor.execute({
        wasmBytes: wasmHeader,
        input: 'x'.repeat(PLUGIN_WASM_EXECUTOR_LIMITS.maxInputBytes + 1)
      })
    ).rejects.toThrow('input exceeds')
    await expect(
      executor.execute({
        wasmBytes: new Uint8Array(PLUGIN_WASM_EXECUTOR_LIMITS.maxArtifactBytes + 1),
        input: null
      })
    ).rejects.toThrow('artifact exceeds')
    expect(workers).toBe(0)
  })

  test('terminates immediately when the caller aborts', async () => {
    const worker = new FakeWorker()
    const executor = createWasmPluginExecutor({ workerFactory: () => worker })
    const controller = new AbortController()
    controller.abort(new Error('cancelled by user'))

    await expect(
      executor.execute({ wasmBytes: wasmHeader, input: null, signal: controller.signal })
    ).rejects.toThrow('cancelled by user')
    expect(worker.terminated).toBe(true)
  })

  test('terminates when posting the transferable request fails synchronously', async () => {
    const worker = new FakeWorker(() => {
      throw new Error('transfer failed')
    })
    const executor = createWasmPluginExecutor({ workerFactory: () => worker })

    await expect(executor.execute({ wasmBytes: wasmHeader, input: null })).rejects.toThrow(
      'transfer failed'
    )
    expect(worker.terminated).toBe(true)
  })
})
