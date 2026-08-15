import {
  assertEd25519PublicKey,
  compareStableSemver,
  createSignedManifestIntegrity,
  stableSemverParts,
  verifySignedManifestIntegrity
} from '@open-pencil/scene-graph'

import { verifyPluginCatalog } from '../catalog'
import { pluginTrustNow, resolveTrustedPluginKey } from '../keyring'
import { verifyPluginRuntimeIndex } from '../runtime-index'
import type { VerifiedPluginRuntimeIndex } from '../runtime-index'
import { createMarketplacePublisherKeyring } from './directory'
import {
  marketplaceCatalogReference,
  parseMarketplaceSnapshot,
  parseMarketplaceSnapshotPayload
} from './parse'
import { marketplaceIdentity } from './parse-helpers'
import { MARKETPLACE_SNAPSHOT_LIMITS } from './types'
import type {
  MarketplaceCatalogVerificationOptions,
  MarketplaceRuntimeIndexVerificationOptions,
  MarketplaceSnapshotDiagnostic,
  MarketplaceSnapshotSigningOptions,
  MarketplaceSnapshotVerificationOptions,
  SignedMarketplaceSnapshotV1,
  VerifiedMarketplaceCatalog,
  VerifiedMarketplaceSnapshot
} from './types'

export type MarketplaceSnapshotTrustErrorCode =
  | 'marketplace-id-mismatch'
  | 'marketplace-key-untrusted'
  | 'marketplace-integrity-invalid'
  | 'marketplace-not-yet-valid'
  | 'marketplace-expired'
  | 'marketplace-catalog-mismatch'
  | 'marketplace-subordinate-validity-invalid'

export class MarketplaceSnapshotTrustError extends Error {
  readonly code: MarketplaceSnapshotTrustErrorCode
  readonly subjectId: string

  constructor(code: MarketplaceSnapshotTrustErrorCode, message: string, subjectId: string) {
    super(message)
    this.name = 'MarketplaceSnapshotTrustError'
    this.code = code
    this.subjectId = subjectId
  }
}

const VERIFIED_SNAPSHOTS = new WeakSet<object>()
const VERIFIED_ROOT_KEYS = new WeakMap<object, CryptoKey>()

function boundedClockSkew(value: number | undefined): number {
  const resolved = value ?? MARKETPLACE_SNAPSHOT_LIMITS.defaultClockSkewMilliseconds
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 0 ||
    resolved > MARKETPLACE_SNAPSHOT_LIMITS.maxClockSkewMilliseconds
  ) {
    throw new TypeError('maxClockSkewMilliseconds must be a bounded non-negative integer')
  }
  return resolved
}

function snapshotTimeDiagnostics(
  snapshot: SignedMarketplaceSnapshotV1,
  now: number,
  skew: number
): readonly MarketplaceSnapshotDiagnostic[] {
  const generatedAt = Date.parse(snapshot.generatedAt)
  const expiresAt = Date.parse(snapshot.expiresAt)
  if (now + skew < generatedAt) {
    throw new MarketplaceSnapshotTrustError(
      'marketplace-not-yet-valid',
      `Marketplace snapshot is not valid until ${snapshot.generatedAt}`,
      snapshot.marketplaceId
    )
  }
  if (now >= expiresAt) {
    throw new MarketplaceSnapshotTrustError(
      'marketplace-expired',
      `Marketplace snapshot expired at ${snapshot.expiresAt}`,
      snapshot.marketplaceId
    )
  }
  return expiresAt - now <= MARKETPLACE_SNAPSHOT_LIMITS.expiringSoonMilliseconds
    ? [
        {
          code: 'marketplace-snapshot-expiring-soon',
          message: `Marketplace snapshot expires at ${snapshot.expiresAt}`,
          subjectId: snapshot.marketplaceId
        }
      ]
    : []
}

export async function signMarketplaceSnapshot(
  value: unknown,
  privateKey: CryptoKey,
  options: MarketplaceSnapshotSigningOptions = {}
): Promise<SignedMarketplaceSnapshotV1> {
  const payload = parseMarketplaceSnapshotPayload(value)
  await createMarketplacePublisherKeyring(payload.publisherDirectory)
  const keyId = marketplaceIdentity(
    options.keyId ?? payload.marketplaceId,
    'marketplaceSnapshot.integrity.signature.keyId'
  )
  return parseMarketplaceSnapshot({
    ...payload,
    integrity: await createSignedManifestIntegrity(payload, keyId, privateKey)
  })
}

export async function verifyMarketplaceSnapshot(
  value: unknown,
  rootPublicKey: CryptoKey,
  options: MarketplaceSnapshotVerificationOptions = {}
): Promise<VerifiedMarketplaceSnapshot> {
  const snapshot = parseMarketplaceSnapshot(value)
  assertEd25519PublicKey(rootPublicKey)
  if (options.expectedMarketplaceId && options.expectedMarketplaceId !== snapshot.marketplaceId) {
    throw new MarketplaceSnapshotTrustError(
      'marketplace-id-mismatch',
      'Marketplace snapshot id is not trusted',
      snapshot.marketplaceId
    )
  }
  if (options.expectedKeyId && options.expectedKeyId !== snapshot.integrity.signature.keyId) {
    throw new MarketplaceSnapshotTrustError(
      'marketplace-key-untrusted',
      'Marketplace snapshot root key id is not trusted',
      snapshot.integrity.signature.keyId
    )
  }
  const { integrity, ...payload } = snapshot
  let verifiedDigest: string
  try {
    verifiedDigest = await verifySignedManifestIntegrity(
      payload,
      integrity,
      rootPublicKey,
      'Marketplace snapshot'
    )
  } catch {
    throw new MarketplaceSnapshotTrustError(
      'marketplace-integrity-invalid',
      'Marketplace snapshot digest or signature verification failed',
      snapshot.marketplaceId
    )
  }
  const now = pluginTrustNow(options.now)
  const diagnostics = snapshotTimeDiagnostics(
    snapshot,
    now,
    boundedClockSkew(options.maxClockSkewMilliseconds)
  )
  const publisherKeyring = await createMarketplacePublisherKeyring(snapshot.publisherDirectory)
  const verified = Object.freeze({
    snapshot,
    verifiedDigest,
    verifiedKeyId: integrity.signature.keyId,
    verifiedAt: new Date(now).toISOString(),
    publisherKeyring,
    diagnostics: Object.freeze(diagnostics)
  })
  VERIFIED_SNAPSHOTS.add(verified)
  VERIFIED_ROOT_KEYS.set(verified, rootPublicKey)
  return verified
}

function verifiedRootKey(snapshot: VerifiedMarketplaceSnapshot): CryptoKey {
  if (!VERIFIED_SNAPSHOTS.has(snapshot)) {
    throw new MarketplaceSnapshotTrustError(
      'marketplace-integrity-invalid',
      'Marketplace snapshot must be verified in this process',
      snapshot.snapshot.marketplaceId
    )
  }
  const key = VERIFIED_ROOT_KEYS.get(snapshot)
  if (!key) throw new Error('Verified marketplace root key is unavailable')
  return key
}

function assertCatalogListingBindings(
  snapshot: VerifiedMarketplaceSnapshot,
  channel: MarketplaceCatalogVerificationOptions['channel'],
  catalog: Awaited<ReturnType<typeof verifyPluginCatalog>>,
  now: number
): void {
  for (const listing of snapshot.snapshot.listings) {
    const release = listing.releases.find((candidate) => candidate.channel === channel)
    if (!release) continue
    const entry = catalog.catalog.entries.find(
      (candidate) =>
        candidate.pluginId === listing.pluginId &&
        candidate.publisherId === listing.publisherId &&
        candidate.version === release.version &&
        candidate.digest === release.digest
    )
    if (!entry) {
      throw new MarketplaceSnapshotTrustError(
        'marketplace-catalog-mismatch',
        `Marketplace listing ${listing.pluginId} is not present in the bound ${channel} catalog`,
        listing.pluginId
      )
    }
    try {
      resolveTrustedPluginKey(snapshot.publisherKeyring, {
        pluginId: entry.pluginId,
        publisherId: entry.publisherId,
        keyId: entry.keyId,
        now
      })
    } catch {
      throw new MarketplaceSnapshotTrustError(
        'marketplace-catalog-mismatch',
        `Marketplace listing ${listing.pluginId} does not have an active publisher key`,
        listing.pluginId
      )
    }
  }
}

export async function verifyMarketplaceCatalog(
  value: unknown,
  options: MarketplaceCatalogVerificationOptions
): Promise<VerifiedMarketplaceCatalog> {
  const snapshot = assertVerifiedMarketplaceSnapshotCurrent(options.snapshot, options)
  const rootPublicKey = verifiedRootKey(snapshot)
  const reference = marketplaceCatalogReference(snapshot.snapshot, options.channel)
  const now = pluginTrustNow(options.now)
  const catalog = await verifyPluginCatalog(value, rootPublicKey, {
    expectedCatalogId: reference.catalogId,
    expectedKeyId: reference.keyId,
    now,
    maxClockSkewMilliseconds: options.maxClockSkewMilliseconds
  })
  if (catalog.verifiedDigest !== reference.digest) {
    throw new MarketplaceSnapshotTrustError(
      'marketplace-catalog-mismatch',
      `Marketplace ${reference.channel} catalog digest does not match the root snapshot`,
      reference.catalogId
    )
  }
  if (Date.parse(catalog.catalog.expiresAt) > Date.parse(snapshot.snapshot.expiresAt)) {
    throw new MarketplaceSnapshotTrustError(
      'marketplace-subordinate-validity-invalid',
      `Marketplace catalog validity exceeds its authorizing snapshot at ${snapshot.snapshot.expiresAt}`,
      reference.catalogId
    )
  }
  assertCatalogListingBindings(snapshot, options.channel, catalog, now)
  return Object.freeze({ reference, catalog })
}

export async function verifyMarketplaceRuntimeIndex(
  value: unknown,
  options: MarketplaceRuntimeIndexVerificationOptions
): Promise<VerifiedPluginRuntimeIndex> {
  const snapshot = assertVerifiedMarketplaceSnapshotCurrent(options.snapshot, options)
  const rootPublicKey = verifiedRootKey(snapshot)
  const reference = snapshot.snapshot.runtimeIndex
  if (!reference) {
    throw new MarketplaceSnapshotTrustError(
      'marketplace-integrity-invalid',
      'Marketplace snapshot does not authorize a runtime index',
      options.snapshot.snapshot.marketplaceId
    )
  }
  const runtimeIndex = await verifyPluginRuntimeIndex(value, rootPublicKey, {
    expectedIndexId: reference.indexId,
    expectedKeyId: reference.keyId,
    expectedDigest: reference.digest,
    now: options.now,
    maxClockSkewMilliseconds: options.maxClockSkewMilliseconds
  })
  if (Date.parse(runtimeIndex.index.expiresAt) > Date.parse(snapshot.snapshot.expiresAt)) {
    throw new MarketplaceSnapshotTrustError(
      'marketplace-subordinate-validity-invalid',
      `Marketplace runtime index validity exceeds its authorizing snapshot at ${snapshot.snapshot.expiresAt}`,
      reference.indexId
    )
  }
  return runtimeIndex
}

export function assertVerifiedMarketplaceSnapshot(
  value: VerifiedMarketplaceSnapshot
): VerifiedMarketplaceSnapshot {
  verifiedRootKey(value)
  return value
}

export function assertVerifiedMarketplaceSnapshotCurrent(
  value: VerifiedMarketplaceSnapshot,
  options: Pick<MarketplaceSnapshotVerificationOptions, 'now' | 'maxClockSkewMilliseconds'> = {}
): VerifiedMarketplaceSnapshot {
  const snapshot = assertVerifiedMarketplaceSnapshot(value)
  snapshotTimeDiagnostics(
    snapshot.snapshot,
    pluginTrustNow(options.now),
    boundedClockSkew(options.maxClockSkewMilliseconds)
  )
  return snapshot
}

export function assertMarketplaceSnapshotAdvance(
  previousValue: VerifiedMarketplaceSnapshot,
  nextValue: VerifiedMarketplaceSnapshot
): VerifiedMarketplaceSnapshot {
  const previous = assertVerifiedMarketplaceSnapshot(previousValue)
  const next = assertVerifiedMarketplaceSnapshot(nextValue)
  if (previous.snapshot.marketplaceId !== next.snapshot.marketplaceId) {
    throw new MarketplaceSnapshotTrustError(
      'marketplace-id-mismatch',
      'Marketplace snapshot update changes marketplace identity',
      next.snapshot.marketplaceId
    )
  }
  if (
    next.snapshot.sequence <= previous.snapshot.sequence ||
    compareStableSemver(
      stableSemverParts(next.snapshot.version),
      stableSemverParts(previous.snapshot.version)
    ) <= 0
  ) {
    throw new MarketplaceSnapshotTrustError(
      'marketplace-integrity-invalid',
      'Marketplace snapshot update must advance sequence and version',
      next.snapshot.marketplaceId
    )
  }
  const previousAudit = previous.snapshot.auditHead
  const nextAudit = next.snapshot.auditHead
  if (
    nextAudit.sequence < previousAudit.sequence ||
    (nextAudit.sequence === previousAudit.sequence &&
      nextAudit.headDigest !== previousAudit.headDigest)
  ) {
    throw new MarketplaceSnapshotTrustError(
      'marketplace-integrity-invalid',
      'Marketplace snapshot update rewrites the append-only audit head',
      next.snapshot.marketplaceId
    )
  }
  return next
}
