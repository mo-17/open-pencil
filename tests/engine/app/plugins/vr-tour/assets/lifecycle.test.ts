import { expect, test } from 'bun:test'

import { createVRTourSamplePluginLifecycle } from '@/app/plugins/vr-tour/assets/lifecycle'
import { createVRTourSampleAssetManager } from '@/app/plugins/vr-tour/assets/manager'

import { deferred, sampleFetcher, sampleStorage } from './helpers'

test('plugin installation is not committed when sample persistence fails', async () => {
  const { storage } = sampleStorage()
  storage.write = async () => undefined
  const resources = createVRTourSampleAssetManager({ storage, fetcher: sampleFetcher() })
  const lifecycle = createVRTourSamplePluginLifecycle(resources)
  let committed = false
  await expect(
    lifecycle.install(async () => {
      committed = true
    })
  ).rejects.toMatchObject({ code: 'storage' })
  expect(committed).toBe(false)
})

test('uninstall waits for an already committing installation and invalidates queued installs', async () => {
  const { rows, storage } = sampleStorage()
  const resources = createVRTourSampleAssetManager({ storage, fetcher: sampleFetcher() })
  const lifecycle = createVRTourSamplePluginLifecycle(resources)
  const started = deferred()
  const release = deferred()
  let installed = false
  const installing = lifecycle.install(async () => {
    started.resolve()
    await release.promise
    installed = true
  })
  await started.promise
  let queuedCommitted = false
  const queued = lifecycle
    .install(async () => {
      queuedCommitted = true
    })
    .catch((error: unknown) => error)
  const uninstalling = lifecycle.uninstall(async () => {
    installed = false
  })
  release.resolve()
  await Promise.all([installing, uninstalling])
  expect(await queued).toMatchObject({ code: 'cancelled' })
  expect(queuedCommitted).toBe(false)
  expect(installed).toBe(false)
  expect(rows.size).toBe(0)
  await lifecycle.install(async () => {
    installed = true
  })
  expect(installed).toBe(true)
  expect(rows.size).toBe(2)
})
