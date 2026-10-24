import {
  parseMarketplaceSnapshotJSON,
  verifyMarketplaceSnapshot,
  type MarketplacePluginListingV1
} from '@open-pencil/plugin-contracts'
import { importEd25519PublicKeyPem } from '@open-pencil/scene-graph'

export type MarketPlugin = MarketplacePluginListingV1

export interface CatalogData {
  readonly plugins: readonly MarketPlugin[]
  readonly sequence: number
  readonly issuedAt: string
  readonly expiresAt: string
  readonly marketplaceId: string
  readonly verifiedKeyId: string
  readonly snapshotDigest: string
}

export interface CatalogTrust {
  readonly marketplaceId: string
  readonly keyId: string
  readonly publicKeyPem: string
}

export interface CatalogLoadOptions {
  readonly fetchImpl?: typeof fetch
  readonly now?: number
  readonly trust?: CatalogTrust
}

export const MARKETPLACE_TRUST: CatalogTrust = Object.freeze({
  marketplaceId: 'openpencil.marketplace',
  keyId: 'openpencil-marketplace-root-20261023',
  publicKeyPem: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAUp4G+YMu4nk1/Ee02t5vRqe1ft2g0IFm/o+y6WYNWbA=
-----END PUBLIC KEY-----`
})

export async function loadCatalog(options: CatalogLoadOptions = {}): Promise<CatalogData> {
  const fetchImpl = options.fetchImpl ?? fetch
  const trust = options.trust ?? MARKETPLACE_TRUST
  const response = await fetchImpl('/v1/snapshot', {
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) throw new Error(`市场目录暂时不可用（HTTP ${response.status}）。`)
  const snapshot = parseMarketplaceSnapshotJSON(await response.text())
  const publicKey = await importEd25519PublicKeyPem(trust.publicKeyPem)
  const verified = await verifyMarketplaceSnapshot(snapshot, publicKey, {
    expectedMarketplaceId: trust.marketplaceId,
    expectedKeyId: trust.keyId,
    now: options.now ?? Date.now()
  })
  return Object.freeze({
    plugins: verified.snapshot.listings,
    sequence: verified.snapshot.sequence,
    issuedAt: verified.snapshot.generatedAt,
    expiresAt: verified.snapshot.expiresAt,
    marketplaceId: verified.snapshot.marketplaceId,
    verifiedKeyId: verified.verifiedKeyId,
    snapshotDigest: verified.verifiedDigest
  })
}

export function filterPlugins(
  plugins: readonly MarketPlugin[],
  query: string,
  category: string,
  searchAliases: Readonly<Record<string, readonly string[]>> = {}
): readonly MarketPlugin[] {
  const normalized = query.normalize('NFC').trim().toLocaleLowerCase('en-US')
  return plugins.filter((plugin) => {
    if (category && !plugin.categories.includes(category)) return false
    if (!normalized) return true
    return [
      plugin.pluginId,
      plugin.publisherId,
      plugin.name,
      plugin.summary,
      ...plugin.categories,
      ...plugin.keywords,
      ...(searchAliases[plugin.pluginId] ?? [])
    ].some((value) => value.normalize('NFC').toLocaleLowerCase('en-US').includes(normalized))
  })
}
