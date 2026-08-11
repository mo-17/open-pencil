import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createVueSourceArchiver,
  type VueSourceArchiveWorkerLike
} from '@/app/plugins/host/vue/archive/client'
import type { VueSourceArchiveWorkerRequest } from '@/app/plugins/host/vue/archive/protocol'
import { VUE_SOURCE_COMPILER_WORKER_LIMITS } from '@/app/plugins/host/vue/compiler/protocol'
import {
  exportCurrentDocumentAsVueSource,
  type VueSourceExportEditor,
  type VueSourceExporterDependencies
} from '@/app/plugins/host/vue/source-exporter'

class FakeArchiveWorker implements VueSourceArchiveWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false

  constructor(
    private readonly respond: (
      request: VueSourceArchiveWorkerRequest,
      worker: FakeArchiveWorker
    ) => void = () => undefined
  ) {}

  postMessage(message: unknown): void {
    this.respond(message as VueSourceArchiveWorkerRequest, this)
  }

  terminate(): void {
    this.terminated = true
  }
}

function editor(): VueSourceExportEditor {
  return { graph: new SceneGraph(), state: { documentName: 'Vue Archive' } }
}

function compiledFiles(): Map<string, string | Uint8Array> {
  return new Map([
    ['package.json', '{"name":"vue-archive"}\n'],
    ['src/App.vue', '<template><main>Vue archive</main></template>\n']
  ])
}

describe('Vue source archive Worker', () => {
  test('terminates compression on abort and never performs a late write', async () => {
    let posted: (() => void) | undefined
    let archiveRequestId = ''
    const archivePosted = new Promise<void>((resolve) => {
      posted = resolve
    })
    const worker = new FakeArchiveWorker((request) => {
      archiveRequestId = request.requestId
      posted?.()
    })
    const archiver = createVueSourceArchiver({ workerFactory: () => worker })
    const controller = new AbortController()
    let wrote = false
    const dependencies: VueSourceExporterDependencies = {
      async chooseDestination() {
        return {
          async write() {
            wrote = true
          }
        }
      },
      async resolveFontManifest() {
        return { faces: [] }
      },
      compile() {
        return { files: compiledFiles(), warnings: [] }
      },
      archive: archiver.archive
    }
    const pending = exportCurrentDocumentAsVueSource(editor(), dependencies, controller.signal)
    await archivePosted
    const lateHandler = worker.onmessage
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
    expect(wrote).toBe(false)
    lateHandler?.({
      data: {
        version: 1,
        type: 'result',
        requestId: archiveRequestId,
        bytes: new Uint8Array([1])
      }
    } as MessageEvent)
    await Promise.resolve()
    expect(wrote).toBe(false)
  })

  test('fails closed on Worker errors and oversized backing buffers', async () => {
    const worker = new FakeArchiveWorker((request, current) => {
      queueMicrotask(() =>
        current.onmessage?.({
          data: {
            version: 1,
            type: 'error',
            requestId: request.requestId,
            error: 'archive isolate failed'
          }
        } as MessageEvent)
      )
    })
    const archiver = createVueSourceArchiver({ workerFactory: () => worker })
    await expect(archiver.archive(compiledFiles())).rejects.toThrow('archive isolate failed')
    expect(worker.terminated).toBe(true)

    const oversizedBacking = new ArrayBuffer(VUE_SOURCE_COMPILER_WORKER_LIMITS.maxOutputBytes + 1)
    let workers = 0
    const bounded = createVueSourceArchiver({
      workerFactory() {
        workers += 1
        return new FakeArchiveWorker()
      }
    })
    await expect(
      bounded.archive(
        new Map([
          [
            'src/assets/tiny-view.bin',
            new Uint8Array(oversizedBacking, oversizedBacking.byteLength - 1, 1)
          ]
        ])
      )
    ).rejects.toThrow(`exceeds ${VUE_SOURCE_COMPILER_WORKER_LIMITS.maxOutputBytes} bytes`)
    expect(workers).toBe(0)
  })
})
