import {
  assertEd25519PublicKey,
  canonicalManifestValue,
  createSignedManifestIntegrity,
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseSha256Base64Url,
  parseSignedManifestIntegrity,
  parseStableSemver,
  satisfiesStableEngineRange,
  validateModuleIdentity,
  verifySignedManifestIntegrity,
  type SignedManifestIntegrity
} from '@open-pencil/scene-graph'

import {
  PluginTrustError,
  parsePluginTrustTimestamp,
  pluginTrustNow,
  resolveTrustedPluginKey,
  type PluginTrustDiagnostic,
  type PluginTrustTimeOptions,
  type TrustedPluginKeyResolution,
  type TrustedPluginKeyringV1
} from './keyring'
import { parseVersionedPluginManifest, type PluginManifest } from './manifest'
import { verifyVersionedPluginPackage, type VerifiedPluginPackage } from './package'
import {
  comparePluginVersionCoordinates,
  parseCanonicalPublicHttpsUrl,
  parsePluginVersionCoordinate
} from './parse-helpers'

export const PLUGIN_CATALOG_FORMAT = 'openpencil-plugin-catalog' as const
export const PLUGIN_CATALOG_SCHEMA_VERSION = 1 as const

export const PLUGIN_CATALOG_LIMITS = Object.freeze({
  maxJsonBytes: 4 * 1024 * 1024,
  maxEntries: 2_048,
  maxUrlLength: 2_048,
  maxValidityMilliseconds: 30 * 24 * 60 * 60 * 1_000,
  defaultClockSkewMilliseconds: 5 * 60 * 1_000,
  maxClockSkewMilliseconds: 60 * 60 * 1_000,
  expiringSoonMilliseconds: 6 * 60 * 60 * 1_000
})

export interface PluginCatalogEntryV1 {
  pluginId: string
  version: string
  digest: string
  manifestUrl: string
  publisherId: string
  keyId: string
}

export interface PluginCatalogPayloadV1 {
  format: typeof PLUGIN_CATALOG_FORMAT
  schemaVersion: typeof PLUGIN_CATALOG_SCHEMA_VERSION
  catalogId: string
  version: string
  generatedAt: string
  expiresAt: string
  entries: readonly PluginCatalogEntryV1[]
}

export interface SignedPluginCatalogV1 extends PluginCatalogPayloadV1 {
  integrity: SignedManifestIntegrity
}

export type PluginCatalogValidationResult =
  | { ok: true; value: SignedPluginCatalogV1 }
  | { ok: false; reason: string }

export interface PluginCatalogSigningOptions {
  keyId?: string
}

export interface PluginCatalogVerificationOptions extends PluginTrustTimeOptions {
  expectedCatalogId?: string
  expectedKeyId?: string
  maxClockSkewMilliseconds?: number
}

export interface VerifiedPluginCatalog {
  catalog: SignedPluginCatalogV1
  verifiedDigest: string
  verifiedKeyId: string
  verifiedAt: string
  diagnostics: readonly PluginTrustDiagnostic[]
}

export interface CatalogPluginPackageVerificationOptions extends PluginTrustTimeOptions {
  catalog: VerifiedPluginCatalog
  engineVersion?: string
}

export interface VerifiedCatalogPluginPackage {
  catalogId: string
  catalogDigest: string
  entry: PluginCatalogEntryV1
  verifiedPackage: VerifiedPluginPackage
  keyTrust: TrustedPluginKeyResolution
  diagnostics: readonly PluginTrustDiagnostic[]
}

const PAYLOAD_KEYS = new Set([
  'format',
  'schemaVersion',
  'catalogId',
  'version',
  'generatedAt',
  'expiresAt',
  'entries'
])
const CATALOG_KEYS = new Set([...PAYLOAD_KEYS, 'integrity'])
const ENTRY_KEYS = new Set(['pluginId', 'version', 'digest', 'manifestUrl', 'publisherId', 'keyId'])
const VERIFIED_CATALOGS = new WeakSet<object>()

function identity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
}

export function comparePluginCatalogEntries(
  left: PluginCatalogEntryV1,
  right: PluginCatalogEntryV1
): number {
  return comparePluginVersionCoordinates(left.pluginId, left.version, right.pluginId, right.version)
}

export function parsePluginCatalogEntry(
  value: unknown,
  path = 'pluginCatalog.entries[0]'
): PluginCatalogEntryV1 {
  const source = parseExactManifestRecord(value, path, ENTRY_KEYS, ENTRY_KEYS)
  const [pluginId, version] = parsePluginVersionCoordinate(source, path)
  return Object.freeze({
    pluginId,
    version,
    digest: parseSha256Base64Url(source.digest, `${path}.digest`),
    manifestUrl: parseCanonicalPublicHttpsUrl(
      source.manifestUrl,
      `${path}.manifestUrl`,
      PLUGIN_CATALOG_LIMITS.maxUrlLength
    ),
    publisherId: identity(source.publisherId, `${path}.publisherId`),
    keyId: identity(source.keyId, `${path}.keyId`)
  })
}

function parseEntries(value: unknown): readonly PluginCatalogEntryV1[] {
  const entries = parseBoundedManifestArray(
    value,
    'pluginCatalog.entries',
    PLUGIN_CATALOG_LIMITS.maxEntries
  ).map((entry, index) => parsePluginCatalogEntry(entry, `pluginCatalog.entries[${index}]`))
  const coordinates = entries.map(({ pluginId, version }) => `${pluginId}@${version}`)
  if (new Set(coordinates).size !== coordinates.length) {
    throw new TypeError('pluginCatalog.entries contains duplicate plugin versions')
  }
  if (new Set(entries.map(({ manifestUrl }) => manifestUrl)).size !== entries.length) {
    throw new TypeError('pluginCatalog.entries contains duplicate manifest URLs')
  }
  if (new Set(entries.map(({ digest }) => digest)).size !== entries.length) {
    throw new TypeError('pluginCatalog.entries contains duplicate manifest digests')
  }
  const publisherByPlugin = new Map<string, string>()
  for (const entry of entries) {
    const publisherId = publisherByPlugin.get(entry.pluginId)
    if (publisherId && publisherId !== entry.publisherId) {
      throw new TypeError('pluginCatalog.entries changes publisher ownership for a plugin')
    }
    publisherByPlugin.set(entry.pluginId, entry.publisherId)
  }
  const sorted = [...entries].sort(comparePluginCatalogEntries)
  if (entries.some((entry, index) => entry !== sorted[index])) {
    throw new TypeError(
      'pluginCatalog.entries must be sorted by plugin id and descending semantic version'
    )
  }
  return Object.freeze(entries)
}

function assertCatalogSize(value: unknown): void {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalManifestValue(value))).byteLength
  if (bytes > PLUGIN_CATALOG_LIMITS.maxJsonBytes) {
    throw new TypeError(`pluginCatalog may not exceed ${PLUGIN_CATALOG_LIMITS.maxJsonBytes} bytes`)
  }
}

export function parsePluginCatalogPayload(value: unknown): PluginCatalogPayloadV1 {
  const source = parseExactManifestRecord(value, 'pluginCatalog', PAYLOAD_KEYS, PAYLOAD_KEYS)
  if (source.format !== PLUGIN_CATALOG_FORMAT) {
    throw new TypeError('pluginCatalog.format is not supported')
  }
  if (source.schemaVersion !== PLUGIN_CATALOG_SCHEMA_VERSION) {
    throw new TypeError('pluginCatalog.schemaVersion is not supported')
  }
  const generatedAt = parsePluginTrustTimestamp(source.generatedAt, 'pluginCatalog.generatedAt')
  const expiresAt = parsePluginTrustTimestamp(source.expiresAt, 'pluginCatalog.expiresAt')
  const lifetime = Date.parse(expiresAt) - Date.parse(generatedAt)
  if (lifetime <= 0 || lifetime > PLUGIN_CATALOG_LIMITS.maxValidityMilliseconds) {
    throw new TypeError('pluginCatalog validity window must be positive and no longer than 30 days')
  }
  const payload = Object.freeze({
    format: PLUGIN_CATALOG_FORMAT,
    schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
    catalogId: identity(source.catalogId, 'pluginCatalog.catalogId'),
    version: parseStableSemver(source.version, 'pluginCatalog.version'),
    generatedAt,
    expiresAt,
    entries: parseEntries(source.entries)
  })
  assertCatalogSize(payload)
  return payload
}

export function parsePluginCatalog(value: unknown): SignedPluginCatalogV1 {
  const source = parseExactManifestRecord(value, 'pluginCatalog', CATALOG_KEYS, CATALOG_KEYS)
  const payloadSource = { ...source }
  Reflect.deleteProperty(payloadSource, 'integrity')
  const payload = parsePluginCatalogPayload(payloadSource)
  const catalog = Object.freeze({
    ...payload,
    integrity: parseSignedManifestIntegrity(source.integrity, 'pluginCatalog.integrity')
  })
  assertCatalogSize(catalog)
  return catalog
}

export function validatePluginCatalog(value: unknown): PluginCatalogValidationResult {
  try {
    return { ok: true, value: parsePluginCatalog(value) }
  } catch (error) {
    if (error instanceof TypeError) return { ok: false, reason: error.message }
    throw error
  }
}

export function parsePluginCatalogJson(source: string): SignedPluginCatalogV1 {
  if (typeof source !== 'string') throw new TypeError('Plugin catalog JSON must be a string')
  if (new TextEncoder().encode(source).byteLength > PLUGIN_CATALOG_LIMITS.maxJsonBytes) {
    throw new TypeError(
      `Plugin catalog JSON may not exceed ${PLUGIN_CATALOG_LIMITS.maxJsonBytes} bytes`
    )
  }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new TypeError('Plugin catalog must contain valid JSON')
  }
  return parsePluginCatalog(value)
}

export function parsePluginCatalogBytes(source: Uint8Array): SignedPluginCatalogV1 {
  if (source.byteLength > PLUGIN_CATALOG_LIMITS.maxJsonBytes) {
    throw new TypeError(`Plugin catalog may not exceed ${PLUGIN_CATALOG_LIMITS.maxJsonBytes} bytes`)
  }
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(source)
  } catch {
    throw new TypeError('Plugin catalog must contain valid UTF-8')
  }
  return parsePluginCatalogJson(decoded)
}

export function serializePluginCatalog(value: unknown): string {
  return `${JSON.stringify(canonicalManifestValue(parsePluginCatalog(value)), null, 2)}\n`
}

export async function signPluginCatalog(
  value: unknown,
  privateKey: CryptoKey,
  options: PluginCatalogSigningOptions = {}
): Promise<SignedPluginCatalogV1> {
  const payload = parsePluginCatalogPayload(value)
  const keyId = identity(
    options.keyId ?? payload.catalogId,
    'pluginCatalog.integrity.signature.keyId'
  )
  return parsePluginCatalog({
    ...payload,
    integrity: await createSignedManifestIntegrity(payload, keyId, privateKey)
  })
}

function clockSkew(value: number | undefined): number {
  const resolved = value ?? PLUGIN_CATALOG_LIMITS.defaultClockSkewMilliseconds
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 0 ||
    resolved > PLUGIN_CATALOG_LIMITS.maxClockSkewMilliseconds
  ) {
    throw new TypeError('maxClockSkewMilliseconds must be a bounded non-negative integer')
  }
  return resolved
}

function assertCatalogTime(
  catalog: SignedPluginCatalogV1,
  now: number,
  skew: number
): readonly PluginTrustDiagnostic[] {
  const generatedAt = Date.parse(catalog.generatedAt)
  const expiresAt = Date.parse(catalog.expiresAt)
  if (now + skew < generatedAt) {
    throw new PluginTrustError(
      'catalog-not-yet-valid',
      `Plugin catalog is not valid until ${catalog.generatedAt}`,
      catalog.catalogId
    )
  }
  if (now >= expiresAt) {
    throw new PluginTrustError(
      'catalog-expired',
      `Plugin catalog expired at ${catalog.expiresAt}`,
      catalog.catalogId
    )
  }
  return expiresAt - now <= PLUGIN_CATALOG_LIMITS.expiringSoonMilliseconds
    ? [
        {
          code: 'catalog-expiring-soon',
          message: `Plugin catalog expires at ${catalog.expiresAt}`,
          subjectId: catalog.catalogId
        }
      ]
    : []
}

export async function verifyPluginCatalog(
  value: unknown,
  rootPublicKey: CryptoKey,
  options: PluginCatalogVerificationOptions = {}
): Promise<VerifiedPluginCatalog> {
  const catalog = parsePluginCatalog(value)
  assertEd25519PublicKey(rootPublicKey)
  if (options.expectedCatalogId && options.expectedCatalogId !== catalog.catalogId) {
    throw new PluginTrustError(
      'catalog-id-mismatch',
      'Plugin catalog id is not trusted',
      catalog.catalogId
    )
  }
  if (options.expectedKeyId && options.expectedKeyId !== catalog.integrity.signature.keyId) {
    throw new PluginTrustError(
      'catalog-key-untrusted',
      'Plugin catalog root key id is not trusted',
      catalog.integrity.signature.keyId
    )
  }
  const { integrity, ...payload } = catalog
  let verifiedDigest: string
  try {
    verifiedDigest = await verifySignedManifestIntegrity(
      payload,
      integrity,
      rootPublicKey,
      'Plugin catalog'
    )
  } catch {
    throw new PluginTrustError(
      'catalog-integrity-invalid',
      'Plugin catalog digest or signature verification failed',
      catalog.catalogId
    )
  }
  const now = pluginTrustNow(options.now)
  const diagnostics = assertCatalogTime(catalog, now, clockSkew(options.maxClockSkewMilliseconds))
  const verified = Object.freeze({
    catalog,
    verifiedDigest,
    verifiedKeyId: integrity.signature.keyId,
    verifiedAt: new Date(now).toISOString(),
    diagnostics: Object.freeze(diagnostics)
  })
  VERIFIED_CATALOGS.add(verified)
  return verified
}

function matchingCatalogEntry(
  catalog: VerifiedPluginCatalog,
  entry: PluginCatalogEntryV1
): PluginCatalogEntryV1 {
  if (!VERIFIED_CATALOGS.has(catalog)) {
    throw new PluginTrustError(
      'catalog-integrity-invalid',
      'Plugin catalog must be verified in this process before package verification',
      entry.pluginId
    )
  }
  const matched = catalog.catalog.entries.find(
    (candidate) =>
      candidate.pluginId === entry.pluginId &&
      candidate.version === entry.version &&
      candidate.digest === entry.digest &&
      candidate.manifestUrl === entry.manifestUrl &&
      candidate.publisherId === entry.publisherId &&
      candidate.keyId === entry.keyId
  )
  if (!matched) {
    throw new PluginTrustError(
      'catalog-entry-mismatch',
      'Plugin entry is not present in the verified catalog',
      `${entry.pluginId}@${entry.version}`
    )
  }
  return matched
}

function assertCatalogEntryMatchesManifest(
  entry: PluginCatalogEntryV1,
  manifest: PluginManifest
): void {
  if (
    manifest.plugin.id !== entry.pluginId ||
    manifest.plugin.version !== entry.version ||
    manifest.publisher.id !== entry.publisherId ||
    manifest.publisher.keyId !== entry.keyId ||
    manifest.integrity.signature.keyId !== entry.keyId ||
    manifest.integrity.digest !== entry.digest
  ) {
    throw new PluginTrustError(
      'catalog-entry-mismatch',
      'Plugin manifest identity or digest does not match its signed catalog entry',
      `${entry.pluginId}@${entry.version}`
    )
  }
}

export async function verifyCatalogPluginPackage(
  entryValue: PluginCatalogEntryV1,
  manifestValue: unknown,
  keyring: TrustedPluginKeyringV1,
  options: CatalogPluginPackageVerificationOptions
): Promise<VerifiedCatalogPluginPackage> {
  const entry = matchingCatalogEntry(options.catalog, parsePluginCatalogEntry(entryValue))
  const now = pluginTrustNow(options.now)
  const catalogDiagnostics = assertCatalogTime(
    options.catalog.catalog,
    now,
    PLUGIN_CATALOG_LIMITS.defaultClockSkewMilliseconds
  )
  const manifest = parseVersionedPluginManifest(manifestValue)
  assertCatalogEntryMatchesManifest(entry, manifest)
  const keyTrust = resolveTrustedPluginKey(keyring, {
    pluginId: entry.pluginId,
    publisherId: entry.publisherId,
    keyId: entry.keyId,
    now
  })
  let verifiedPackage: VerifiedPluginPackage
  try {
    verifiedPackage = await verifyVersionedPluginPackage(manifest, keyTrust.key.publicKey, {
      expectedKeyId: entry.keyId
    })
  } catch {
    throw new PluginTrustError(
      'publisher-signature-invalid',
      'Plugin manifest signature verification failed',
      entry.keyId
    )
  }
  if (
    options.engineVersion &&
    !satisfiesStableEngineRange(options.engineVersion, manifest.engineRange)
  ) {
    throw new PluginTrustError(
      'publisher-engine-incompatible',
      `Plugin requires OpenPencil ${manifest.engineRange}`,
      entry.pluginId
    )
  }
  return {
    catalogId: options.catalog.catalog.catalogId,
    catalogDigest: options.catalog.verifiedDigest,
    entry,
    verifiedPackage,
    keyTrust,
    diagnostics: Object.freeze([...catalogDiagnostics, ...keyTrust.diagnostics])
  }
}
