import type { MarketplacePublisherKeyV1, MarketplaceStateV1 } from '../types'

export function findActiveMarketplacePublisherKey(
  state: MarketplaceStateV1,
  publisherId: string,
  keyId: string,
  at: number
): MarketplacePublisherKeyV1 | null {
  const key = state.publisherKeys.find(
    (candidate) => candidate.publisherId === publisherId && candidate.keyId === keyId
  )
  if (
    key?.status !== 'active' ||
    at < Date.parse(key.notBefore) ||
    at >= Date.parse(key.notAfter)
  ) {
    return null
  }
  return key
}
