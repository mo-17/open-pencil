/* eslint-disable max-lines -- Root index verification and publisher package coordinate binding form one trust boundary. */
import {
  assertEd25519PublicKey,
  canonicalManifestValue,
  createSignedManifestIntegrity,
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseSha256Base64Url,
  parseSignedManifestIntegrity,
  parseStableSemver,
  validateModuleIdentity,
  verifySignedManifestIntegrity,
  type SignedManifestIntegrity
} from '@open-pencil/scene-graph'

import {
  parsePluginTrustTimestamp,
  parseTrustedPluginKeyring,
  pluginTrustNow,
  resolveTrustedPluginKey,
  type PluginTrustDiagnostic,
  type PluginTrustTimeOptions,
  type TrustedPluginKeyResolution,
  type TrustedPluginKeyringV1
} from './keyring'
import {
  parseVerifiedPluginPackageSnapshot,
  verifyPluginPackage,
  type VerifiedPluginPackage
} from './package'
import {
  comparePluginVersionCoordinates,
  parseCanonicalPublicHttpsUrl,
  parsePluginVersionCoordinate
} from './parse-helpers'
import {
  PLUGIN_RUNTIME_PACKAGE_LIMITS,
  parsePluginRuntimePackage,
  pluginRuntimePackageCanonicalByteLength,
  verifyPluginRuntimePackage,
  type PluginRuntimeKindV1,
  type VerifiedPluginRuntimePackage
} from './runtime-package'

export const PLUGIN_RUNTIME_INDEX_FORMAT = 'openpencil-plugin-runtime-index' as const
export const PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION = 1 as const

export const PLUGIN_RUNTIME_INDEX_LIMITS = Object.freeze({
  maxJsonBytes: 1024 * 1024,
  maxEntries: 512,
  maxUrlLength: 2_048,
  maxValidityMilliseconds: 7 * 24 * 60 * 60 * 1_000,
  defaultClockSkewMilliseconds: 5 * 60 * 1_000,
  maxClockSkewMilliseconds: 60 * 60 * 1_000,
  expiringSoonMilliseconds: 6 * 60 * 60 * 1_000
})

export interface PluginRuntimeIndexEntryV1 {
  pluginId: string
  version: string
  publisherId: string
  keyId: string
  declarativeManifestDigest: string
  runtimeKind: PluginRuntimeKindV1
  runtimePackageUrl: string
  runtimePackageDigest: string
  runtimePackageByteLength: number
}

export interface PluginRuntimeIndexPayloadV1 {
  format: typeof PLUGIN_RUNTIME_INDEX_FORMAT
  schemaVersion: typeof PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION
  indexId: string
  version: string
  generatedAt: string
  expiresAt: string
  entries: readonly PluginRuntimeIndexEntryV1[]
}

export interface SignedPluginRuntimeIndexV1 extends PluginRuntimeIndexPayloadV1 {
  integrity: SignedManifestIntegrity
}

export type PluginRuntimeTrustErrorCode =
  | 'runtime-index-id-mismatch'
  | 'runtime-index-key-untrusted'
  | 'runtime-index-coordinate-mismatch'
  | 'runtime-index-integrity-invalid'
  | 'runtime-index-not-yet-valid'
  | 'runtime-index-expired'
  | 'runtime-index-entry-mismatch'
  | 'runtime-declarative-package-mismatch'
  | 'runtime-publisher-signature-invalid'

export class PluginRuntimeTrustError extends Error {
  readonly code: PluginRuntimeTrustErrorCode
  readonly subjectId: string

  constructor(code: PluginRuntimeTrustErrorCode, message: string, subjectId: string) {
    super(message)
    this.name = 'PluginRuntimeTrustError'
    this.code = code
    this.subjectId = subjectId
  }
}

export interface PluginRuntimeIndexDiagnostic {
  code: 'runtime-index-expiring-soon'
  message: string
  subjectId: string
}

export interface PluginRuntimeIndexVerificationOptions extends PluginTrustTimeOptions {
  expectedIndexId?: string
  expectedKeyId?: string
  expectedDigest?: string
  maxClockSkewMilliseconds?: number
}

export interface VerifiedPluginRuntimeIndex {
  index: SignedPluginRuntimeIndexV1
  verifiedDigest: string
  verifiedKeyId: string
  verifiedAt: string
  diagnostics: readonly PluginRuntimeIndexDiagnostic[]
}

export interface IndexedPluginRuntimeVerificationOptions extends PluginTrustTimeOptions {
  index: VerifiedPluginRuntimeIndex
  declarativePackage: VerifiedPluginPackage
}

export interface VerifiedIndexedPluginRuntimePackage {
  indexId: string
  indexDigest: string
  entry: PluginRuntimeIndexEntryV1
  declarativePackage: VerifiedPluginPackage
  verifiedRuntimePackage: VerifiedPluginRuntimePackage
  keyTrust: TrustedPluginKeyResolution
  diagnostics: readonly (PluginRuntimeIndexDiagnostic | PluginTrustDiagnostic)[]
}

const PAYLOAD_KEYS = new Set([
  'format',
  'schemaVersion',
  'indexId',
  'version',
  'generatedAt',
  'expiresAt',
  'entries'
])
const INDEX_KEYS = new Set([...PAYLOAD_KEYS, 'integrity'])
const ENTRY_KEYS = new Set([
  'pluginId',
  'version',
  'publisherId',
  'keyId',
  'declarativeManifestDigest',
  'runtimeKind',
  'runtimePackageUrl',
  'runtimePackageDigest',
  'runtimePackageByteLength'
])
const VERIFIED_RUNTIME_INDEXES = new WeakSet<object>()

function identity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
}

function runtimeKind(value: unknown, path: string): PluginRuntimeKindV1 {
  if (value !== 'wasm' && value !== 'javascript') {
    throw new TypeError(`${path} must be wasm or javascript`)
  }
  return value
}

function runtimePackageByteLength(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > PLUGIN_RUNTIME_PACKAGE_LIMITS.maxJsonBytes
  ) {
    throw new TypeError(`${path} must be a positive bounded canonical JSON byte length`)
  }
  return value as number
}

export function comparePluginRuntimeIndexEntries(
  left: PluginRuntimeIndexEntryV1,
  right: PluginRuntimeIndexEntryV1
): number {
  return comparePluginVersionCoordinates(left.pluginId, left.version, right.pluginId, right.version)
}

export function parsePluginRuntimeIndexEntry(
  value: unknown,
  path = 'runtimeIndex.entries[0]'
): PluginRuntimeIndexEntryV1 {
  const source = parseExactManifestRecord(value, path, ENTRY_KEYS, ENTRY_KEYS)
  const coordinate = parsePluginVersionCoordinate(source, path)
  return Object.freeze({
    pluginId: coordinate[0],
    version: coordinate[1],
    publisherId: identity(source.publisherId, `${path}.publisherId`),
    keyId: identity(source.keyId, `${path}.keyId`),
    declarativeManifestDigest: parseSha256Base64Url(
      source.declarativeManifestDigest,
      `${path}.declarativeManifestDigest`
    ),
    runtimeKind: runtimeKind(source.runtimeKind, `${path}.runtimeKind`),
    runtimePackageUrl: parseCanonicalPublicHttpsUrl(
      source.runtimePackageUrl,
      `${path}.runtimePackageUrl`,
      PLUGIN_RUNTIME_INDEX_LIMITS.maxUrlLength
    ),
    runtimePackageDigest: parseSha256Base64Url(
      source.runtimePackageDigest,
      `${path}.runtimePackageDigest`
    ),
    runtimePackageByteLength: runtimePackageByteLength(
      source.runtimePackageByteLength,
      `${path}.runtimePackageByteLength`
    )
  })
}

function runtimeIndexEntries(value: unknown): readonly PluginRuntimeIndexEntryV1[] {
  const entries = parseBoundedManifestArray(
    value,
    'runtimeIndex.entries',
    PLUGIN_RUNTIME_INDEX_LIMITS.maxEntries
  ).map((entry, index) => parsePluginRuntimeIndexEntry(entry, `runtimeIndex.entries[${index}]`))
  const coordinates = entries.map(({ pluginId, version }) => `${pluginId}@${version}`)
  if (new Set(coordinates).size !== entries.length) {
    throw new TypeError('runtimeIndex.entries contains duplicate plugin versions')
  }
  if (new Set(entries.map(({ runtimePackageUrl }) => runtimePackageUrl)).size !== entries.length) {
    throw new TypeError('runtimeIndex.entries contains duplicate runtime package URLs')
  }
  if (
    new Set(entries.map(({ runtimePackageDigest }) => runtimePackageDigest)).size !== entries.length
  ) {
    throw new TypeError('runtimeIndex.entries contains duplicate runtime package digests')
  }
  const publisherByPlugin = new Map<string, string>()
  for (const entry of entries) {
    const publisherId = publisherByPlugin.get(entry.pluginId)
    if (publisherId && publisherId !== entry.publisherId) {
      throw new TypeError('runtimeIndex.entries changes publisher ownership for a plugin')
    }
    publisherByPlugin.set(entry.pluginId, entry.publisherId)
  }
  const sorted = [...entries].sort(comparePluginRuntimeIndexEntries)
  if (entries.some((entry, index) => entry !== sorted[index])) {
    throw new TypeError(
      'runtimeIndex.entries must be sorted by plugin id and descending semantic version'
    )
  }
  return Object.freeze(entries)
}

function assertIndexSize(value: unknown): void {
  const byteLength = new TextEncoder().encode(
    JSON.stringify(canonicalManifestValue(value))
  ).byteLength
  if (byteLength > PLUGIN_RUNTIME_INDEX_LIMITS.maxJsonBytes) {
    throw new TypeError(
      `runtimeIndex may not exceed ${PLUGIN_RUNTIME_INDEX_LIMITS.maxJsonBytes} bytes`
    )
  }
}

export function parsePluginRuntimeIndexPayload(value: unknown): PluginRuntimeIndexPayloadV1 {
  const source = parseExactManifestRecord(value, 'runtimeIndex', PAYLOAD_KEYS, PAYLOAD_KEYS)
  if (source.format !== PLUGIN_RUNTIME_INDEX_FORMAT) {
    throw new TypeError('runtimeIndex.format is not supported')
  }
  if (source.schemaVersion !== PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION) {
    throw new TypeError('runtimeIndex.schemaVersion is not supported')
  }
  const generatedAt = parsePluginTrustTimestamp(source.generatedAt, 'runtimeIndex.generatedAt')
  const expiresAt = parsePluginTrustTimestamp(source.expiresAt, 'runtimeIndex.expiresAt')
  const lifetime = Date.parse(expiresAt) - Date.parse(generatedAt)
  if (lifetime <= 0 || lifetime > PLUGIN_RUNTIME_INDEX_LIMITS.maxValidityMilliseconds) {
    throw new TypeError('runtimeIndex validity must be positive and no longer than 7 days')
  }
  const payload = Object.freeze({
    format: PLUGIN_RUNTIME_INDEX_FORMAT,
    schemaVersion: PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION,
    indexId: identity(source.indexId, 'runtimeIndex.indexId'),
    version: parseStableSemver(source.version, 'runtimeIndex.version'),
    generatedAt,
    expiresAt,
    entries: runtimeIndexEntries(source.entries)
  })
  assertIndexSize(payload)
  return payload
}

export function parsePluginRuntimeIndex(value: unknown): SignedPluginRuntimeIndexV1 {
  const source = parseExactManifestRecord(value, 'runtimeIndex', INDEX_KEYS, INDEX_KEYS)
  const payloadSource = { ...source }
  Reflect.deleteProperty(payloadSource, 'integrity')
  const payload = parsePluginRuntimeIndexPayload(payloadSource)
  const index = Object.freeze({
    ...payload,
    integrity: parseSignedManifestIntegrity(source.integrity, 'runtimeIndex.integrity')
  })
  assertIndexSize(index)
  return index
}

export function parsePluginRuntimeIndexJson(source: string): SignedPluginRuntimeIndexV1 {
  if (
    typeof source !== 'string' ||
    new TextEncoder().encode(source).byteLength > PLUGIN_RUNTIME_INDEX_LIMITS.maxJsonBytes
  ) {
    throw new TypeError('Runtime index JSON must be bounded text')
  }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new TypeError('Runtime index must contain valid JSON')
  }
  return parsePluginRuntimeIndex(value)
}

export function parsePluginRuntimeIndexBytes(source: Uint8Array): SignedPluginRuntimeIndexV1 {
  if (source.byteLength > PLUGIN_RUNTIME_INDEX_LIMITS.maxJsonBytes) {
    throw new TypeError('Runtime index exceeds the JSON byte limit')
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(source)
  } catch {
    throw new TypeError('Runtime index must contain valid UTF-8')
  }
  return parsePluginRuntimeIndexJson(text)
}

export function serializePluginRuntimeIndex(value: unknown): string {
  return `${JSON.stringify(canonicalManifestValue(parsePluginRuntimeIndex(value)), null, 2)}\n`
}

export async function signPluginRuntimeIndex(
  value: unknown,
  privateKey: CryptoKey,
  options: { keyId?: string } = {}
): Promise<SignedPluginRuntimeIndexV1> {
  const payload = parsePluginRuntimeIndexPayload(value)
  const keyId = identity(options.keyId ?? payload.indexId, 'runtimeIndex.integrity.signature.keyId')
  return parsePluginRuntimeIndex({
    ...payload,
    integrity: await createSignedManifestIntegrity(payload, keyId, privateKey)
  })
}

function clockSkew(value: number | undefined): number {
  const resolved = value ?? PLUGIN_RUNTIME_INDEX_LIMITS.defaultClockSkewMilliseconds
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 0 ||
    resolved > PLUGIN_RUNTIME_INDEX_LIMITS.maxClockSkewMilliseconds
  ) {
    throw new TypeError('maxClockSkewMilliseconds must be a bounded non-negative integer')
  }
  return resolved
}

function assertIndexTime(
  index: SignedPluginRuntimeIndexV1,
  now: number,
  skew: number
): readonly PluginRuntimeIndexDiagnostic[] {
  const generatedAt = Date.parse(index.generatedAt)
  const expiresAt = Date.parse(index.expiresAt)
  if (now + skew < generatedAt) {
    throw new PluginRuntimeTrustError(
      'runtime-index-not-yet-valid',
      `Runtime index is not valid until ${index.generatedAt}`,
      index.indexId
    )
  }
  if (now >= expiresAt) {
    throw new PluginRuntimeTrustError(
      'runtime-index-expired',
      `Runtime index expired at ${index.expiresAt}`,
      index.indexId
    )
  }
  return expiresAt - now <= PLUGIN_RUNTIME_INDEX_LIMITS.expiringSoonMilliseconds
    ? [
        {
          code: 'runtime-index-expiring-soon',
          message: `Runtime index expires at ${index.expiresAt}`,
          subjectId: index.indexId
        }
      ]
    : []
}

export async function verifyPluginRuntimeIndex(
  value: unknown,
  rootPublicKey: CryptoKey,
  options: PluginRuntimeIndexVerificationOptions = {}
): Promise<VerifiedPluginRuntimeIndex> {
  const index = parsePluginRuntimeIndex(value)
  assertEd25519PublicKey(rootPublicKey)
  if (options.expectedIndexId && options.expectedIndexId !== index.indexId) {
    throw new PluginRuntimeTrustError(
      'runtime-index-id-mismatch',
      'Runtime index id is not trusted',
      index.indexId
    )
  }
  if (options.expectedKeyId && options.expectedKeyId !== index.integrity.signature.keyId) {
    throw new PluginRuntimeTrustError(
      'runtime-index-key-untrusted',
      'Runtime index root key id is not trusted',
      index.integrity.signature.keyId
    )
  }
  const { integrity, ...payload } = index
  let verifiedDigest: string
  try {
    verifiedDigest = await verifySignedManifestIntegrity(
      payload,
      integrity,
      rootPublicKey,
      'Plugin runtime index'
    )
  } catch {
    throw new PluginRuntimeTrustError(
      'runtime-index-integrity-invalid',
      'Runtime index digest or signature verification failed',
      index.indexId
    )
  }
  if (options.expectedDigest && options.expectedDigest !== verifiedDigest) {
    throw new PluginRuntimeTrustError(
      'runtime-index-coordinate-mismatch',
      'Runtime index digest does not match the trusted marketplace coordinate',
      index.indexId
    )
  }
  const now = pluginTrustNow(options.now)
  const diagnostics = assertIndexTime(index, now, clockSkew(options.maxClockSkewMilliseconds))
  const verified = Object.freeze({
    index,
    verifiedDigest,
    verifiedKeyId: integrity.signature.keyId,
    verifiedAt: new Date(now).toISOString(),
    diagnostics: Object.freeze(diagnostics)
  })
  VERIFIED_RUNTIME_INDEXES.add(verified)
  return verified
}

function matchingIndexEntry(
  index: VerifiedPluginRuntimeIndex,
  entry: PluginRuntimeIndexEntryV1
): PluginRuntimeIndexEntryV1 {
  if (!VERIFIED_RUNTIME_INDEXES.has(index)) {
    throw new PluginRuntimeTrustError(
      'runtime-index-integrity-invalid',
      'Runtime index must be verified in this process before package verification',
      entry.pluginId
    )
  }
  const matched = index.index.entries.find(
    (candidate) =>
      candidate.pluginId === entry.pluginId &&
      candidate.version === entry.version &&
      candidate.publisherId === entry.publisherId &&
      candidate.keyId === entry.keyId &&
      candidate.declarativeManifestDigest === entry.declarativeManifestDigest &&
      candidate.runtimeKind === entry.runtimeKind &&
      candidate.runtimePackageUrl === entry.runtimePackageUrl &&
      candidate.runtimePackageDigest === entry.runtimePackageDigest &&
      candidate.runtimePackageByteLength === entry.runtimePackageByteLength
  )
  if (!matched) {
    throw new PluginRuntimeTrustError(
      'runtime-index-entry-mismatch',
      'Runtime package entry is not present in the verified runtime index',
      `${entry.pluginId}@${entry.version}`
    )
  }
  return matched
}

async function verifyDeclarativeCoordinates(
  entry: PluginRuntimeIndexEntryV1,
  declarativeValue: VerifiedPluginPackage,
  publicKey: CryptoKey
): Promise<VerifiedPluginPackage> {
  const snapshot = parseVerifiedPluginPackageSnapshot(declarativeValue)
  let declarative: VerifiedPluginPackage
  try {
    declarative = await verifyPluginPackage(snapshot.manifest, publicKey, {
      expectedKeyId: entry.keyId
    })
  } catch {
    throw new PluginRuntimeTrustError(
      'runtime-declarative-package-mismatch',
      'Accepted declarative plugin signature no longer verifies against the current publisher key',
      `${entry.pluginId}@${entry.version}`
    )
  }
  if (
    declarative.manifest.plugin.id !== entry.pluginId ||
    declarative.manifest.plugin.version !== entry.version ||
    declarative.manifest.publisher.id !== entry.publisherId ||
    declarative.manifest.publisher.keyId !== entry.keyId ||
    declarative.verifiedKeyId !== entry.keyId ||
    declarative.verifiedDigest !== entry.declarativeManifestDigest ||
    snapshot.verifiedDigest !== declarative.verifiedDigest ||
    snapshot.verifiedKeyId !== declarative.verifiedKeyId
  ) {
    throw new PluginRuntimeTrustError(
      'runtime-declarative-package-mismatch',
      'Runtime entry is not bound to the accepted declarative plugin package',
      `${entry.pluginId}@${entry.version}`
    )
  }
  return declarative
}

function assertRuntimeCoordinates(
  entry: PluginRuntimeIndexEntryV1,
  runtimePackageValue: unknown
): void {
  const runtimePackage = parsePluginRuntimePackage(runtimePackageValue)
  if (
    runtimePackage.plugin.id !== entry.pluginId ||
    runtimePackage.plugin.version !== entry.version ||
    runtimePackage.publisher.id !== entry.publisherId ||
    runtimePackage.publisher.keyId !== entry.keyId ||
    runtimePackage.integrity.signature.keyId !== entry.keyId ||
    runtimePackage.declarativeManifestDigest !== entry.declarativeManifestDigest ||
    runtimePackage.runtime.kind !== entry.runtimeKind ||
    runtimePackage.integrity.digest !== entry.runtimePackageDigest ||
    pluginRuntimePackageCanonicalByteLength(runtimePackage) !== entry.runtimePackageByteLength
  ) {
    throw new PluginRuntimeTrustError(
      'runtime-index-entry-mismatch',
      'Runtime package identity, digest, kind, or size does not match its signed index entry',
      `${entry.pluginId}@${entry.version}`
    )
  }
}

export async function verifyIndexedPluginRuntimePackage(
  entryValue: PluginRuntimeIndexEntryV1,
  runtimePackageValue: unknown,
  keyringValue: TrustedPluginKeyringV1,
  options: IndexedPluginRuntimeVerificationOptions
): Promise<VerifiedIndexedPluginRuntimePackage> {
  const entry = matchingIndexEntry(options.index, parsePluginRuntimeIndexEntry(entryValue))
  const now = pluginTrustNow(options.now)
  const indexDiagnostics = assertIndexTime(
    options.index.index,
    now,
    PLUGIN_RUNTIME_INDEX_LIMITS.defaultClockSkewMilliseconds
  )
  const keyTrust = resolveTrustedPluginKey(parseTrustedPluginKeyring(keyringValue), {
    pluginId: entry.pluginId,
    publisherId: entry.publisherId,
    keyId: entry.keyId,
    now
  })
  const declarativePackage = await verifyDeclarativeCoordinates(
    entry,
    options.declarativePackage,
    keyTrust.key.publicKey
  )
  assertRuntimeCoordinates(entry, runtimePackageValue)
  let verifiedRuntimePackage: VerifiedPluginRuntimePackage
  try {
    verifiedRuntimePackage = await verifyPluginRuntimePackage(
      runtimePackageValue,
      keyTrust.key.publicKey,
      {
        expectedPluginId: entry.pluginId,
        expectedPluginVersion: entry.version,
        expectedPublisherId: entry.publisherId,
        expectedKeyId: entry.keyId,
        expectedDeclarativeManifestDigest: entry.declarativeManifestDigest
      }
    )
  } catch {
    throw new PluginRuntimeTrustError(
      'runtime-publisher-signature-invalid',
      'Runtime package signature, asset, or static safety verification failed',
      entry.keyId
    )
  }
  return Object.freeze({
    indexId: options.index.index.indexId,
    indexDigest: options.index.verifiedDigest,
    entry,
    declarativePackage,
    verifiedRuntimePackage,
    keyTrust,
    diagnostics: Object.freeze([...indexDiagnostics, ...keyTrust.diagnostics])
  })
}
