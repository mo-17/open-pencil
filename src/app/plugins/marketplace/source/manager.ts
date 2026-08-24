import {
  verifyMarketplaceSnapshot,
  type VerifiedMarketplaceSnapshot
} from '@open-pencil/plugin-contracts'

import {
  advanceMarketplaceSourceHighWater,
  canonicalizeMarketplaceSourceConfig,
  canonicalizeMarketplaceSourceConfigJSON,
  emptyMarketplaceSourceState,
  MARKETPLACE_SOURCE_LIMITS,
  marketplaceEffectiveNow,
  parseMarketplaceSourceStateJSON,
  resolveMarketplaceSourceRecord,
  type CanonicalMarketplaceSourceConfig,
  type MarketplaceSourceOrigin,
  type MarketplaceSourceRecordV1,
  type MarketplaceSourceStateV1,
  type MarketplaceSourceTrustHighWaterV1,
  type MarketplaceTrustDomainRecordV1
} from './contract'
import type { MarketplaceSourceStorage } from './storage'

export interface MarketplaceSourcePublicRecord {
  sourceId: string
  trustDomainId: string
  origin: MarketplaceSourceOrigin
  snapshotUrl: string
  expectedMarketplaceId: string
  channel: 'stable' | 'beta'
  rootKeyId: string
  rootKeySpkiSha256: string
  sourceGeneration: number
  highWater: MarketplaceSourceTrustHighWaterV1 | null
}

export interface MarketplaceSourceManagerSnapshot {
  ready: boolean
  configured: boolean
  origin: MarketplaceSourceOrigin | 'none'
  editable: boolean
  active: MarketplaceSourcePublicRecord | null
  error: Error | null
}

export interface MarketplaceSourceAuthority {
  sourceId: string
  trustDomainId: string
  sourceGeneration: number
  rootKeySpkiSha256: string
}

export interface ResolvedMarketplaceSource {
  authority: MarketplaceSourceAuthority
  origin: MarketplaceSourceOrigin
  config: CanonicalMarketplaceSourceConfig
  effectiveNow: number
}

export interface MarketplaceSourceCandidate extends ResolvedMarketplaceSource {
  stageId: string
  baseRevision: number
  previousSourceId: string | null
  previousRootFingerprint: string | null
  requiresRootRotation: boolean
  requiresStrictAdvance: boolean
  requiresFingerprintConfirmation: boolean
}

export interface MarketplaceSourcePrecommitContext {
  candidate: MarketplaceSourceCandidate
  snapshot: VerifiedMarketplaceSnapshot
  effectiveNow: number
}

export type MarketplaceSourcePrecommitValidator = (
  context: MarketplaceSourcePrecommitContext
) => void | Promise<void>

export interface CreateMarketplaceSourceManagerOptions {
  storage: MarketplaceSourceStorage
  managedConfigJSON?: string
  now?: () => number
  idFactory?: (kind: 'source' | 'trust-domain' | 'stage') => string
}

type Listener = (snapshot: MarketplaceSourceManagerSnapshot) => void

function defaultIdFactory(kind: 'source' | 'trust-domain' | 'stage'): string {
  return `${kind}:${crypto.randomUUID()}`
}

function errorOf(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function publicError(value: Error | null): Error | null {
  return value ? new Error(value.message, { cause: value.cause }) : null
}

function publicRecord(
  source: MarketplaceSourceRecordV1,
  domain: MarketplaceTrustDomainRecordV1
): MarketplaceSourcePublicRecord {
  return Object.freeze({
    sourceId: source.sourceId,
    trustDomainId: source.trustDomainId,
    origin: source.origin,
    snapshotUrl: source.normalizedSnapshotURL,
    expectedMarketplaceId: source.expectedMarketplaceId,
    channel: source.channel,
    rootKeyId: source.rootKeyId,
    rootKeySpkiSha256: source.rootKeySpkiSha256,
    sourceGeneration: source.sourceGeneration,
    highWater: domain.highWater ? structuredClone(domain.highWater) : null
  })
}

function activeSource(
  state: MarketplaceSourceStateV1,
  managedConfigured: boolean
): MarketplaceSourceRecordV1 | null {
  const sourceId = managedConfigured ? state.managedSourceId : state.activeUserSourceId
  return state.sources.find((source) => source.sourceId === sourceId) ?? null
}

function domainFor(
  state: MarketplaceSourceStateV1,
  source: MarketplaceSourceRecordV1
): MarketplaceTrustDomainRecordV1 {
  const domain = state.trustDomains.find(
    ({ trustDomainId }) => trustDomainId === source.trustDomainId
  )
  if (!domain) throw new Error(`Marketplace trust domain is missing: ${source.trustDomainId}`)
  return domain
}

function sameSource(
  source: MarketplaceSourceRecordV1,
  origin: MarketplaceSourceOrigin,
  config: CanonicalMarketplaceSourceConfig
): boolean {
  return (
    source.origin === origin &&
    source.normalizedSnapshotURL === config.snapshotUrl &&
    source.expectedMarketplaceId === config.expectedMarketplaceId &&
    source.channel === config.channel &&
    source.rootKeyId === config.expectedKeyId &&
    source.rootKeySpkiSha256 === config.rootKeySpkiSha256
  )
}

function sameHighWater(
  left: MarketplaceSourceTrustHighWaterV1 | null,
  right: MarketplaceSourceTrustHighWaterV1
): boolean {
  return Boolean(
    left &&
    left.snapshotSequence === right.snapshotSequence &&
    left.snapshotVersion === right.snapshotVersion &&
    left.snapshotDigest === right.snapshotDigest &&
    left.auditSequence === right.auditSequence &&
    left.auditHeadDigest === right.auditHeadDigest
  )
}

function stateJSON(state: MarketplaceSourceStateV1): string {
  return JSON.stringify(state)
}

function committedSource(
  candidate: MarketplaceSourceCandidate,
  acceptedAt: string,
  previous: MarketplaceSourceRecordV1 | undefined
): MarketplaceSourceRecordV1 {
  const sameRootPredecessor =
    previous?.rootKeySpkiSha256 === candidate.config.rootKeySpkiSha256 ? previous : undefined
  return {
    schemaVersion: 1,
    sourceId: candidate.authority.sourceId,
    trustDomainId: candidate.authority.trustDomainId,
    origin: candidate.origin,
    normalizedSnapshotURL: candidate.config.snapshotUrl,
    expectedMarketplaceId: candidate.config.expectedMarketplaceId,
    channel: candidate.config.channel,
    rootKeyId: candidate.config.expectedKeyId,
    rootKeySpkiSha256: candidate.config.rootKeySpkiSha256,
    rootPublicKeyPem: candidate.config.rootPublicKeyPem,
    sourceGeneration: candidate.authority.sourceGeneration,
    predecessorRootFingerprint: candidate.requiresRootRotation
      ? candidate.previousRootFingerprint
      : (sameRootPredecessor?.predecessorRootFingerprint ?? null),
    rotationAt: candidate.requiresRootRotation
      ? acceptedAt
      : (sameRootPredecessor?.rotationAt ?? null)
  }
}

function committedDomain(
  candidate: MarketplaceSourceCandidate,
  previous: MarketplaceTrustDomainRecordV1 | undefined,
  highWater: MarketplaceSourceTrustHighWaterV1
): MarketplaceTrustDomainRecordV1 {
  return {
    schemaVersion: 1,
    trustDomainId: candidate.authority.trustDomainId,
    expectedMarketplaceId: candidate.config.expectedMarketplaceId,
    currentRootFingerprint: candidate.config.rootKeySpkiSha256,
    retiredRootFingerprints:
      candidate.requiresRootRotation && previous
        ? [...previous.retiredRootFingerprints, previous.currentRootFingerprint]
        : (previous?.retiredRootFingerprints ?? []),
    highWater
  }
}

function upsertSource(
  values: readonly MarketplaceSourceRecordV1[],
  next: MarketplaceSourceRecordV1
): readonly MarketplaceSourceRecordV1[] {
  return values.some(({ sourceId }) => sourceId === next.sourceId)
    ? values.map((value) => (value.sourceId === next.sourceId ? next : value))
    : [...values, next]
}

function upsertDomain(
  values: readonly MarketplaceTrustDomainRecordV1[],
  next: MarketplaceTrustDomainRecordV1
): readonly MarketplaceTrustDomainRecordV1[] {
  return values.some(({ trustDomainId }) => trustDomainId === next.trustDomainId)
    ? values.map((value) => (value.trustDomainId === next.trustDomainId ? next : value))
    : [...values, next]
}

function committedState(
  state: MarketplaceSourceStateV1,
  candidate: MarketplaceSourceCandidate,
  source: MarketplaceSourceRecordV1,
  domain: MarketplaceTrustDomainRecordV1
): MarketplaceSourceStateV1 {
  const switching = candidate.previousSourceId !== source.sourceId
  return {
    ...state,
    activeUserSourceId: candidate.origin === 'user' ? source.sourceId : state.activeUserSourceId,
    managedSourceId: candidate.origin === 'managed' ? source.sourceId : state.managedSourceId,
    nextGeneration: switching ? state.nextGeneration + 1 : state.nextGeneration,
    sources: upsertSource(state.sources, source),
    trustDomains: upsertDomain(state.trustDomains, domain)
  }
}

function rootRotationRequirement(
  domain: MarketplaceTrustDomainRecordV1 | undefined,
  nextFingerprint: string
): { previous: string | null; required: boolean } {
  if (domain?.retiredRootFingerprints.includes(nextFingerprint)) {
    throw new Error('Marketplace source cannot restore a retired root key')
  }
  const previous = domain?.currentRootFingerprint ?? null
  const required = previous !== null && previous !== nextFingerprint
  if (
    required &&
    domain &&
    domain.retiredRootFingerprints.length >= MARKETPLACE_SOURCE_LIMITS.maxRetiredRoots
  ) {
    throw new Error('Marketplace root lineage history is full')
  }
  return { previous, required }
}

function currentRootSource(
  state: MarketplaceSourceStateV1,
  domain: MarketplaceTrustDomainRecordV1 | undefined
): MarketplaceSourceRecordV1 | undefined {
  if (!domain) return undefined
  return state.sources
    .filter(
      (source) =>
        source.trustDomainId === domain.trustDomainId &&
        source.rootKeySpkiSha256 === domain.currentRootFingerprint
    )
    .sort((left, right) => right.sourceGeneration - left.sourceGeneration)[0]
}

export function createMarketplaceSourceManager(options: CreateMarketplaceSourceManagerOptions) {
  const now = options.now ?? Date.now
  const idFactory = options.idFactory ?? defaultIdFactory
  const managedConfigured = options.managedConfigJSON !== undefined
  const managedConfigJSON = options.managedConfigJSON ?? ''
  const listeners = new Set<Listener>()
  const issuedCandidates = new WeakSet<object>()
  let state = emptyMarketplaceSourceState()
  let ready = false
  let fatalError: Error | null = null
  let revision = 0
  let persistedValue: string | null = null
  let activeMutation: Promise<unknown> = Promise.resolve()
  let managedCandidate: MarketplaceSourceCandidate | null = null

  function snapshot(): MarketplaceSourceManagerSnapshot {
    const source =
      fatalError || (managedConfigured && managedCandidate)
        ? null
        : activeSource(state, managedConfigured)
    const domain = source ? domainFor(state, source) : null
    const origin = managedConfigured ? 'managed' : (source?.origin ?? 'none')
    return Object.freeze({
      ready,
      configured: managedConfigured || Boolean(source),
      origin,
      editable: !managedConfigured,
      active: source && domain ? publicRecord(source, domain) : null,
      error: publicError(fatalError)
    })
  }

  function notify(): void {
    const next = snapshot()
    for (const listener of listeners) listener(next)
  }

  function runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = activeMutation.then(operation, operation)
    activeMutation = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async function persist(next: MarketplaceSourceStateV1): Promise<void> {
    const json = stateJSON(next)
    const validated = await parseMarketplaceSourceStateJSON(json)
    if (!(await options.storage.compareAndSwap(persistedValue, json))) {
      fatalError = new Error(
        'Marketplace source settings changed in another window; reload before continuing'
      )
      revision++
      notify()
      throw fatalError
    }
    persistedValue = json
    state = validated
    revision++
    fatalError = null
    notify()
  }

  async function assertPersistedStateCurrent(): Promise<void> {
    if (
      persistedValue === null
        ? (await options.storage.read()) === null
        : await options.storage.compareAndSwap(persistedValue, persistedValue)
    ) {
      return
    }
    fatalError = new Error(
      'Marketplace source settings changed in another window; reload before continuing'
    )
    revision++
    notify()
    throw fatalError
  }

  function findDomain(config: CanonicalMarketplaceSourceConfig) {
    return state.trustDomains.find(
      ({ expectedMarketplaceId }) => expectedMarketplaceId === config.expectedMarketplaceId
    )
  }

  function requireReady(): void {
    if (!ready || fatalError) {
      throw fatalError ?? new Error('Marketplace source manager is not ready')
    }
  }

  function resolvedActiveSource(): MarketplaceSourceRecordV1 | null {
    requireReady()
    return managedConfigured && managedCandidate ? null : activeSource(state, managedConfigured)
  }

  async function persistDomainWallClock(
    domain: MarketplaceTrustDomainRecordV1,
    effectiveNow: number
  ): Promise<void> {
    if (!domain.highWater) throw new Error('Marketplace trust clock is unavailable')
    const nextDomain = {
      ...domain,
      highWater: {
        ...domain.highWater,
        lastSeenWallTime: new Date(effectiveNow).toISOString()
      }
    }
    await persist({
      ...state,
      trustDomains: state.trustDomains.map((entry) =>
        entry.trustDomainId === nextDomain.trustDomainId ? nextDomain : entry
      )
    })
  }

  function candidateFor(
    origin: MarketplaceSourceOrigin,
    config: CanonicalMarketplaceSourceConfig
  ): MarketplaceSourceCandidate {
    const immutableConfig = Object.freeze({ ...config })
    const current = activeSource(state, managedConfigured)
    const existing = state.sources.find((source) => sameSource(source, origin, immutableConfig))
    const domain = findDomain(immutableConfig)
    const trustDomainId = domain?.trustDomainId ?? idFactory('trust-domain')
    const sourceId = existing?.sourceId ?? idFactory('source')
    const switching = current?.sourceId !== sourceId
    const sourceGeneration = switching ? state.nextGeneration : (existing?.sourceGeneration ?? 1)
    const rotation = rootRotationRequirement(domain, immutableConfig.rootKeySpkiSha256)
    const trustedRoot = currentRootSource(state, domain)
    if (rotation.required && trustedRoot?.rootKeyId === immutableConfig.expectedKeyId) {
      throw new Error('Marketplace root rotation must use a new root key id')
    }
    const candidate = Object.freeze({
      stageId: idFactory('stage'),
      baseRevision: revision,
      previousSourceId: current?.sourceId ?? null,
      previousRootFingerprint: rotation.previous,
      requiresRootRotation: rotation.required,
      requiresStrictAdvance: Boolean(domain?.highWater) && (switching || rotation.required),
      requiresFingerprintConfirmation: origin === 'user' && switching,
      authority: Object.freeze({
        sourceId,
        trustDomainId,
        sourceGeneration,
        rootKeySpkiSha256: immutableConfig.rootKeySpkiSha256
      }),
      origin,
      config: immutableConfig,
      effectiveNow: marketplaceEffectiveNow(domain?.highWater ?? null, now())
    })
    issuedCandidates.add(candidate)
    return candidate
  }

  async function load(): Promise<MarketplaceSourceManagerSnapshot> {
    return runMutation(async () => {
      try {
        const stored = await options.storage.read()
        persistedValue = stored
        state =
          stored === null
            ? emptyMarketplaceSourceState()
            : await parseMarketplaceSourceStateJSON(stored)
        fatalError = null
        revision++
        if (managedConfigured) {
          const config = await canonicalizeMarketplaceSourceConfigJSON(managedConfigJSON)
          const committed = state.sources.find((source) => sameSource(source, 'managed', config))
          if (committed?.sourceId === state.managedSourceId) {
            managedCandidate = null
          } else {
            managedCandidate = candidateFor('managed', config)
          }
        } else {
          managedCandidate = null
        }
      } catch (cause) {
        fatalError = errorOf(cause)
        managedCandidate = null
      }
      ready = true
      notify()
      return snapshot()
    })
  }

  async function stageUserSource(value: unknown): Promise<MarketplaceSourceCandidate> {
    return runMutation(async () => {
      if (!ready) throw new Error('Marketplace source manager is not ready')
      if (fatalError) throw fatalError
      if (managedConfigured)
        throw new Error('Marketplace source is locked by managed configuration')
      return candidateFor('user', await canonicalizeMarketplaceSourceConfig(value))
    })
  }

  function pendingManagedSource(): MarketplaceSourceCandidate | null {
    return managedCandidate
  }

  function assertCandidateCommitAuthority(
    candidate: MarketplaceSourceCandidate,
    confirmedRootFingerprint: string | undefined
  ): void {
    if (!issuedCandidates.has(candidate)) {
      throw new Error('Marketplace source candidate was not issued by this manager')
    }
    if (candidate.baseRevision !== revision)
      throw new Error('Marketplace source candidate is stale')
    if (candidate.origin === 'managed') {
      if (!managedConfigured || managedCandidate?.stageId !== candidate.stageId) {
        throw new Error('Managed marketplace source candidate is stale')
      }
      return
    }
    if (managedConfigured) throw new Error('Marketplace source is locked by managed configuration')
    if (
      candidate.requiresFingerprintConfirmation &&
      confirmedRootFingerprint !== candidate.config.rootKeySpkiSha256
    ) {
      throw new Error('Marketplace root key fingerprint confirmation does not match')
    }
  }

  async function commitCandidate(
    candidate: MarketplaceSourceCandidate,
    verifiedValue: VerifiedMarketplaceSnapshot,
    confirmedRootFingerprint?: string,
    validateBeforePersist?: MarketplaceSourcePrecommitValidator
  ): Promise<MarketplaceSourceManagerSnapshot> {
    return runMutation(async () => {
      if (!ready || fatalError)
        throw fatalError ?? new Error('Marketplace source manager is not ready')
      assertCandidateCommitAuthority(candidate, confirmedRootFingerprint)
      const domain = findDomain(candidate.config)
      const effectiveNow = marketplaceEffectiveNow(domain?.highWater ?? null, now())
      const acceptedAt = new Date(effectiveNow).toISOString()
      const verified = await verifyMarketplaceSnapshot(
        verifiedValue.snapshot,
        candidate.config.rootPublicKey,
        {
          expectedMarketplaceId: candidate.config.expectedMarketplaceId,
          expectedKeyId: candidate.config.expectedKeyId,
          now: acceptedAt
        }
      )
      await validateBeforePersist?.(Object.freeze({ candidate, snapshot: verified, effectiveNow }))
      const nextHighWater = advanceMarketplaceSourceHighWater(
        domain?.highWater ?? null,
        verified,
        acceptedAt
      )
      if (
        candidate.requiresStrictAdvance &&
        sameHighWater(domain?.highWater ?? null, nextHighWater)
      ) {
        throw new Error('Marketplace source replacement requires a strictly advancing snapshot')
      }
      const previousSource = state.sources.find(
        ({ sourceId }) => sourceId === candidate.authority.sourceId
      )
      const nextSource = committedSource(candidate, acceptedAt, previousSource)
      const nextDomain = committedDomain(candidate, domain, nextHighWater)
      await persist(committedState(state, candidate, nextSource, nextDomain))
      if (candidate.origin === 'managed') {
        managedCandidate = null
        notify()
      }
      return snapshot()
    })
  }

  async function clearUserSource(): Promise<MarketplaceSourceManagerSnapshot> {
    return runMutation(async () => {
      if (!ready || fatalError)
        throw fatalError ?? new Error('Marketplace source manager is not ready')
      if (managedConfigured) throw new Error('Managed marketplace source cannot be removed')
      if (state.activeUserSourceId === null) return snapshot()
      await persist({ ...state, activeUserSourceId: null })
      return snapshot()
    })
  }

  async function stageActiveSourceRefresh(): Promise<MarketplaceSourceCandidate | null> {
    return runMutation(async () => {
      const source = resolvedActiveSource()
      if (!source) return null
      const resolved = await resolveMarketplaceSourceRecord(source)
      return candidateFor(source.origin, {
        ...resolved,
        rootPublicKeyPem: source.rootPublicKeyPem,
        rootKeySpkiSha256: source.rootKeySpkiSha256
      })
    })
  }

  /**
   * Durably raises the active trust domain's wall-clock floor before a publisher
   * privilege boundary is crossed. Persistence uses the source state's CAS so a
   * stale process cannot lower a checkpoint written by another process.
   */
  async function checkpointActivePrivilegeClock(): Promise<number> {
    return runMutation(async () => {
      const source = resolvedActiveSource()
      if (!source) {
        await assertPersistedStateCurrent()
        return now()
      }
      const domain = domainFor(state, source)
      const effectiveNow = marketplaceEffectiveNow(domain.highWater, now())
      if (!domain.highWater || effectiveNow === Date.parse(domain.highWater.lastSeenWallTime)) {
        await assertPersistedStateCurrent()
        return effectiveNow
      }
      await persistDomainWallClock(domain, effectiveNow)
      return effectiveNow
    })
  }

  async function observeCandidateClock(
    candidate: MarketplaceSourceCandidate
  ): Promise<MarketplaceSourceCandidate> {
    return runMutation(async () => {
      requireReady()
      if (!issuedCandidates.has(candidate))
        throw new Error('Marketplace source candidate was not issued by this manager')
      if (candidate.baseRevision !== revision)
        throw new Error('Marketplace source candidate is stale')
      const domain = findDomain(candidate.config)
      const effectiveNow = marketplaceEffectiveNow(domain?.highWater ?? null, now())
      if (domain?.highWater && effectiveNow > Date.parse(domain.highWater.lastSeenWallTime)) {
        await persistDomainWallClock(domain, effectiveNow)
      }
      const refreshed = candidateFor(candidate.origin, candidate.config)
      if (candidate.origin === 'managed') managedCandidate = refreshed
      return refreshed
    })
  }

  async function resolveActiveSource(): Promise<ResolvedMarketplaceSource | null> {
    return runMutation(async () => {
      const source = resolvedActiveSource()
      if (!source) return null
      const domain = domainFor(state, source)
      const config = await resolveMarketplaceSourceRecord(source)
      return Object.freeze({
        authority: Object.freeze({
          sourceId: source.sourceId,
          trustDomainId: source.trustDomainId,
          sourceGeneration: source.sourceGeneration,
          rootKeySpkiSha256: source.rootKeySpkiSha256
        }),
        origin: source.origin,
        config: Object.freeze({
          ...config,
          rootPublicKeyPem: source.rootPublicKeyPem,
          rootKeySpkiSha256: source.rootKeySpkiSha256
        }),
        effectiveNow: marketplaceEffectiveNow(domain.highWater, now())
      })
    })
  }

  return {
    snapshot,
    load,
    stageUserSource,
    stageActiveSourceRefresh,
    pendingManagedSource,
    commitCandidate,
    clearUserSource,
    checkpointActivePrivilegeClock,
    observeCandidateClock,
    resolveActiveSource,
    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
