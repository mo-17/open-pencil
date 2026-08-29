/* eslint-disable max-lines -- Root request, signer, import, emergency, and crash-recovery invariants form one end-to-end ceremony. */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  assertMarketplacePublicationRequestState,
  createMarketplaceOfflineSignerPolicy,
  createMarketplacePublicationRequest,
  createMarketplaceService,
  createMarketplaceSignedPublicationBundle,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceOfflineSignerPolicyStore,
  createMemoryMarketplaceRepository,
  importMarketplaceSignedPublicationBundle,
  loadMarketplacePreviousPublicationEvidence,
  marketplaceAuditEventHash,
  marketplacePublicationRequestDigest,
  marketplacePublicationRequestBytes,
  marketplacePublicationReservationFromRequest,
  marketplacePublicationStateDigest,
  marketplaceSignedPublicationBundleDigest,
  parseMarketplaceSignedPublicationBundleJSON,
  prepareMarketplacePublication,
  prepareMarketplacePublicationProjection,
  serializeMarketplacePublicationRequest,
  serializeMarketplaceSignedPublicationBundle,
  signMarketplacePublicationRequest,
  verifyMarketplacePublicationRequestEvidence,
  verifyMarketplacePreviousPublicationEvidence,
  type MarketplaceArtifactStore,
  type MarketplaceMutationContext,
  type MarketplaceOfflineSignerPolicyStore,
  type MarketplacePreviousPublicationEvidence,
  type MarketplacePublicationProjectionV1,
  type MarketplacePublicationReservationRepository,
  type MarketplaceStateV1,
  type OfflineMarketplacePublication,
  type PreparedMarketplacePublication
} from '@open-pencil/marketplace'
import { signPluginManifest } from '@open-pencil/plugin-contracts'
import { canonicalManifestJSON, exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import { pluginPayload } from '#tests/engine/plugins/helpers'

const MARKETPLACE_ID = 'offline-marketplace'
const ROOT_KEY_ID = 'offline-root-2026'
const PUBLIC_BASE_URL = 'https://plugins.example.com/'
const BASELINE_GENERATED_AT = '2026-08-10T00:00:00.000Z'
const BASELINE_EXPIRES_AT = '2026-08-11T00:00:00.000Z'
const PLAN_GENERATED_AT = '2026-08-12T00:00:00.000Z'
const PLAN_EXPIRES_AT = '2026-08-13T00:00:00.000Z'
const FORK_GENERATED_AT = '2026-08-12T01:00:00.000Z'
const FORK_EXPIRES_AT = '2026-08-13T01:00:00.000Z'
const RECOVERY_GENERATED_AT = '2026-08-14T00:00:00.000Z'
const RECOVERY_EXPIRES_AT = '2026-08-15T00:00:00.000Z'
const AFTER_RECOVERY_GENERATED_AT = '2026-08-16T00:00:00.000Z'
const AFTER_RECOVERY_EXPIRES_AT = '2026-08-17T00:00:00.000Z'
const RELEASE_TIME = '2026-08-05T00:00:00.000Z'
const EMERGENCY_REVOCATION_TIME = '2026-08-11T00:00:00.000Z'

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('base64url')
}

function context(time: string, reason?: string): MarketplaceMutationContext {
  return { actor: 'offline-test', time, ...(reason ? { reason } : {}) }
}

function projectionConfig(generatedAt: string, expiresAt: string) {
  return {
    marketplaceId: MARKETPLACE_ID,
    rootKeyId: ROOT_KEY_ID,
    publicBaseUrl: PUBLIC_BASE_URL,
    now: () => new Date(generatedAt),
    validityMilliseconds: Date.parse(expiresAt) - Date.parse(generatedAt)
  }
}

async function createUnpublishedFixture(options: { withRelease?: boolean } = {}) {
  const [rootKeyPair, publisherKeyPair] = await Promise.all([
    crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']),
    crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  ])
  const publisherPublicKeyPem = await exportEd25519PublicKeyPem(publisherKeyPair.publicKey)
  const repository = createMemoryMarketplaceRepository()
  const artifacts = createMemoryMarketplaceArtifactStore()
  await repository.transaction(async (transaction) => {
    await transaction.createPublisher(
      { id: 'acme', displayName: 'Acme Plugins' },
      context('2026-01-01T00:00:00.000Z')
    )
    await transaction.registerPublisherKey(
      {
        keyId: 'acme.release.1',
        publisherId: 'acme',
        publicKeyPem: publisherPublicKeyPem,
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2027-01-01T00:00:00.000Z'
      },
      context('2026-01-01T00:00:01.000Z')
    )
    await transaction.transitionPublisherKey(
      'acme.release.1',
      'active',
      context('2026-01-01T00:00:02.000Z')
    )
    await transaction.transitionPublisher('acme', 'active', context('2026-01-01T00:00:03.000Z'))
    await transaction.requestOwnership(
      { pluginId: 'acme.widget', publisherId: 'acme' },
      context('2026-01-01T00:00:04.000Z')
    )
    await transaction.transitionOwnership(
      'acme.widget',
      'active',
      context('2026-02-01T00:00:00.000Z')
    )
  })

  let releaseArtifactDigest: string | null = null
  if (options.withRelease) {
    const service = createMarketplaceService({
      repository,
      artifacts,
      marketplaceId: MARKETPLACE_ID,
      publicBaseUrl: PUBLIC_BASE_URL,
      now: () => new Date(RELEASE_TIME)
    })
    const payload = pluginPayload()
    const manifest = await signPluginManifest(
      {
        ...payload,
        plugin: { ...payload.plugin, id: 'acme.widget', name: 'Acme Widget' },
        publisher: {
          ...payload.publisher,
          id: 'acme',
          name: 'Acme Plugins',
          keyId: 'acme.release.1'
        }
      },
      publisherKeyPair.privateKey
    )
    const submission = await service.submit(
      {
        id: 'acme-widget-1',
        publisherId: 'acme',
        channel: 'stable',
        manifest,
        listing: {
          displayName: 'Acme Widget',
          summary: 'A signed release used to verify offline artifact closure.',
          description:
            'The importer must possess this release artifact before committing Root output.',
          categories: ['widgets'],
          iconUrl: null,
          homepageUrl: null
        }
      },
      context(RELEASE_TIME)
    )
    await service.transitionSubmission(submission.id, 'approved', context(RELEASE_TIME))
    await service.publishSubmission(submission.id, context(RELEASE_TIME))
    releaseArtifactDigest = submission.artifactDigest
  }

  const state = await repository.snapshot()
  const plan = await prepareMarketplacePublicationProjection(
    state,
    artifacts,
    projectionConfig(BASELINE_GENERATED_AT, BASELINE_EXPIRES_AT)
  )
  const policy = await createMarketplaceOfflineSignerPolicy({
    marketplaceId: MARKETPLACE_ID,
    rootKeyId: ROOT_KEY_ID,
    publicBaseUrl: PUBLIC_BASE_URL,
    rootPublicKey: rootKeyPair.publicKey,
    bootstrapState: state
  })
  const policyStore = createMemoryMarketplaceOfflineSignerPolicyStore(policy)
  return {
    rootKeyPair,
    publisherKeyPair,
    publisherPublicKeyPem,
    repository,
    artifacts,
    policyStore,
    releaseArtifactDigest,
    state,
    plan
  }
}

function publicationRequest(
  state: MarketplaceStateV1,
  baseline: MarketplacePublicationProjectionV1 | null,
  plan: MarketplacePublicationProjectionV1,
  purpose: 'routine' | 'emergency-revocation' | 'revocation-recovery' = 'routine'
) {
  return createMarketplacePublicationRequest({
    state,
    purpose,
    marketplaceId: MARKETPLACE_ID,
    rootKeyId: ROOT_KEY_ID,
    publicBaseUrl: PUBLIC_BASE_URL,
    baseline,
    plan
  })
}

async function reservePublication(
  repository: MarketplacePublicationReservationRepository,
  request: unknown
): Promise<void> {
  await repository.reservePublication(marketplacePublicationReservationFromRequest(request))
}

function exactEvidence(
  publication: OfflineMarketplacePublication
): MarketplacePreviousPublicationEvidence {
  return {
    snapshot: { bytes: new Uint8Array(publication.snapshot.bytes) },
    catalogs: publication.catalogs.map(({ channel, bytes }) => ({
      channel,
      bytes: new Uint8Array(bytes)
    })),
    runtimeIndex: publication.runtimeIndex
      ? { bytes: new Uint8Array(publication.runtimeIndex.bytes) }
      : null
  }
}

async function continuationFixture(options: { withRelease?: boolean } = {}) {
  const fixture = await createUnpublishedFixture(options)
  const initialRequest = publicationRequest(fixture.state, null, fixture.plan)
  await reservePublication(fixture.repository, initialRequest)
  const initialSigned = await signMarketplacePublicationRequest({
    requestBytes: marketplacePublicationRequestBytes(initialRequest),
    state: fixture.state,
    previousPublication: null,
    rootPublicKey: fixture.rootKeyPair.publicKey,
    rootPrivateKey: fixture.rootKeyPair.privateKey,
    artifacts: fixture.artifacts,
    policyStore: fixture.policyStore,
    now: () => Date.parse(BASELINE_GENERATED_AT)
  })
  await importMarketplaceSignedPublicationBundle({
    bundle: createMarketplaceSignedPublicationBundle(initialSigned),
    repository: fixture.repository,
    artifacts: fixture.artifacts,
    rootPublicKey: fixture.rootKeyPair.publicKey,
    actor: 'offline-test',
    now: () => Date.parse(BASELINE_GENERATED_AT)
  })

  const state = await fixture.repository.snapshot()
  const plan = await prepareMarketplacePublicationProjection(
    state,
    fixture.artifacts,
    projectionConfig(PLAN_GENERATED_AT, PLAN_EXPIRES_AT)
  )
  return {
    ...fixture,
    state,
    baseline: fixture.plan,
    plan,
    previousPublication: exactEvidence(initialSigned)
  }
}

function withPublisherName(
  plan: MarketplacePublicationProjectionV1,
  name: string
): MarketplacePublicationProjectionV1 {
  return {
    ...plan,
    snapshot: {
      ...plan.snapshot,
      publisherDirectory: {
        ...plan.snapshot.publisherDirectory,
        publishers: plan.snapshot.publisherDirectory.publishers.map((publisher) => ({
          ...publisher,
          name
        }))
      }
    }
  }
}

function unsignedProjection(
  prepared: PreparedMarketplacePublication
): MarketplacePublicationProjectionV1 {
  const catalogs = prepared.catalogs.map(({ channel, catalog: signedCatalog }) => {
    const { integrity, ...catalog } = signedCatalog
    void integrity
    return { channel, catalog }
  })
  let runtimeIndex: MarketplacePublicationProjectionV1['runtimeIndex'] = null
  if (prepared.runtimeIndex) {
    const { integrity, ...payload } = prepared.runtimeIndex.index
    void integrity
    runtimeIndex = payload
  }
  const {
    integrity,
    catalogs: signedCatalogReferences,
    runtimeIndex: signedRuntimeReference,
    ...snapshot
  } = prepared.snapshot
  void integrity
  void signedCatalogReferences
  void signedRuntimeReference
  return { catalogs, runtimeIndex, snapshot }
}

async function forgedPublicationEventState(state: MarketplaceStateV1): Promise<MarketplaceStateV1> {
  const recorded = state.auditEvents.at(-1)
  if (!recorded || recorded.action !== 'publication.recorded') {
    throw new Error('Fixture requires a terminal publication.recorded audit event')
  }
  const { eventHash, ...fields } = recorded
  void eventHash
  const forgedFields = { ...fields, subject: 'publication:forged' }
  const forged = {
    ...forgedFields,
    eventHash: await marketplaceAuditEventHash(forgedFields)
  }
  return {
    ...state,
    auditEvents: [...state.auditEvents.slice(0, -1), forged]
  }
}

async function previousRootArtifactStore(
  state: MarketplaceStateV1,
  source: MarketplaceArtifactStore
): Promise<MarketplaceArtifactStore> {
  const previous = state.publications.at(-1)
  if (!previous) throw new Error('Fixture requires a previous publication')
  const target = createMemoryMarketplaceArtifactStore()
  const digests = new Set([
    previous.snapshotArtifactDigest,
    ...previous.catalogs.map(({ artifactDigest }) => artifactDigest),
    ...(previous.runtimeIndexArtifactDigest ? [previous.runtimeIndexArtifactDigest] : [])
  ])
  for (const artifactDigest of digests) {
    const artifact = await source.get(artifactDigest)
    if (!artifact) throw new Error(`Fixture artifact is unavailable: ${artifactDigest}`)
    await target.put(artifact.bytes)
  }
  return target
}

function emergencyPlanThatRevivesCurrentOwnership(
  baseline: MarketplacePublicationProjectionV1,
  current: MarketplacePublicationProjectionV1
): MarketplacePublicationProjectionV1 {
  const baselineOwnership = baseline.snapshot.publisherDirectory.ownerships.find(
    ({ pluginId }) => pluginId === 'acme.widget'
  )
  if (!baselineOwnership || baselineOwnership.status !== 'active') {
    throw new Error('Fixture requires a baseline active ownership')
  }
  return {
    ...current,
    snapshot: {
      ...current.snapshot,
      publisherDirectory: {
        ...current.snapshot.publisherDirectory,
        publishers: current.snapshot.publisherDirectory.publishers.map((publisher) => ({
          ...publisher,
          keys: publisher.keys.map((key) =>
            key.keyId === 'acme.release.1'
              ? {
                  ...key,
                  revokedAt: EMERGENCY_REVOCATION_TIME,
                  revocationReason: 'Emergency key compromise'
                }
              : key
          )
        })),
        ownerships: current.snapshot.publisherDirectory.ownerships.map((ownership) =>
          ownership.pluginId === 'acme.widget' ? baselineOwnership : ownership
        )
      }
    }
  }
}

function emergencyKeyRevocationPlan(
  current: MarketplacePublicationProjectionV1
): MarketplacePublicationProjectionV1 {
  return {
    ...current,
    snapshot: {
      ...current.snapshot,
      publisherDirectory: {
        ...current.snapshot.publisherDirectory,
        publishers: current.snapshot.publisherDirectory.publishers.map((publisher) => ({
          ...publisher,
          keys: publisher.keys.map((key) =>
            key.keyId === 'acme.release.1'
              ? {
                  ...key,
                  revokedAt: EMERGENCY_REVOCATION_TIME,
                  revocationReason: 'Emergency key compromise'
                }
              : key
          )
        }))
      }
    }
  }
}

async function signerPolicy(policyStore: MarketplaceOfflineSignerPolicyStore) {
  return policyStore.transaction(async (policy) => ({ policy, result: policy }))
}

describe('offline Root marketplace publication', () => {
  test('reconstructs the prior baseline from exact signed bytes before signing a continuation', async () => {
    const fixture = await continuationFixture()
    const loadedPreviousPublication = await loadMarketplacePreviousPublicationEvidence(
      fixture.state,
      fixture.artifacts
    )
    if (!loadedPreviousPublication) throw new Error('Fixture requires previous Root artifacts')
    const reconstructed = await verifyMarketplacePreviousPublicationEvidence(
      {
        state: fixture.state,
        previousPublication: loadedPreviousPublication,
        marketplaceId: MARKETPLACE_ID,
        rootKeyId: ROOT_KEY_ID,
        publicBaseUrl: PUBLIC_BASE_URL
      },
      fixture.rootKeyPair.publicKey
    )
    expect(reconstructed).toEqual(fixture.baseline)

    const request = publicationRequest(fixture.state, fixture.baseline, fixture.plan)
    const requestBytes = marketplacePublicationRequestBytes(request)
    const verified = await verifyMarketplacePublicationRequestEvidence(
      {
        requestBytes,
        state: fixture.state,
        previousPublication: fixture.previousPublication
      },
      fixture.rootKeyPair.publicKey,
      { now: () => Date.parse(PLAN_GENERATED_AT) }
    )
    expect(verified.reconstructedBaseline).toEqual(fixture.baseline)

    const signed = await signMarketplacePublicationRequest({
      requestBytes,
      state: fixture.state,
      previousPublication: fixture.previousPublication,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(PLAN_GENERATED_AT)
    })
    expect(signed.sequence).toBe(2)
    expect(signed.snapshot.payloadDigest).toBe(signed.record.snapshotDigest)
    expect(signed.snapshot.artifactDigest).toBe(signed.record.snapshotArtifactDigest)
    expect(signed.catalogs.map(({ channel }) => channel)).toEqual(['stable', 'beta'])
    expect(signed.runtimeIndex).toBeNull()
    expect(signed.snapshot.value.runtimeIndex).toBeUndefined()
  })

  test('rejects a self-reported baseline that differs from the prior signed artifacts', async () => {
    const fixture = await continuationFixture()
    const poisonedBaseline = withPublisherName(fixture.baseline, 'Poisoned Baseline')
    const request = publicationRequest(fixture.state, poisonedBaseline, fixture.plan)

    await expect(
      verifyMarketplacePublicationRequestEvidence(
        {
          requestBytes: marketplacePublicationRequestBytes(request),
          state: fixture.state,
          previousPublication: fixture.previousPublication
        },
        fixture.rootKeyPair.publicKey,
        { now: () => Date.parse(PLAN_GENERATED_AT) }
      )
    ).rejects.toThrow('not reconstructed from signed evidence')
  })

  test('rejects changed prior artifact bytes and a request outside its signing window', async () => {
    const fixture = await continuationFixture()
    const request = publicationRequest(fixture.state, fixture.baseline, fixture.plan)
    const requestBytes = marketplacePublicationRequestBytes(request)
    const changedSnapshotBytes = new Uint8Array(fixture.previousPublication.snapshot.bytes)
    changedSnapshotBytes[changedSnapshotBytes.byteLength - 2] ^= 1

    await expect(
      verifyMarketplacePublicationRequestEvidence(
        {
          requestBytes,
          state: fixture.state,
          previousPublication: {
            ...fixture.previousPublication,
            snapshot: { bytes: changedSnapshotBytes }
          }
        },
        fixture.rootKeyPair.publicKey,
        { now: () => Date.parse(PLAN_GENERATED_AT) }
      )
    ).rejects.toThrow()
    await expect(
      verifyMarketplacePublicationRequestEvidence(
        {
          requestBytes,
          state: fixture.state,
          previousPublication: fixture.previousPublication
        },
        fixture.rootKeyPair.publicKey,
        { now: () => Date.parse(PLAN_EXPIRES_AT) }
      )
    ).rejects.toThrow('outside its signing validity window')
  })

  test('rejects a request older than the trusted audit head before reserving signer state', async () => {
    const fixture = await createUnpublishedFixture()
    const originalRequest = publicationRequest(fixture.state, null, fixture.plan)
    await fixture.repository.transaction((transaction) =>
      transaction.createPublisher(
        { id: 'pending-later', displayName: 'Pending Later' },
        context('2026-08-11T00:00:00.000Z')
      )
    )
    const laterState = await fixture.repository.snapshot()
    const laterAuditHead = laterState.auditEvents.at(-1)
    if (!laterAuditHead) throw new Error('Fixture requires a non-empty audit chain')
    const stalePlan = await prepareMarketplacePublicationProjection(
      laterState,
      fixture.artifacts,
      projectionConfig(BASELINE_GENERATED_AT, BASELINE_EXPIRES_AT)
    )

    expect(() => publicationRequest(laterState, null, stalePlan)).toThrow(
      'must not precede the latest trusted audit event'
    )

    const staleRequest = {
      ...originalRequest,
      auditSequence: laterState.auditEvents.length,
      auditHead: laterAuditHead.eventHash,
      stateDigest: marketplacePublicationStateDigest(laterState),
      planDigest: digest(canonicalManifestJSON(stalePlan)),
      plan: stalePlan
    }
    const staleRequestBytes = marketplacePublicationRequestBytes(staleRequest)
    expect(() => assertMarketplacePublicationRequestState(staleRequest, laterState)).toThrow(
      'must not precede the latest trusted audit event'
    )
    const before = await signerPolicy(fixture.policyStore)

    await expect(
      signMarketplacePublicationRequest({
        requestBytes: staleRequestBytes,
        state: laterState,
        previousPublication: null,
        rootPublicKey: fixture.rootKeyPair.publicKey,
        rootPrivateKey: fixture.rootKeyPair.privateKey,
        artifacts: fixture.artifacts,
        policyStore: fixture.policyStore,
        now: () => Date.parse(BASELINE_GENERATED_AT)
      })
    ).rejects.toThrow('must not precede the latest trusted audit event')

    expect(await signerPolicy(fixture.policyStore)).toEqual(before)
  })

  test('refuses an arbitrary bootstrap plan and still accepts the independently derived plan', async () => {
    const fixture = await createUnpublishedFixture()
    const arbitraryPlan = withPublisherName(fixture.plan, 'Attacker Chosen Name')
    const arbitraryRequest = publicationRequest(fixture.state, null, arbitraryPlan)
    await expect(
      signMarketplacePublicationRequest({
        requestBytes: marketplacePublicationRequestBytes(arbitraryRequest),
        state: fixture.state,
        previousPublication: null,
        rootPublicKey: fixture.rootKeyPair.publicKey,
        rootPrivateKey: fixture.rootKeyPair.privateKey,
        artifacts: fixture.artifacts,
        policyStore: fixture.policyStore,
        now: () => Date.parse(BASELINE_GENERATED_AT)
      })
    ).rejects.toThrow('not independently derived from trusted state')

    const validRequest = publicationRequest(fixture.state, null, fixture.plan)
    const signed = await signMarketplacePublicationRequest({
      requestBytes: marketplacePublicationRequestBytes(validRequest),
      state: fixture.state,
      previousPublication: null,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(BASELINE_GENERATED_AT)
    })
    expect(signed.sequence).toBe(1)
  })

  test('returns exact stored bytes for an identical replay', async () => {
    const fixture = await continuationFixture()
    const request = publicationRequest(fixture.state, fixture.baseline, fixture.plan)
    const options = {
      requestBytes: marketplacePublicationRequestBytes(request),
      state: fixture.state,
      previousPublication: fixture.previousPublication,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(PLAN_GENERATED_AT)
    }
    const first = await signMarketplacePublicationRequest(options)
    const replayed = await signMarketplacePublicationRequest(options)

    expect(replayed.snapshot.bytes).toEqual(first.snapshot.bytes)
    expect(replayed.catalogs.map(({ bytes }) => bytes)).toEqual(
      first.catalogs.map(({ bytes }) => bytes)
    )
    expect(
      serializeMarketplaceSignedPublicationBundle(
        createMarketplaceSignedPublicationBundle(replayed)
      )
    ).toBe(
      serializeMarketplaceSignedPublicationBundle(createMarketplaceSignedPublicationBundle(first))
    )
  })

  test('uses only the frozen evidence captured before an untrusted policy store callback', async () => {
    const fixture = await continuationFixture()
    const request = publicationRequest(fixture.state, fixture.baseline, fixture.plan)
    const requestBytes = marketplacePublicationRequestBytes(request)
    const signed = await signMarketplacePublicationRequest({
      requestBytes,
      state: fixture.state,
      previousPublication: fixture.previousPublication,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(PLAN_GENERATED_AT)
    })
    const expectedBundle = serializeMarketplaceSignedPublicationBundle(
      createMarketplaceSignedPublicationBundle(signed)
    )

    const mutableOptions = {
      requestBytes,
      state: fixture.state as unknown,
      previousPublication:
        fixture.previousPublication as MarketplacePreviousPublicationEvidence | null,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: {} as MarketplaceOfflineSignerPolicyStore,
      now: () => Date.parse(PLAN_GENERATED_AT)
    }
    const hostilePolicyStore: MarketplaceOfflineSignerPolicyStore = {
      transaction(operation) {
        mutableOptions.requestBytes = new Uint8Array([0x7b])
        mutableOptions.state = { attacker: true }
        mutableOptions.previousPublication = null
        return fixture.policyStore.transaction(operation)
      }
    }
    mutableOptions.policyStore = hostilePolicyStore
    const replayed = await signMarketplacePublicationRequest(mutableOptions)
    expect(
      serializeMarketplaceSignedPublicationBundle(
        createMarketplaceSignedPublicationBundle(replayed)
      )
    ).toBe(expectedBundle)
  })

  test('retrieves an exact already-signed sequence after the original request expires', async () => {
    const fixture = await continuationFixture()
    const request = publicationRequest(fixture.state, fixture.baseline, fixture.plan)
    const requestBytes = marketplacePublicationRequestBytes(request)
    const options = {
      requestBytes,
      state: fixture.state,
      previousPublication: fixture.previousPublication,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(PLAN_GENERATED_AT)
    }
    const signed = await signMarketplacePublicationRequest(options)
    const replayed = await signMarketplacePublicationRequest({
      ...options,
      now: () => Date.parse(PLAN_EXPIRES_AT) + 1
    })
    expect(
      serializeMarketplaceSignedPublicationBundle(
        createMarketplaceSignedPublicationBundle(replayed)
      )
    ).toBe(
      serializeMarketplaceSignedPublicationBundle(createMarketplaceSignedPublicationBundle(signed))
    )
  })

  test('persists a reservation before signing and resumes only that request after expiry', async () => {
    const fixture = await continuationFixture()
    const request = publicationRequest(fixture.state, fixture.baseline, fixture.plan)
    const requestBytes = marketplacePublicationRequestBytes(request)
    await reservePublication(fixture.repository, request)
    let transactionCount = 0
    const crashBeforeFinalizeStore: MarketplaceOfflineSignerPolicyStore = {
      transaction(operation) {
        transactionCount++
        if (transactionCount === 2) {
          return Promise.reject(new Error('simulated crash before signer finalization'))
        }
        return fixture.policyStore.transaction(operation)
      }
    }
    const baseOptions = {
      requestBytes,
      state: fixture.state,
      previousPublication: fixture.previousPublication,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      now: () => Date.parse(PLAN_GENERATED_AT)
    }

    await expect(
      signMarketplacePublicationRequest({
        ...baseOptions,
        policyStore: crashBeforeFinalizeStore
      })
    ).rejects.toThrow('simulated crash before signer finalization')
    expect((await signerPolicy(fixture.policyStore)).pending?.requestDigest).toBe(
      digest(requestBytes)
    )

    const forkPlan = await prepareMarketplacePublicationProjection(
      fixture.state,
      fixture.artifacts,
      projectionConfig(FORK_GENERATED_AT, FORK_EXPIRES_AT)
    )
    await expect(
      signMarketplacePublicationRequest({
        ...baseOptions,
        requestBytes: marketplacePublicationRequestBytes(
          publicationRequest(fixture.state, fixture.baseline, forkPlan)
        ),
        policyStore: fixture.policyStore,
        now: () => Date.parse(FORK_GENERATED_AT)
      })
    ).rejects.toThrow('reserved for a different publication request')

    const signed = await signMarketplacePublicationRequest({
      ...baseOptions,
      policyStore: fixture.policyStore,
      now: () => Date.parse(PLAN_EXPIRES_AT) + 1
    })
    expect((await signerPolicy(fixture.policyStore)).pending).toBeNull()
    await importMarketplaceSignedPublicationBundle({
      bundle: createMarketplaceSignedPublicationBundle(signed),
      repository: fixture.repository,
      artifacts: fixture.artifacts,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      actor: 'offline-test',
      now: () => Date.parse(PLAN_EXPIRES_AT) + 24 * 60 * 60 * 1_000
    })

    const nextState = await fixture.repository.snapshot()
    const nextPlan = await prepareMarketplacePublicationProjection(
      nextState,
      fixture.artifacts,
      projectionConfig(RECOVERY_GENERATED_AT, RECOVERY_EXPIRES_AT)
    )
    const next = await signMarketplacePublicationRequest({
      requestBytes: marketplacePublicationRequestBytes(
        publicationRequest(nextState, fixture.plan, nextPlan)
      ),
      state: nextState,
      previousPublication: exactEvidence(signed),
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(RECOVERY_GENERATED_AT)
    })
    expect(next.sequence).toBe(3)
  })

  test('refuses a different plan for an already signed sequence', async () => {
    const fixture = await continuationFixture()
    const request = publicationRequest(fixture.state, fixture.baseline, fixture.plan)
    await signMarketplacePublicationRequest({
      requestBytes: marketplacePublicationRequestBytes(request),
      state: fixture.state,
      previousPublication: fixture.previousPublication,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(PLAN_GENERATED_AT)
    })

    const forkPlan = await prepareMarketplacePublicationProjection(
      fixture.state,
      fixture.artifacts,
      projectionConfig(FORK_GENERATED_AT, FORK_EXPIRES_AT)
    )
    const forkRequest = publicationRequest(fixture.state, fixture.baseline, forkPlan)
    await expect(
      signMarketplacePublicationRequest({
        requestBytes: marketplacePublicationRequestBytes(forkRequest),
        state: fixture.state,
        previousPublication: fixture.previousPublication,
        rootPublicKey: fixture.rootKeyPair.publicKey,
        rootPrivateKey: fixture.rootKeyPair.privateKey,
        artifacts: fixture.artifacts,
        policyStore: fixture.policyStore,
        now: () => Date.parse(FORK_GENERATED_AT)
      })
    ).rejects.toThrow('refuses a second plan for an already signed sequence')
  })

  test('requires the exact publication.recorded audit event after the prior audit anchor', async () => {
    const fixture = await continuationFixture()
    const missingEventState: MarketplaceStateV1 = {
      ...fixture.state,
      auditEvents: fixture.state.auditEvents.slice(0, -1),
      auditContexts: fixture.state.auditContexts.filter(
        ({ sequence }) => sequence < fixture.state.auditEvents.length
      )
    }
    const missingEventPlan = await prepareMarketplacePublicationProjection(
      missingEventState,
      fixture.artifacts,
      projectionConfig(PLAN_GENERATED_AT, PLAN_EXPIRES_AT)
    )
    const missingEventRequest = publicationRequest(
      missingEventState,
      fixture.baseline,
      missingEventPlan
    )
    await expect(
      verifyMarketplacePublicationRequestEvidence(
        {
          requestBytes: marketplacePublicationRequestBytes(missingEventRequest),
          state: missingEventState,
          previousPublication: fixture.previousPublication
        },
        fixture.rootKeyPair.publicKey,
        { now: () => Date.parse(PLAN_GENERATED_AT) }
      )
    ).rejects.toThrow('exact recorded audit event')

    const forgedEventState = await forgedPublicationEventState(fixture.state)
    const forgedEventPlan = await prepareMarketplacePublicationProjection(
      forgedEventState,
      fixture.artifacts,
      projectionConfig(PLAN_GENERATED_AT, PLAN_EXPIRES_AT)
    )
    const forgedEventRequest = publicationRequest(
      forgedEventState,
      fixture.baseline,
      forgedEventPlan
    )
    await expect(
      verifyMarketplacePublicationRequestEvidence(
        {
          requestBytes: marketplacePublicationRequestBytes(forgedEventRequest),
          state: forgedEventState,
          previousPublication: fixture.previousPublication
        },
        fixture.rootKeyPair.publicKey,
        { now: () => Date.parse(PLAN_GENERATED_AT) }
      )
    ).rejects.toThrow('exact recorded audit event')
  })

  test('does not advance signer policy when the Root private key mismatches its public authority', async () => {
    const fixture = await continuationFixture()
    const wrongRootKeyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify'
    ])
    const request = publicationRequest(fixture.state, fixture.baseline, fixture.plan)
    const requestBytes = marketplacePublicationRequestBytes(request)
    await expect(
      signMarketplacePublicationRequest({
        requestBytes,
        state: fixture.state,
        previousPublication: fixture.previousPublication,
        rootPublicKey: fixture.rootKeyPair.publicKey,
        rootPrivateKey: wrongRootKeyPair.privateKey,
        artifacts: fixture.artifacts,
        policyStore: fixture.policyStore,
        now: () => Date.parse(PLAN_GENERATED_AT)
      })
    ).rejects.toThrow()

    const signed = await signMarketplacePublicationRequest({
      requestBytes,
      state: fixture.state,
      previousPublication: fixture.previousPublication,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(PLAN_GENERATED_AT)
    })
    expect(signed.sequence).toBe(2)
  })

  test('requires the importer target store to contain the independently reviewed release closure', async () => {
    const fixture = await continuationFixture({ withRelease: true })
    if (!fixture.releaseArtifactDigest) throw new Error('Fixture requires a release artifact')
    const request = publicationRequest(fixture.state, fixture.baseline, fixture.plan)
    const signed = await signMarketplacePublicationRequest({
      requestBytes: marketplacePublicationRequestBytes(request),
      state: fixture.state,
      previousPublication: fixture.previousPublication,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(PLAN_GENERATED_AT)
    })
    expect(signed.snapshot.value.listings).toHaveLength(1)

    const target = await previousRootArtifactStore(fixture.state, fixture.artifacts)
    expect(await target.get(fixture.releaseArtifactDigest)).toBeNull()
    let putCount = 0
    const countingTarget: MarketplaceArtifactStore = {
      get: (artifactDigest) => target.get(artifactDigest),
      async put(bytes) {
        putCount++
        return target.put(bytes)
      }
    }
    const stateDigestBeforeImport = marketplacePublicationStateDigest(
      await fixture.repository.snapshot()
    )
    await expect(
      importMarketplaceSignedPublicationBundle({
        bundle: createMarketplaceSignedPublicationBundle(signed),
        repository: fixture.repository,
        artifacts: countingTarget,
        rootPublicKey: fixture.rootKeyPair.publicKey,
        actor: 'offline-test',
        now: () => Date.parse(PLAN_GENERATED_AT)
      })
    ).rejects.toThrow('Plugin manifest artifact is unavailable')
    expect(putCount).toBe(0)
    expect(marketplacePublicationStateDigest(await fixture.repository.snapshot())).toBe(
      stateDigestBeforeImport
    )
  })

  test('rejects a routine bundle relabeled as revocation recovery before writes or mutation', async () => {
    const fixture = await continuationFixture()
    const routineRequest = publicationRequest(fixture.state, fixture.baseline, fixture.plan)
    const signed = await signMarketplacePublicationRequest({
      requestBytes: marketplacePublicationRequestBytes(routineRequest),
      state: fixture.state,
      previousPublication: fixture.previousPublication,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(PLAN_GENERATED_AT)
    })
    const recoveryRequest = publicationRequest(
      fixture.state,
      fixture.baseline,
      fixture.plan,
      'revocation-recovery'
    )
    const tamperedBundle = {
      ...createMarketplaceSignedPublicationBundle(signed),
      requestDigest: marketplacePublicationRequestDigest(recoveryRequest),
      requestJson: serializeMarketplacePublicationRequest(recoveryRequest)
    }
    let putCount = 0
    const countingArtifacts: MarketplaceArtifactStore = {
      get: (artifactDigest) => fixture.artifacts.get(artifactDigest),
      async put(bytes) {
        putCount++
        return fixture.artifacts.put(bytes)
      }
    }
    let transactionCount = 0
    const countingRepository: MarketplacePublicationReservationRepository = {
      ...fixture.repository,
      transaction(operation) {
        transactionCount++
        return fixture.repository.transaction(operation)
      },
      completePublication(reservation, bundleDigest, operation) {
        transactionCount++
        return fixture.repository.completePublication(reservation, bundleDigest, operation)
      }
    }
    const stateDigestBeforeImport = marketplacePublicationStateDigest(
      await fixture.repository.snapshot()
    )

    await expect(
      importMarketplaceSignedPublicationBundle({
        bundle: tamperedBundle,
        repository: countingRepository,
        artifacts: countingArtifacts,
        rootPublicKey: fixture.rootKeyPair.publicKey,
        actor: 'offline-test'
      })
    ).rejects.toThrow('authorization signature is invalid')

    expect(putCount).toBe(0)
    expect(transactionCount).toBe(0)
    expect(marketplacePublicationStateDigest(await fixture.repository.snapshot())).toBe(
      stateDigestBeforeImport
    )
  })

  test('round-trips and imports the canonical bundle while rejecting tampering before persistence', async () => {
    const fixture = await continuationFixture()
    const request = publicationRequest(fixture.state, fixture.baseline, fixture.plan)
    const signed = await signMarketplacePublicationRequest({
      requestBytes: marketplacePublicationRequestBytes(request),
      state: fixture.state,
      previousPublication: fixture.previousPublication,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(PLAN_GENERATED_AT)
    })
    const bundle = createMarketplaceSignedPublicationBundle(signed)
    const bundleJSON = serializeMarketplaceSignedPublicationBundle(bundle)
    const parsed = parseMarketplaceSignedPublicationBundleJSON(bundleJSON)
    expect(serializeMarketplaceSignedPublicationBundle(parsed)).toBe(bundleJSON)

    let putCount = 0
    const countingArtifacts: MarketplaceArtifactStore = {
      get: (artifactDigest) => fixture.artifacts.get(artifactDigest),
      async put(bytes) {
        putCount++
        return fixture.artifacts.put(bytes)
      }
    }
    const stateDigestBeforeTamper = marketplacePublicationStateDigest(
      await fixture.repository.snapshot()
    )
    const tamperedBundle = {
      ...bundle,
      record: { ...bundle.record, snapshotDigest: digest('tampered snapshot digest') }
    }
    await expect(
      importMarketplaceSignedPublicationBundle({
        bundle: tamperedBundle,
        repository: fixture.repository,
        artifacts: countingArtifacts,
        rootPublicKey: fixture.rootKeyPair.publicKey,
        actor: 'offline-test',
        now: () => Date.parse(PLAN_GENERATED_AT)
      })
    ).rejects.toThrow()
    expect(putCount).toBe(0)
    expect(marketplacePublicationStateDigest(await fixture.repository.snapshot())).toBe(
      stateDigestBeforeTamper
    )

    await expect(
      importMarketplaceSignedPublicationBundle({
        bundle: parsed,
        repository: fixture.repository,
        artifacts: countingArtifacts,
        rootPublicKey: fixture.rootKeyPair.publicKey,
        actor: 'offline-test',
        now: () => Date.parse(PLAN_GENERATED_AT)
      })
    ).rejects.toThrow('publication reservation does not match')
    expect(putCount).toBe(0)

    await reservePublication(fixture.repository, request)
    const imported = await importMarketplaceSignedPublicationBundle({
      bundle: parsed,
      repository: fixture.repository,
      artifacts: countingArtifacts,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      actor: 'offline-test',
      now: () => Date.parse(PLAN_GENERATED_AT)
    })
    const importedState = await fixture.repository.snapshot()
    expect(imported.publication.sequence).toBe(2)
    expect(importedState.publications).toHaveLength(2)
    expect(importedState.auditEvents.at(-1)?.action).toBe('publication.recorded')
    expect(putCount).toBe(3)
  })

  test('replays an exact committed bundle before artifact writes after response loss and later state changes', async () => {
    const fixture = await continuationFixture()
    const request = publicationRequest(fixture.state, fixture.baseline, fixture.plan)
    await reservePublication(fixture.repository, request)
    const signed = await signMarketplacePublicationRequest({
      requestBytes: marketplacePublicationRequestBytes(request),
      state: fixture.state,
      previousPublication: fixture.previousPublication,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(PLAN_GENERATED_AT)
    })
    const bundle = createMarketplaceSignedPublicationBundle(signed)
    const bundleDigest = marketplaceSignedPublicationBundleDigest(bundle)
    const lossyRepository: MarketplacePublicationReservationRepository = {
      ...fixture.repository,
      async completePublication(reservation, exactBundleDigest, operation) {
        await fixture.repository.completePublication(reservation, exactBundleDigest, operation)
        throw new Error('simulated response loss after COMMIT')
      }
    }

    await expect(
      importMarketplaceSignedPublicationBundle({
        bundle,
        repository: lossyRepository,
        artifacts: fixture.artifacts,
        rootPublicKey: fixture.rootKeyPair.publicKey,
        actor: 'offline-test'
      })
    ).rejects.toThrow('simulated response loss after COMMIT')
    expect(
      await fixture.repository.inspectPublicationCompletion(request.stateDigest, bundleDigest)
    ).toBeNull()
    expect(
      await fixture.repository.inspectPublicationCompletion(
        marketplacePublicationRequestDigest(request),
        bundleDigest
      )
    ).not.toBeNull()

    await fixture.repository.transaction((transaction) =>
      transaction.createPublisher(
        { id: 'after-lost-response', displayName: 'After Lost Response' },
        { actor: 'offline-test', time: '2026-08-12T00:00:01.000Z' }
      )
    )
    const beforeReplay = await fixture.repository.snapshot()
    let putCount = 0
    const countingArtifacts: MarketplaceArtifactStore = {
      get: (artifactDigest) => fixture.artifacts.get(artifactDigest),
      async put(bytes) {
        putCount++
        return fixture.artifacts.put(bytes)
      }
    }
    const replayed = await importMarketplaceSignedPublicationBundle({
      bundle,
      repository: fixture.repository,
      artifacts: countingArtifacts,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      actor: 'offline-test'
    })

    expect(replayed.publication).toEqual(beforeReplay.publications.at(-1))
    expect(replayed.verified.requestDigest).toBe(marketplacePublicationRequestDigest(request))
    expect(putCount).toBe(0)
    expect(await fixture.repository.snapshot()).toEqual(beforeReplay)
  })

  test('freezes importer authority references before asynchronous callbacks can mutate options', async () => {
    const fixture = await continuationFixture()
    const request = publicationRequest(fixture.state, fixture.baseline, fixture.plan)
    await reservePublication(fixture.repository, request)
    const signed = await signMarketplacePublicationRequest({
      requestBytes: marketplacePublicationRequestBytes(request),
      state: fixture.state,
      previousPublication: fixture.previousPublication,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(PLAN_GENERATED_AT)
    })
    const bundle = createMarketplaceSignedPublicationBundle(signed)
    const hostileRepository = createMemoryMarketplaceRepository()
    const hostileArtifactStore = createMemoryMarketplaceArtifactStore()
    let hostilePutCount = 0
    const hostileArtifacts: MarketplaceArtifactStore = {
      get: (artifactDigest) => hostileArtifactStore.get(artifactDigest),
      async put(bytes) {
        hostilePutCount++
        return hostileArtifactStore.put(bytes)
      }
    }
    const wrongRootKeyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify'
    ])
    const mutableOptions: {
      bundle: unknown
      repository: MarketplacePublicationReservationRepository
      artifacts: MarketplaceArtifactStore
      rootPublicKey: CryptoKey
      actor: string
      now: () => number
    } = {
      bundle,
      repository: fixture.repository,
      artifacts: fixture.artifacts,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      actor: 'offline-test',
      now: () => Date.parse(PLAN_GENERATED_AT)
    }
    const mutatingRepository: MarketplacePublicationReservationRepository = {
      ...fixture.repository,
      async snapshot() {
        const state = await fixture.repository.snapshot()
        mutableOptions.bundle = { attacker: true }
        mutableOptions.repository = hostileRepository
        mutableOptions.artifacts = hostileArtifacts
        mutableOptions.rootPublicKey = wrongRootKeyPair.publicKey
        mutableOptions.actor = ''
        return state
      }
    }
    mutableOptions.repository = mutatingRepository

    const imported = await importMarketplaceSignedPublicationBundle(mutableOptions)

    expect(imported.publication.sequence).toBe(2)
    expect((await fixture.repository.snapshot()).publications).toHaveLength(2)
    expect((await hostileRepository.snapshot()).publications).toHaveLength(0)
    expect(hostilePutCount).toBe(0)
  })

  test('rejects an emergency plan that shrinks the baseline but revives current revoked authority', async () => {
    const fixture = await continuationFixture()
    await fixture.repository.transaction((transaction) =>
      transaction.transitionOwnership(
        'acme.widget',
        'revoked',
        context(EMERGENCY_REVOCATION_TIME, 'Emergency ownership revocation')
      )
    )
    const currentState = await fixture.repository.snapshot()
    const independentlyDerivedCurrent = await prepareMarketplacePublicationProjection(
      currentState,
      fixture.artifacts,
      projectionConfig(PLAN_GENERATED_AT, PLAN_EXPIRES_AT)
    )
    expect(
      independentlyDerivedCurrent.snapshot.publisherDirectory.ownerships.find(
        ({ pluginId }) => pluginId === 'acme.widget'
      )?.status
    ).toBe('revoked')
    const maliciousPlan = emergencyPlanThatRevivesCurrentOwnership(
      fixture.baseline,
      independentlyDerivedCurrent
    )
    const request = publicationRequest(
      currentState,
      fixture.baseline,
      maliciousPlan,
      'emergency-revocation'
    )
    expect(request.review.changes).toHaveLength(1)
    expect(request.review.changes[0]).toMatchObject({
      operation: 'restrict',
      resource: 'publisher-key'
    })
    await expect(
      signMarketplacePublicationRequest({
        requestBytes: marketplacePublicationRequestBytes(request),
        state: currentState,
        previousPublication: fixture.previousPublication,
        rootPublicKey: fixture.rootKeyPair.publicKey,
        rootPrivateKey: fixture.rootKeyPair.privateKey,
        artifacts: fixture.artifacts,
        policyStore: fixture.policyStore,
        now: () => Date.parse(PLAN_GENERATED_AT)
      })
    ).rejects.toThrow('may not add or expand ownership:acme.widget')
  })

  test('persists an emergency deny floor until an explicit Root recovery publication', async () => {
    const fixture = await continuationFixture()
    const emergencyPlan = emergencyKeyRevocationPlan(fixture.plan)
    const emergencyRequest = publicationRequest(
      fixture.state,
      fixture.baseline,
      emergencyPlan,
      'emergency-revocation'
    )
    await reservePublication(fixture.repository, emergencyRequest)
    const emergency = await signMarketplacePublicationRequest({
      requestBytes: marketplacePublicationRequestBytes(emergencyRequest),
      state: fixture.state,
      previousPublication: fixture.previousPublication,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(PLAN_GENERATED_AT)
    })
    expect((await signerPolicy(fixture.policyStore)).revocationFloorRequestJson).not.toBeNull()
    await importMarketplaceSignedPublicationBundle({
      bundle: createMarketplaceSignedPublicationBundle(emergency),
      repository: fixture.repository,
      artifacts: fixture.artifacts,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      actor: 'offline-test'
    })

    const recoveryState = await fixture.repository.snapshot()
    const recoveryPlan = await prepareMarketplacePublicationProjection(
      recoveryState,
      fixture.artifacts,
      projectionConfig(RECOVERY_GENERATED_AT, RECOVERY_EXPIRES_AT)
    )
    const routineRequest = publicationRequest(recoveryState, emergencyPlan, recoveryPlan)
    const recoveryOptions = {
      state: recoveryState,
      previousPublication: exactEvidence(emergency),
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(RECOVERY_GENERATED_AT)
    }
    await expect(
      signMarketplacePublicationRequest({
        ...recoveryOptions,
        requestBytes: marketplacePublicationRequestBytes(routineRequest)
      })
    ).rejects.toThrow('may not add or expand publisher-key:acme/acme.release.1')

    const recoveryRequest = publicationRequest(
      recoveryState,
      emergencyPlan,
      recoveryPlan,
      'revocation-recovery'
    )
    await reservePublication(fixture.repository, recoveryRequest)
    const recovered = await signMarketplacePublicationRequest({
      ...recoveryOptions,
      requestBytes: marketplacePublicationRequestBytes(recoveryRequest)
    })
    expect((await signerPolicy(fixture.policyStore)).revocationFloorRequestJson).toBeNull()
    await importMarketplaceSignedPublicationBundle({
      bundle: createMarketplaceSignedPublicationBundle(recovered),
      repository: fixture.repository,
      artifacts: fixture.artifacts,
      rootPublicKey: fixture.rootKeyPair.publicKey,
      actor: 'offline-test'
    })

    const afterRecoveryState = await fixture.repository.snapshot()
    const afterRecoveryPlan = await prepareMarketplacePublicationProjection(
      afterRecoveryState,
      fixture.artifacts,
      projectionConfig(AFTER_RECOVERY_GENERATED_AT, AFTER_RECOVERY_EXPIRES_AT)
    )
    const afterRecovery = await signMarketplacePublicationRequest({
      requestBytes: marketplacePublicationRequestBytes(
        publicationRequest(afterRecoveryState, recoveryPlan, afterRecoveryPlan)
      ),
      state: afterRecoveryState,
      previousPublication: exactEvidence(recovered),
      rootPublicKey: fixture.rootKeyPair.publicKey,
      rootPrivateKey: fixture.rootKeyPair.privateKey,
      artifacts: fixture.artifacts,
      policyStore: fixture.policyStore,
      now: () => Date.parse(AFTER_RECOVERY_GENERATED_AT)
    })
    expect(afterRecovery.sequence).toBe(4)
  })

  test('keeps online publication signing byte payloads in parity with the unsigned projection', async () => {
    const fixture = await createUnpublishedFixture()
    const prepared = await prepareMarketplacePublication(fixture.state, fixture.artifacts, {
      ...projectionConfig(BASELINE_GENERATED_AT, BASELINE_EXPIRES_AT),
      rootPrivateKey: fixture.rootKeyPair.privateKey
    })
    expect(unsignedProjection(prepared)).toEqual(fixture.plan)
  })
})
