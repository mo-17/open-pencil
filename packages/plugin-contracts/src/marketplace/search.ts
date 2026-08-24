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

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameRelease(
  left: MarketplacePluginListingV1['releases'][number],
  right: MarketplacePluginListingV1['releases'][number]
): boolean {
  return (
    left.channel === right.channel && left.version === right.version && left.digest === right.digest
  )
}

function isRecordValue(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function preservesSignedMetadata(
  projected: MarketplacePluginListingV1,
  signed: MarketplacePluginListingV1
): boolean {
  return (
    projected.publisherId === signed.publisherId &&
    projected.name === signed.name &&
    projected.summary === signed.summary &&
    Array.isArray(projected.categories) &&
    sameStrings(projected.categories, signed.categories) &&
    Array.isArray(projected.keywords) &&
    sameStrings(projected.keywords, signed.keywords) &&
    Array.isArray(projected.releases) &&
    projected.releases.length > 0 &&
    projected.releases.length <= signed.releases.length
  )
}

function signedProjectionListing(
  signedListings: readonly MarketplacePluginListingV1[],
  projected: MarketplacePluginListingV1 | undefined,
  projectedIndex: number,
  startIndex: number
): readonly [MarketplacePluginListingV1, number] {
  if (!projected || typeof projected !== 'object' || Array.isArray(projected)) {
    throw new TypeError(`marketplaceListingProjection[${projectedIndex}] must be an object`)
  }
  for (let index = startIndex; index < signedListings.length; index++) {
    const signed = signedListings[index]
    if (signed.pluginId !== projected.pluginId) continue
    if (!preservesSignedMetadata(projected, signed)) {
      throw new TypeError('Marketplace listing projection must preserve signed metadata')
    }
    return [signed, index + 1]
  }
  throw new TypeError('Marketplace listing projection must be an ordered signed subset')
}

function canonicalProjectedReleases(
  signed: MarketplacePluginListingV1,
  projected: MarketplacePluginListingV1
): readonly MarketplacePluginListingV1['releases'][number][] {
  let signedIndex = 0
  const canonical: MarketplacePluginListingV1['releases'][number][] = []
  for (const projectedRelease of projected.releases) {
    if (!isRecordValue(projectedRelease)) {
      throw new TypeError('Marketplace listing projection release must be an object')
    }
    let release: MarketplacePluginListingV1['releases'][number] | undefined
    while (signedIndex < signed.releases.length) {
      const candidate = signed.releases[signedIndex++]
      if (sameRelease(candidate, projectedRelease)) {
        release = candidate
        break
      }
    }
    if (!release) {
      throw new TypeError('Marketplace listing releases must be an ordered signed subset')
    }
    canonical.push(Object.freeze({ ...release }))
  }
  return Object.freeze(canonical)
}

function canonicalListingProjection(
  signedListings: readonly MarketplacePluginListingV1[],
  projectedListings: readonly MarketplacePluginListingV1[]
): readonly MarketplacePluginListingV1[] {
  if (!Array.isArray(projectedListings) || projectedListings.length > signedListings.length) {
    throw new TypeError('Marketplace listing projection exceeds the signed snapshot')
  }

  let signedIndex = 0
  const canonical: MarketplacePluginListingV1[] = []
  for (let index = 0; index < projectedListings.length; index++) {
    const projected = projectedListings[index]
    const [signed, nextSignedIndex] = signedProjectionListing(
      signedListings,
      projected,
      index,
      signedIndex
    )
    signedIndex = nextSignedIndex
    canonical.push(
      Object.freeze({
        ...signed,
        categories: Object.freeze([...signed.categories]),
        keywords: Object.freeze([...signed.keywords]),
        releases: canonicalProjectedReleases(signed, projected)
      })
    )
  }
  return Object.freeze(canonical)
}

function searchMarketplaceListingEntries(
  listings: readonly MarketplacePluginListingV1[],
  options: MarketplaceListingSearchOptions = {}
): readonly MarketplacePluginListingV1[] {
  const query = normalizedQuery(options.query)
  const category = options.category
    ? marketplaceIdentity(options.category, 'marketplaceSearch.category')
    : undefined
  const channel = options.channel
    ? marketplaceChannel(options.channel, 'marketplaceSearch.channel')
    : undefined
  const ranked = listings
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

export function searchMarketplaceListings(
  verifiedValue: VerifiedMarketplaceSnapshot,
  options: MarketplaceListingSearchOptions = {}
): readonly MarketplacePluginListingV1[] {
  const verified = assertVerifiedMarketplaceSnapshot(verifiedValue)
  return searchMarketplaceListingEntries(verified.snapshot.listings, options)
}

export function searchVerifiedMarketplaceListingProjection(
  verifiedValue: VerifiedMarketplaceSnapshot,
  projectedListings: readonly MarketplacePluginListingV1[],
  options: MarketplaceListingSearchOptions = {}
): readonly MarketplacePluginListingV1[] {
  const verified = assertVerifiedMarketplaceSnapshot(verifiedValue)
  return searchMarketplaceListingEntries(
    canonicalListingProjection(verified.snapshot.listings, projectedListings),
    options
  )
}
