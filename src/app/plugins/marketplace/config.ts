import { importEd25519PublicKeyPem, parseExactManifestRecord } from '@open-pencil/scene-graph'

import { parseRemotePluginUrl } from '../remote'

export const MARKETPLACE_TRUST_CONFIG_SCHEMA_VERSION = 1 as const
export const MARKETPLACE_TRUST_CONFIG_LIMITS = Object.freeze({
  maxJsonBytes: 32 * 1024,
  maxPemBytes: 8 * 1024
})

export interface ResolvedMarketplaceTrustConfig {
  snapshotUrl: string
  expectedMarketplaceId: string
  expectedKeyId: string
  rootPublicKey: CryptoKey
  channel: 'stable' | 'beta'
}

const ROOT_KEYS = new Set([
  'schemaVersion',
  'url',
  'marketplaceId',
  'keyId',
  'publicKeyPem',
  'channel'
])
const REQUIRED_KEYS = new Set(['schemaVersion', 'url', 'marketplaceId', 'keyId', 'publicKeyPem'])

function boundedText(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${path} must be a non-empty bounded string`)
  }
  return value
}

export async function parseMarketplaceTrustConfig(
  value: unknown
): Promise<ResolvedMarketplaceTrustConfig> {
  const source = parseExactManifestRecord(value, 'marketplaceTrustConfig', ROOT_KEYS, REQUIRED_KEYS)
  if (source.schemaVersion !== MARKETPLACE_TRUST_CONFIG_SCHEMA_VERSION) {
    throw new TypeError('marketplaceTrustConfig.schemaVersion is not supported')
  }
  const channel = source.channel ?? 'stable'
  if (channel !== 'stable' && channel !== 'beta') {
    throw new TypeError('marketplaceTrustConfig.channel must be stable or beta')
  }
  return {
    snapshotUrl: parseRemotePluginUrl(boundedText(source.url, 'marketplaceTrustConfig.url', 2_048))
      .href,
    expectedMarketplaceId: boundedText(
      source.marketplaceId,
      'marketplaceTrustConfig.marketplaceId',
      128
    ),
    expectedKeyId: boundedText(source.keyId, 'marketplaceTrustConfig.keyId', 128),
    rootPublicKey: await importEd25519PublicKeyPem(
      boundedText(
        source.publicKeyPem,
        'marketplaceTrustConfig.publicKeyPem',
        MARKETPLACE_TRUST_CONFIG_LIMITS.maxPemBytes
      )
    ),
    channel
  }
}

export async function parseMarketplaceTrustConfigJson(
  source: string
): Promise<ResolvedMarketplaceTrustConfig> {
  if (
    typeof source !== 'string' ||
    new TextEncoder().encode(source).byteLength > MARKETPLACE_TRUST_CONFIG_LIMITS.maxJsonBytes
  ) {
    throw new TypeError('Marketplace trust config JSON exceeds the size limit')
  }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new TypeError('Marketplace trust config must contain valid JSON')
  }
  return parseMarketplaceTrustConfig(value)
}
