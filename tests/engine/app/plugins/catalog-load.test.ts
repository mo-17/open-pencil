import { expect, test } from 'bun:test'

import { appPluginStoreReady } from '@/app/plugins/app'
import { createBundledPluginCatalog } from '@/app/plugins/catalog'

test('loads every bundled plugin through the real host catalog and activation checks', async () => {
  const snapshot = await appPluginStoreReady
  expect(snapshot.error).toBeNull()
  expect(snapshot.ready).toBe(true)
  expect(new Set(snapshot.catalog.map((entry) => entry.package.manifest.plugin.id))).toEqual(
    new Set(createBundledPluginCatalog().map((entry) => entry.manifest.plugin.id))
  )
  expect(
    snapshot.installed.some((entry) => entry.package.manifest.plugin.id === 'open-pencil.map')
  ).toBe(true)
})
