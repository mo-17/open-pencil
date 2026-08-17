import { describe, expect, test } from 'bun:test'

import { withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createBrowserPreviewWorkerClient,
  type BrowserPreviewWorkerLike
} from '@/app/lowcode/preview-pane/browser-worker/client'
import {
  BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
  type BrowserPreviewFontProvider,
  type BrowserPreviewWorkerRequest
} from '@/app/lowcode/preview-pane/browser-worker/protocol'

class FakeWorker implements BrowserPreviewWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  posted: BrowserPreviewWorkerRequest | null = null
  readonly posts: BrowserPreviewWorkerRequest[] = []
  terminated = false

  constructor(private readonly respond?: (worker: FakeWorker) => void) {}

  postMessage(value: unknown): void {
    this.posted = value as BrowserPreviewWorkerRequest
    this.posts.push(this.posted)
    this.respond?.(this)
  }

  terminate(): void {
    this.terminated = true
  }
}

function input(generation = 1) {
  const graph = new SceneGraph()
  return {
    generation,
    graph,
    pageIds: graph.getPages().map(({ id }) => id),
    options: withDefaults({ packageName: 'openpencil-preview', target: 'react', router: 'none' }),
    fontProviders: ['google', 'fontsource'] satisfies BrowserPreviewFontProvider[],
    refreshFonts: true
  }
}

const CHANNEL = '12345678-1234-4234-9234-123456789012'

describe('browser preview Worker client', () => {
  test('reuses one Worker for serial correlated results until disposal', async () => {
    const worker = new FakeWorker((current) => {
      queueMicrotask(() => {
        const request = current.posted
        if (!request) return
        current.onmessage?.({
          data: {
            version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            generation: request.generation,
            result: {
              status: 'ready',
              html: '<main>ready</main>',
              diagnostics: [],
              metrics: {
                compileMs: 1,
                bundleMs: 2,
                totalMs: 3,
                inputBytes: 4,
                outputBytes: 5,
                fileCount: 6,
                dependencyCount: 7
              }
            }
          }
        } as MessageEvent)
      })
    })
    let workerFactoryCalls = 0
    const client = createBrowserPreviewWorkerClient({
      workerFactory: () => {
        workerFactoryCalls += 1
        return worker
      }
    })

    await expect(client.build(input(), CHANNEL)).resolves.toMatchObject({ status: 'ready' })
    await expect(client.build(input(2), CHANNEL)).resolves.toMatchObject({ status: 'ready' })
    expect(worker.posted).toMatchObject({
      version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
      generation: 2,
      fontProviders: ['google', 'fontsource'],
      refreshFonts: true
    })
    expect(worker.posts).toHaveLength(2)
    expect(workerFactoryCalls).toBe(1)
    expect(worker.terminated).toBe(false)

    client.dispose()
    expect(worker.terminated).toBe(true)
  })

  test('terminates a successful Worker after the bounded idle timeout', async () => {
    const worker = new FakeWorker((current) => {
      queueMicrotask(() => {
        const request = current.posted
        if (!request) return
        current.onmessage?.({
          data: {
            version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            generation: request.generation,
            result: {
              status: 'unsupported',
              reason: 'unsupported fixture',
              diagnostics: [],
              metrics: {
                compileMs: 1,
                bundleMs: 2,
                totalMs: 3,
                inputBytes: 4,
                outputBytes: 5,
                fileCount: 6,
                dependencyCount: 7
              }
            }
          }
        } as MessageEvent)
      })
    })
    const client = createBrowserPreviewWorkerClient({
      workerFactory: () => worker,
      idleTimeoutMs: 5
    })

    await expect(client.build(input(), CHANNEL)).resolves.toMatchObject({ status: 'unsupported' })
    expect(worker.terminated).toBe(false)
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 15)
    })
    expect(worker.terminated).toBe(true)
  })

  test('cancels and terminates without transferring live graph buffers', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const source = input()
    const image = new Uint8Array([1, 2, 3])
    source.graph.images.set('image', image)
    const client = createBrowserPreviewWorkerClient({ workerFactory: () => worker })
    const pending = client.build(source, CHANNEL, controller.signal)

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
    expect(source.graph.images.get('image')).toBe(image)
    expect(image.byteLength).toBe(3)
  })

  test('times out and terminates a non-responsive Worker', async () => {
    const worker = new FakeWorker()
    const client = createBrowserPreviewWorkerClient({
      workerFactory: () => worker,
      timeoutMs: 5
    })

    await expect(client.build(input(), CHANNEL)).rejects.toThrow('exceeded 5ms')
    expect(worker.terminated).toBe(true)
  })

  test('uses validated stage progress as liveness without removing the hard total limit', async () => {
    const progressingWorker = new FakeWorker((current) => {
      const request = current.posted
      if (!request) return
      setTimeout(() => {
        current.onmessage?.({
          data: {
            version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
            type: 'progress',
            requestId: request.requestId,
            generation: request.generation,
            stage: 'fonts',
            elapsedMs: 10
          }
        } as MessageEvent)
      }, 10)
      setTimeout(() => {
        current.onmessage?.({
          data: {
            version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            generation: request.generation,
            result: {
              status: 'ready',
              html: '<main>progressed</main>',
              diagnostics: [],
              metrics: {
                compileMs: 1,
                bundleMs: 2,
                totalMs: 20,
                inputBytes: 4,
                outputBytes: 5,
                fileCount: 6,
                dependencyCount: 7
              }
            }
          }
        } as MessageEvent)
      }, 20)
    })
    const progressingClient = createBrowserPreviewWorkerClient({
      workerFactory: () => progressingWorker,
      timeoutMs: 15,
      totalTimeoutMs: 50
    })

    await expect(progressingClient.build(input(), CHANNEL)).resolves.toMatchObject({
      status: 'ready'
    })
    progressingClient.dispose()

    let progressInterval: ReturnType<typeof setInterval> | undefined
    const endlessWorker = new FakeWorker((current) => {
      const request = current.posted
      if (!request) return
      progressInterval = setInterval(() => {
        current.onmessage?.({
          data: {
            version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
            type: 'progress',
            requestId: request.requestId,
            generation: request.generation,
            stage: 'bundle-initialize',
            elapsedMs: 5
          }
        } as MessageEvent)
      }, 5)
    })
    const endlessClient = createBrowserPreviewWorkerClient({
      workerFactory: () => endlessWorker,
      timeoutMs: 10,
      totalTimeoutMs: 25
    })
    try {
      await expect(endlessClient.build(input(), CHANNEL)).rejects.toThrow(
        '25ms total limit during stage "bundle-initialize"'
      )
      expect(endlessWorker.terminated).toBe(true)
    } finally {
      if (progressInterval) clearInterval(progressInterval)
    }
  })

  test('reports the active stage when progress stops', async () => {
    const worker = new FakeWorker((current) => {
      queueMicrotask(() => {
        const request = current.posted
        if (!request) return
        current.onmessage?.({
          data: {
            version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
            type: 'progress',
            requestId: request.requestId,
            generation: request.generation,
            stage: 'fonts',
            elapsedMs: 1
          }
        } as MessageEvent)
      })
    })
    const client = createBrowserPreviewWorkerClient({
      workerFactory: () => worker,
      timeoutMs: 5,
      totalTimeoutMs: 25
    })

    await expect(client.build(input(), CHANNEL)).rejects.toThrow('during stage "fonts"')
    expect(worker.terminated).toBe(true)
  })

  test('rejects malformed correlated responses instead of waiting for timeout', async () => {
    const worker = new FakeWorker((current) => {
      queueMicrotask(() => {
        const request = current.posted
        if (!request) return
        current.onmessage?.({
          data: {
            version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            generation: request.generation,
            result: { status: 'error', diagnostics: [], metrics: {}, unexpected: true }
          }
        } as MessageEvent)
      })
    })
    const client = createBrowserPreviewWorkerClient({ workerFactory: () => worker, timeoutMs: 100 })

    await expect(client.build(input(), CHANNEL)).rejects.toThrow('fields are invalid')
    expect(worker.terminated).toBe(true)
  })

  test('rejects a late result from another generation', async () => {
    const worker = new FakeWorker((current) => {
      queueMicrotask(() => {
        const request = current.posted
        if (!request) return
        current.onmessage?.({
          data: {
            version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            generation: request.generation - 1,
            result: { status: 'error', diagnostics: [], metrics: {} }
          }
        } as MessageEvent)
      })
    })
    const client = createBrowserPreviewWorkerClient({ workerFactory: () => worker, timeoutMs: 100 })

    await expect(client.build(input(9), CHANNEL)).rejects.toThrow('invalid response')
    expect(worker.terminated).toBe(true)
  })

  test('terminates when the reusable Worker emits a runtime error', async () => {
    const worker = new FakeWorker((current) => {
      queueMicrotask(() => {
        current.onerror?.({ message: 'worker crashed' } as ErrorEvent)
      })
    })
    const client = createBrowserPreviewWorkerClient({ workerFactory: () => worker })

    await expect(client.build(input(), CHANNEL)).rejects.toThrow('worker crashed')
    expect(worker.terminated).toBe(true)
  })

  test('terminates after a structured build error and when disposed in flight', async () => {
    const failedWorker = new FakeWorker((current) => {
      queueMicrotask(() => {
        const request = current.posted
        if (!request) return
        current.onmessage?.({
          data: {
            version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            generation: request.generation,
            result: {
              status: 'error',
              diagnostics: [
                { code: 'compile-failed', severity: 'error', message: 'fixture failed' }
              ],
              metrics: {
                compileMs: 1,
                bundleMs: 2,
                totalMs: 3,
                inputBytes: 4,
                outputBytes: 5,
                fileCount: 6,
                dependencyCount: 7
              }
            }
          }
        } as MessageEvent)
      })
    })
    const failedClient = createBrowserPreviewWorkerClient({ workerFactory: () => failedWorker })

    await expect(failedClient.build(input(), CHANNEL)).resolves.toMatchObject({ status: 'error' })
    expect(failedWorker.terminated).toBe(true)

    const disposedWorker = new FakeWorker()
    const disposedClient = createBrowserPreviewWorkerClient({
      workerFactory: () => disposedWorker
    })
    const pending = disposedClient.build(input(), CHANNEL)
    disposedClient.dispose()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(disposedWorker.terminated).toBe(true)
  })
})
