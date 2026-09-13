import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createPreviewHost } from '@/app/lowcode/preview-pane/host/create'
import {
  createLocalBackendPreviewConnection,
  LOCAL_BACKEND_CHANGED_MESSAGE,
  prepareLocalBackendPreview,
  type PreparedLocalBackendPreview
} from '@/app/lowcode/preview-pane/local-backend-connection'

const prepared: PreparedLocalBackendPreview = {
  connection: {
    previewPort: 5181,
    apiPort: 3000,
    apiBasePath: '/api',
    applicationId: 'personal-notes',
    applicationDigest: 'A'.repeat(43)
  },
  loginPath: '/login'
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('explicit local Backend preview session', () => {
  test('adopts only the owned host connection supplied by a prepared managed session', async () => {
    let externalPreparations = 0
    const controller = createLocalBackendPreviewConnection({
      prepare: async () => {
        externalPreparations++
        return prepared
      },
      start: async () => undefined,
      stop: async () => undefined
    })
    await controller.adoptPrepared({
      connection: { ...prepared.connection, apiPort: 3012, previewPort: 5182 },
      loginPath: '/login'
    })
    controller.markReady()
    expect(externalPreparations).toBe(0)
    expect(controller.connection.value?.apiPort).toBe(3012)
    expect(controller.browserURL.value).toBe('http://127.0.0.1:5182/login')
    await controller.disconnect()
    expect(controller.browserURL.value).toBeNull()
  })

  test('publishes only an acknowledged browser URL and revokes it before asynchronous teardown', async () => {
    const stopped = deferred<undefined>()
    let stopCount = 0
    let starts = 0
    const controller = createLocalBackendPreviewConnection({
      prepare: async () => prepared,
      start: async () => {
        starts++
      },
      stop: () => (++stopCount === 1 ? Promise.resolve() : stopped.promise)
    })
    await controller.connect(3000)
    expect(controller.state.value.kind).toBe('connecting')
    expect(controller.browserURL.value).toBeNull()
    controller.markReady()
    expect(controller.browserURL.value).toBe('http://127.0.0.1:5181/login')
    const disconnecting = controller.disconnect(LOCAL_BACKEND_CHANGED_MESSAGE)
    expect(controller.connection.value).toBeNull()
    expect(controller.browserURL.value).toBeNull()
    expect(controller.state.value.message).toBe(LOCAL_BACKEND_CHANGED_MESSAGE)
    controller.markReady()
    expect(controller.state.value.kind).toBe('disconnected')
    stopped.resolve(undefined)
    await disconnecting
    expect(starts).toBe(1)
  })

  test('a connection cancelled while plugin readiness is pending cannot start a sidecar', async () => {
    const pending = deferred<PreparedLocalBackendPreview>()
    const entered = deferred<undefined>()
    let starts = 0
    const controller = createLocalBackendPreviewConnection({
      prepare: () => {
        entered.resolve(undefined)
        return pending.promise
      },
      start: async () => {
        starts++
      },
      stop: async () => undefined
    })
    const connecting = controller.connect(3000)
    await entered.promise
    await controller.disconnect(LOCAL_BACKEND_CHANGED_MESSAGE)
    pending.resolve(prepared)
    await connecting
    expect(starts).toBe(0)
    expect(controller.connection.value).toBeNull()
  })

  test('failed connection clears writable session authority and keeps an actionable error', async () => {
    let stops = 0
    const controller = createLocalBackendPreviewConnection({
      prepare: async () => prepared,
      start: async () => {
        throw new Error('Backend contract differs. Synchronize and reconnect.')
      },
      stop: async () => {
        stops++
      }
    })
    await controller.connect(3000)
    expect(controller.state.value.kind).toBe('error')
    expect(controller.state.value.message).toContain('Synchronize and reconnect')
    expect(controller.connection.value).toBeNull()
    expect(stops).toBe(2)
  })

  test('browser editor and browser host reject local connections before starting a runtime', async () => {
    await expect(prepareLocalBackendPreview(new SceneGraph(), 'react', 3000)).rejects.toThrow(
      'desktop editor'
    )
    await expect(
      createPreviewHost('react', { environment: 'browser', localBackend: prepared.connection })
    ).rejects.toThrow('desktop editor')
  })
})
