import { describe, expect, test } from 'bun:test'

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'

import { createBrowserMarketplaceSourceStorage } from '@/app/plugins/marketplace'

describe('marketplace source storage', () => {
  test('serializes compare-and-swap across independent browser storage instances', async () => {
    const previousIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: fakeIndexedDB
    })
    try {
      const databaseName = `open-pencil-marketplace-source-test-${crypto.randomUUID()}`
      const key = 'marketplace-source-test'
      const first = createBrowserMarketplaceSourceStorage(key, databaseName)
      const stale = createBrowserMarketplaceSourceStorage(key, databaseName)

      expect(await first.read()).toBeNull()
      expect(await stale.read()).toBeNull()
      expect(await first.compareAndSwap(null, 'trusted-floor-1')).toBe(true)
      expect(await stale.compareAndSwap(null, 'stale-floor-2')).toBe(false)
      expect(await first.read()).toBe('trusted-floor-1')

      await stale.write('trusted-floor-3')
      expect(await first.compareAndSwap('trusted-floor-1', 'stale-floor-4')).toBe(false)
      expect(await first.read()).toBe('trusted-floor-3')
    } finally {
      if (previousIndexedDB) Object.defineProperty(globalThis, 'indexedDB', previousIndexedDB)
      else Reflect.deleteProperty(globalThis, 'indexedDB')
    }
  })
})
