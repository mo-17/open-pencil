import { expect, test } from 'bun:test'

import { VR_TOUR_SAMPLE_ASSETS } from '@open-pencil/core/plugins'

import type { VRTourSampleFetch } from '@/app/plugins/vr-tour/assets/download'
import { createVRTourSampleAssetManager } from '@/app/plugins/vr-tour/assets/manager'

import { deferred, sampleBytes, sampleFetcher, sampleStorage } from './helpers'

test('cache reads never fetch and installation waits for durable verified originals', async () => {
  const { rows, storage } = sampleStorage()
  const requested: string[] = []
  const manager = createVRTourSampleAssetManager({
    storage,
    fetcher: sampleFetcher((asset) => requested.push(asset.id))
  })
  expect(await manager.get()).toBeNull()
  expect(requested).toEqual([])
  const result = await manager.ensure()
  expect(requested).toEqual(VR_TOUR_SAMPLE_ASSETS.map((asset) => asset.id))
  expect(rows.size).toBe(2)
  result[0].bytes[0] ^= 1
  expect((await manager.get())?.[0].bytes).toEqual(sampleBytes())
  await manager.ensure()
  expect(requested.length).toBe(2)
})

test('explicit repair downloads only missing or invalid cached files', async () => {
  const { rows, storage } = sampleStorage()
  const [first, second] = VR_TOUR_SAMPLE_ASSETS
  rows.set(first.id, sampleBytes(first))
  rows.set(second.id, new Uint8Array(second.byteLength))
  const requested: string[] = []
  const manager = createVRTourSampleAssetManager({
    storage,
    fetcher: sampleFetcher((asset) => requested.push(asset.id))
  })
  expect(await manager.get()).toBeNull()
  expect((await manager.ensure()).length).toBe(2)
  expect(requested).toEqual([second.id])
})

test('storage failures and silently discarded writes cannot declare samples ready', async () => {
  for (const scenario of ['read', 'write', 'discard']) {
    const { storage } = sampleStorage()
    if (scenario === 'read')
      storage.read = async () => {
        throw new Error('disk failure')
      }
    if (scenario === 'write')
      storage.write = async () => {
        throw new Error('quota exceeded')
      }
    if (scenario === 'discard') storage.write = async () => undefined
    const manager = createVRTourSampleAssetManager({ storage, fetcher: sampleFetcher() })
    await expect(manager.ensure()).rejects.toMatchObject({ code: 'storage' })
  }
})

test('removal cancels an active download and already queued repair without late writes', async () => {
  const { rows, storage } = sampleStorage()
  const started = deferred()
  let requests = 0
  const fetcher = (async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      requests += 1
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      started.resolve()
    })) as VRTourSampleFetch
  const manager = createVRTourSampleAssetManager({ storage, fetcher })
  const first = manager.ensure().catch((error: unknown) => error)
  await started.promise
  const queued = manager.ensure().catch((error: unknown) => error)
  await manager.remove()
  expect(await first).toMatchObject({ code: 'cancelled' })
  expect(await queued).toMatchObject({ code: 'cancelled' })
  expect(requests).toBe(1)
  expect(rows.size).toBe(0)
  expect(await manager.get()).toBeNull()
})

test('removal waits for an in-flight cache write then clears it permanently', async () => {
  const { rows, storage } = sampleStorage()
  const started = deferred()
  const release = deferred()
  const write = storage.write
  storage.write = async (asset, bytes) => {
    started.resolve()
    await release.promise
    await write(asset, bytes)
  }
  const manager = createVRTourSampleAssetManager({ storage, fetcher: sampleFetcher() })
  const installing = manager.ensure().catch((error: unknown) => error)
  await started.promise
  const removing = manager.remove()
  release.resolve()
  await removing
  expect(await installing).toMatchObject({ code: 'cancelled' })
  expect(rows.size).toBe(0)
  expect(await manager.get()).toBeNull()
})

test('pre-aborted repairs fail before any network or cache mutation', async () => {
  const { rows, storage } = sampleStorage()
  let requests = 0
  const manager = createVRTourSampleAssetManager({
    storage,
    fetcher: sampleFetcher(() => {
      requests += 1
    })
  })
  const controller = new AbortController()
  controller.abort()
  await expect(manager.ensure({ signal: controller.signal })).rejects.toMatchObject({
    code: 'cancelled'
  })
  expect(rows.size).toBe(0)
  expect(requests).toBe(0)
})
