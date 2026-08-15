import { marketplaceChannel, marketplaceIdentity } from './parse-helpers'
import { assertVerifiedMarketplaceSnapshot } from './trust'
import { MARKETPLACE_SNAPSHOT_LIMITS } from './types'
import type {
  MarketplaceListingSearchOptions,
  MarketplacePluginListingV1,
  VerifiedMarketplaceSnapshot
} from './types'

function normalizedQuery(value: string | undefined): string {
  if (value === undefined) return ''
  if (
    typeof value !== 'string' ||
    value.length > MARKETPLACE_SNAPSHOT_LIMITS.maxSearchQueryLength
  ) {
    throw new TypeError('Marketplace search query exceeds the size limit')
  }
  return value.normalize('NFC').trim().toLocaleLowerCase('en-US')
}

function resultLimit(value: number | undefined): number {
  const resolved = value ?? 25
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    resolved > MARKETPLACE_SNAPSHOT_LIMITS.maxSearchResults
  ) {
    throw new TypeError(
      `Marketplace search limit must be between 1 and ${MARKETPLACE_SNAPSHOT_LIMITS.maxSearchResults}`
    )
  }
  return resolved
}

function searchableText(entry: MarketplacePluginListingV1): string {
  return [entry.pluginId, entry.name, entry.summary, ...entry.categories, ...entry.keywords]
    .join('\n')
    .toLocaleLowerCase('en-US')
}

function searchRank(entry: MarketplacePluginListingV1, query: string): number {
  if (!query) return 3
  const pluginId = entry.pluginId.toLocaleLowerCase('en-US')
  const name = entry.name.toLocaleLowerCase('en-US')
  if (pluginId === query || name === query) return 0
  if (pluginId.startsWith(query) || name.startsWith(query)) return 1
  return searchableText(entry).includes(query) ? 2 : Number.POSITIVE_INFINITY
}

export function searchMarketplaceListings(
  verifiedValue: VerifiedMarketplaceSnapshot,
  options: MarketplaceListingSearchOptions = {}
): readonly MarketplacePluginListingV1[] {
  const verified = assertVerifiedMarketplaceSnapshot(verifiedValue)
  const query = normalizedQuery(options.query)
  const category = options.category
    ? marketplaceIdentity(options.category, 'marketplaceSearch.category')
    : undefined
  const channel = options.channel
    ? marketplaceChannel(options.channel, 'marketplaceSearch.channel')
    : undefined
  const ranked = verified.snapshot.listings
    .map((entry) => ({ entry, rank: searchRank(entry, query) }))
    .filter(
      ({ entry, rank }) =>
        Number.isFinite(rank) &&
        (!category || entry.categories.includes(category)) &&
        (!channel || entry.releases.some((release) => release.channel === channel))
    )
    .sort(
      (left, right) =>
        left.rank - right.rank || left.entry.pluginId.localeCompare(right.entry.pluginId)
    )
    .slice(0, resultLimit(options.limit))
    .map(({ entry }) => entry)
  return Object.freeze(ranked)
}
