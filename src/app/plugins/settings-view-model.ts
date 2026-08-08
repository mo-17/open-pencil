import {
  searchMarketplaceListings,
  type MarketplacePluginListingV1,
  type MarketplacePublisherV1
} from '@open-pencil/core/plugins'

import type { MarketplaceSnapshotLoadResult, MarketplaceSnapshotLoadStatus } from './marketplace'
import type { AppPluginCatalogItem } from './types'

export type PluginMarketplaceKeyStatus =
  | 'active'
  | 'not-yet-valid'
  | 'expired'
  | 'revoked'
  | 'unknown'

export interface PluginMarketplaceListingView {
  listing: MarketplacePluginListingV1
  publisherName: string
  publisherStatus: MarketplacePublisherV1['status'] | 'unknown'
  ownershipStatus: 'active' | 'revoked' | 'unknown'
  keyStatus: PluginMarketplaceKeyStatus
  channels: readonly ('stable' | 'beta')[]
}

export interface PluginMarketplaceSnapshotView {
  configured: boolean
  status: MarketplaceSnapshotLoadStatus | 'loading' | 'not-configured'
  marketplaceId: string | null
  version: string | null
  sequence: number | null
  listingCount: number
  auditSequence: number | null
  auditDigest: string | null
  runtimeIndexId: string | null
  runtimeIndexDigest: string | null
  refreshError: Error | null
}

function normalizedSearchQuery(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('en-US').slice(0, 256)
}

function localCatalogSearchText(item: AppPluginCatalogItem): string {
  const manifest = item.package.manifest
  return [
    manifest.plugin.id,
    manifest.plugin.name,
    ...manifest.contributions.modules.flatMap((module) => [
      module.moduleType,
      module.name,
      module.description
    ]),
    ...(manifest.contributions.commands ?? []).flatMap((command) => [
      command.commandId,
      command.name,
      command.description
    ]),
    ...(manifest.contributions.exporters ?? []).flatMap((exporter) => [
      exporter.exporterId,
      exporter.name,
      exporter.description,
      exporter.fileExtension
    ])
  ]
    .join('\n')
    .toLocaleLowerCase('en-US')
}

function publisherKeyStatus(
  publisher: MarketplacePublisherV1 | undefined,
  at: number
): PluginMarketplaceKeyStatus {
  if (!publisher || publisher.keys.length === 0) return 'unknown'
  const isRevoked = (revokedAt: string | undefined) =>
    revokedAt !== undefined && Date.parse(revokedAt) <= at
  if (
    publisher.keys.some(
      (key) =>
        !isRevoked(key.revokedAt) &&
        Date.parse(key.notBefore) <= at &&
        at < Date.parse(key.notAfter)
    )
  ) {
    return 'active'
  }
  if (publisher.keys.every((key) => isRevoked(key.revokedAt))) return 'revoked'
  if (publisher.keys.some((key) => !isRevoked(key.revokedAt) && Date.parse(key.notBefore) > at)) {
    return 'not-yet-valid'
  }
  if (publisher.keys.some((key) => !isRevoked(key.revokedAt) && Date.parse(key.notAfter) <= at)) {
    return 'expired'
  }
  return 'unknown'
}

export function pluginMarketplaceSnapshotView(
  configured: boolean,
  result: MarketplaceSnapshotLoadResult | null
): PluginMarketplaceSnapshotView {
  const snapshot = result?.snapshot?.snapshot ?? null
  const status = configured ? (result?.status ?? 'loading') : 'not-configured'
  const refreshError = result?.refreshError ?? null
  if (!snapshot) {
    return Object.freeze({
      configured,
      status,
      marketplaceId: null,
      version: null,
      sequence: null,
      listingCount: 0,
      auditSequence: null,
      auditDigest: null,
      runtimeIndexId: null,
      runtimeIndexDigest: null,
      refreshError
    })
  }
  const runtimeIndex = snapshot.runtimeIndex
  return Object.freeze({
    configured,
    status,
    marketplaceId: snapshot.marketplaceId,
    version: snapshot.version,
    sequence: snapshot.sequence,
    listingCount: snapshot.listings.length,
    auditSequence: snapshot.auditHead.sequence,
    auditDigest: snapshot.auditHead.headDigest,
    runtimeIndexId: runtimeIndex ? runtimeIndex.indexId : null,
    runtimeIndexDigest: runtimeIndex ? runtimeIndex.digest : null,
    refreshError
  })
}

function compareMarketplaceChannel(left: 'stable' | 'beta', right: 'stable' | 'beta'): number {
  if (left === right) return 0
  return left === 'stable' ? -1 : 1
}

export function pluginMarketplaceListingViews(
  result: MarketplaceSnapshotLoadResult | null,
  now = Date.now()
): ReadonlyMap<string, PluginMarketplaceListingView> {
  const snapshot = result?.snapshot?.snapshot
  if (!snapshot) return new Map()
  const publishers = new Map(
    snapshot.publisherDirectory.publishers.map((publisher) => [publisher.publisherId, publisher])
  )
  const ownerships = new Map(
    snapshot.publisherDirectory.ownerships.map((ownership) => [ownership.pluginId, ownership])
  )
  const views = snapshot.listings.map((listing) => {
    const publisher = publishers.get(listing.publisherId)
    const ownership = ownerships.get(listing.pluginId)
    const channels = [...new Set(listing.releases.map((release) => release.channel))].sort(
      compareMarketplaceChannel
    )
    return [
      listing.pluginId,
      Object.freeze({
        listing,
        publisherName: publisher?.name ?? listing.publisherId,
        publisherStatus: publisher?.status ?? 'unknown',
        ownershipStatus: ownership?.status ?? 'unknown',
        keyStatus: publisherKeyStatus(publisher, now),
        channels: Object.freeze(channels)
      })
    ] as const
  })
  return new Map(views)
}

export function filterPluginDiscoverCatalog(
  catalog: readonly AppPluginCatalogItem[],
  marketplace: MarketplaceSnapshotLoadResult | null,
  query: string
): readonly AppPluginCatalogItem[] {
  const normalized = normalizedSearchQuery(query)
  if (!normalized) return catalog
  const verified = marketplace?.snapshot
  const marketplaceMatches = new Set(
    verified
      ? searchMarketplaceListings(verified, { query: normalized, limit: 100 }).map(
          (listing) => listing.pluginId
        )
      : []
  )
  return catalog.filter(
    (item) =>
      localCatalogSearchText(item).includes(normalized) ||
      marketplaceMatches.has(item.package.manifest.plugin.id)
  )
}
