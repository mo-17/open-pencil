import { expect, test } from 'bun:test'

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'

import { createIdbAppPluginStateStorage } from '@/app/plugins/storage'

function record(pluginId: string) {
  return {
    schemaVersion: 3,
    pluginId,
    trustSource: 'app-bundle',
    activeDigest: `digest:${pluginId}`,
    installed: false,
    enabled: false,
    pinnedDigest: null,
    installedState: null,
    marketplaceAuthority: null
  }
}

test('app plugin IDB storage increments one shared atomic revision per mutation', async () => {
  const previousIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: fakeIndexedDB
  })
  try {
    const databaseName = `open-pencil-plugin-storage-test-${crypto.randomUUID()}`
    const first = createIdbAppPluginStateStorage(databaseName)
    const second = createIdbAppPluginStateStorage(databaseName)
    expect(await first.revision()).toBe(0)

    await Promise.all([first.put(record('plugin.a')), second.put(record('plugin.b'))])
    expect(await first.revision()).toBe(2)
    expect(await second.revision()).toBe(2)
    expect((await first.list()).map((value) => Reflect.get(value, 'pluginId')).sort()).toEqual([
      'plugin.a',
      'plugin.b'
    ])

    await second.delete('plugin.a')
    expect(await first.revision()).toBe(3)
    expect((await first.list()).map((value) => Reflect.get(value, 'pluginId'))).toEqual([
      'plugin.b'
    ])
  } finally {
    if (previousIndexedDB) Object.defineProperty(globalThis, 'indexedDB', previousIndexedDB)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
  }
})
