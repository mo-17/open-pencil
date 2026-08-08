import { validateModuleIdentity } from './module'
import {
  canonicalManifestValue,
  decodeBase64Url,
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseStableSemver
} from './signed-manifest'

export const PLUGIN_DOCUMENT_LOCK_FORMAT = 'openpencil-plugin-lock' as const
export const PLUGIN_DOCUMENT_LOCK_SCHEMA_VERSION = 1 as const

export const PLUGIN_DOCUMENT_LOCK_LIMITS = Object.freeze({
  maxJsonBytes: 64 * 1024,
  maxPlugins: 64
})

export interface PluginDocumentLockEntryV1 {
  pluginId: string
  version: string
  manifestDigest: string
  publisherKeyId: string
}

export interface PluginDocumentLockV1 {
  format: typeof PLUGIN_DOCUMENT_LOCK_FORMAT
  schemaVersion: typeof PLUGIN_DOCUMENT_LOCK_SCHEMA_VERSION
  plugins: PluginDocumentLockEntryV1[]
}

export type PluginDocumentLockValidationResult =
  | { ok: true; value: PluginDocumentLockV1 }
  | { ok: false; reason: string }

const LOCK_KEYS = new Set(['format', 'schemaVersion', 'plugins'])
const ENTRY_KEYS = new Set(['pluginId', 'version', 'manifestDigest', 'publisherKeyId'])
const SHA_256_BASE64URL = /^[A-Za-z0-9_-]{43}$/

function identity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
}

function lockEntry(value: unknown, index: number): PluginDocumentLockEntryV1 {
  const path = `pluginLock.plugins[${index}]`
  const entry = parseExactManifestRecord(value, path, ENTRY_KEYS)
  if (typeof entry.manifestDigest !== 'string' || !SHA_256_BASE64URL.test(entry.manifestDigest)) {
    throw new TypeError(`${path}.manifestDigest must be a SHA-256 base64url digest`)
  }
  if (decodeBase64Url(entry.manifestDigest).byteLength !== 32) {
    throw new TypeError(`${path}.manifestDigest must encode a 32-byte SHA-256 digest`)
  }
  return {
    pluginId: identity(entry.pluginId, `${path}.pluginId`),
    version: parseStableSemver(entry.version, `${path}.version`),
    manifestDigest: entry.manifestDigest,
    publisherKeyId: identity(entry.publisherKeyId, `${path}.publisherKeyId`)
  }
}

export function parsePluginDocumentLock(value: unknown): PluginDocumentLockV1 {
  const lock = parseExactManifestRecord(value, 'pluginLock', LOCK_KEYS)
  if (lock.format !== PLUGIN_DOCUMENT_LOCK_FORMAT) {
    throw new TypeError('pluginLock.format is not a supported plugin lock format')
  }
  if (lock.schemaVersion !== PLUGIN_DOCUMENT_LOCK_SCHEMA_VERSION) {
    throw new TypeError('pluginLock.schemaVersion is not supported')
  }
  const plugins = parseBoundedManifestArray(
    lock.plugins,
    'pluginLock.plugins',
    PLUGIN_DOCUMENT_LOCK_LIMITS.maxPlugins
  )
    .map(lockEntry)
    .sort((left, right) => {
      if (left.pluginId === right.pluginId) return 0
      return left.pluginId < right.pluginId ? -1 : 1
    })
  const duplicate = plugins.find((entry, index) => entry.pluginId === plugins[index - 1]?.pluginId)
  if (duplicate) throw new TypeError(`pluginLock.plugins contains duplicate ${duplicate.pluginId}`)
  const parsed: PluginDocumentLockV1 = {
    format: PLUGIN_DOCUMENT_LOCK_FORMAT,
    schemaVersion: PLUGIN_DOCUMENT_LOCK_SCHEMA_VERSION,
    plugins
  }
  if (
    new TextEncoder().encode(JSON.stringify(canonicalManifestValue(parsed))).byteLength >
    PLUGIN_DOCUMENT_LOCK_LIMITS.maxJsonBytes
  ) {
    throw new TypeError(
      `pluginLock may not exceed ${PLUGIN_DOCUMENT_LOCK_LIMITS.maxJsonBytes} serialized bytes`
    )
  }
  return parsed
}

export function validatePluginDocumentLock(value: unknown): PluginDocumentLockValidationResult {
  try {
    return { ok: true, value: parsePluginDocumentLock(value) }
  } catch (error) {
    if (error instanceof TypeError) return { ok: false, reason: error.message }
    throw error
  }
}

export function serializePluginDocumentLock(value: unknown): string {
  return `${JSON.stringify(canonicalManifestValue(parsePluginDocumentLock(value)), null, 2)}\n`
}
