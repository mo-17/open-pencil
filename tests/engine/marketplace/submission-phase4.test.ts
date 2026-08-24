/* eslint-disable max-lines -- Phase 4 submission invariants share one fail-first fixture and contract boundary. */
import { describe, expect, test } from 'bun:test'

import {
  createMarketplaceService,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceRepository,
  digestMarketplaceArtifact,
  marketplaceAuditEventHash,
  marketplaceAuditPayloadDigest,
  marketplaceListingDigest,
  marketplaceReleaseCoordinateKey,
  type MarketplaceAuditEventV1,
  type MarketplaceArtifactStore,
  type MarketplaceListingMetadataV1,
  type MarketplaceMutationContext,
  type MarketplaceReleaseChannel,
  type MarketplaceReleaseV1,
  type MarketplaceRepository,
  type MarketplaceService,
  type MarketplaceSubmissionV1,
  type SubmitMarketplacePluginInput
} from '@open-pencil/marketplace'
import {
  PLUGIN_RUNTIME_COMPUTE_ABI,
  PLUGIN_RUNTIME_PACKAGE_FORMAT,
  PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
  createPluginRuntimeAsset,
  serializeVersionedPluginManifest,
  signPluginManifest,
  signPluginRuntimePackage
} from '@open-pencil/plugin-contracts'
import { digestCanonicalManifest, exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import { pluginPayload } from '../plugins/helpers'

const BEFORE = '2026-08-05T11:59:00.000Z'
const SUBMITTED_AT = '2026-08-05T12:00:00.000Z'
const REVIEWED_AT = '2026-08-05T12:00:01.000Z'
const REVISED_AT = '2026-08-05T12:00:02.000Z'
const CHANGES_REASON = 'Replace the unsafe connector declaration before review continues'
const VALIDATION_REASON = 'Automated validation rejected the submitted payload'

interface Phase4RevisionRecord {
  readonly revision: number
  readonly signingKeyId: string
  readonly authenticatedRequestKeyId: string
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly listingDigest: string
  readonly listing: { readonly summary: string }
  readonly runtimeCoordinate: { readonly packageDigest: string } | null
}

interface Phase4Submission extends MarketplaceSubmissionV1 {
  readonly revision: number
  readonly signingKeyId: string
  readonly authenticatedRequestKeyId: string
  readonly listingDigest: string
  readonly revisionHistory: readonly Phase4RevisionRecord[]
}

interface Phase4ValidationResult {
  readonly valid: true
  readonly publisherId: string
  readonly coordinate: {
    readonly pluginId: string
    readonly version: string
    readonly channel: MarketplaceReleaseChannel
  }
  readonly signingKeyId: string
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly listingDigest: string
  readonly runtimePackageDigest: string | null
}

interface Phase4ImpactPreview {
  readonly operation: 'submission.publish'
  readonly subject: string
  readonly authorityDigest: string
  readonly allowed: boolean
  readonly blockers: readonly string[]
}

interface ReviseSubmissionInput {
  readonly publisherId: string
  readonly expectedRevision: number
  readonly channel: MarketplaceReleaseChannel
  readonly manifest: unknown
  readonly listing: SubmitMarketplacePluginInput['listing']
  readonly runtimePackage?: unknown
}

type Phase4MutationContext = MarketplaceMutationContext & {
  readonly authenticatedRequestKeyId: string
}

type Phase4Service = Omit<MarketplaceService, 'publishSubmission'> & {
  validateSubmission(input: SubmitMarketplacePluginInput): Promise<Phase4ValidationResult>
  reviseSubmission(
    submissionId: string,
    input: ReviseSubmissionInput,
    context: Phase4MutationContext
  ): Promise<Phase4Submission>
  previewImpact(input: {
    operation: 'submission.publish'
    submissionId: string
  }): Promise<Phase4ImpactPreview>
  publishSubmission(
    submissionId: string,
    context: MarketplaceMutationContext,
    authorityDigest?: string
  ): Promise<MarketplaceReleaseV1>
}

interface ArtifactHarness {
  readonly store: MarketplaceArtifactStore
  readonly backing: MarketplaceArtifactStore
  readonly counts: { puts: number; gets: number }
  setReadsAvailable(value: boolean): void
}

interface RepositoryHarness {
  readonly repository: MarketplaceRepository
  readonly backing: MarketplaceRepository
  readonly counts: { snapshots: number; transactions: number }
  failNextAwaitingReview(reason: string): void
}

function phase4Service(service: MarketplaceService): Phase4Service {
  return service as Phase4Service
}

function artifactHarness(): ArtifactHarness {
  const backing = createMemoryMarketplaceArtifactStore()
  const counts = { puts: 0, gets: 0 }
  let readsAvailable = true
  return {
    backing,
    counts,
    setReadsAvailable(value) {
      readsAvailable = value
    },
    store: {
      put(bytes) {
        counts.puts++
        return backing.put(bytes)
      },
      get(digest) {
        counts.gets++
        return readsAvailable ? backing.get(digest) : Promise.resolve(null)
      }
    }
  }
}

function repositoryHarness(): RepositoryHarness {
  const backing = createMemoryMarketplaceRepository()
  const counts = { snapshots: 0, transactions: 0 }
  let validationFailure: string | null = null
  return {
    backing,
    counts,
    failNextAwaitingReview(reason) {
      validationFailure = reason
    },
    repository: {
      snapshot() {
        counts.snapshots++
        return backing.snapshot()
      },
      transaction(operation) {
        counts.transactions++
        return backing.transaction((transaction) =>
          operation(
            new Proxy(transaction, {
              get(target, property, receiver) {
                if (property === 'transitionSubmission') {
                  return (
                    submissionId: string,
                    status: Parameters<typeof target.transitionSubmission>[1],
                    context: MarketplaceMutationContext
                  ) => {
                    if (status === 'awaiting_review' && validationFailure) {
                      const reason = validationFailure
                      validationFailure = null
                      return target.transitionSubmission(submissionId, 'validation_failed', {
                        ...context,
                        reason
                      })
                    }
                    return target.transitionSubmission(submissionId, status, context)
                  }
                }
                const value = Reflect.get(target, property, receiver)
                return typeof value === 'function' ? value.bind(target) : value
              }
            })
          )
        )
      }
    }
  }
}

async function keyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

function listing(label: string): SubmitMarketplacePluginInput['listing'] {
  return {
    displayName: `Analytics ${label}`,
    summary: `${label} marketplace listing`,
    description: `${label} bounded declarative analytics package for Phase 4 tests.`,
    categories: ['analytics'],
    iconUrl: null,
    homepageUrl: null
  }
}

async function runtimePackage(
  manifest: Awaited<ReturnType<typeof signPluginManifest>>,
  privateKey: CryptoKey,
  keyId: string,
  marker: string
) {
  return signPluginRuntimePackage(
    {
      format: PLUGIN_RUNTIME_PACKAGE_FORMAT,
      schemaVersion: PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
      plugin: { id: 'acme.analytics', version: manifest.plugin.version },
      publisher: { id: 'acme', keyId },
      declarativeManifestDigest: manifest.integrity.digest,
      runtime: {
        kind: 'javascript',
        abi: PLUGIN_RUNTIME_COMPUTE_ABI,
        capabilities: [],
        limits: {
          timeoutMs: 2_000,
          maxInputBytes: 256 * 1024,
          maxOutputBytes: 256 * 1024,
          maxMemoryPages: 4
        },
        asset: await createPluginRuntimeAsset(
          'javascript',
          new TextEncoder().encode(
            `export function compute() { return ${JSON.stringify(marker)} }\n`
          )
        )
      }
    },
    privateKey
  )
}

async function fixture() {
  const publisher = await keyPair()
  const repository = repositoryHarness()
  const artifacts = artifactHarness()
  const service = phase4Service(
    createMarketplaceService({
      repository: repository.repository,
      artifacts: artifacts.store,
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      now: () => new Date(SUBMITTED_AT)
    })
  )
  await service.registerPublisher(
    {
      publisher: { id: 'acme', displayName: 'Acme Plugins' },
      key: {
        keyId: 'acme.release',
        publisherId: 'acme',
        publicKeyPem: await exportEd25519PublicKeyPem(publisher.publicKey),
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2027-01-01T00:00:00.000Z'
      }
    },
    { actor: 'publisher:acme', time: BEFORE }
  )
  await service.transitionPublisherKey('acme.release', 'active', {
    actor: 'admin:fixture',
    time: BEFORE
  })
  await service.transitionPublisher('acme', 'active', {
    actor: 'admin:fixture',
    time: BEFORE
  })
  await service.requestOwnership('acme.analytics', 'acme', {
    actor: 'publisher:acme',
    time: BEFORE
  })
  await service.transitionOwnership('acme.analytics', 'active', {
    actor: 'admin:fixture',
    time: BEFORE
  })
  return { artifacts, publisher, repository, service }
}

function publisherContext(time: string): MarketplaceMutationContext {
  return { actor: 'publisher:acme', time }
}

function revisionContext(time: string, keyId = 'acme.release'): Phase4MutationContext {
  return { actor: 'publisher:acme', authenticatedRequestKeyId: keyId, time }
}

async function submissionInput(
  privateKey: CryptoKey,
  options: {
    id?: string
    version?: string
    moduleName?: string
    keyId?: string
    listingLabel?: string
    runtimeMarker?: string
  } = {}
) {
  const keyId = options.keyId ?? 'acme.release'
  const payload = pluginPayload(options.version ?? '1.0.0', options.moduleName ?? 'Original Chart')
  payload.publisher.keyId = keyId
  const manifest = await signPluginManifest(payload, privateKey)
  const runtime = await runtimePackage(
    manifest,
    privateKey,
    keyId,
    options.runtimeMarker ?? 'original-runtime'
  )
  return {
    id: options.id ?? 'submission-phase4',
    publisherId: 'acme',
    channel: 'stable' as const,
    manifest,
    listing: listing(options.listingLabel ?? 'original'),
    runtimePackage: runtime
  }
}

async function requestChanges(
  service: Phase4Service,
  submissionId: string,
  reason = CHANGES_REASON
): Promise<void> {
  await service.transitionSubmission(submissionId, 'changes_requested', {
    actor: 'admin:reviewer',
    reason,
    time: REVIEWED_AT
  })
}

async function activateRotatedKey(service: Phase4Service) {
  const pair = await keyPair()
  await service.registerPublisherKey(
    {
      keyId: 'acme.release.next',
      publisherId: 'acme',
      publicKeyPem: await exportEd25519PublicKeyPem(pair.publicKey),
      predecessorKeyId: 'acme.release',
      notBefore: REVIEWED_AT,
      notAfter: '2027-08-05T00:00:00.000Z'
    },
    { actor: 'publisher:acme', time: REVIEWED_AT }
  )
  await service.transitionPublisherKey('acme.release.next', 'active', {
    actor: 'admin:fixture',
    time: REVIEWED_AT
  })
  return pair
}

describe('Phase 4 marketplace submission validation and revision', () => {
  test('validates with the production rules without repository, audit, or artifact writes', async () => {
    const value = await fixture()
    const input = await submissionInput(value.publisher.privateKey)
    const before = await value.service.snapshot()
    const beforeTransactions = value.repository.counts.transactions
    const beforePuts = value.artifacts.counts.puts

    const result = await value.service.validateSubmission(input)

    expect(result).toMatchObject({
      valid: true,
      publisherId: 'acme',
      coordinate: { pluginId: 'acme.analytics', version: '1.0.0', channel: 'stable' },
      signingKeyId: 'acme.release',
      manifestDigest: input.manifest.integrity.digest,
      artifactDigest: digestMarketplaceArtifact(
        new TextEncoder().encode(serializeVersionedPluginManifest(input.manifest))
      ),
      listingDigest: await digestCanonicalManifest(input.listing),
      runtimePackageDigest: input.runtimePackage.integrity.digest
    })
    expect(value.repository.counts.transactions).toBe(beforeTransactions)
    expect(value.artifacts.counts.puts).toBe(beforePuts)
    expect(await value.service.snapshot()).toEqual(before)
  })

  test('revises only the same coordinate and publisher while preserving old identity and reason', async () => {
    const value = await fixture()
    const originalInput = await submissionInput(value.publisher.privateKey)
    const original = (await value.service.submit(
      originalInput,
      publisherContext(SUBMITTED_AT)
    )) as Phase4Submission
    await requestChanges(value.service, original.id)
    const nextKey = await activateRotatedKey(value.service)
    const nextInput = await submissionInput(nextKey.privateKey, {
      keyId: 'acme.release.next',
      moduleName: 'Revised Chart',
      listingLabel: 'revised',
      runtimeMarker: 'revised-runtime'
    })

    const revised = await value.service.reviseSubmission(
      original.id,
      {
        publisherId: 'acme',
        expectedRevision: 1,
        channel: 'stable',
        manifest: nextInput.manifest,
        listing: nextInput.listing,
        runtimePackage: nextInput.runtimePackage
      },
      revisionContext(REVISED_AT, 'acme.release.next')
    )

    expect(revised).toMatchObject({
      id: original.id,
      publisherId: 'acme',
      coordinate: original.coordinate,
      revision: 2,
      signingKeyId: 'acme.release.next',
      authenticatedRequestKeyId: 'acme.release.next',
      status: 'submitted',
      statusReason: null,
      manifestDigest: nextInput.manifest.integrity.digest,
      listingDigest: await digestCanonicalManifest(nextInput.listing),
      runtimeCoordinate: { packageDigest: nextInput.runtimePackage.integrity.digest },
      revisionHistory: [
        {
          revision: 1,
          signingKeyId: 'acme.release',
          authenticatedRequestKeyId: 'acme.release',
          manifestDigest: original.manifestDigest,
          artifactDigest: original.artifactDigest,
          listingDigest: await digestCanonicalManifest(originalInput.listing),
          listing: { summary: originalInput.listing.summary },
          runtimeCoordinate: { packageDigest: originalInput.runtimePackage.integrity.digest }
        }
      ]
    })
    expect(revised.artifactDigest).not.toBe(original.artifactDigest)
    expect(await value.artifacts.backing.get(original.artifactDigest)).not.toBeNull()
    expect(await value.artifacts.backing.get(revised.artifactDigest)).not.toBeNull()
    const persisted = JSON.stringify(await value.service.snapshot())
    expect(persisted).toContain(original.manifestDigest)
    expect(persisted).toContain(original.artifactDigest)
    expect(persisted).toContain(originalInput.runtimePackage.integrity.digest)
    expect(persisted).toContain(originalInput.listing.summary)
    expect(persisted).toContain(CHANGES_REASON)
  })

  test('rejects illegal state, cross-publisher, coordinate changes, and reused signatures atomically', async () => {
    const value = await fixture()
    const originalInput = await submissionInput(value.publisher.privateKey)
    const original = (await value.service.submit(
      originalInput,
      publisherContext(SUBMITTED_AT)
    )) as Phase4Submission
    const nextInput = await submissionInput(value.publisher.privateKey, {
      moduleName: 'Safe Revision',
      listingLabel: 'safe revision',
      runtimeMarker: 'safe-revision-runtime'
    })
    const revision = (overrides: Partial<ReviseSubmissionInput> = {}): ReviseSubmissionInput => ({
      publisherId: 'acme',
      expectedRevision: 1,
      channel: 'stable',
      manifest: nextInput.manifest,
      listing: nextInput.listing,
      runtimePackage: nextInput.runtimePackage,
      ...overrides
    })

    await expect(
      value.service.reviseSubmission(original.id, revision(), revisionContext(REVISED_AT))
    ).rejects.toThrow(/state|awaiting_review|cannot|revision/i)

    await requestChanges(value.service, original.id)
    const before = await value.service.snapshot()
    const beforePuts = value.artifacts.counts.puts
    await expect(
      value.service.reviseSubmission(original.id, revision({ publisherId: 'other' }), {
        actor: 'publisher:other',
        authenticatedRequestKeyId: 'other.release',
        time: REVISED_AT
      })
    ).rejects.toThrow(/publisher|belong|authenticated/i)
    await expect(
      value.service.reviseSubmission(
        original.id,
        revision({ channel: 'beta' }),
        revisionContext(REVISED_AT)
      )
    ).rejects.toThrow(/coordinate|channel/i)

    const changedVersion = await submissionInput(value.publisher.privateKey, { version: '1.0.1' })
    await expect(
      value.service.reviseSubmission(
        original.id,
        revision({
          manifest: changedVersion.manifest,
          runtimePackage: changedVersion.runtimePackage
        }),
        revisionContext(REVISED_AT)
      )
    ).rejects.toThrow(/coordinate|version/i)

    const reusedSignature = structuredClone(nextInput.manifest)
    reusedSignature.plugin.name = 'Tampered after signing'
    await expect(
      value.service.reviseSubmission(
        original.id,
        revision({ manifest: reusedSignature }),
        revisionContext(REVISED_AT)
      )
    ).rejects.toThrow(/signature|digest|integrity/i)

    expect(await value.service.snapshot()).toEqual(before)
    expect(value.artifacts.counts.puts).toBe(beforePuts)
  })

  test('supports the validation_failed revision path and preserves its automated reason', async () => {
    const value = await fixture()
    value.repository.failNextAwaitingReview(VALIDATION_REASON)
    const originalInput = await submissionInput(value.publisher.privateKey, {
      id: 'submission-validation-failed'
    })
    const original = (await value.service.submit(
      originalInput,
      publisherContext(SUBMITTED_AT)
    )) as Phase4Submission
    expect(original.status).toBe('validation_failed')
    const nextInput = await submissionInput(value.publisher.privateKey, {
      id: original.id,
      moduleName: 'Validated Revision',
      listingLabel: 'validated revision',
      runtimeMarker: 'validated-revision-runtime'
    })

    const revised = await value.service.reviseSubmission(
      original.id,
      {
        publisherId: 'acme',
        expectedRevision: 1,
        channel: 'stable',
        manifest: nextInput.manifest,
        listing: nextInput.listing,
        runtimePackage: nextInput.runtimePackage
      },
      revisionContext(REVISED_AT)
    )

    expect(revised).toMatchObject({ revision: 2, status: 'submitted', statusReason: null })
    expect(revised.revisionHistory).toHaveLength(1)
    expect(JSON.stringify(await value.service.snapshot())).toContain(VALIDATION_REASON)
  })

  test('allows exactly one concurrent writer for an expected revision', async () => {
    const value = await fixture()
    const originalInput = await submissionInput(value.publisher.privateKey)
    const original = (await value.service.submit(
      originalInput,
      publisherContext(SUBMITTED_AT)
    )) as Phase4Submission
    await requestChanges(value.service, original.id)
    const left = await submissionInput(value.publisher.privateKey, {
      moduleName: 'Concurrent Left',
      listingLabel: 'concurrent left',
      runtimeMarker: 'concurrent-left-runtime'
    })
    const right = await submissionInput(value.publisher.privateKey, {
      moduleName: 'Concurrent Right',
      listingLabel: 'concurrent right',
      runtimeMarker: 'concurrent-right-runtime'
    })
    const revise = (input: typeof left) =>
      value.service.reviseSubmission(
        original.id,
        {
          publisherId: 'acme',
          expectedRevision: 1,
          channel: 'stable',
          manifest: input.manifest,
          listing: input.listing,
          runtimePackage: input.runtimePackage
        },
        revisionContext(REVISED_AT)
      )

    const beforePuts = value.artifacts.counts.puts
    const results = await Promise.allSettled([revise(left), revise(right)])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    const rejection = results.find(({ status }) => status === 'rejected') as PromiseRejectedResult
    expect(String(rejection.reason)).toMatch(/revision|stale|conflict|changed/i)

    const state = await value.service.snapshot()
    const submission = state.submissions.find(({ id }) => id === original.id) as Phase4Submission
    expect(submission.revision).toBe(2)
    expect(submission.revisionHistory).toHaveLength(1)
    expect([left.manifest.integrity.digest, right.manifest.integrity.digest]).toContain(
      submission.manifestDigest
    )
    expect(state.auditEvents.filter(({ action }) => action === 'submission.revised')).toHaveLength(
      1
    )
    expect(value.artifacts.counts.puts - beforePuts).toBe(2)
  })

  test('rechecks active signing key and ownership before revising', async () => {
    for (const revokedAuthority of ['key', 'ownership'] as const) {
      const value = await fixture()
      const originalInput = await submissionInput(value.publisher.privateKey)
      const original = (await value.service.submit(
        originalInput,
        publisherContext(SUBMITTED_AT)
      )) as Phase4Submission
      await requestChanges(value.service, original.id)
      const nextInput = await submissionInput(value.publisher.privateKey, {
        moduleName: `Revoked ${revokedAuthority}`,
        listingLabel: `revoked ${revokedAuthority}`,
        runtimeMarker: `revoked-${revokedAuthority}-runtime`
      })
      if (revokedAuthority === 'key') {
        await value.service.transitionPublisherKey('acme.release', 'revoked', {
          actor: 'admin:security',
          reason: 'Signing key compromise',
          time: REVISED_AT
        })
      } else {
        await value.service.transitionOwnership('acme.analytics', 'revoked', {
          actor: 'admin:security',
          reason: 'Ownership revoked',
          time: REVISED_AT
        })
      }
      const before = await value.service.snapshot()
      const beforePuts = value.artifacts.counts.puts

      await expect(
        value.service.reviseSubmission(
          original.id,
          {
            publisherId: 'acme',
            expectedRevision: 1,
            channel: 'stable',
            manifest: nextInput.manifest,
            listing: nextInput.listing,
            runtimePackage: nextInput.runtimePackage
          },
          revisionContext('2026-08-05T12:00:03.000Z')
        )
      ).rejects.toThrow(
        revokedAuthority === 'key' ? /key|signing|active|revoked/i : /ownership|own|active|revoked/i
      )
      expect(await value.service.snapshot()).toEqual(before)
      expect(value.artifacts.counts.puts).toBe(beforePuts)
    }
  })

  test('binds revision-one listing and authenticated request identity to its creation audit', async () => {
    const value = await fixture()
    const input = await submissionInput(value.publisher.privateKey)
    await value.service.submit(input, publisherContext(SUBMITTED_AT))
    const state = await value.service.snapshot()
    const tamperedListing = structuredClone(state) as {
      submissions: Array<{
        listing: MarketplaceListingMetadataV1
        listingDigest: string
        authenticatedRequestKeyId: string | null
      }>
    }
    const submission = tamperedListing.submissions.at(0)
    if (!submission) throw new TypeError('Expected revision-one submission fixture')
    submission.listing = { ...submission.listing, description: 'Tampered after creation' }
    submission.listingDigest = marketplaceListingDigest(submission.listing)
    expect(() => createMemoryMarketplaceRepository({ initialState: tamperedListing })).toThrow(
      /creation audit payload/i
    )

    const tamperedRequestKey = structuredClone(state) as {
      submissions: Array<{ authenticatedRequestKeyId: string | null }>
    }
    const requestIdentity = tamperedRequestKey.submissions.at(0)
    if (!requestIdentity) throw new TypeError('Expected request-key submission fixture')
    requestIdentity.authenticatedRequestKeyId = 'acme.release.tampered'
    expect(() => createMemoryMarketplaceRepository({ initialState: tamperedRequestKey })).toThrow(
      /creation audit payload/i
    )

    const downgradedIdentity = structuredClone(state) as {
      submissions: Array<{
        signingKeyId: string | null
        authenticatedRequestKeyId: string | null
      }>
    }
    const downgraded = downgradedIdentity.submissions.at(0)
    if (!downgraded) throw new TypeError('Expected downgrade submission fixture')
    downgraded.signingKeyId = null
    downgraded.authenticatedRequestKeyId = null
    expect(() => createMemoryMarketplaceRepository({ initialState: downgradedIdentity })).toThrow(
      /creation audit payload/i
    )

    const forgedApproval = structuredClone(state) as {
      submissions: Array<{ status: string; statusReason: string | null }>
    }
    const forged = forgedApproval.submissions.at(0)
    if (!forged) throw new TypeError('Expected approval submission fixture')
    forged.status = 'approved'
    forged.statusReason = null
    expect(() => createMemoryMarketplaceRepository({ initialState: forgedApproval })).toThrow(
      /current status audit/i
    )
  })

  test('binds authority state and public key material to audit evidence', async () => {
    const value = await fixture()
    await value.service.transitionPublisher('acme', 'suspended', {
      actor: 'admin:security',
      reason: 'Publisher security review',
      time: SUBMITTED_AT
    })
    await value.service.transitionPublisherKey('acme.release', 'revoked', {
      actor: 'admin:security',
      reason: 'Signing key compromise',
      time: SUBMITTED_AT
    })
    await value.service.transitionOwnership('acme.analytics', 'revoked', {
      actor: 'admin:security',
      reason: 'Ownership revoked',
      time: SUBMITTED_AT
    })
    const state = await value.service.snapshot()
    const attacker = await keyPair()

    const swappedPublicKey = structuredClone(state) as {
      publisherKeys: Array<{ publicKeyPem: string }>
    }
    const swappedKey = swappedPublicKey.publisherKeys.at(0)
    if (!swappedKey) throw new TypeError('Expected publisher key fixture')
    swappedKey.publicKeyPem = await exportEd25519PublicKeyPem(attacker.publicKey)
    expect(() => createMemoryMarketplaceRepository({ initialState: swappedPublicKey })).toThrow(
      /publisher key.*registration audit/i
    )

    const weakRegistration = structuredClone(state) as {
      publisherKeys: Array<{
        keyId: string
        notAfter: string
        notBefore: string
        predecessorKeyId: string | null
        publisherId: string
      }>
      auditEvents: MarketplaceAuditEventV1[]
    }
    const registeredKey = weakRegistration.publisherKeys.at(0)
    if (!registeredKey) throw new TypeError('Expected publisher key fixture')
    const weakDigest = await marketplaceAuditPayloadDigest({
      keyId: registeredKey.keyId,
      notAfter: registeredKey.notAfter,
      notBefore: registeredKey.notBefore,
      predecessorKeyId: registeredKey.predecessorKeyId,
      publisherId: registeredKey.publisherId
    })
    const rebuiltAudit: MarketplaceAuditEventV1[] = []
    for (const event of weakRegistration.auditEvents) {
      const { eventHash: _eventHash, ...fields } = event
      const nextFields = {
        ...fields,
        payloadDigest:
          event.action === 'publisher_key.registered' ? weakDigest : event.payloadDigest,
        previousHash: rebuiltAudit.at(-1)?.eventHash ?? null
      }
      rebuiltAudit.push({
        ...nextFields,
        eventHash: await marketplaceAuditEventHash(nextFields)
      })
    }
    weakRegistration.auditEvents = rebuiltAudit
    expect(() => createMemoryMarketplaceRepository({ initialState: weakRegistration })).toThrow(
      /publisher key.*registration audit/i
    )

    const renamedPublisher = structuredClone(state) as {
      publishers: Array<{ displayName: string }>
    }
    const renamed = renamedPublisher.publishers.at(0)
    if (!renamed) throw new TypeError('Expected publisher fixture')
    renamed.displayName = 'Attacker Plugins'
    expect(() => createMemoryMarketplaceRepository({ initialState: renamedPublisher })).toThrow(
      /publisher.*creation audit/i
    )

    const resurrectedPublisher = structuredClone(state) as {
      publishers: Array<{ status: string; statusReason: string | null }>
    }
    const publisher = resurrectedPublisher.publishers.at(0)
    if (!publisher) throw new TypeError('Expected publisher fixture')
    publisher.status = 'active'
    publisher.statusReason = null
    expect(() => createMemoryMarketplaceRepository({ initialState: resurrectedPublisher })).toThrow(
      /publisher.*current status audit/i
    )

    const resurrectedKey = structuredClone(state) as {
      publisherKeys: Array<{
        status: string
        statusReason: string | null
        revokedAt: string | null
        revocationReason: string | null
      }>
    }
    const key = resurrectedKey.publisherKeys.at(0)
    if (!key) throw new TypeError('Expected publisher key fixture')
    key.status = 'active'
    key.statusReason = null
    key.revokedAt = null
    key.revocationReason = null
    expect(() => createMemoryMarketplaceRepository({ initialState: resurrectedKey })).toThrow(
      /publisher key.*current status audit/i
    )

    const resurrectedOwnership = structuredClone(state) as {
      ownerships: Array<{ status: string; statusReason: string | null }>
    }
    const ownership = resurrectedOwnership.ownerships.at(0)
    if (!ownership) throw new TypeError('Expected ownership fixture')
    ownership.status = 'active'
    ownership.statusReason = null
    expect(() => createMemoryMarketplaceRepository({ initialState: resurrectedOwnership })).toThrow(
      /ownership.*current status audit/i
    )
  })
})

describe('Phase 4 marketplace impact authority', () => {
  test('keeps preview read-only, rejects stale authority, and rechecks the signing key at publish', async () => {
    const value = await fixture()
    const input = await submissionInput(value.publisher.privateKey)
    const submission = (await value.service.submit(
      input,
      publisherContext(SUBMITTED_AT)
    )) as Phase4Submission
    await value.service.transitionSubmission(submission.id, 'approved', {
      actor: 'admin:reviewer',
      time: REVIEWED_AT
    })
    const beforePreview = await value.service.snapshot()
    const beforePuts = value.artifacts.counts.puts

    const preview = await value.service.previewImpact({
      operation: 'submission.publish',
      submissionId: submission.id
    })

    expect(preview).toMatchObject({
      operation: 'submission.publish',
      subject: `submission:${submission.id}`,
      allowed: true,
      blockers: []
    })
    expect(preview.authorityDigest).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await value.service.snapshot()).toEqual(beforePreview)
    expect(value.artifacts.counts.puts).toBe(beforePuts)

    await value.service.transitionPublisherKey('acme.release', 'revoked', {
      actor: 'admin:security',
      reason: 'Signing key compromise after approval',
      time: REVISED_AT
    })
    await expect(
      value.service.publishSubmission(
        submission.id,
        { actor: 'admin:publisher', time: '2026-08-05T12:00:03.000Z' },
        preview.authorityDigest
      )
    ).rejects.toThrow(/authority|stale|changed/i)
    expect((await value.service.snapshot()).releases).toHaveLength(0)

    const current = await value.service.previewImpact({
      operation: 'submission.publish',
      submissionId: submission.id
    })
    expect(current.allowed).toBe(false)
    expect(current.blockers.join(' ')).toMatch(/key|signing|active|revoked/i)
    await expect(
      value.service.publishSubmission(
        submission.id,
        { actor: 'admin:publisher', time: '2026-08-05T12:00:03.000Z' },
        current.authorityDigest
      )
    ).rejects.toThrow(/key|signing|active|revoked/i)
    expect((await value.service.snapshot()).releases).toHaveLength(0)
  })

  test('revalidates immutable artifacts before release and rejects an unavailable CAS entry', async () => {
    const value = await fixture()
    const input = await submissionInput(value.publisher.privateKey)
    const submission = await value.service.submit(input, publisherContext(SUBMITTED_AT))
    await value.service.transitionSubmission(submission.id, 'approved', {
      actor: 'admin:reviewer',
      time: REVIEWED_AT
    })
    const preview = await value.service.previewImpact({
      operation: 'submission.publish',
      submissionId: submission.id
    })
    const before = await value.service.snapshot()
    value.artifacts.setReadsAvailable(false)

    await expect(
      value.service.publishSubmission(
        submission.id,
        { actor: 'admin:publisher', time: REVISED_AT },
        preview.authorityDigest
      )
    ).rejects.toThrow(/artifact|unavailable/i)
    expect(await value.service.snapshot()).toEqual(before)
  })

  test('pins a verified legacy revision-one signer with audit before publishing', async () => {
    const value = await fixture()
    const input = await submissionInput(value.publisher.privateKey)
    const submission = await value.service.submit(input, publisherContext(SUBMITTED_AT))
    await value.service.transitionSubmission(submission.id, 'approved', {
      actor: 'admin:reviewer',
      time: REVIEWED_AT
    })
    const currentState = await value.service.snapshot()
    const currentSubmission = currentState.submissions.at(0)
    if (!currentSubmission) throw new TypeError('Expected legacy submission fixture')
    const legacyCreationDigest = await marketplaceAuditPayloadDigest({
      artifactDigest: currentSubmission.artifactDigest,
      coordinate: marketplaceReleaseCoordinateKey(currentSubmission.coordinate),
      manifestDigest: currentSubmission.manifestDigest,
      publisherId: currentSubmission.publisherId,
      runtimePackageDigest: currentSubmission.runtimeCoordinate?.packageDigest ?? null,
      submissionId: currentSubmission.id
    })
    const legacyState = structuredClone(currentState) as {
      submissions: Array<Record<string, unknown>>
      auditEvents: MarketplaceAuditEventV1[]
    }
    for (const legacySubmission of legacyState.submissions) {
      delete legacySubmission.listingDigest
      delete legacySubmission.signingKeyId
      delete legacySubmission.authenticatedRequestKeyId
      delete legacySubmission.revision
      delete legacySubmission.revisionCreatedAt
      delete legacySubmission.revisionHistory
    }
    const rebuiltAudit: MarketplaceAuditEventV1[] = []
    for (const event of legacyState.auditEvents) {
      const { eventHash: _eventHash, ...fields } = event
      const nextFields = {
        ...fields,
        payloadDigest:
          event.action === 'submission.created' ? legacyCreationDigest : event.payloadDigest,
        previousHash: rebuiltAudit.at(-1)?.eventHash ?? null
      }
      rebuiltAudit.push({
        ...nextFields,
        eventHash: await marketplaceAuditEventHash(nextFields)
      })
    }
    legacyState.auditEvents = rebuiltAudit
    const legacyService = phase4Service(
      createMarketplaceService({
        repository: createMemoryMarketplaceRepository({ initialState: legacyState }),
        artifacts: value.artifacts.backing,
        marketplaceId: 'openpencil-marketplace',
        publicBaseUrl: 'https://plugins.example.com/',
        now: () => new Date(REVISED_AT)
      })
    )
    const preview = await legacyService.previewImpact({
      operation: 'submission.publish',
      submissionId: submission.id
    })
    expect(preview.allowed).toBe(true)
    await legacyService.publishSubmission(
      submission.id,
      { actor: 'admin:publisher', time: REVISED_AT },
      preview.authorityDigest
    )
    const state = await legacyService.snapshot()
    expect(state.submissions[0]?.signingKeyId).toBe('acme.release')
    expect(state.submissions[0]?.authenticatedRequestKeyId).toBeNull()
    expect(state.releases).toHaveLength(1)
    expect(state.auditEvents.slice(-2).map(({ action }) => action)).toEqual([
      'submission.signing_key_pinned',
      'release.published'
    ])
    const tamperedPin = structuredClone(state) as {
      submissions: Array<{
        listing: MarketplaceListingMetadataV1
        listingDigest: string
      }>
    }
    const pinnedSubmission = tamperedPin.submissions.at(0)
    if (!pinnedSubmission) throw new TypeError('Expected pinned legacy submission fixture')
    pinnedSubmission.listing = {
      ...pinnedSubmission.listing,
      description: 'Tampered after legacy signer pin'
    }
    pinnedSubmission.listingDigest = marketplaceListingDigest(pinnedSubmission.listing)
    expect(() => createMemoryMarketplaceRepository({ initialState: tamperedPin })).toThrow(
      /signing-key pin audit payload/i
    )
  })
})
