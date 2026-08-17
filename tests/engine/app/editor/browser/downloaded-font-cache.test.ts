import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test } from 'bun:test'

import {
  createBrowserDownloadedFontCache,
  type BrowserDownloadedFontCache
} from '@/app/editor/fonts/browser-downloaded-font-cache'

const caches: BrowserDownloadedFontCache[] = []
let databaseSequence = 0

interface RawFontRecord {
  key: string
  [field: string]: unknown
}

function firstRawFontRecord(value: unknown): RawFontRecord {
  if (!Array.isArray(value)) throw new TypeError('Expected an IndexedDB record array')
  const first: unknown = value[0]
  if (
    typeof first !== 'object' ||
    first === null ||
    Array.isArray(first) ||
    !('key' in first) ||
    typeof first.key !== 'string'
  ) {
    throw new TypeError('Expected a stored font record')
  }
  return first
}

function databaseName(): string {
  databaseSequence++
  return `browser-font-cache-test-${databaseSequence}`
}

function woff2(marker: number, byteLength = 48): ArrayBuffer {
  const data = new ArrayBuffer(byteLength)
  const bytes = new Uint8Array(data)
  bytes.set([0x77, 0x4f, 0x46, 0x32])
  const view = new DataView(data)
  view.setUint32(8, byteLength)
  view.setUint16(12, 1)
  bytes[byteLength - 1] = marker
  return data
}

function cache(
  options: Parameters<typeof createBrowserDownloadedFontCache>[0] = {}
): BrowserDownloadedFontCache {
  const created = createBrowserDownloadedFontCache({ databaseName: databaseName(), ...options })
  caches.push(created)
  return created
}

afterEach(() => {
  for (const item of caches.splice(0)) item.close()
})

describe('createBrowserDownloadedFontCache', () => {
  test('round-trips validated font bytes using canonical bounded keys', async () => {
    const fonts = cache()
    const bytes = woff2(7)

    await fonts.write(' Inter ', 'REGULAR', bytes, 'b\na')

    const loaded = await fonts.read('inter', 'regular', 'ab')
    expect(loaded).not.toBeNull()
    if (!loaded) throw new Error('Expected cached font bytes')
    expect(new Uint8Array(loaded)).toEqual(new Uint8Array(bytes))
    expect(loaded).not.toBe(bytes)
    await expect(fonts.read('inter', 'bold', 'ab')).resolves.toBeNull()
    await expect(fonts.summary()).resolves.toMatchObject({ count: 1, byteLength: 48 })
  })

  test('rejects invalid identity, malformed fonts, and oversized entries', async () => {
    const fonts = cache({ maxItemBytes: 64, maxTotalBytes: 128 })

    await expect(fonts.write('', 'Regular', woff2(1))).rejects.toBeInstanceOf(TypeError)
    await expect(fonts.write('Inter\u0000secret', 'Regular', woff2(1))).rejects.toBeInstanceOf(
      TypeError
    )
    await expect(fonts.write('Inter', 'Regular', new ArrayBuffer(48))).rejects.toBeInstanceOf(
      TypeError
    )
    await expect(fonts.write('Inter', 'Regular', woff2(1, 65))).rejects.toBeInstanceOf(RangeError)
    await expect(fonts.summary()).resolves.toEqual({ count: 0, byteLength: 0, updatedAt: null })
  })

  test('evicts the least recently used entry within aggregate and count limits', async () => {
    let now = 0
    const fonts = cache({
      maxItemBytes: 48,
      maxTotalBytes: 96,
      maxEntries: 2,
      now: () => ++now
    })

    await fonts.write('Alpha', 'Regular', woff2(1))
    await fonts.write('Beta', 'Regular', woff2(2))
    await expect(fonts.read('Alpha', 'Regular')).resolves.not.toBeNull()
    await fonts.write('Gamma', 'Regular', woff2(3))

    await expect(fonts.read('Alpha', 'Regular')).resolves.not.toBeNull()
    await expect(fonts.read('Beta', 'Regular')).resolves.toBeNull()
    await expect(fonts.read('Gamma', 'Regular')).resolves.not.toBeNull()
    await expect(fonts.summary()).resolves.toMatchObject({ count: 2, byteLength: 96 })
  })

  test('detects content corruption and removes the invalid record', async () => {
    const name = databaseName()
    const fonts = createBrowserDownloadedFontCache({ databaseName: name })
    caches.push(fonts)
    await fonts.write('Inter', 'Regular', woff2(1))

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const readTx = database.transaction('downloaded-fonts', 'readonly')
    const records = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const request = readTx.objectStore('downloaded-fonts').getAll()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    expect(records[0]?.key).toMatch(/^font:v1:[a-f\d]{64}$/u)
    expect(records[0]).not.toHaveProperty('characters')
    expect(records[0]).not.toHaveProperty('url')
    const corrupted = { ...records[0], bytes: woff2(9) }
    const writeTx = database.transaction('downloaded-fonts', 'readwrite')
    await new Promise<void>((resolve, reject) => {
      const request = writeTx.objectStore('downloaded-fonts').put(corrupted)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
    database.close()

    await expect(fonts.read('Inter', 'Regular')).resolves.toBeNull()
    await expect(fonts.summary()).resolves.toEqual({ count: 0, byteLength: 0, updatedAt: null })
  })

  test('rejects and removes records with unapproved persisted fields', async () => {
    const name = databaseName()
    const fonts = createBrowserDownloadedFontCache({ databaseName: name })
    caches.push(fonts)
    await fonts.write('Inter', 'Regular', woff2(1), 'abc')

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const readTx = database.transaction('downloaded-fonts', 'readonly')
    const record = await new Promise<RawFontRecord>((resolve, reject) => {
      const request = readTx.objectStore('downloaded-fonts').getAll()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(firstRawFontRecord(request.result))
    })
    const writeTx = database.transaction('downloaded-fonts', 'readwrite')
    await new Promise<void>((resolve, reject) => {
      const request = writeTx.objectStore('downloaded-fonts').put({
        ...record,
        characters: 'document-secret',
        url: 'file:///Users/example/private.ttf'
      })
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
    database.close()

    await expect(fonts.read('Inter', 'Regular', 'abc')).resolves.toBeNull()
    await expect(fonts.summary()).resolves.toEqual({ count: 0, byteLength: 0, updatedAt: null })
  })

  test('bounds cache scans and recovers by replacing an oversized store', async () => {
    const name = databaseName()
    const fonts = createBrowserDownloadedFontCache({ databaseName: name, maxEntries: 2 })
    caches.push(fonts)
    await fonts.write('Seed', 'Regular', woff2(1))

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const readTx = database.transaction('downloaded-fonts', 'readonly')
    const seed = await new Promise<RawFontRecord>((resolve, reject) => {
      const request = readTx.objectStore('downloaded-fonts').getAll()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(firstRawFontRecord(request.result))
    })
    const writeTx = database.transaction('downloaded-fonts', 'readwrite')
    const store = writeTx.objectStore('downloaded-fonts')
    for (let index = 0; index < 21; index++) {
      store.put({ ...seed, key: `font:v1:${index.toString(16).padStart(64, '0')}` })
    }
    await new Promise<void>((resolve, reject) => {
      writeTx.oncomplete = () => resolve()
      writeTx.onerror = () => reject(writeTx.error)
      writeTx.onabort = () => reject(writeTx.error)
    })
    database.close()

    await expect(fonts.summary()).resolves.toEqual({ count: 0, byteLength: 0, updatedAt: null })
    await fonts.write('Recovered', 'Regular', woff2(2))
    await expect(fonts.summary()).resolves.toMatchObject({ count: 1, byteLength: 48 })
  })

  test('clears entries and rejects operations after close', async () => {
    const fonts = cache()
    await fonts.write('Inter', 'Regular', woff2(1))
    await fonts.clear()
    await expect(fonts.summary()).resolves.toEqual({ count: 0, byteLength: 0, updatedAt: null })

    fonts.close()
    await expect(fonts.read('Inter', 'Regular')).rejects.toThrow('cache is closed')
  })
})
