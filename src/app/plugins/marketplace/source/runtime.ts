import {
  assertVerifiedMarketplaceSnapshotCurrent,
  verifyMarketplaceCatalog,
  type VerifiedMarketplaceSnapshot
} from '@open-pencil/plugin-contracts'

import {
  createRemotePluginCatalogClient,
  remotePluginCatalogEntries,
  type RemotePluginCatalogLoadResult
} from '@/app/plugins/remote'
import type { RemotePluginCacheStorage } from '@/app/plugins/remote/cache'
import type { CreateRemotePluginTransportOptions } from '@/app/plugins/remote/transport'
import type { AppPluginMarketplaceTrustBundle } from '@/app/plugins/types'

import { createMarketplaceSnapshotClient, type MarketplaceSnapshotLoadResult } from '../client'
import type {
  MarketplaceSourceCandidate,
  MarketplaceSourceManagerSnapshot,
  MarketplaceSourcePrecommitContext,
  createMarketplaceSourceManager
} from './manager'

export interface MarketplaceSourceReview {
  stageId: string
  snapshotUrl: string
  marketplaceId: string
  channel: 'stable' | 'beta'
  rootKeyId: string
  rootFingerprint: string
  isRootRotation: boolean
  requiresStrictAdvance: boolean
  snapshotVersion: string
  snapshotSequence: number
  snapshotDigest: string
  expiresAt: string
  auditSequence: number
  auditHeadDigest: string
  listingCount: number
  catalogId: string
  catalogVersion: string
  catalogDigest: string
}

export interface CreateMarketplaceSourceRuntimeOptions {
  manager: ReturnType<typeof createMarketplaceSourceManager>
  cache: RemotePluginCacheStorage
  engineVersion: string
  transportOptions?: CreateRemotePluginTransportOptions
  onMarketplaceResult?: (result: MarketplaceSnapshotLoadResult | null) => void
  onCatalogResult?: (result: RemotePluginCatalogLoadResult | null) => void
}

interface LoadedCandidate {
  candidate: MarketplaceSourceCandidate
  marketplace: MarketplaceSnapshotLoadResult
  snapshot: VerifiedMarketplaceSnapshot
  catalog: RemotePluginCatalogLoadResult
  bundle: AppPluginMarketplaceTrustBundle
  review: MarketplaceSourceReview
}

function preparedMatchesActive(
  prepared: LoadedCandidate | null,
  active: MarketplaceSourceManagerSnapshot['active']
): prepared is LoadedCandidate {
  if (!prepared) return false
  if (!active) return false
  return (
    active.sourceId === prepared.candidate.authority.sourceId &&
    active.sourceGeneration === prepared.candidate.authority.sourceGeneration &&
    active.rootKeySpkiSha256 === prepared.candidate.authority.rootKeySpkiSha256 &&
    active.highWater?.snapshotSequence === prepared.snapshot.snapshot.sequence &&
    active.highWater.snapshotDigest === prepared.snapshot.verifiedDigest
  )
}

function marketplaceError(result: MarketplaceSnapshotLoadResult): Error {
  return result.refreshError ?? new Error('Marketplace snapshot is unavailable')
}

function catalogError(result: RemotePluginCatalogLoadResult): Error {
  return result.refreshError ?? new Error('Marketplace catalog is unavailable')
}

export function createMarketplaceSourceRuntime(options: CreateMarketplaceSourceRuntimeOptions) {
  let reviewed: LoadedCandidate | null = null
  let preparedActive: LoadedCandidate | null = null

  async function assertLoadedCurrentAt(
    loaded: LoadedCandidate,
    context: MarketplaceSourcePrecommitContext
  ): Promise<void> {
    if (
      context.candidate !== loaded.candidate ||
      context.snapshot.verifiedDigest !== loaded.snapshot.verifiedDigest
    ) {
      throw new Error('Marketplace snapshot authority changed after source review')
    }
    assertVerifiedMarketplaceSnapshotCurrent(context.snapshot, { now: context.effectiveNow })
    const loadedCatalog = loaded.catalog.catalog
    if (!loadedCatalog) throw new Error('Marketplace catalog is unavailable')
    const catalog = await verifyMarketplaceCatalog(loadedCatalog.catalog, {
      snapshot: context.snapshot,
      channel: loaded.candidate.config.channel,
      now: context.effectiveNow
    })
    if (catalog.catalog.verifiedDigest !== loadedCatalog.verifiedDigest) {
      throw new Error('Marketplace catalog authority changed after source verification')
    }
  }

  async function assertLoadedCurrent(loaded: LoadedCandidate): Promise<void> {
    const active = await options.manager.resolveActiveSource()
    if (!active || !preparedMatchesActive(loaded, options.manager.snapshot().active)) {
      throw new Error('Marketplace source authority changed after verification')
    }
    await assertLoadedCurrentAt(loaded, {
      candidate: loaded.candidate,
      snapshot: loaded.snapshot,
      effectiveNow: active.effectiveNow
    })
  }

  function commitLoadedCandidate(
    loaded: LoadedCandidate,
    confirmedRootFingerprint?: string
  ): Promise<MarketplaceSourceManagerSnapshot> {
    return options.manager.commitCandidate(
      loaded.candidate,
      loaded.snapshot,
      confirmedRootFingerprint,
      (context) => assertLoadedCurrentAt(loaded, context)
    )
  }

  async function loadCandidate(candidate: MarketplaceSourceCandidate): Promise<LoadedCandidate> {
    const marketplaceClient = createMarketplaceSnapshotClient({
      ...candidate.config,
      cache: options.cache,
      transportOptions: options.transportOptions,
      now: () => candidate.effectiveNow
    })
    const marketplace = await marketplaceClient.load()
    const snapshot = marketplace.snapshot
    if (!snapshot) throw marketplaceError(marketplace)
    const reference = snapshot.snapshot.catalogs.find(
      ({ channel }) => channel === candidate.config.channel
    )
    if (!reference) {
      throw new Error(`Marketplace ${candidate.config.channel} catalog is unavailable`)
    }
    const catalogClient = createRemotePluginCatalogClient({
      catalogUrl: reference.url,
      expectedCatalogId: reference.catalogId,
      expectedCatalogKeyId: reference.keyId,
      catalogPublicKey: candidate.config.rootPublicKey,
      publisherKeyring: snapshot.publisherKeyring,
      engineVersion: options.engineVersion,
      cache: options.cache,
      transportOptions: options.transportOptions,
      now: () => candidate.effectiveNow
    })
    const catalog = await catalogClient.load()
    if (!catalog.catalog) throw catalogError(catalog)
    const verifiedCatalog = await verifyMarketplaceCatalog(catalog.catalog.catalog, {
      snapshot,
      channel: candidate.config.channel,
      now: candidate.effectiveNow
    })
    if (verifiedCatalog.catalog.verifiedDigest !== catalog.catalog.verifiedDigest) {
      throw new Error('Marketplace catalog verification changed during source review')
    }
    const bundle: AppPluginMarketplaceTrustBundle = {
      catalog: remotePluginCatalogEntries(catalog),
      trustedKeyring: snapshot.publisherKeyring,
      lease: {
        authority: structuredClone(candidate.authority),
        marketplaceId: snapshot.snapshot.marketplaceId,
        snapshotVersion: snapshot.snapshot.version,
        snapshotSequence: snapshot.snapshot.sequence,
        snapshotDigest: snapshot.verifiedDigest,
        snapshotExpiresAt: snapshot.snapshot.expiresAt
      }
    }
    return {
      candidate,
      marketplace,
      snapshot,
      catalog,
      bundle,
      review: Object.freeze({
        stageId: candidate.stageId,
        snapshotUrl: candidate.config.snapshotUrl,
        marketplaceId: snapshot.snapshot.marketplaceId,
        channel: candidate.config.channel,
        rootKeyId: candidate.config.expectedKeyId,
        rootFingerprint: candidate.config.rootKeySpkiSha256,
        isRootRotation: candidate.requiresRootRotation,
        requiresStrictAdvance: candidate.requiresStrictAdvance,
        snapshotVersion: snapshot.snapshot.version,
        snapshotSequence: snapshot.snapshot.sequence,
        snapshotDigest: snapshot.verifiedDigest,
        expiresAt: snapshot.snapshot.expiresAt,
        auditSequence: snapshot.snapshot.auditHead.sequence,
        auditHeadDigest: snapshot.snapshot.auditHead.headDigest,
        listingCount: snapshot.snapshot.listings.length,
        catalogId: catalog.catalog.catalog.catalogId,
        catalogVersion: catalog.catalog.catalog.version,
        catalogDigest: catalog.catalog.verifiedDigest
      })
    }
  }

  async function reviewUserSource(value: unknown): Promise<MarketplaceSourceReview> {
    reviewed = null
    const staged = await options.manager.stageUserSource(value)
    const candidate = await options.manager.observeCandidateClock(staged)
    const loaded = await loadCandidate(candidate)
    reviewed = loaded
    return loaded.review
  }

  async function activateReviewedSource(
    stageId: string,
    confirmedRootFingerprint: string
  ): Promise<MarketplaceSourceManagerSnapshot> {
    const loaded = reviewed
    if (!loaded || loaded.candidate.stageId !== stageId) {
      throw new Error('Marketplace source review is missing or stale')
    }
    const snapshot = await commitLoadedCandidate(loaded, confirmedRootFingerprint)
    reviewed = null
    preparedActive = loaded
    return snapshot
  }

  async function activeCandidate(): Promise<MarketplaceSourceCandidate | null> {
    const pending = options.manager.pendingManagedSource()
    if (pending) return options.manager.observeCandidateClock(pending)
    await options.manager.checkpointActivePrivilegeClock()
    return options.manager.stageActiveSourceRefresh()
  }

  async function loadActiveTrustBundle(): Promise<AppPluginMarketplaceTrustBundle | undefined> {
    const prepared = preparedActive
    const active = options.manager.snapshot().active
    if (preparedMatchesActive(prepared, active)) {
      preparedActive = null
      await assertLoadedCurrent(prepared)
      options.onMarketplaceResult?.(prepared.marketplace)
      options.onCatalogResult?.(prepared.catalog)
      return prepared.bundle
    }
    preparedActive = null
    const candidate = await activeCandidate()
    if (!candidate) return undefined
    const loaded = await loadCandidate(candidate)
    await commitLoadedCandidate(loaded)
    await assertLoadedCurrent(loaded)
    options.onMarketplaceResult?.(loaded.marketplace)
    options.onCatalogResult?.(loaded.catalog)
    return loaded.bundle
  }

  function reset(): void {
    reviewed = null
    preparedActive = null
    options.onMarketplaceResult?.(null)
    options.onCatalogResult?.(null)
  }

  return {
    reviewUserSource,
    activateReviewedSource,
    loadActiveTrustBundle,
    reset
  }
}
