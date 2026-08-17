import { describe, expect, test } from 'bun:test'

import { withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import type {
  BrowserPreviewWorkerBuildResult,
  CreateBrowserPreviewWorkerRequestInput
} from '@/app/lowcode/preview-pane/browser-worker/protocol'
import { createBrowserPreviewHost } from '@/app/lowcode/preview-pane/host/browser'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function metrics() {
  return {
    compileMs: 1,
    bundleMs: 2,
    totalMs: 3,
    inputBytes: 4,
    outputBytes: 5,
    fileCount: 6,
    dependencyCount: 7
  }
}

function request(generation: number, target: 'react' | 'vue' = 'react') {
  const graph = new SceneGraph()
  return {
    generation,
    graph,
    pageIds: graph.getPages().map(({ id }) => id),
    options: withDefaults({ packageName: 'openpencil-preview', target, router: 'none' }),
    refreshFonts: false
  }
}

describe('browser preview Host', () => {
  test('creates the minimal opaque sandbox descriptor and reclaims Blob URLs', async () => {
    const revoked: string[] = []
    let clientDisposed = false
    let sequence = 0
    const host = createBrowserPreviewHost('react', {
      client: {
        async build() {
          return {
            status: 'ready',
            html: `<main>${sequence}</main>`,
            diagnostics: [],
            metrics: metrics()
          }
        },
        dispose() {
          clientDisposed = true
        }
      },
      createChannelId: () => `channel-id-000000${sequence}`,
      createObjectURL: () => `blob:preview-${++sequence}`,
      revokeObjectURL: (url) => revoked.push(url)
    })

    const first = await host.build(request(1))
    expect(first).toMatchObject({
      status: 'ready',
      frame: {
        src: 'blob:preview-1',
        expectedMessageOrigin: 'null',
        postMessageTargetOrigin: '*',
        sandbox: 'allow-scripts'
      }
    })
    const second = await host.build(request(2))
    expect(second).toMatchObject({ status: 'ready', frame: { src: 'blob:preview-2' } })
    expect(revoked).toEqual(['blob:preview-1'])

    if (second.status !== 'ready') throw new Error('Expected ready browser preview')
    host.releaseFrame(second.frame)
    expect(revoked).toEqual(['blob:preview-1', 'blob:preview-2'])

    await host.dispose()
    expect(revoked).toEqual(['blob:preview-1', 'blob:preview-2'])
    expect(clientDisposed).toBe(true)
    expect(host.isAlive()).toBe(false)
  })

  test('snapshots reviewed font providers and the refresh flag into the Worker request', async () => {
    let posted: CreateBrowserPreviewWorkerRequestInput | null = null
    const host = createBrowserPreviewHost('react', {
      client: {
        async build(input) {
          posted = input
          return {
            status: 'ready',
            html: '<main>fonts</main>',
            diagnostics: [],
            metrics: metrics()
          }
        },
        dispose: () => undefined
      },
      getFontProviders: () => ['fontshare', 'google'],
      createChannelId: () => 'channel-id-1234567890',
      createObjectURL: () => 'blob:font-preview',
      revokeObjectURL: () => undefined
    })

    await expect(host.build({ ...request(1), refreshFonts: true })).resolves.toMatchObject({
      status: 'ready'
    })
    expect(posted).toMatchObject({
      fontProviders: ['fontshare', 'google'],
      refreshFonts: true
    })
    await host.dispose()
  })

  test('drops a late result and never lets it replace the latest artifact', async () => {
    const pending = new Map<number, Deferred<BrowserPreviewWorkerBuildResult>>()
    const signals = new Map<number, AbortSignal | undefined>()
    const created: string[] = []
    const revoked: string[] = []
    const host = createBrowserPreviewHost('react', {
      client: {
        build(input, _channelId, signal) {
          const build = deferred<BrowserPreviewWorkerBuildResult>()
          pending.set(input.generation, build)
          signals.set(input.generation, signal)
          return build.promise
        },
        dispose: () => undefined
      },
      createChannelId: () => 'channel-id-1234567890',
      createObjectURL: () => {
        const url = `blob:preview-${created.length + 1}`
        created.push(url)
        return url
      },
      revokeObjectURL: (url) => revoked.push(url)
    })

    const first = host.build(request(1))
    const second = host.build(request(2))
    expect(signals.get(1)?.aborted).toBe(true)
    pending.get(2)?.resolve({
      status: 'ready',
      html: '<main>latest</main>',
      diagnostics: [],
      metrics: metrics()
    })
    await expect(second).resolves.toMatchObject({
      status: 'ready',
      frame: { src: 'blob:preview-1' }
    })
    pending.get(1)?.resolve({
      status: 'ready',
      html: '<main>late</main>',
      diagnostics: [],
      metrics: metrics()
    })
    await expect(first).resolves.toMatchObject({ status: 'stale' })
    expect(created).toEqual(['blob:preview-1'])
    expect(revoked).toEqual([])

    await host.dispose()
    expect(revoked).toEqual(['blob:preview-1'])
  })

  test('removes the old successful artifact as soon as a newer build fails', async () => {
    const revoked: string[] = []
    let calls = 0
    const host = createBrowserPreviewHost('react', {
      client: {
        async build() {
          calls += 1
          return calls === 1
            ? {
                status: 'ready',
                html: '<main>old</main>',
                diagnostics: [],
                metrics: metrics()
              }
            : {
                status: 'error',
                diagnostics: [
                  { code: 'compile-error', severity: 'error', message: 'Latest build failed' }
                ],
                metrics: metrics()
              }
        },
        dispose: () => undefined
      },
      createChannelId: () => 'channel-id-1234567890',
      createObjectURL: () => 'blob:old-success',
      revokeObjectURL: (url) => revoked.push(url)
    })

    await expect(host.build(request(1))).resolves.toMatchObject({ status: 'ready' })
    await expect(host.build(request(2))).resolves.toMatchObject({
      status: 'error',
      reason: 'Latest build failed'
    })
    expect(revoked).toEqual(['blob:old-success'])
  })

  test('fails closed for Vue without starting a Worker', async () => {
    let calls = 0
    const host = createBrowserPreviewHost('vue', {
      client: {
        async build() {
          calls += 1
          throw new Error('must not run')
        },
        dispose: () => undefined
      }
    })

    await expect(host.build(request(1, 'vue'))).resolves.toMatchObject({
      status: 'unsupported',
      diagnostics: [{ code: 'browser-preview-vue-unsupported' }]
    })
    expect(calls).toBe(0)
  })

  test('dispose aborts an in-flight Worker request', async () => {
    const pending = deferred<BrowserPreviewWorkerBuildResult>()
    let clientDisposed = false
    let signal: AbortSignal | undefined
    const host = createBrowserPreviewHost('react', {
      client: {
        build(_input, _channelId, currentSignal) {
          signal = currentSignal
          return pending.promise
        },
        dispose() {
          clientDisposed = true
        }
      }
    })
    const build = host.build(request(1))

    const disposing = host.dispose()
    expect(signal?.aborted).toBe(true)
    expect(clientDisposed).toBe(true)
    pending.resolve({ status: 'error', diagnostics: [], metrics: metrics() })
    await disposing
    await expect(build).resolves.toMatchObject({ status: 'stale' })
  })
})
