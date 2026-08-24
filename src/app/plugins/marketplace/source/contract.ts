import {
  assertVerifiedMarketplaceSnapshot,
  type VerifiedMarketplaceSnapshot
} from '@open-pencil/plugin-contracts'
import {
  compareStableSemver,
  encodeBase64URL,
  exportEd25519PublicKeyPem,
  stableSemverParts
} from '@open-pencil/scene-graph'

import {
  parseMarketplaceTrustConfig,
  parseMarketplaceTrustConfigJSON,
  type ResolvedMarketplaceTrustConfig
} from '../config'

export const MARKETPLACE_SOURCE_STATE_SCHEMA_VERSION = 1 as const
export const MARKETPLACE_SOURCE_STORAGE_KEY = 'open-pencil:marketplace-sources:v1'
export const MARKETPLACE_SOURCE_LIMITS = Object.freeze({
  maxStateBytes: 128 * 1024,
  maxSources: 32,
  maxTrustDomains: 16,
  maxRetiredRoots: 8,
  maxIdLength: 128,
  maxFingerprintLength: 80
})

export type MarketplaceSourceOrigin = 'managed' | 'user'

export interface MarketplaceSourceTrustHighWaterV1 {
  snapshotSequence: number
  snapshotVersion: string
  snapshotDigest: string
  auditSequence: number
  auditHeadDigest: string
  acceptedAt: string
  lastSeenWallTime: string
}

export interface MarketplaceTrustDomainRecordV1 {
  schemaVersion: 1
  trustDomainId: string
  expectedMarketplaceId: string
  currentRootFingerprint: string
  retiredRootFingerprints: readonly string[]
  highWater: MarketplaceSourceTrustHighWaterV1 | null
}

export interface MarketplaceSourceRecordV1 {
  schemaVersion: 1
  sourceId: string
  trustDomainId: string
  origin: MarketplaceSourceOrigin
  normalizedSnapshotURL: string
  expectedMarketplaceId: string
  channel: 'stable' | 'beta'
  rootKeyId: string
  rootKeySpkiSha256: string
  rootPublicKeyPem: string
  sourceGeneration: number
  predecessorRootFingerprint: string | null
  rotationAt: string | null
}

export interface MarketplaceSourceStateV1 {
  schemaVersion: 1
  activeUserSourceId: string | null
  managedSourceId: string | null
  nextGeneration: number
  sources: readonly MarketplaceSourceRecordV1[]
  trustDomains: readonly MarketplaceTrustDomainRecordV1[]
}

export interface CanonicalMarketplaceSourceConfig {
  snapshotUrl: string
  expectedMarketplaceId: string
  expectedKeyId: string
  rootPublicKey: CryptoKey
  rootPublicKeyPem: string
  rootKeySpkiSha256: string
  channel: 'stable' | 'beta'
}

const SHA_256_FINGERPRINT = /^sha256-[A-Za-z0-9_-]{43}$/u
const SHA_256_DIGEST = /^[A-Za-z0-9_-]{43}$/u
const SOURCE_ID = /^[A-Za-z0-9._:-]{1,128}$/u
const encoder = new TextEncoder()

interface UnknownObject {
  [key: string]: unknown
}

function isUnknownObject(value: unknown): value is UnknownObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown, path: string): UnknownObject {
  if (!isUnknownObject(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  return value
}

function exact(value: UnknownObject, path: string, keys: readonly string[]): void {
  const allowed = new Set(keys)
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key))
  if (unsupported.length > 0) throw new TypeError(`${path} contains unsupported fields`)
  for (const key of keys) {
    if (!(key in value)) throw new TypeError(`${path}.${key} is required`)
  }
}

function text(
  value: unknown,
  path: string,
  maximum: number = MARKETPLACE_SOURCE_LIMITS.maxIdLength
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${path} must be a non-empty bounded string`)
  }
  return value
}

function identifier(value: unknown, path: string): string {
  const parsed = text(value, path)
  if (!SOURCE_ID.test(parsed)) throw new TypeError(`${path} must be a portable identifier`)
  return parsed
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${path} must be a bounded integer`)
  }
  return value as number
}

function timestamp(value: unknown, path: string): string {
  const parsed = text(value, path, 64)
  const milliseconds = Date.parse(parsed)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== parsed) {
    throw new TypeError(`${path} must be a canonical ISO timestamp`)
  }
  return parsed
}

function digest(value: unknown, path: string): string {
  const parsed = text(value, path, 64)
  if (!SHA_256_DIGEST.test(parsed)) throw new TypeError(`${path} must be a SHA-256 digest`)
  return parsed
}

function fingerprint(value: unknown, path: string): string {
  const parsed = text(value, path, MARKETPLACE_SOURCE_LIMITS.maxFingerprintLength)
  if (!SHA_256_FINGERPRINT.test(parsed)) {
    throw new TypeError(`${path} must be an SPKI SHA-256 fingerprint`)
  }
  return parsed
}

function optionalText(value: unknown, path: string): string | null {
  return value === null ? null : fingerprint(value, path)
}

function highWater(value: unknown, path: string): MarketplaceSourceTrustHighWaterV1 | null {
  if (value === null) return null
  const source = record(value, path)
  exact(source, path, [
    'snapshotSequence',
    'snapshotVersion',
    'snapshotDigest',
    'auditSequence',
    'auditHeadDigest',
    'acceptedAt',
    'lastSeenWallTime'
  ])
  const snapshotVersion = text(source.snapshotVersion, `${path}.snapshotVersion`, 64)
  stableSemverParts(snapshotVersion)
  return {
    snapshotSequence: integer(source.snapshotSequence, `${path}.snapshotSequence`, 1),
    snapshotVersion,
    snapshotDigest: digest(source.snapshotDigest, `${path}.snapshotDigest`),
    auditSequence: integer(source.auditSequence, `${path}.auditSequence`),
    auditHeadDigest: digest(source.auditHeadDigest, `${path}.auditHeadDigest`),
    acceptedAt: timestamp(source.acceptedAt, `${path}.acceptedAt`),
    lastSeenWallTime: timestamp(source.lastSeenWallTime, `${path}.lastSeenWallTime`)
  }
}

function trustDomain(value: unknown, path: string): MarketplaceTrustDomainRecordV1 {
  const source = record(value, path)
  exact(source, path, [
    'schemaVersion',
    'trustDomainId',
    'expectedMarketplaceId',
    'currentRootFingerprint',
    'retiredRootFingerprints',
    'highWater'
  ])
  if (source.schemaVersion !== 1) throw new TypeError(`${path}.schemaVersion is not supported`)
  if (
    !Array.isArray(source.retiredRootFingerprints) ||
    source.retiredRootFingerprints.length > MARKETPLACE_SOURCE_LIMITS.maxRetiredRoots
  ) {
    throw new TypeError(`${path}.retiredRootFingerprints is invalid`)
  }
  const currentRootFingerprint = fingerprint(
    source.currentRootFingerprint,
    `${path}.currentRootFingerprint`
  )
  const retiredRootFingerprints = source.retiredRootFingerprints.map((entry, index) =>
    fingerprint(entry, `${path}.retiredRootFingerprints[${index}]`)
  )
  if (
    new Set(retiredRootFingerprints).size !== retiredRootFingerprints.length ||
    retiredRootFingerprints.includes(currentRootFingerprint)
  ) {
    throw new TypeError(`${path}.retiredRootFingerprints contains invalid root lineage`)
  }
  return {
    schemaVersion: 1,
    trustDomainId: identifier(source.trustDomainId, `${path}.trustDomainId`),
    expectedMarketplaceId: identifier(
      source.expectedMarketplaceId,
      `${path}.expectedMarketplaceId`
    ),
    currentRootFingerprint,
    retiredRootFingerprints,
    highWater: highWater(source.highWater, `${path}.highWater`)
  }
}

async function sourceRecord(value: unknown, path: string): Promise<MarketplaceSourceRecordV1> {
  const source = record(value, path)
  exact(source, path, [
    'schemaVersion',
    'sourceId',
    'trustDomainId',
    'origin',
    'normalizedSnapshotURL',
    'expectedMarketplaceId',
    'channel',
    'rootKeyId',
    'rootKeySpkiSha256',
    'rootPublicKeyPem',
    'sourceGeneration',
    'predecessorRootFingerprint',
    'rotationAt'
  ])
  if (source.schemaVersion !== 1) throw new TypeError(`${path}.schemaVersion is not supported`)
  const origin = source.origin
  if (origin !== 'managed' && origin !== 'user') throw new TypeError(`${path}.origin is invalid`)
  const normalizedSnapshotURL = text(
    source.normalizedSnapshotURL,
    `${path}.normalizedSnapshotURL`,
    2_048
  )
  const canonical = await canonicalizeMarketplaceSourceConfig({
    schemaVersion: 1,
    url: normalizedSnapshotURL,
    marketplaceId: source.expectedMarketplaceId,
    keyId: source.rootKeyId,
    publicKeyPem: source.rootPublicKeyPem,
    channel: source.channel
  })
  const storedFingerprint = fingerprint(source.rootKeySpkiSha256, `${path}.rootKeySpkiSha256`)
  if (canonical.snapshotUrl !== normalizedSnapshotURL) {
    throw new TypeError(`${path}.normalizedSnapshotURL is not canonical`)
  }
  if (canonical.rootKeySpkiSha256 !== storedFingerprint) {
    throw new TypeError(`${path}.rootKeySpkiSha256 does not match rootPublicKeyPem`)
  }
  const predecessorRootFingerprint = optionalText(
    source.predecessorRootFingerprint,
    `${path}.predecessorRootFingerprint`
  )
  const rotationAt =
    source.rotationAt === null ? null : timestamp(source.rotationAt, `${path}.rotationAt`)
  if ((predecessorRootFingerprint === null) !== (rotationAt === null)) {
    throw new TypeError(`${path} root rotation metadata must be complete`)
  }
  return {
    schemaVersion: 1,
    sourceId: identifier(source.sourceId, `${path}.sourceId`),
    trustDomainId: identifier(source.trustDomainId, `${path}.trustDomainId`),
    origin,
    normalizedSnapshotURL,
    expectedMarketplaceId: canonical.expectedMarketplaceId,
    channel: canonical.channel,
    rootKeyId: canonical.expectedKeyId,
    rootKeySpkiSha256: storedFingerprint,
    rootPublicKeyPem: canonical.rootPublicKeyPem,
    sourceGeneration: integer(source.sourceGeneration, `${path}.sourceGeneration`, 1),
    predecessorRootFingerprint,
    rotationAt
  }
}

export function emptyMarketplaceSourceState(): MarketplaceSourceStateV1 {
  return {
    schemaVersion: 1,
    activeUserSourceId: null,
    managedSourceId: null,
    nextGeneration: 1,
    sources: [],
    trustDomains: []
  }
}

function sourceArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MARKETPLACE_SOURCE_LIMITS.maxSources) {
    throw new TypeError('Marketplace source state has too many sources')
  }
  return value
}

function trustDomainArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MARKETPLACE_SOURCE_LIMITS.maxTrustDomains) {
    throw new TypeError('Marketplace source state has too many trust domains')
  }
  return value
}

function validateMarketplaceSourceRelationships(
  sources: readonly MarketplaceSourceRecordV1[],
  trustDomains: readonly MarketplaceTrustDomainRecordV1[]
): void {
  const sourceIds = new Set(sources.map(({ sourceId }) => sourceId))
  const domainIds = new Set(trustDomains.map(({ trustDomainId }) => trustDomainId))
  if (sourceIds.size !== sources.length || domainIds.size !== trustDomains.length) {
    throw new TypeError('Marketplace source state contains duplicate identities')
  }
  if (
    new Set(trustDomains.map(({ expectedMarketplaceId }) => expectedMarketplaceId)).size !==
    trustDomains.length
  ) {
    throw new TypeError('Marketplace source state contains duplicate marketplace trust domains')
  }
  for (const source of sources) {
    const domain = trustDomains.find(({ trustDomainId }) => trustDomainId === source.trustDomainId)
    if (!domain || domain.expectedMarketplaceId !== source.expectedMarketplaceId) {
      throw new TypeError(`Marketplace source ${source.sourceId} has an invalid trust domain`)
    }
    if (
      source.rootKeySpkiSha256 !== domain.currentRootFingerprint &&
      !domain.retiredRootFingerprints.includes(source.rootKeySpkiSha256)
    ) {
      throw new TypeError(`Marketplace source ${source.sourceId} is outside its root lineage`)
    }
  }
}

function activeSourceId(
  value: unknown,
  path: string,
  origin: MarketplaceSourceOrigin,
  sources: readonly MarketplaceSourceRecordV1[]
): string | null {
  if (value === null) return null
  const sourceId = identifier(value, path)
  if (!sources.some((entry) => entry.sourceId === sourceId && entry.origin === origin)) {
    throw new TypeError(`${path} is missing`)
  }
  return sourceId
}

function validateActiveSourceRoot(
  sourceId: string | null,
  sources: readonly MarketplaceSourceRecordV1[],
  trustDomains: readonly MarketplaceTrustDomainRecordV1[]
): void {
  if (!sourceId) return
  const source = sources.find((entry) => entry.sourceId === sourceId)
  const domain = source
    ? trustDomains.find(({ trustDomainId }) => trustDomainId === source.trustDomainId)
    : undefined
  if (!source || !domain || source.rootKeySpkiSha256 !== domain.currentRootFingerprint) {
    throw new TypeError('Marketplace active source does not use the current trust root')
  }
}

export async function parseMarketplaceSourceStateJSON(
  json: string
): Promise<MarketplaceSourceStateV1> {
  if (
    typeof json !== 'string' ||
    encoder.encode(json).byteLength > MARKETPLACE_SOURCE_LIMITS.maxStateBytes
  ) {
    throw new TypeError('Marketplace source state exceeds the size limit')
  }
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new TypeError('Marketplace source state must contain valid JSON')
  }
  const root = record(value, 'marketplaceSourceState')
  exact(root, 'marketplaceSourceState', [
    'schemaVersion',
    'activeUserSourceId',
    'managedSourceId',
    'nextGeneration',
    'sources',
    'trustDomains'
  ])
  if (root.schemaVersion !== 1)
    throw new TypeError('Marketplace source state schema is unsupported')
  const storedSources = sourceArray(root.sources)
  const storedDomains = trustDomainArray(root.trustDomains)
  const sources = await Promise.all(
    storedSources.map((entry, index) =>
      sourceRecord(entry, `marketplaceSourceState.sources[${index}]`)
    )
  )
  const trustDomains = storedDomains.map((entry, index) =>
    trustDomain(entry, `marketplaceSourceState.trustDomains[${index}]`)
  )
  validateMarketplaceSourceRelationships(sources, trustDomains)
  const activeUserSourceId = activeSourceId(
    root.activeUserSourceId,
    'marketplaceSourceState.activeUserSourceId',
    'user',
    sources
  )
  const managedSourceId = activeSourceId(
    root.managedSourceId,
    'marketplaceSourceState.managedSourceId',
    'managed',
    sources
  )
  validateActiveSourceRoot(activeUserSourceId, sources, trustDomains)
  validateActiveSourceRoot(managedSourceId, sources, trustDomains)
  const nextGeneration = integer(root.nextGeneration, 'marketplaceSourceState.nextGeneration', 1)
  if (sources.some(({ sourceGeneration }) => sourceGeneration >= nextGeneration)) {
    throw new TypeError('Marketplace source next generation must exceed all committed generations')
  }
  return {
    schemaVersion: 1,
    activeUserSourceId,
    managedSourceId,
    nextGeneration,
    sources,
    trustDomains
  }
}

export async function marketplaceRootKeyFingerprint(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key)
  const hash = await crypto.subtle.digest('SHA-256', spki)
  return `sha256-${encodeBase64URL(new Uint8Array(hash))}`
}

export async function canonicalizeMarketplaceSourceConfig(
  value: unknown
): Promise<CanonicalMarketplaceSourceConfig> {
  const resolved = await parseMarketplaceTrustConfig(value)
  return canonicalSourceConfig(resolved)
}

async function canonicalSourceConfig(
  resolved: ResolvedMarketplaceTrustConfig
): Promise<CanonicalMarketplaceSourceConfig> {
  const rootPublicKeyPem = await exportEd25519PublicKeyPem(resolved.rootPublicKey)
  return Object.freeze({
    ...resolved,
    rootPublicKeyPem,
    rootKeySpkiSha256: await marketplaceRootKeyFingerprint(resolved.rootPublicKey)
  })
}

export async function canonicalizeMarketplaceSourceConfigJSON(
  value: string
): Promise<CanonicalMarketplaceSourceConfig> {
  return canonicalSourceConfig(await parseMarketplaceTrustConfigJSON(value))
}

export async function resolveMarketplaceSourceRecord(
  source: MarketplaceSourceRecordV1
): Promise<ResolvedMarketplaceTrustConfig> {
  return parseMarketplaceTrustConfig({
    schemaVersion: 1,
    url: source.normalizedSnapshotURL,
    marketplaceId: source.expectedMarketplaceId,
    keyId: source.rootKeyId,
    publicKeyPem: source.rootPublicKeyPem,
    channel: source.channel
  })
}

function laterTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right
}

export function marketplaceEffectiveNow(
  highWater: MarketplaceSourceTrustHighWaterV1 | null,
  now: number
): number {
  return Math.max(now, highWater ? Date.parse(highWater.lastSeenWallTime) : now)
}

export function advanceMarketplaceSourceHighWater(
  previous: MarketplaceSourceTrustHighWaterV1 | null,
  verifiedValue: VerifiedMarketplaceSnapshot,
  acceptedAt: string
): MarketplaceSourceTrustHighWaterV1 {
  const verified = assertVerifiedMarketplaceSnapshot(verifiedValue)
  const snapshot = verified.snapshot
  const next: MarketplaceSourceTrustHighWaterV1 = {
    snapshotSequence: snapshot.sequence,
    snapshotVersion: snapshot.version,
    snapshotDigest: verified.verifiedDigest,
    auditSequence: snapshot.auditHead.sequence,
    auditHeadDigest: snapshot.auditHead.headDigest,
    acceptedAt,
    lastSeenWallTime: previous ? laterTimestamp(previous.lastSeenWallTime, acceptedAt) : acceptedAt
  }
  if (!previous) return next
  const repeated =
    next.snapshotSequence === previous.snapshotSequence &&
    next.snapshotVersion === previous.snapshotVersion &&
    next.snapshotDigest === previous.snapshotDigest &&
    next.auditSequence === previous.auditSequence &&
    next.auditHeadDigest === previous.auditHeadDigest
  if (repeated)
    return { ...next, lastSeenWallTime: laterTimestamp(previous.lastSeenWallTime, acceptedAt) }
  if (
    next.snapshotSequence <= previous.snapshotSequence ||
    compareStableSemver(
      stableSemverParts(next.snapshotVersion),
      stableSemverParts(previous.snapshotVersion)
    ) <= 0
  ) {
    throw new Error('Marketplace source snapshot must advance the persisted sequence and version')
  }
  if (
    next.auditSequence < previous.auditSequence ||
    (next.auditSequence === previous.auditSequence &&
      next.auditHeadDigest !== previous.auditHeadDigest)
  ) {
    throw new Error('Marketplace source snapshot rewrites the persisted audit high-water')
  }
  return next
}
