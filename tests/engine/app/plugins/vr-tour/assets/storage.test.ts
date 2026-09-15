import { expect, test } from 'bun:test'

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'

import { VR_TOUR_SAMPLE_ASSETS } from '@open-pencil/core/plugins'

import { createVRTourSampleAssetManager } from '@/app/plugins/vr-tour/assets/manager'
import { createIdbVRTourSampleStorage } from '@/app/plugins/vr-tour/assets/storage'

import { sampleBytes, sampleFetcher } from './helpers'

test('IndexedDB sample pack survives a fresh adapter and removes only its own database bytes', async () => {
  const name = `vr-tour-samples-test-${crypto.randomUUID()}`
  const first = createIdbVRTourSampleStorage(name, fakeIndexedDB)
  const unrelated = createIdbVRTourSampleStorage(`${name}-unrelated`, fakeIndexedDB)
  const asset = VR_TOUR_SAMPLE_ASSETS[0]
  await unrelated.write(asset, sampleBytes(asset))
  await createVRTourSampleAssetManager({ storage: first, fetcher: sampleFetcher() }).ensure()
  const restarted = createIdbVRTourSampleStorage(name, fakeIndexedDB)
  const reader = createVRTourSampleAssetManager({ storage: restarted, fetcher: sampleFetcher() })
  expect((await reader.get())?.length).toBe(2)
  await reader.remove()
  expect(await first.read(asset)).toBeNull()
  expect(await unrelated.read(asset)).toEqual(sampleBytes(asset))
})

test('IndexedDB cache rejects caller-defined keys before opening the database', async () => {
  const storage = createIdbVRTourSampleStorage(
    `vr-tour-keys-test-${crypto.randomUUID()}`,
    fakeIndexedDB
  )
  await expect(
    storage.read({ ...VR_TOUR_SAMPLE_ASSETS[0], id: '../../other' })
  ).rejects.toMatchObject({ code: 'integrity' })
})
