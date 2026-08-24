import { sameAppPluginMarketplaceAuthority, type ResolvedPluginPackage } from './types'

export type ReviewedInstalledPublisherAuthority = Readonly<{
  version: string
  digest: string
  keyId: string
}>

function sameRemoteCatalog(
  left: ResolvedPluginPackage['remoteCatalog'],
  right: ResolvedPluginPackage['remoteCatalog']
): boolean {
  if (!left || !right) return left === right
  return (
    left.catalogId === right.catalogId &&
    left.catalogVersion === right.catalogVersion &&
    left.catalogDigest === right.catalogDigest &&
    left.catalogExpiresAt === right.catalogExpiresAt &&
    left.source === right.source
  )
}

/**
 * Compares the complete publisher authority that an install/update review displays.
 * Callers must still perform this comparison inside the store mutation queue.
 */
export function sameReviewedPublisherPackage(
  left: ResolvedPluginPackage,
  right: ResolvedPluginPackage
): boolean {
  return (
    left.trustSource === 'publisher-signature' &&
    right.trustSource === 'publisher-signature' &&
    left.verifiedPackage !== undefined &&
    right.verifiedPackage !== undefined &&
    left.manifest.plugin.id === right.manifest.plugin.id &&
    left.manifest.plugin.version === right.manifest.plugin.version &&
    left.manifest.publisher.id === right.manifest.publisher.id &&
    left.manifest.publisher.keyId === right.manifest.publisher.keyId &&
    left.digest === right.digest &&
    left.verifiedPackage.verifiedDigest === left.digest &&
    right.verifiedPackage.verifiedDigest === right.digest &&
    left.verifiedPackage.verifiedKeyId === left.manifest.publisher.keyId &&
    right.verifiedPackage.verifiedKeyId === right.manifest.publisher.keyId &&
    left.verifiedPackage.verifiedKeyId === right.verifiedPackage.verifiedKeyId &&
    sameRemoteCatalog(left.remoteCatalog, right.remoteCatalog) &&
    sameAppPluginMarketplaceAuthority(left.marketplaceAuthority, right.marketplaceAuthority)
  )
}

export function sameReviewedInstalledPublisherAuthority(
  expected: ReviewedInstalledPublisherAuthority,
  installed: ResolvedPluginPackage
): boolean {
  const verified = installed.verifiedPackage
  return (
    installed.trustSource === 'publisher-signature' &&
    verified !== undefined &&
    installed.manifest.plugin.version === expected.version &&
    installed.digest === expected.digest &&
    verified.verifiedDigest === expected.digest &&
    installed.manifest.publisher.keyId === expected.keyId &&
    verified.verifiedKeyId === expected.keyId
  )
}
