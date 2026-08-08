import { exportEd25519PublicKeyPem, importEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import {
  TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
  parsePluginTrustTimestamp,
  parseTrustedPluginKeyring,
  type TrustedPluginKeyringV1
} from '#core/plugins/keyring'
import { parsePluginTrustValidityWindow } from '#core/plugins/parse-helpers'

import {
  assertMarketplaceSorted,
  compareMarketplaceText,
  marketplaceIdentity,
  marketplacePublicKeyPem,
  marketplaceText,
  parseBoundedManifestArray,
  parseExactManifestRecord
} from './parse-helpers'
import { MARKETPLACE_SNAPSHOT_LIMITS } from './types'
import type {
  MarketplacePluginOwnershipV1,
  MarketplacePublisherDirectoryV1,
  MarketplacePublisherKeyV1,
  MarketplacePublisherV1
} from './types'

const DIRECTORY_KEYS = new Set(['publishers', 'ownerships'])
const PUBLISHER_KEYS = new Set(['publisherId', 'name', 'status', 'keys'])
const PUBLISHER_KEY_KEYS = new Set([
  'keyId',
  'publicKeyPem',
  'notBefore',
  'notAfter',
  'predecessorKeyId',
  'revokedAt',
  'revocationReason'
])
const PUBLISHER_KEY_REQUIRED = new Set(['keyId', 'publicKeyPem', 'notBefore', 'notAfter'])
const OWNERSHIP_KEYS = new Set([
  'pluginId',
  'publisherId',
  'status',
  'grantedAt',
  'revokedAt',
  'revocationReason'
])
const OWNERSHIP_REQUIRED = new Set(['pluginId', 'publisherId', 'status', 'grantedAt'])

function optionalRevocation(
  source: Readonly<Record<string, unknown>>,
  path: string
): Pick<MarketplacePublisherKeyV1, 'revokedAt' | 'revocationReason'> {
  const hasTime = Object.hasOwn(source, 'revokedAt')
  const hasReason = Object.hasOwn(source, 'revocationReason')
  if (hasTime !== hasReason) {
    throw new TypeError(`${path}.revokedAt and revocationReason must be provided together`)
  }
  if (!hasTime) return {}
  return {
    revokedAt: parsePluginTrustTimestamp(source.revokedAt, `${path}.revokedAt`),
    revocationReason: marketplaceText(
      source.revocationReason,
      `${path}.revocationReason`,
      MARKETPLACE_SNAPSHOT_LIMITS.maxReasonLength
    )
  }
}

function publisherKey(value: unknown, path: string): MarketplacePublisherKeyV1 {
  const source = parseExactManifestRecord(value, path, PUBLISHER_KEY_KEYS, PUBLISHER_KEY_REQUIRED)
  const { notBefore, notAfter } = parsePluginTrustValidityWindow(source, path)
  const predecessorKeyId = Object.hasOwn(source, 'predecessorKeyId')
    ? marketplaceIdentity(source.predecessorKeyId, `${path}.predecessorKeyId`)
    : undefined
  return Object.freeze({
    keyId: marketplaceIdentity(source.keyId, `${path}.keyId`),
    publicKeyPem: marketplacePublicKeyPem(source.publicKeyPem, `${path}.publicKeyPem`),
    notBefore,
    notAfter,
    ...(predecessorKeyId ? { predecessorKeyId } : {}),
    ...optionalRevocation(source, path)
  })
}

function publisher(value: unknown, index: number): MarketplacePublisherV1 {
  const path = `marketplaceSnapshot.publisherDirectory.publishers[${index}]`
  const source = parseExactManifestRecord(value, path, PUBLISHER_KEYS, PUBLISHER_KEYS)
  if (source.status !== 'active' && source.status !== 'suspended') {
    throw new TypeError(`${path}.status must be active or suspended`)
  }
  const keys = parseBoundedManifestArray(
    source.keys,
    `${path}.keys`,
    MARKETPLACE_SNAPSHOT_LIMITS.maxKeysPerPublisher
  ).map((entry, keyIndex) => publisherKey(entry, `${path}.keys[${keyIndex}]`))
  if (keys.length === 0) throw new TypeError(`${path}.keys must contain at least one key`)
  assertMarketplaceSorted(keys, `${path}.keys`, (left, right) =>
    compareMarketplaceText(left.keyId, right.keyId)
  )
  return Object.freeze({
    publisherId: marketplaceIdentity(source.publisherId, `${path}.publisherId`),
    name: marketplaceText(source.name, `${path}.name`, MARKETPLACE_SNAPSHOT_LIMITS.maxNameLength),
    status: source.status,
    keys: Object.freeze(keys)
  })
}

function ownership(value: unknown, index: number): MarketplacePluginOwnershipV1 {
  const path = `marketplaceSnapshot.publisherDirectory.ownerships[${index}]`
  const source = parseExactManifestRecord(value, path, OWNERSHIP_KEYS, OWNERSHIP_REQUIRED)
  if (source.status !== 'active' && source.status !== 'revoked') {
    throw new TypeError(`${path}.status must be active or revoked`)
  }
  const grantedAt = parsePluginTrustTimestamp(source.grantedAt, `${path}.grantedAt`)
  const revocation = optionalRevocation(source, path)
  if (source.status === 'active' && revocation.revokedAt) {
    throw new TypeError(`${path} cannot be active and revoked`)
  }
  if (source.status === 'revoked' && !revocation.revokedAt) {
    throw new TypeError(`${path} must include revocation metadata when revoked`)
  }
  if (revocation.revokedAt && Date.parse(revocation.revokedAt) < Date.parse(grantedAt)) {
    throw new TypeError(`${path}.revokedAt cannot predate grantedAt`)
  }
  return Object.freeze({
    pluginId: marketplaceIdentity(source.pluginId, `${path}.pluginId`),
    publisherId: marketplaceIdentity(source.publisherId, `${path}.publisherId`),
    status: source.status,
    grantedAt,
    ...revocation
  })
}

function validatePublisherKeys(publishers: readonly MarketplacePublisherV1[]): void {
  const globalKeys = new Set<string>()
  const publicKeys = new Set<string>()
  for (const entry of publishers) {
    const byId = new Map(entry.keys.map((key) => [key.keyId, key]))
    for (const key of entry.keys) {
      if (globalKeys.has(key.keyId)) {
        throw new TypeError(`marketplaceSnapshot publisher key id is duplicated: ${key.keyId}`)
      }
      globalKeys.add(key.keyId)
      if (publicKeys.has(key.publicKeyPem)) {
        throw new TypeError('marketplaceSnapshot publisher public keys must be unique')
      }
      publicKeys.add(key.publicKeyPem)
      if (!key.predecessorKeyId) continue
      const predecessor = byId.get(key.predecessorKeyId)
      if (!predecessor) {
        throw new TypeError(
          `marketplaceSnapshot publisher key ${key.keyId} has an unknown predecessor`
        )
      }
      if (Date.parse(predecessor.notBefore) >= Date.parse(key.notBefore)) {
        throw new TypeError(
          `marketplaceSnapshot publisher key ${key.keyId} must follow its predecessor`
        )
      }
    }
  }
}

function validateOwnerships(
  publishers: readonly MarketplacePublisherV1[],
  ownerships: readonly MarketplacePluginOwnershipV1[]
): void {
  const publisherIds = new Set(publishers.map(({ publisherId }) => publisherId))
  for (const entry of ownerships) {
    if (!publisherIds.has(entry.publisherId)) {
      throw new TypeError(
        `marketplaceSnapshot ownership ${entry.pluginId} references an unknown publisher`
      )
    }
  }
}

export function parseMarketplacePublisherDirectory(
  value: unknown
): MarketplacePublisherDirectoryV1 {
  const path = 'marketplaceSnapshot.publisherDirectory'
  const source = parseExactManifestRecord(value, path, DIRECTORY_KEYS, DIRECTORY_KEYS)
  const publishers = parseBoundedManifestArray(
    source.publishers,
    `${path}.publishers`,
    MARKETPLACE_SNAPSHOT_LIMITS.maxPublishers
  ).map(publisher)
  const ownerships = parseBoundedManifestArray(
    source.ownerships,
    `${path}.ownerships`,
    MARKETPLACE_SNAPSHOT_LIMITS.maxOwnerships
  ).map(ownership)
  assertMarketplaceSorted(publishers, `${path}.publishers`, (left, right) =>
    compareMarketplaceText(left.publisherId, right.publisherId)
  )
  assertMarketplaceSorted(ownerships, `${path}.ownerships`, (left, right) =>
    compareMarketplaceText(left.pluginId, right.pluginId)
  )
  validatePublisherKeys(publishers)
  validateOwnerships(publishers, ownerships)
  return Object.freeze({
    publishers: Object.freeze(publishers),
    ownerships: Object.freeze(ownerships)
  })
}

function activePluginIds(
  directory: MarketplacePublisherDirectoryV1,
  publisherId: string
): readonly string[] {
  return directory.ownerships
    .filter((entry) => entry.publisherId === publisherId && entry.status === 'active')
    .map(({ pluginId }) => pluginId)
}

export async function createMarketplacePublisherKeyring(
  value: unknown
): Promise<TrustedPluginKeyringV1> {
  const directory = parseMarketplacePublisherDirectory(value)
  const keys = []
  for (const publisher of directory.publishers) {
    const pluginIds = activePluginIds(directory, publisher.publisherId)
    if (publisher.status !== 'active' || pluginIds.length === 0) continue
    for (const key of publisher.keys) {
      const publicKey = await importEd25519PublicKeyPem(key.publicKeyPem)
      if ((await exportEd25519PublicKeyPem(publicKey)) !== key.publicKeyPem) {
        throw new TypeError(`Publisher key ${key.keyId} PEM is not canonical`)
      }
      keys.push({
        keyId: key.keyId,
        publisherId: publisher.publisherId,
        pluginIds,
        publicKey,
        notBefore: key.notBefore,
        notAfter: key.notAfter,
        ...(key.predecessorKeyId ? { predecessorKeyId: key.predecessorKeyId } : {}),
        ...(key.revokedAt
          ? { revokedAt: key.revokedAt, revocationReason: key.revocationReason }
          : {})
      })
    }
  }
  return parseTrustedPluginKeyring({
    schemaVersion: TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
    keys
  })
}
