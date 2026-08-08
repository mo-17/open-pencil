import {
  TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
  parseTrustedPluginKeyring,
  type TrustedPluginKeyringV1
} from '@open-pencil/core/plugins'
import {
  importEd25519PublicKeyPem,
  parseExactManifestRecord,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import { parseRemotePluginUrl } from './transport'

export const REMOTE_PLUGIN_TRUST_CONFIG_SCHEMA_VERSION = 1 as const
export const REMOTE_PLUGIN_TRUST_CONFIG_LIMITS = Object.freeze({
  maxJsonBytes: 512 * 1024,
  maxPemBytes: 8 * 1024,
  maxPublisherKeys: 256
})

export interface ResolvedRemotePluginTrustConfig {
  catalogUrl: string
  expectedCatalogId: string
  expectedCatalogKeyId: string
  catalogPublicKey: CryptoKey
  publisherKeyring: TrustedPluginKeyringV1
}

const ROOT_KEYS = new Set(['schemaVersion', 'catalog', 'publisherKeys'])
const CATALOG_KEYS = new Set(['url', 'catalogId', 'keyId', 'publicKeyPem'])
const PUBLISHER_KEY_KEYS = new Set([
  'keyId',
  'publisherId',
  'pluginIds',
  'publicKeyPem',
  'notBefore',
  'notAfter',
  'predecessorKeyId',
  'revokedAt',
  'revocationReason'
])
const REQUIRED_PUBLISHER_KEY_KEYS = new Set([
  'keyId',
  'publisherId',
  'pluginIds',
  'publicKeyPem',
  'notBefore',
  'notAfter'
])

function identity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
}

function pem(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > REMOTE_PLUGIN_TRUST_CONFIG_LIMITS.maxPemBytes
  ) {
    throw new TypeError(`${path} must be a bounded PEM string`)
  }
  return value
}

export async function parseRemotePluginTrustConfig(
  value: unknown
): Promise<ResolvedRemotePluginTrustConfig> {
  const source = parseExactManifestRecord(value, 'remotePluginTrustConfig', ROOT_KEYS, ROOT_KEYS)
  if (source.schemaVersion !== REMOTE_PLUGIN_TRUST_CONFIG_SCHEMA_VERSION) {
    throw new TypeError('remotePluginTrustConfig.schemaVersion is not supported')
  }
  const catalog = parseExactManifestRecord(
    source.catalog,
    'remotePluginTrustConfig.catalog',
    CATALOG_KEYS,
    CATALOG_KEYS
  )
  const url = parseRemotePluginUrl(catalog.url as string).href
  const catalogId = identity(catalog.catalogId, 'remotePluginTrustConfig.catalog.catalogId')
  const catalogKeyId = identity(catalog.keyId, 'remotePluginTrustConfig.catalog.keyId')
  const catalogPublicKey = await importEd25519PublicKeyPem(
    pem(catalog.publicKeyPem, 'remotePluginTrustConfig.catalog.publicKeyPem')
  )
  if (!Array.isArray(source.publisherKeys)) {
    throw new TypeError('remotePluginTrustConfig.publisherKeys must be an array')
  }
  if (source.publisherKeys.length > REMOTE_PLUGIN_TRUST_CONFIG_LIMITS.maxPublisherKeys) {
    throw new TypeError('remotePluginTrustConfig.publisherKeys exceeds the key count limit')
  }
  const keys = await Promise.all(
    source.publisherKeys.map(async (value, index) => {
      const path = `remotePluginTrustConfig.publisherKeys[${index}]`
      const key = parseExactManifestRecord(
        value,
        path,
        PUBLISHER_KEY_KEYS,
        REQUIRED_PUBLISHER_KEY_KEYS
      )
      return {
        keyId: key.keyId,
        publisherId: key.publisherId,
        pluginIds: key.pluginIds,
        publicKey: await importEd25519PublicKeyPem(pem(key.publicKeyPem, `${path}.publicKeyPem`)),
        notBefore: key.notBefore,
        notAfter: key.notAfter,
        ...(Object.hasOwn(key, 'predecessorKeyId')
          ? { predecessorKeyId: key.predecessorKeyId }
          : {}),
        ...(Object.hasOwn(key, 'revokedAt') ? { revokedAt: key.revokedAt } : {}),
        ...(Object.hasOwn(key, 'revocationReason')
          ? { revocationReason: key.revocationReason }
          : {})
      }
    })
  )
  return {
    catalogUrl: url,
    expectedCatalogId: catalogId,
    expectedCatalogKeyId: catalogKeyId,
    catalogPublicKey,
    publisherKeyring: parseTrustedPluginKeyring({
      schemaVersion: TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
      keys
    })
  }
}

export async function parseRemotePluginTrustConfigJson(
  source: string
): Promise<ResolvedRemotePluginTrustConfig> {
  if (
    typeof source !== 'string' ||
    new TextEncoder().encode(source).byteLength > REMOTE_PLUGIN_TRUST_CONFIG_LIMITS.maxJsonBytes
  ) {
    throw new TypeError('Remote plugin trust config JSON exceeds the size limit')
  }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new TypeError('Remote plugin trust config must contain valid JSON')
  }
  return parseRemotePluginTrustConfig(value)
}
