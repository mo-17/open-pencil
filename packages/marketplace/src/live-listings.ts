import {
  assertVerifiedMarketplaceSnapshot,
  searchVerifiedMarketplaceListingProjection,
  type MarketplaceListingSearchOptions,
  type MarketplacePluginListingV1,
  type VerifiedMarketplaceSnapshot
} from '@open-pencil/plugin-contracts'

import { findActiveMarketplacePublisherKey } from './publisher/trust'
import { marketplaceReleaseCoordinateKey, type MarketplaceStateV1 } from './types'

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
  verifiedValue: VerifiedMarketplaceSnapshot,
  at: number
): readonly MarketplacePluginListingV1[] {
  if (!Number.isSafeInteger(at)) throw new TypeError('Marketplace listing time is invalid')
  const listings = assertVerifiedMarketplaceSnapshot(verifiedValue).snapshot.listings
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

export function searchLiveMarketplaceListings(
  verifiedValue: VerifiedMarketplaceSnapshot,
  listings: readonly MarketplacePluginListingV1[],
  options: MarketplaceListingSearchOptions = {}
): readonly MarketplacePluginListingV1[] {
  return searchVerifiedMarketplaceListingProjection(verifiedValue, listings, options)
}
