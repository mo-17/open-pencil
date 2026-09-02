import type { DownloadedFontCache } from '@open-pencil/core/text'

import type { DownloadedFontCacheSummary } from '@/app/editor/fonts/cache'
import { openIdb, reqToPromise, txDone } from '@/app/storage/idb'

const DEFAULT_DATABASE_NAME = 'open-pencil-downloaded-fonts-v1'
const DATABASE_VERSION = 1
const STORE_NAME = 'downloaded-fonts'
const DEFAULT_MAX_ITEM_BYTES = 12 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_ENTRIES = 128
const MAX_CONFIGURED_ENTRIES = 4_096
const MAX_FAMILY_LENGTH = 256
const MAX_STYLE_LENGTH = 128
const MAX_CHARACTERS = 16_384
const SHA256 = /^[a-f\d]{64}$/u
const textEncoder = new TextEncoder()

interface CacheIdentity {
  family: string
  style: string
  characters: string
}

interface StoredFontRecord {
  version: 1
  key: string
  family: string
  style: string
  bytes: ArrayBuffer
  byteLength: number
  sha256: string
  createdAt: number
  lastAccessedAt: number
}

export type BrowserDownloadedFontCacheSummary = DownloadedFontCacheSummary

export interface BrowserDownloadedFontCache extends DownloadedFontCache {
  summary(): Promise<BrowserDownloadedFontCacheSummary>
  clear(): Promise<void>
  close(): void
}

export interface BrowserDownloadedFontCacheOptions {
  /** Override only to isolate tests or separately budget a worker. */
  databaseName?: string
  maxItemBytes?: number
  maxTotalBytes?: number
  maxEntries?: number
  /** Injectable monotonic wall clock for deterministic tests. */
  now?: () => number
}

interface ResolvedBrowserDownloadedFontCacheOptions {
  databaseName: string
  maxItemBytes: number
  maxTotalBytes: number
  maxEntries: number
  now: () => number
}

function cacheLimit(value: number | undefined, fallback: number, label: string): number {
  const candidate = value === undefined ? fallback : value
  if (typeof candidate !== 'number' || candidate < 1 || !Number.isSafeInteger(candidate)) {
    throw new TypeError(`Invalid positive cache limit: ${label}`)
  }
  return candidate
}

function resolveOptions(
  options: BrowserDownloadedFontCacheOptions
): ResolvedBrowserDownloadedFontCacheOptions {
  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME
  if (!databaseName || databaseName.length > 128 || hasControlCharacters(databaseName)) {
    throw new TypeError('databaseName is invalid')
  }
  const maxItemBytes = cacheLimit(options.maxItemBytes, DEFAULT_MAX_ITEM_BYTES, 'maxItemBytes')
  const maxTotalBytes = cacheLimit(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES, 'maxTotalBytes')
  if (maxItemBytes > maxTotalBytes) {
    throw new TypeError('maxItemBytes must not exceed maxTotalBytes')
  }
  const maxEntries = cacheLimit(options.maxEntries, DEFAULT_MAX_ENTRIES, 'maxEntries')
  if (maxEntries > MAX_CONFIGURED_ENTRIES) {
    throw new TypeError(`maxEntries must not exceed ${MAX_CONFIGURED_ENTRIES}`)
  }
  return {
    databaseName,
    maxItemBytes,
    maxTotalBytes,
    maxEntries,
    now: options.now ?? Date.now
  }
}

function normalizedText(value: string, maxLength: number, name: string): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  const normalized = value.normalize('NFKC').trim().toLowerCase()
  if (!normalized || normalized.length > maxLength || hasControlCharacters(normalized)) {
    throw new TypeError(`${name} is invalid`)
  }
  return normalized
}

function cacheIdentity(family: string, style: string, characters = ''): CacheIdentity {
  if (typeof characters !== 'string') throw new TypeError('characters must be a string')
  const normalizedCharacters = Array.from(new Set(characters.normalize('NFC')))
    .filter((character) => !hasControlCharacters(character))
    .sort()
    .join('')
  if (normalizedCharacters.length > MAX_CHARACTERS) {
    throw new TypeError('characters are invalid or exceed the cache key limit')
  }
  return {
    family: normalizedText(family, MAX_FAMILY_LENGTH, 'family'),
    style: normalizedText(style, MAX_STYLE_LENGTH, 'style'),
    characters: normalizedCharacters
  }
}

function hexDigest(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 0x20 || codePoint === 0x7f
  })
}

async function sha256(value: ArrayBuffer | Uint8Array): Promise<string> {
  const source = new ArrayBuffer(value.byteLength)
  new Uint8Array(source).set(value instanceof ArrayBuffer ? new Uint8Array(value) : value)
  return hexDigest(await crypto.subtle.digest('SHA-256', source))
}

async function cacheKey(identity: CacheIdentity): Promise<string> {
  const digest = await sha256(
    textEncoder.encode(`${identity.family}\0${identity.style}\0${identity.characters}`)
  )
  return `font:v1:${digest}`
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function hasValidFontStructure(data: ArrayBuffer): boolean {
  if (data.byteLength < 12) return false
  const bytes = new Uint8Array(data)
  const view = new DataView(data)
  const signature = ascii(bytes, 0, 4)

  if (signature === 'wOFF') {
    if (data.byteLength < 44 || view.getUint32(8) !== data.byteLength) return false
    const tableCount = view.getUint16(12)
    return tableCount > 0 && tableCount <= 4_096 && 44 + tableCount * 20 <= data.byteLength
  }
  if (signature === 'wOF2') {
    if (data.byteLength < 48 || view.getUint32(8) !== data.byteLength) return false
    const tableCount = view.getUint16(12)
    return tableCount > 0 && tableCount <= 4_096
  }
  if (!['\u0000\u0001\u0000\u0000', 'OTTO', 'true', 'typ1'].includes(signature)) return false
  const tableCount = view.getUint16(4)
  return tableCount > 0 && tableCount <= 4_096 && 12 + tableCount * 16 <= data.byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

const STORED_FONT_RECORD_KEYS = new Set([
  'byteLength',
  'bytes',
  'createdAt',
  'family',
  'key',
  'lastAccessedAt',
  'sha256',
  'style',
  'version'
])

function hasExactStoredKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value)
  return (
    keys.length === STORED_FONT_RECORD_KEYS.size &&
    keys.every((key) => STORED_FONT_RECORD_KEYS.has(key))
  )
}

// oxlint-disable-next-line eslint/complexity -- Every persisted field stays visible in one fail-closed record validator.
function validStoredMetadata(value: unknown, maxItemBytes: number): value is StoredFontRecord {
  if (!isRecord(value) || !hasExactStoredKeys(value)) return false
  return (
    value.version === 1 &&
    typeof value.key === 'string' &&
    /^font:v1:[a-f\d]{64}$/u.test(value.key) &&
    typeof value.family === 'string' &&
    value.family.length > 0 &&
    value.family.length <= MAX_FAMILY_LENGTH &&
    !hasControlCharacters(value.family) &&
    typeof value.style === 'string' &&
    value.style.length > 0 &&
    value.style.length <= MAX_STYLE_LENGTH &&
    !hasControlCharacters(value.style) &&
    value.bytes instanceof ArrayBuffer &&
    Number.isSafeInteger(value.byteLength) &&
    (value.byteLength as number) > 0 &&
    (value.byteLength as number) <= maxItemBytes &&
    value.bytes.byteLength === value.byteLength &&
    typeof value.sha256 === 'string' &&
    SHA256.test(value.sha256) &&
    validTimestamp(value.createdAt) &&
    validTimestamp(value.lastAccessedAt)
  )
}

function sameBytes(first: ArrayBuffer, second: ArrayBuffer): boolean {
  if (first.byteLength !== second.byteLength) return false
  const firstBytes = new Uint8Array(first)
  const secondBytes = new Uint8Array(second)
  return firstBytes.every((byte, index) => byte === secondBytes[index])
}

function sameStoredSnapshot(first: unknown, second: unknown): boolean {
  if (!isRecord(first) || !isRecord(second)) return Object.is(first, second)
  const firstKeys = Object.keys(first).sort()
  const secondKeys = Object.keys(second).sort()
  if (
    firstKeys.length !== secondKeys.length ||
    firstKeys.some((key, index) => key !== secondKeys[index])
  ) {
    return false
  }
  return firstKeys.every((key) => {
    const firstValue = first[key]
    const secondValue = second[key]
    if (firstValue instanceof ArrayBuffer && secondValue instanceof ArrayBuffer) {
      return sameBytes(firstValue, secondValue)
    }
    return Object.is(firstValue, secondValue)
  })
}

function storedRecordWithAccessTime(
  record: StoredFontRecord,
  lastAccessedAt: number
): StoredFontRecord {
  return {
    version: 1,
    key: record.key,
    family: record.family,
    style: record.style,
    bytes: record.bytes.slice(0),
    byteLength: record.byteLength,
    sha256: record.sha256,
    createdAt: record.createdAt,
    lastAccessedAt
  }
}

async function openDatabase(name: string): Promise<IDBDatabase> {
  return openIdb(name, DATABASE_VERSION, (database) => {
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
  })
}

function identityMatches(record: StoredFontRecord, identity: CacheIdentity): boolean {
  return record.family === identity.family && record.style === identity.style
}

/**
 * A bounded, integrity-verified IndexedDB cache usable in Window and DedicatedWorker globals.
 * It never stores source URLs, request headers, credentials, or local paths.
 */
export function createBrowserDownloadedFontCache(
  options: BrowserDownloadedFontCacheOptions = {}
): BrowserDownloadedFontCache {
  const resolved = resolveOptions(options)
  let closed = false
  let databasePromise: Promise<IDBDatabase> | null = null

  const database = async (): Promise<IDBDatabase> => {
    if (closed) throw new Error('Browser downloaded font cache is closed')
    databasePromise ??= openDatabase(resolved.databaseName)
    return databasePromise
  }

  const removeIfUnchanged = async (key: string, snapshot: unknown): Promise<void> => {
    const db = await database()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const done = txDone(tx)
    const store = tx.objectStore(STORE_NAME)
    const current: unknown = await reqToPromise(store.get(key))
    if (sameStoredSnapshot(current, snapshot)) store.delete(key)
    await done
  }

  const scanLimit = Math.min(resolved.maxEntries * 2 + 16, MAX_CONFIGURED_ENTRIES)

  return {
    async read(family, style, characters = '') {
      const identity = cacheIdentity(family, style, characters)
      const key = await cacheKey(identity)
      const db = await database()
      const tx = db.transaction(STORE_NAME, 'readonly')
      const done = txDone(tx)
      const value: unknown = await reqToPromise(tx.objectStore(STORE_NAME).get(key))
      await done
      if (!validStoredMetadata(value, resolved.maxItemBytes)) {
        if (value !== undefined) await removeIfUnchanged(key, value)
        return null
      }
      if (
        !identityMatches(value, identity) ||
        value.key !== key ||
        !hasValidFontStructure(value.bytes)
      ) {
        await removeIfUnchanged(key, value)
        return null
      }
      if ((await sha256(value.bytes)) !== value.sha256) {
        await removeIfUnchanged(key, value)
        return null
      }

      const touchTx = db.transaction(STORE_NAME, 'readwrite')
      const touchDone = txDone(touchTx)
      const touchStore = touchTx.objectStore(STORE_NAME)
      const current: unknown = await reqToPromise(touchStore.get(key))
      if (sameStoredSnapshot(current, value)) {
        touchStore.put(storedRecordWithAccessTime(value, resolved.now()))
      }
      await touchDone
      return value.bytes.slice(0)
    },

    async write(family, style, data, characters = '') {
      const identity = cacheIdentity(family, style, characters)
      if (!(data instanceof ArrayBuffer)) throw new TypeError('font data must be an ArrayBuffer')
      if (data.byteLength === 0 || data.byteLength > resolved.maxItemBytes) {
        throw new RangeError('font data exceeds the per-item cache limit')
      }
      if (!hasValidFontStructure(data)) throw new TypeError('font data has an invalid font header')

      const [key, digest] = await Promise.all([cacheKey(identity), sha256(data)])
      const db = await database()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const done = txDone(tx)
      const store = tx.objectStore(STORE_NAME)
      const storedCount = await reqToPromise(store.count())
      const existing: unknown[] =
        storedCount > scanLimit ? [] : await reqToPromise(store.getAll(undefined, scanLimit))
      if (storedCount > scanLimit) store.clear()
      const valid = existing.filter((entry): entry is StoredFontRecord => {
        if (validStoredMetadata(entry, resolved.maxItemBytes)) return true
        if (isRecord(entry) && typeof entry.key === 'string') store.delete(entry.key)
        return false
      })
      const previous = valid.find((entry) => entry.key === key)
      const now = resolved.now()
      const record: StoredFontRecord = {
        version: 1,
        key,
        family: identity.family,
        style: identity.style,
        bytes: data.slice(0),
        byteLength: data.byteLength,
        sha256: digest,
        createdAt: previous?.createdAt ?? now,
        lastAccessedAt: now
      }
      const retained = valid
        .filter((entry) => entry.key !== key)
        .sort(
          (first, second) =>
            first.lastAccessedAt - second.lastAccessedAt || first.key.localeCompare(second.key)
        )
      let byteLength = retained.reduce((sum, entry) => sum + entry.byteLength, record.byteLength)
      while (retained.length + 1 > resolved.maxEntries || byteLength > resolved.maxTotalBytes) {
        const evicted = retained.shift()
        if (!evicted) {
          tx.abort()
          throw new RangeError('font data exceeds the total cache limit')
        }
        store.delete(evicted.key)
        byteLength -= evicted.byteLength
      }
      store.put(record)
      await done
    },

    async summary() {
      const db = await database()
      const tx = db.transaction(STORE_NAME, 'readonly')
      const done = txDone(tx)
      const store = tx.objectStore(STORE_NAME)
      const storedCount = await reqToPromise(store.count())
      const values: unknown[] =
        storedCount > scanLimit ? [] : await reqToPromise(store.getAll(undefined, scanLimit))
      await done
      const valid = values.filter((entry): entry is StoredFontRecord =>
        validStoredMetadata(entry, resolved.maxItemBytes)
      )
      return {
        count: valid.length,
        byteLength: valid.reduce((sum, entry) => sum + entry.byteLength, 0),
        updatedAt: valid.length > 0 ? Math.max(...valid.map((entry) => entry.lastAccessedAt)) : null
      }
    },

    async clear() {
      const db = await database()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const done = txDone(tx)
      tx.objectStore(STORE_NAME).clear()
      await done
    },

    close() {
      if (closed) return
      closed = true
      if (databasePromise) {
        void databasePromise.then(
          (database) => database.close(),
          () => undefined
        )
      }
    }
  }
}
