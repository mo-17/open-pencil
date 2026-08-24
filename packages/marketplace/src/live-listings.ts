import {
  MARKETPLACE_SNAPSHOT_LIMITS,
  type MarketplaceListingSearchOptions,
  type MarketplacePluginListingV1
} from '@open-pencil/plugin-contracts'

import { findActiveMarketplacePublisherKey } from './publisher-trust'
import {
  MARKETPLACE_RELEASE_CHANNELS,
  marketplaceReleaseCoordinateKey,
  parseMarketplaceIdentity,
  type MarketplaceStateV1
} from './types'

function liveListingRelease(
  state: MarketplaceStateV1,
  listing: MarketplacePluginListingV1,
  releaseValue: MarketplacePluginListingV1['releases'][number],
  at: number
): boolean {
  const release = state.releases.find(
    (candidate) =>
      marketplaceReleaseCoordinateKey(candidate.coordinate) ===
      marketplaceReleaseCoordinateKey({
        pluginId: listing.pluginId,
        version: releaseValue.version,
        channel: releaseValue.channel
      })
  )
  if (!release) return false
  if (
    release.yankedAt !== null ||
    release.publisherId !== listing.publisherId ||
    release.manifestDigest !== releaseValue.digest
  ) {
    return false
  }
  const submission = state.submissions.find(({ id }) => id === release.submissionId)
  if (!submission) return false
  if (
    submission.status !== 'published' ||
    submission.publisherId !== listing.publisherId ||
    submission.revision !== release.submissionRevision ||
    marketplaceReleaseCoordinateKey(submission.coordinate) !==
      marketplaceReleaseCoordinateKey(release.coordinate) ||
    submission.manifestDigest !== release.manifestDigest ||
    submission.artifactDigest !== release.artifactDigest ||
    submission.signingKeyId === null
  ) {
    return false
  }
  return (
    findActiveMarketplacePublisherKey(state, listing.publisherId, submission.signingKeyId, at) !==
    null
  )
}

/**
 * Projects a root-verified immutable listing snapshot through the current
 * control state. It never changes the signed snapshot or its artifacts.
 */
export function projectLiveMarketplaceListings(
  state: MarketplaceStateV1,
  listings: readonly MarketplacePluginListingV1[],
  at: number
): readonly MarketplacePluginListingV1[] {
  if (!Number.isSafeInteger(at)) throw new TypeError('Marketplace listing time is invalid')
  const projected = listings.flatMap((listing) => {
    const publisher = state.publishers.find(({ id }) => id === listing.publisherId)
    const ownership = state.ownerships.find(({ pluginId }) => pluginId === listing.pluginId)
    if (
      publisher?.status !== 'active' ||
      ownership?.status !== 'active' ||
      ownership.publisherId !== listing.publisherId
    ) {
      return []
    }
    const releases = listing.releases.filter((release) =>
      liveListingRelease(state, listing, release, at)
    )
    if (releases.length === 0) return []
    return [Object.freeze({ ...listing, releases: Object.freeze(releases) })]
  })
  return Object.freeze(projected)
}

function normalizedQuery(value: string | undefined): string {
  if (
    value !== undefined &&
    (typeof value !== 'string' || value.length > MARKETPLACE_SNAPSHOT_LIMITS.maxSearchQueryLength)
  ) {
    throw new TypeError('Marketplace search query exceeds the size limit')
  }
  return (value ?? '').normalize('NFC').trim().toLocaleLowerCase('en-US')
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

function searchRank(entry: MarketplacePluginListingV1, query: string): number {
  if (!query) return 3
  const pluginId = entry.pluginId.toLocaleLowerCase('en-US')
  const name = entry.name.toLocaleLowerCase('en-US')
  if (pluginId === query || name === query) return 0
  if (pluginId.startsWith(query) || name.startsWith(query)) return 1
  const searchable = [
    entry.pluginId,
    entry.name,
    entry.summary,
    ...entry.categories,
    ...entry.keywords
  ]
    .join('\n')
    .toLocaleLowerCase('en-US')
  return searchable.includes(query) ? 2 : Number.POSITIVE_INFINITY
}

export function searchLiveMarketplaceListings(
  listings: readonly MarketplacePluginListingV1[],
  options: MarketplaceListingSearchOptions = {}
): readonly MarketplacePluginListingV1[] {
  const query = normalizedQuery(options.query)
  const category = options.category
    ? parseMarketplaceIdentity(options.category, 'marketplaceSearch.category')
    : undefined
  const channel = options.channel
  if (channel && !MARKETPLACE_RELEASE_CHANNELS.includes(channel)) {
    throw new TypeError('marketplaceSearch.channel must be stable or beta')
  }
  return Object.freeze(
    listings
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
  )
}
