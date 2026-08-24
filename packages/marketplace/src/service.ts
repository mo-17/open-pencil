import {
  parseMarketplaceSnapshotBytes,
  parsePluginRuntimePackageBytes,
  parseVersionedPluginManifest,
  parseVersionedPluginPackageBytes,
  parsePluginRuntimePackage,
  pluginRuntimePackageCanonicalByteLength,
  serializeVersionedPluginManifest,
  serializePluginRuntimePackage,
  verifyMarketplaceSnapshot,
  verifyVersionedPluginPackage,
  verifyPluginRuntimePackage,
  type MarketplaceListingSearchOptions,
  type MarketplacePluginListingV1,
  type PluginManifest,
  type SignedMarketplaceSnapshotV1,
  type SignedPluginRuntimePackageV1,
  type VerifiedPluginRuntimePackage,
  type VerifiedMarketplaceSnapshot
} from '@open-pencil/plugin-contracts'
import {
  exportEd25519PublicKeyPem,
  importEd25519PublicKeyPem,
  parseSha256Base64URL,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import {
  inspectMarketplaceArtifact,
  type MarketplaceArtifact,
  type MarketplaceArtifactStore
} from './artifacts'
import { createMarketplaceControlReader, type MarketplaceControlReader } from './control-reader'
import {
  assertMarketplaceImpactAuthority,
  createMarketplaceImpactPreview,
  MarketplaceImpactAuthorityError,
  type MarketplaceImpactPreviewV1,
  type MarketplaceImpactRequest
} from './impact'
import { projectLiveMarketplaceListings, searchLiveMarketplaceListings } from './live-listings'
import {
  createMarketplaceSubmissionPresentation,
  type MarketplaceSubmissionPresentationV1
} from './presentation'
import {
  prepareMarketplacePublication,
  type MarketplacePublicationConfig,
  type PreparedMarketplacePublication
} from './publication'
import { findActiveMarketplacePublisherKey } from './publisher-trust'
import type { MarketplaceRepository } from './repository'
import {
  createMarketplaceSubmissionRevisionDiff,
  type MarketplaceSubmissionRevisionDiffV1
} from './revision-diff'
import {
  createMarketplaceSubmissionReviewerHistory,
  marketplaceSubmissionCheck,
  parseMarketplaceSubmissionCurrentCheckReport,
  type MarketplaceSubmissionCurrentCheckReportV1,
  type MarketplaceSubmissionReviewerHistoryQuery,
  type MarketplaceSubmissionReviewerHistoryV1
} from './submission-assurance'
import {
  MARKETPLACE_RELEASE_CHANNELS,
  parseMarketplaceSubmission,
  parseMarketplaceIdentity,
  marketplaceListingDigest,
  parseMarketplaceListingMetadata,
  parseMarketplacePublicURL,
  parseMarketplaceReason,
  parseMarketplaceReleaseCoordinate,
  parseMarketplaceTimestamp,
  parseRegisterMarketplacePublisherKeyInput,
  type MarketplaceAuditEventV1,
  type MarketplaceListingMetadataV1,
  type MarketplaceMutationContext,
  type MarketplaceOwnershipV1,
  type MarketplaceOwnershipStatus,
  type MarketplacePublicationV1,
  type MarketplacePublisherKeyV1,
  type MarketplacePublisherKeyStatus,
  type MarketplacePublisherStatus,
  type MarketplacePublisherV1,
  type MarketplaceReleaseChannel,
  type MarketplaceReleaseCoordinateV1,
  type MarketplaceReleaseV1,
  type MarketplaceStateV1,
  type MarketplaceSubmissionStatus,
  type MarketplaceSubmissionV1,
  type RegisterMarketplacePublisherKeyInput
} from './types'

export interface MarketplaceRootTrust {
  keyId: string
  publicKey?: CryptoKey
  privateKey?: CryptoKey
}

export interface CreateMarketplaceServiceOptions {
  repository: MarketplaceRepository
  artifacts: MarketplaceArtifactStore
  marketplaceId: string
  publicBaseUrl: string
  root?: MarketplaceRootTrust
  now?: () => Date
  publicationValidityMilliseconds?: number
}

export interface RegisterMarketplacePublisherInput {
  publisher: { id: string; displayName: string }
  key: RegisterMarketplacePublisherKeyInput
}

export interface SubmitMarketplacePluginInput {
  id: string
  publisherId: string
  channel: MarketplaceReleaseChannel
  manifest: unknown
  listing: MarketplaceListingMetadataV1
  runtimePackage?: unknown
  authenticatedRequestKeyId?: string
}

export interface ReviseMarketplaceSubmissionInput {
  publisherId: string
  expectedRevision: number
  channel: MarketplaceReleaseChannel
  manifest: unknown
  listing: MarketplaceListingMetadataV1
  runtimePackage?: unknown
}

export interface MarketplaceSubmissionValidationV1 {
  valid: true
  publisherId: string
  coordinate: MarketplaceReleaseCoordinateV1
  signingKeyId: string
  authenticatedRequestKeyId: string
  manifestDigest: string
  artifactDigest: string
  listingDigest: string
  runtimePackageDigest: string | null
  runtimeArtifactDigest: string | null
  manifestByteLength: number
  runtimeByteLength: number | null
}

export interface MarketplaceAuthenticatedMutationContext extends MarketplaceMutationContext {
  authenticatedRequestKeyId?: string
}

export type MarketplacePublisherActivationIntent = 'approve' | 'reactivate'

export const MARKETPLACE_PUBLIC_AUDIT_PAGE_LIMITS = Object.freeze({
  defaultPageSize: 1_000,
  maxPageSize: 1_000
})

export interface MarketplacePublicAuditPageQuery {
  readonly after?: number
  readonly limit?: number
}

export interface MarketplacePublicAuditPage {
  readonly events: readonly MarketplaceAuditEventV1[]
  readonly head: string | null
  readonly nextAfter: number | null
}

export interface MarketplaceService {
  readonly control: MarketplaceControlReader
  readonly marketplaceId: string
  snapshot(): Promise<MarketplaceStateV1>
  registerPublisher(
    input: RegisterMarketplacePublisherInput,
    context: MarketplaceMutationContext
  ): Promise<MarketplacePublisherV1>
  registerPublisherKey(
    input: RegisterMarketplacePublisherKeyInput,
    context: MarketplaceMutationContext
  ): Promise<MarketplacePublisherKeyV1>
  transitionPublisher(
    publisherId: string,
    status: MarketplacePublisherStatus,
    context: MarketplaceMutationContext,
    authorityDigest?: string,
    activationIntent?: MarketplacePublisherActivationIntent
  ): Promise<MarketplacePublisherV1>
  transitionPublisherKey(
    keyId: string,
    status: MarketplacePublisherKeyStatus,
    context: MarketplaceMutationContext,
    authorityDigest?: string
  ): Promise<MarketplacePublisherKeyV1>
  requestOwnership(
    pluginId: string,
    publisherId: string,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceOwnershipV1>
  transitionOwnership(
    pluginId: string,
    status: MarketplaceOwnershipStatus,
    context: MarketplaceMutationContext,
    authorityDigest?: string
  ): Promise<MarketplaceOwnershipV1>
  submit(
    input: SubmitMarketplacePluginInput,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceSubmissionV1>
  validateSubmission(
    input: SubmitMarketplacePluginInput
  ): Promise<MarketplaceSubmissionValidationV1>
  reviseSubmission(
    submissionId: string,
    input: ReviseMarketplaceSubmissionInput,
    context: MarketplaceAuthenticatedMutationContext
  ): Promise<MarketplaceSubmissionV1>
  transitionSubmission(
    submissionId: string,
    status: MarketplaceSubmissionStatus,
    context: MarketplaceMutationContext,
    authorityDigest?: string
  ): Promise<MarketplaceSubmissionV1>
  withdrawSubmission(
    submissionId: string,
    publisherId: string,
    reason: string,
    context: Omit<MarketplaceMutationContext, 'reason'>
  ): Promise<MarketplaceSubmissionV1>
  publishSubmission(
    submissionId: string,
    context: MarketplaceMutationContext,
    authorityDigest?: string
  ): Promise<MarketplaceReleaseV1>
  yankRelease(
    coordinate: MarketplaceReleaseCoordinateV1,
    context: MarketplaceMutationContext,
    authorityDigest?: string
  ): Promise<MarketplaceReleaseV1>
  publish(
    context: MarketplaceMutationContext,
    authorityDigest?: string
  ): Promise<{
    publication: MarketplacePublicationV1
    prepared: PreparedMarketplacePublication
  }>
  previewImpact(input: MarketplaceImpactRequest): Promise<MarketplaceImpactPreviewV1>
  submissionPresentation(
    submissionId: string,
    publisherId: string
  ): Promise<MarketplaceSubmissionPresentationV1 | null>
  submissionRevisionDiff(
    submissionId: string,
    publisherId: string,
    fromRevision: number,
    toRevision: number
  ): Promise<MarketplaceSubmissionRevisionDiffV1 | null>
  submissionCurrentCheckReport(
    submissionId: string
  ): Promise<MarketplaceSubmissionCurrentCheckReportV1 | null>
  submissionReviewerHistory(
    submissionId: string,
    query: MarketplaceSubmissionReviewerHistoryQuery
  ): Promise<MarketplaceSubmissionReviewerHistoryV1 | null>
  resolveActivePublisherKey(publisherId: string, keyId: string): Promise<CryptoKey | null>
  artifact(digest: string): Promise<MarketplaceArtifact | null>
  publicArtifact(digest: string): Promise<MarketplaceArtifact | null>
  latestSnapshotArtifact(): Promise<MarketplaceArtifact | null>
  latestSnapshot(): Promise<SignedMarketplaceSnapshotV1 | null>
  latestVerifiedSnapshot(): Promise<VerifiedMarketplaceSnapshot | null>
  latestCatalog(channel: MarketplaceReleaseChannel): Promise<MarketplaceArtifact | null>
  latestRuntimeIndex(): Promise<MarketplaceArtifact | null>
  search(options?: MarketplaceListingSearchOptions): Promise<readonly MarketplacePluginListingV1[]>
  listing(pluginId: string): Promise<MarketplacePluginListingV1 | null>
  publicAuditPage(query?: MarketplacePublicAuditPageQuery): Promise<MarketplacePublicAuditPage>
}

const encoder = new TextEncoder()

function currentTime(now: (() => Date) | undefined): string {
  const date = (now ?? (() => new Date()))()
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('Marketplace service clock must return a valid Date')
  }
  return parseMarketplaceTimestamp(date.toISOString(), 'marketplace service time')
}

function normalizedContext(
  context: MarketplaceMutationContext,
  fallbackTime: string
): MarketplaceMutationContext {
  return { ...context, time: context.time ?? fallbackTime }
}

function baseURL(value: string): string {
  const parsed = new URL(parseMarketplacePublicURL(value, 'marketplace public base URL'))
  if (parsed.pathname !== '/' || parsed.search !== '') {
    throw new TypeError('Marketplace public base URL must be an HTTPS origin')
  }
  return parsed.href
}

function artifactURL(publicBaseURL: string, digest: string): string {
  return new URL(`v1/artifacts/${digest}`, publicBaseURL).href
}

function assertCategory(value: string, index: number): void {
  const reason = validateModuleIdentity(value, `marketplace listing category ${index}`)
  if (reason) throw new TypeError(reason)
}

function publicListing(value: MarketplaceListingMetadataV1): MarketplaceListingMetadataV1 {
  const listing = parseMarketplaceListingMetadata(value)
  if (listing.displayName.length > 128 || listing.summary.length > 512) {
    throw new TypeError('Marketplace listing name or summary exceeds the public snapshot limit')
  }
  if (listing.categories.length > 8) {
    throw new TypeError('Marketplace listing may contain at most 8 public categories')
  }
  listing.categories.forEach(assertCategory)
  const categories = [...listing.categories].sort()
  if (new Set(categories).size !== categories.length) {
    throw new TypeError('Marketplace listing categories must be unique')
  }
  return parseMarketplaceListingMetadata({ ...listing, categories })
}

function activePublisherKey(
  state: MarketplaceStateV1,
  publisherId: string,
  keyId: string,
  at: number
) {
  const publisher = state.publishers.find(({ id }) => id === publisherId)
  if (publisher?.status !== 'active') throw new Error(`Publisher ${publisherId} is not active`)
  const ownership = (pluginId: string) =>
    state.ownerships.some(
      (candidate) =>
        candidate.pluginId === pluginId &&
        candidate.publisherId === publisherId &&
        candidate.status === 'active'
    )
  const key = findActiveMarketplacePublisherKey(state, publisherId, keyId, at)
  if (!key) {
    throw new Error(`Publisher key ${keyId} is not active at the submission time`)
  }
  return { key, ownership }
}

async function canonicalPublicKey(input: RegisterMarketplacePublisherKeyInput) {
  const parsed = parseRegisterMarketplacePublisherKeyInput(input)
  const publicKey = await importEd25519PublicKeyPem(parsed.publicKeyPem)
  if ((await exportEd25519PublicKeyPem(publicKey)) !== parsed.publicKeyPem) {
    throw new TypeError('Marketplace publisher key must use canonical Ed25519 SPKI PEM encoding')
  }
  return { input: parsed, publicKey }
}

interface PreparedMarketplaceSubmission {
  readonly validation: MarketplaceSubmissionValidationV1
  readonly manifestBytes: Uint8Array
  readonly runtimeBytes: Uint8Array | null
  readonly listing: MarketplaceListingMetadataV1
  readonly runtimeCoordinate: MarketplaceSubmissionV1['runtimeCoordinate']
  readonly signingPublicKeyPem: string
}

async function prepareSubmission(
  options: CreateMarketplaceServiceOptions,
  publicBaseURL: string,
  state: MarketplaceStateV1,
  input: SubmitMarketplacePluginInput,
  at: string,
  allowedSubmissionId?: string,
  skipAvailability = false
): Promise<PreparedMarketplaceSubmission> {
  const submissionId = parseMarketplaceIdentity(input.id, 'submission id')
  const publisherId = parseMarketplaceIdentity(input.publisherId, 'publisher id')
  if (!MARKETPLACE_RELEASE_CHANNELS.includes(input.channel)) {
    throw new TypeError('Marketplace submission channel must be stable or beta')
  }
  const atMilliseconds = Date.parse(parseMarketplaceTimestamp(at, 'submission time'))
  const manifest = parseVersionedPluginManifest(input.manifest)
  const trust = activePublisherKey(state, publisherId, manifest.publisher.keyId, atMilliseconds)
  const authenticatedRequestKeyId = parseMarketplaceIdentity(
    input.authenticatedRequestKeyId ?? manifest.publisher.keyId,
    'authenticated request key id'
  )
  if (
    !findActiveMarketplacePublisherKey(
      state,
      publisherId,
      authenticatedRequestKeyId,
      atMilliseconds
    )
  ) {
    throw new Error(
      `Authenticated request key ${authenticatedRequestKeyId} is not active at the submission time`
    )
  }
  const publicKey = await importEd25519PublicKeyPem(trust.key.publicKeyPem)
  const verified = await verifyVersionedPluginPackage(manifest, publicKey, {
    expectedKeyId: trust.key.keyId
  })
  if (verified.manifest.publisher.id !== publisherId) {
    throw new Error('Plugin manifest publisher does not match the authenticated publisher')
  }
  if (!trust.ownership(verified.manifest.plugin.id)) {
    throw new Error('Publisher does not own the submitted plugin id')
  }
  const coordinate = parseMarketplaceReleaseCoordinate({
    pluginId: verified.manifest.plugin.id,
    version: verified.manifest.plugin.version,
    channel: input.channel
  })
  const coordinateKey = `${coordinate.pluginId}@${coordinate.version}#${coordinate.channel}`
  if (
    !skipAvailability &&
    state.submissions.some(
      (submission) => submission.id === submissionId && submission.id !== allowedSubmissionId
    )
  ) {
    throw new Error(`Submission ${submissionId} already exists`)
  }
  if (
    !skipAvailability &&
    state.submissions.some(
      (submission) =>
        `${submission.coordinate.pluginId}@${submission.coordinate.version}#${submission.coordinate.channel}` ===
          coordinateKey && submission.id !== allowedSubmissionId
    )
  ) {
    throw new Error(`Release coordinate ${coordinateKey} already has a submission`)
  }
  const listing = publicListing(input.listing)
  const listingDigest = marketplaceListingDigest(listing)
  const manifestBytes = encoder.encode(serializeVersionedPluginManifest(verified.manifest))
  const manifestArtifact = inspectMarketplaceArtifact(manifestBytes)
  let runtimeBytes: Uint8Array | null = null
  let runtimeCoordinate: MarketplaceSubmissionV1['runtimeCoordinate'] = null
  let runtimePackageDigest: string | null = null
  let runtimeArtifactDigest: string | null = null
  let runtimeByteLength: number | null = null
  if (input.runtimePackage !== undefined) {
    const runtimePackage = parsePluginRuntimePackage(input.runtimePackage)
    const verifiedRuntime = await verifyPluginRuntimePackage(runtimePackage, publicKey, {
      expectedPluginId: coordinate.pluginId,
      expectedPluginVersion: coordinate.version,
      expectedPublisherId: publisherId,
      expectedKeyId: trust.key.keyId,
      expectedDeclarativeManifestDigest: verified.verifiedDigest
    })
    runtimeBytes = encoder.encode(serializePluginRuntimePackage(runtimePackage))
    const runtimeArtifact = inspectMarketplaceArtifact(runtimeBytes)
    runtimePackageDigest = verifiedRuntime.verifiedDigest
    runtimeArtifactDigest = runtimeArtifact.digest
    runtimeByteLength = pluginRuntimePackageCanonicalByteLength(runtimePackage)
    runtimeCoordinate = {
      packageDigest: verifiedRuntime.verifiedDigest,
      packageUrl: artifactURL(publicBaseURL, runtimeArtifact.digest),
      byteLength: runtimeByteLength,
      kind: runtimePackage.runtime.kind
    }
  }
  return Object.freeze({
    validation: Object.freeze({
      valid: true,
      publisherId,
      coordinate,
      signingKeyId: trust.key.keyId,
      authenticatedRequestKeyId,
      manifestDigest: verified.verifiedDigest,
      artifactDigest: manifestArtifact.digest,
      listingDigest,
      runtimePackageDigest,
      runtimeArtifactDigest,
      manifestByteLength: manifestArtifact.byteLength,
      runtimeByteLength
    }),
    manifestBytes,
    runtimeBytes,
    listing,
    runtimeCoordinate,
    signingPublicKeyPem: trust.key.publicKeyPem
  })
}

async function persistPreparedSubmissionArtifacts(
  artifacts: MarketplaceArtifactStore,
  prepared: PreparedMarketplaceSubmission
): Promise<void> {
  const manifestArtifact = await artifacts.put(prepared.manifestBytes)
  if (manifestArtifact.digest !== prepared.validation.artifactDigest) {
    throw new Error('Marketplace artifact store changed the validated manifest digest')
  }
  if (prepared.runtimeBytes) {
    const runtimeArtifact = await artifacts.put(prepared.runtimeBytes)
    if (runtimeArtifact.digest !== prepared.validation.runtimeArtifactDigest) {
      throw new Error('Marketplace artifact store changed the validated runtime digest')
    }
  }
}

function artifactDigestFromURL(value: string, publicBaseURL: string): string {
  const prefix = artifactURL(publicBaseURL, '')
  if (!value.startsWith(prefix)) {
    throw new Error('Runtime package URL is not owned by this marketplace artifact store')
  }
  const suffix = value.slice(prefix.length)
  if (suffix.includes('/') || suffix.includes('?')) {
    throw new Error('Runtime package URL must be an immutable marketplace artifact URL')
  }
  return parseSha256Base64URL(suffix, 'runtime package artifact digest')
}

interface VerifiedMarketplaceSubmissionManifestArtifact {
  readonly signingKeyId: string
  readonly manifest: PluginManifest
  readonly publicKey: CryptoKey
}

interface VerifiedMarketplaceSubmissionRuntimeArtifact {
  readonly artifactDigest: string
  readonly byteLength: number
  readonly runtimePackage: SignedPluginRuntimePackageV1
  readonly verification: VerifiedPluginRuntimePackage
}

interface VerifiedMarketplaceSubmissionArtifacts {
  readonly signingKeyId: string
  readonly manifest: PluginManifest
  readonly runtime: Readonly<{
    artifactDigest: string
    byteLength: number
    runtimePackage: SignedPluginRuntimePackageV1
    verification: VerifiedPluginRuntimePackage
  }> | null
}

async function verifySubmissionManifestArtifact(
  options: CreateMarketplaceServiceOptions,
  publicBaseURL: string,
  state: MarketplaceStateV1,
  submission: MarketplaceSubmissionV1,
  at: string,
  requireActiveKey: boolean
): Promise<VerifiedMarketplaceSubmissionManifestArtifact> {
  if (submission.manifestUrl !== artifactURL(publicBaseURL, submission.artifactDigest)) {
    throw new Error('Submission manifest URL is not its immutable artifact URL')
  }
  const artifact = await options.artifacts.get(submission.artifactDigest)
  if (!artifact) throw new Error('Submission manifest artifact is unavailable')
  const verifiedArtifact = inspectMarketplaceArtifact(artifact.bytes, submission.artifactDigest)
  const manifest = parseVersionedPluginPackageBytes(verifiedArtifact.bytes)
  const signingKeyId = manifest.publisher.keyId
  if (submission.signingKeyId !== null && submission.signingKeyId !== signingKeyId) {
    throw new Error('Submission signing key does not match its signed manifest')
  }
  const key = requireActiveKey
    ? findActiveMarketplacePublisherKey(state, submission.publisherId, signingKeyId, Date.parse(at))
    : state.publisherKeys.find(
        (candidate) =>
          candidate.publisherId === submission.publisherId && candidate.keyId === signingKeyId
      )
  if (!key) {
    throw new Error(
      requireActiveKey
        ? 'Submission signing key is not active at publication time'
        : 'Submission signing key is unavailable'
    )
  }
  const publicKey = await importEd25519PublicKeyPem(key.publicKeyPem)
  const verified = await verifyVersionedPluginPackage(manifest, publicKey, {
    expectedKeyId: signingKeyId
  })
  if (
    verified.verifiedDigest !== submission.manifestDigest ||
    verified.manifest.plugin.id !== submission.coordinate.pluginId ||
    verified.manifest.plugin.version !== submission.coordinate.version ||
    verified.manifest.publisher.id !== submission.publisherId
  ) {
    throw new Error('Submission identity does not match its signed manifest artifact')
  }
  return Object.freeze({
    signingKeyId,
    manifest: verified.manifest,
    publicKey
  })
}

async function verifySubmissionRuntimeArtifact(
  options: CreateMarketplaceServiceOptions,
  publicBaseURL: string,
  submission: MarketplaceSubmissionV1,
  verifiedManifest: VerifiedMarketplaceSubmissionManifestArtifact
): Promise<VerifiedMarketplaceSubmissionRuntimeArtifact> {
  const coordinate = submission.runtimeCoordinate
  if (!coordinate) throw new Error('Submission has no runtime artifact')
  const runtimeArtifactDigest = artifactDigestFromURL(coordinate.packageUrl, publicBaseURL)
  const runtimeArtifact = await options.artifacts.get(runtimeArtifactDigest)
  if (!runtimeArtifact) throw new Error('Submission runtime artifact is unavailable')
  const runtimeBytes = inspectMarketplaceArtifact(
    runtimeArtifact.bytes,
    runtimeArtifactDigest
  ).bytes
  const runtimePackage = parsePluginRuntimePackageBytes(runtimeBytes)
  const verifiedRuntime = await verifyPluginRuntimePackage(
    runtimePackage,
    verifiedManifest.publicKey,
    {
      expectedPluginId: submission.coordinate.pluginId,
      expectedPluginVersion: submission.coordinate.version,
      expectedPublisherId: submission.publisherId,
      expectedKeyId: verifiedManifest.signingKeyId,
      expectedDeclarativeManifestDigest: submission.manifestDigest
    }
  )
  if (
    verifiedRuntime.verifiedDigest !== coordinate.packageDigest ||
    pluginRuntimePackageCanonicalByteLength(runtimePackage) !== coordinate.byteLength ||
    runtimePackage.runtime.kind !== coordinate.kind
  ) {
    throw new Error('Submission runtime identity does not match its signed artifact')
  }
  return Object.freeze({
    artifactDigest: runtimeArtifactDigest,
    byteLength: coordinate.byteLength,
    runtimePackage,
    verification: verifiedRuntime
  })
}

async function verifySubmissionArtifacts(
  options: CreateMarketplaceServiceOptions,
  publicBaseURL: string,
  state: MarketplaceStateV1,
  submission: MarketplaceSubmissionV1,
  at: string,
  requireActiveKey: boolean
): Promise<VerifiedMarketplaceSubmissionArtifacts> {
  const verifiedManifest = await verifySubmissionManifestArtifact(
    options,
    publicBaseURL,
    state,
    submission,
    at,
    requireActiveKey
  )
  const runtime = submission.runtimeCoordinate
    ? await verifySubmissionRuntimeArtifact(options, publicBaseURL, submission, verifiedManifest)
    : null
  return Object.freeze({
    signingKeyId: verifiedManifest.signingKeyId,
    manifest: verifiedManifest.manifest,
    runtime
  })
}

interface MarketplaceSubmissionAssuranceInspection {
  readonly verifiedManifest: VerifiedMarketplaceSubmissionManifestArtifact | null
  readonly verifiedRuntime: VerifiedMarketplaceSubmissionRuntimeArtifact | null
  readonly runtimeArtifactDigest: string | null
}

async function inspectMarketplaceSubmissionAssurance(
  options: CreateMarketplaceServiceOptions,
  publicBaseURL: string,
  state: MarketplaceStateV1,
  submission: MarketplaceSubmissionV1,
  evaluatedAt: string
): Promise<MarketplaceSubmissionAssuranceInspection> {
  let verifiedManifest: VerifiedMarketplaceSubmissionManifestArtifact | null = null
  try {
    verifiedManifest = await verifySubmissionManifestArtifact(
      options,
      publicBaseURL,
      state,
      submission,
      evaluatedAt,
      false
    )
  } catch {
    verifiedManifest = null
  }
  let verifiedRuntime: VerifiedMarketplaceSubmissionRuntimeArtifact | null = null
  if (submission.runtimeCoordinate && verifiedManifest) {
    try {
      verifiedRuntime = await verifySubmissionRuntimeArtifact(
        options,
        publicBaseURL,
        submission,
        verifiedManifest
      )
    } catch {
      verifiedRuntime = null
    }
  }
  let runtimeArtifactDigest: string | null = null
  if (submission.runtimeCoordinate) {
    try {
      runtimeArtifactDigest = artifactDigestFromURL(
        submission.runtimeCoordinate.packageUrl,
        publicBaseURL
      )
    } catch {
      runtimeArtifactDigest = null
    }
  }
  return Object.freeze({ verifiedManifest, verifiedRuntime, runtimeArtifactDigest })
}

function submissionAtRevision(
  submission: MarketplaceSubmissionV1,
  revisionValue: number
): MarketplaceSubmissionV1 {
  if (!Number.isSafeInteger(revisionValue) || revisionValue < 1) {
    throw new TypeError('Submission revision must be a positive safe integer')
  }
  if (revisionValue === submission.revision) return submission
  if (revisionValue > submission.revision) {
    throw new TypeError('Submission revision is unavailable')
  }
  const historical = submission.revisionHistory[revisionValue - 1]
  if (historical.revision !== revisionValue) {
    throw new TypeError('Submission revision is unavailable')
  }
  return parseMarketplaceSubmission({
    ...submission,
    signingKeyId: historical.signingKeyId,
    authenticatedRequestKeyId: historical.authenticatedRequestKeyId,
    manifestDigest: historical.manifestDigest,
    artifactDigest: historical.artifactDigest,
    manifestUrl: historical.manifestUrl,
    listing: historical.listing,
    listingDigest: historical.listingDigest,
    runtimeCoordinate: historical.runtimeCoordinate,
    revision: historical.revision,
    revisionCreatedAt: historical.createdAt,
    revisionHistory: submission.revisionHistory.slice(0, historical.revision - 1),
    status: historical.supersededFromStatus,
    updatedAt: historical.supersededAt,
    statusReason: historical.supersededReason
  })
}

function publicationConfig(
  options: CreateMarketplaceServiceOptions,
  root: MarketplaceRootTrust
): MarketplacePublicationConfig {
  if (!root.privateKey) throw new Error('Marketplace publication requires a root private key')
  return {
    marketplaceId: options.marketplaceId,
    rootKeyId: root.keyId,
    rootPrivateKey: root.privateKey,
    publicBaseUrl: options.publicBaseUrl,
    ...(options.now ? { now: options.now } : {}),
    ...(options.publicationValidityMilliseconds === undefined
      ? {}
      : { validityMilliseconds: options.publicationValidityMilliseconds })
  }
}

export function createMarketplaceService(
  options: CreateMarketplaceServiceOptions
): MarketplaceService {
  const marketplaceId = parseMarketplaceIdentity(options.marketplaceId, 'marketplace id')
  const publicBaseURL = baseURL(options.publicBaseUrl)
  const root = options.root
    ? { ...options.root, keyId: parseMarketplaceIdentity(options.root.keyId, 'root key id') }
    : undefined
  const control = createMarketplaceControlReader(options.repository, options.now)

  async function latestSnapshotFromState(
    state: MarketplaceStateV1
  ): Promise<SignedMarketplaceSnapshotV1 | null> {
    const publication = state.publications.at(-1)
    if (!publication) return null
    const artifact = await options.artifacts.get(publication.snapshotArtifactDigest)
    if (!artifact) throw new Error('Published marketplace snapshot artifact is unavailable')
    const snapshot = parseMarketplaceSnapshotBytes(artifact.bytes)
    if (snapshot.integrity.digest !== publication.snapshotDigest) {
      throw new Error('Published marketplace snapshot digest does not match repository state')
    }
    return snapshot
  }

  async function latestVerifiedSnapshotFromState(
    state: MarketplaceStateV1,
    at: string
  ): Promise<VerifiedMarketplaceSnapshot | null> {
    const snapshot = await latestSnapshotFromState(state)
    if (!snapshot) return null
    if (!root?.publicKey) throw new Error('Marketplace root public key is not configured')
    return verifyMarketplaceSnapshot(snapshot, root.publicKey, {
      expectedMarketplaceId: marketplaceId,
      expectedKeyId: root.keyId,
      now: at
    })
  }

  function immutablePublicState(): Promise<MarketplaceStateV1> {
    return options.repository.immutableSnapshot
      ? options.repository.immutableSnapshot()
      : options.repository.snapshot()
  }

  return {
    control,
    marketplaceId,
    snapshot: () => options.repository.snapshot(),
    async registerPublisher(input, context) {
      const id = parseMarketplaceIdentity(input.publisher.id, 'publisher id')
      if (input.key.publisherId !== id) {
        throw new TypeError('Initial publisher key must belong to the registered publisher')
      }
      if (input.publisher.displayName.length > 128) {
        throw new TypeError('Publisher display name exceeds the public snapshot limit')
      }
      const canonical = await canonicalPublicKey(input.key)
      const mutationContext = normalizedContext(context, currentTime(options.now))
      return options.repository.transaction(async (transaction) => {
        const publisher = await transaction.createPublisher(
          { id, displayName: input.publisher.displayName },
          mutationContext
        )
        await transaction.registerPublisherKey(canonical.input, mutationContext)
        return publisher
      })
    },
    async registerPublisherKey(input, context) {
      const canonical = await canonicalPublicKey(input)
      return options.repository.transaction((transaction) =>
        transaction.registerPublisherKey(
          canonical.input,
          normalizedContext(context, currentTime(options.now))
        )
      )
    },
    transitionPublisher(publisherId, status, context, authorityDigest, activationIntent) {
      const mutationContext = normalizedContext(context, currentTime(options.now))
      return options.repository.transaction(async (transaction) => {
        const state = transaction.snapshot()
        if (activationIntent !== undefined) {
          if (status !== 'active') {
            throw new TypeError('Publisher activation intent requires active target status')
          }
          const expectedStatus = activationIntent === 'approve' ? 'pending' : 'suspended'
          const current = state.publishers.find(({ id }) => id === publisherId)
          if (current?.status !== expectedStatus) {
            throw new MarketplaceImpactAuthorityError(
              `Publisher ${activationIntent} requires current ${expectedStatus} status`
            )
          }
        }
        await assertMarketplaceImpactAuthority(
          state,
          {
            operation: 'publisher.status',
            publisherId,
            status,
            reason: mutationContext.reason ?? null
          },
          mutationContext.time as string,
          authorityDigest
        )
        return transaction.transitionPublisher(publisherId, status, mutationContext)
      })
    },
    transitionPublisherKey(keyId, status, context, authorityDigest) {
      const mutationContext = normalizedContext(context, currentTime(options.now))
      return options.repository.transaction(async (transaction) => {
        await assertMarketplaceImpactAuthority(
          transaction.snapshot(),
          {
            operation: 'publisher-key.status',
            keyId,
            status,
            reason: mutationContext.reason ?? null
          },
          mutationContext.time as string,
          authorityDigest
        )
        return transaction.transitionPublisherKey(keyId, status, mutationContext)
      })
    },
    requestOwnership(pluginId, publisherId, context) {
      return options.repository.transaction((transaction) =>
        transaction.requestOwnership(
          { pluginId, publisherId },
          normalizedContext(context, currentTime(options.now))
        )
      )
    },
    transitionOwnership(pluginId, status, context, authorityDigest) {
      const mutationContext = normalizedContext(context, currentTime(options.now))
      return options.repository.transaction(async (transaction) => {
        await assertMarketplaceImpactAuthority(
          transaction.snapshot(),
          {
            operation: 'ownership.status',
            pluginId,
            status,
            reason: mutationContext.reason ?? null
          },
          mutationContext.time as string,
          authorityDigest
        )
        return transaction.transitionOwnership(pluginId, status, mutationContext)
      })
    },
    async submit(input, context) {
      const submittedAt = context.time ?? currentTime(options.now)
      const initialState = await options.repository.snapshot()
      const prepared = await prepareSubmission(
        options,
        publicBaseURL,
        initialState,
        input,
        submittedAt
      )
      const mutationContext = normalizedContext(context, submittedAt)
      return options.repository.transaction(async (transaction) => {
        const currentKey = transaction
          .snapshot()
          .publisherKeys.find(({ keyId }) => keyId === prepared.validation.signingKeyId)
        if (currentKey?.publicKeyPem !== prepared.signingPublicKeyPem) {
          throw new Error('Publisher trust changed while the submission was being verified')
        }
        const submission = await transaction.createSubmission(
          {
            id: parseMarketplaceIdentity(input.id, 'submission id'),
            publisherId: prepared.validation.publisherId,
            coordinate: prepared.validation.coordinate,
            manifestDigest: prepared.validation.manifestDigest,
            artifactDigest: prepared.validation.artifactDigest,
            manifestUrl: artifactURL(publicBaseURL, prepared.validation.artifactDigest),
            listing: prepared.listing,
            listingDigest: prepared.validation.listingDigest,
            runtimeCoordinate: prepared.runtimeCoordinate,
            signingKeyId: prepared.validation.signingKeyId,
            authenticatedRequestKeyId: prepared.validation.authenticatedRequestKeyId
          },
          mutationContext
        )
        await transaction.transitionSubmission(submission.id, 'awaiting_review', mutationContext)
        await persistPreparedSubmissionArtifacts(options.artifacts, prepared)
        return transaction
          .snapshot()
          .submissions.find(({ id }) => id === submission.id) as MarketplaceSubmissionV1
      })
    },
    async validateSubmission(input) {
      const state = await options.repository.snapshot()
      return (
        await prepareSubmission(options, publicBaseURL, state, input, currentTime(options.now))
      ).validation
    },
    async reviseSubmission(submissionIdValue, input, context) {
      const submissionId = parseMarketplaceIdentity(submissionIdValue, 'submission id')
      const publisherId = parseMarketplaceIdentity(input.publisherId, 'publisher id')
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
        throw new TypeError('expectedRevision must be a positive safe integer')
      }
      const revisedAt = context.time ?? currentTime(options.now)
      const initialState = await options.repository.snapshot()
      const current = initialState.submissions.find(({ id }) => id === submissionId)
      if (!current || current.publisherId !== publisherId) {
        throw new Error('Submission does not belong to the authenticated publisher')
      }
      if (current.status !== 'validation_failed' && current.status !== 'changes_requested') {
        throw new Error(`Submission cannot be revised from ${current.status}`)
      }
      if (current.revision !== input.expectedRevision) {
        throw new Error('Submission revision changed before validation')
      }
      if (current.coordinate.channel !== input.channel) {
        throw new Error('Submission revision cannot change its release coordinate channel')
      }
      const prepared = await prepareSubmission(
        options,
        publicBaseURL,
        initialState,
        {
          id: submissionId,
          publisherId,
          channel: input.channel,
          manifest: input.manifest,
          listing: input.listing,
          ...(input.runtimePackage === undefined ? {} : { runtimePackage: input.runtimePackage }),
          authenticatedRequestKeyId:
            context.authenticatedRequestKeyId ??
            parseVersionedPluginManifest(input.manifest).publisher.keyId
        },
        revisedAt,
        submissionId
      )
      if (
        prepared.validation.coordinate.pluginId !== current.coordinate.pluginId ||
        prepared.validation.coordinate.version !== current.coordinate.version ||
        prepared.validation.coordinate.channel !== current.coordinate.channel
      ) {
        throw new Error('Submission revision cannot change its release coordinate')
      }
      if (prepared.validation.manifestDigest === current.manifestDigest) {
        throw new Error('Submission revision must use a newly signed manifest')
      }
      const mutationContext = normalizedContext(
        { actor: context.actor, ...(context.reason ? { reason: context.reason } : {}) },
        revisedAt
      )
      return options.repository.transaction(async (transaction) => {
        const revised = await transaction.reviseSubmission(
          {
            id: submissionId,
            publisherId,
            coordinate: prepared.validation.coordinate,
            manifestDigest: prepared.validation.manifestDigest,
            artifactDigest: prepared.validation.artifactDigest,
            manifestUrl: artifactURL(publicBaseURL, prepared.validation.artifactDigest),
            listing: prepared.listing,
            listingDigest: prepared.validation.listingDigest,
            runtimeCoordinate: prepared.runtimeCoordinate,
            signingKeyId: prepared.validation.signingKeyId,
            authenticatedRequestKeyId: prepared.validation.authenticatedRequestKeyId
          },
          input.expectedRevision,
          mutationContext
        )
        await persistPreparedSubmissionArtifacts(options.artifacts, prepared)
        return revised
      })
    },
    transitionSubmission(submissionId, status, context, authorityDigest) {
      const mutationContext = normalizedContext(context, currentTime(options.now))
      return options.repository.transaction(async (transaction) => {
        await assertMarketplaceImpactAuthority(
          transaction.snapshot(),
          {
            operation: 'submission.status',
            submissionId,
            status,
            reason: mutationContext.reason ?? null
          },
          mutationContext.time as string,
          authorityDigest
        )
        return transaction.transitionSubmission(submissionId, status, mutationContext)
      })
    },
    withdrawSubmission(submissionId, publisherId, reason, context) {
      const parsedReason = parseMarketplaceReason(reason, 'withdrawal reason')
      return options.repository.transaction((transaction) => {
        const submission = transaction.snapshot().submissions.find(({ id }) => id === submissionId)
        if (!submission || submission.publisherId !== publisherId) {
          throw new Error('Submission does not belong to the authenticated publisher')
        }
        if (submission.status === 'published' || submission.status === 'yanked') {
          throw new Error(
            'Published submissions cannot be withdrawn; an administrator must yank them'
          )
        }
        return transaction.transitionSubmission(submissionId, 'withdrawn', {
          ...context,
          reason: parsedReason,
          time: context.time ?? currentTime(options.now)
        })
      })
    },
    publishSubmission(submissionId, context, authorityDigest) {
      const mutationContext = normalizedContext(context, currentTime(options.now))
      return options.repository.transaction(async (transaction) => {
        const state = transaction.snapshot()
        await assertMarketplaceImpactAuthority(
          state,
          { operation: 'submission.publish', submissionId },
          mutationContext.time as string,
          authorityDigest
        )
        const submission = state.submissions.find(({ id }) => id === submissionId)
        if (!submission) throw new Error(`Submission ${submissionId} does not exist`)
        const verifiedSigningKeyId = (
          await verifySubmissionArtifacts(
            options,
            publicBaseURL,
            state,
            submission,
            mutationContext.time as string,
            true
          )
        ).signingKeyId
        if (submission.signingKeyId === null) {
          await transaction.pinLegacySubmissionSigningKey(
            submissionId,
            verifiedSigningKeyId,
            mutationContext
          )
        }
        return transaction.publishSubmission(submissionId, mutationContext)
      })
    },
    yankRelease(coordinate, context, authorityDigest) {
      const mutationContext = normalizedContext(context, currentTime(options.now))
      return options.repository.transaction(async (transaction) => {
        await assertMarketplaceImpactAuthority(
          transaction.snapshot(),
          {
            operation: 'release.yank',
            coordinate,
            reason: mutationContext.reason as string
          },
          mutationContext.time as string,
          authorityDigest
        )
        return transaction.yankRelease(coordinate, mutationContext)
      })
    },
    async publish(context, authorityDigest) {
      if (!root) throw new Error('Marketplace root trust is not configured')
      if (!root.publicKey) {
        throw new Error('Marketplace publication requires the matching root public key')
      }
      const state = await options.repository.snapshot()
      await assertMarketplaceImpactAuthority(
        state,
        { operation: 'marketplace.publish' },
        context.time ?? currentTime(options.now),
        authorityDigest
      )
      const prepared = await prepareMarketplacePublication(
        state,
        options.artifacts,
        publicationConfig({ ...options, marketplaceId, publicBaseUrl: publicBaseURL }, root)
      )
      await verifyMarketplaceSnapshot(prepared.snapshot, root.publicKey, {
        expectedMarketplaceId: marketplaceId,
        expectedKeyId: root.keyId,
        now: prepared.snapshot.generatedAt
      })
      const publication = await options.repository.transaction(async (transaction) => {
        const current = transaction.snapshot()
        const auditHead = current.auditEvents.at(-1)?.eventHash
        const nextSequence = (current.publications.at(-1)?.sequence ?? 0) + 1
        if (
          current.auditEvents.length !== prepared.auditSequence ||
          auditHead !== prepared.auditHead ||
          nextSequence !== prepared.sequence
        ) {
          throw new Error('Marketplace state changed while publication artifacts were prepared')
        }
        return transaction.recordPublication(prepared.record, {
          ...context,
          time: prepared.snapshot.generatedAt
        })
      })
      return { publication, prepared }
    },
    async previewImpact(input) {
      return createMarketplaceImpactPreview(
        await options.repository.snapshot(),
        input,
        currentTime(options.now)
      )
    },
    async submissionPresentation(submissionIdValue, publisherIdValue) {
      const submissionId = parseMarketplaceIdentity(submissionIdValue, 'submission id')
      const publisherId = parseMarketplaceIdentity(publisherIdValue, 'publisher id')
      const state = await options.repository.snapshot()
      const submission = state.submissions.find(
        (candidate) => candidate.id === submissionId && candidate.publisherId === publisherId
      )
      if (!submission) return null
      const verified = await verifySubmissionArtifacts(
        options,
        publicBaseURL,
        state,
        submission,
        currentTime(options.now),
        false
      )
      return createMarketplaceSubmissionPresentation(
        submission,
        verified.manifest,
        verified.runtime
      )
    },
    async submissionRevisionDiff(submissionIdValue, publisherIdValue, fromRevision, toRevision) {
      const submissionId = parseMarketplaceIdentity(submissionIdValue, 'submission id')
      const publisherId = parseMarketplaceIdentity(publisherIdValue, 'publisher id')
      if (
        !Number.isSafeInteger(fromRevision) ||
        !Number.isSafeInteger(toRevision) ||
        fromRevision < 1 ||
        toRevision < 1 ||
        fromRevision >= toRevision
      ) {
        throw new TypeError('Submission revision diff must compare an older positive revision')
      }
      const state = await options.repository.snapshot()
      const submission = state.submissions.find(
        (candidate) => candidate.id === submissionId && candidate.publisherId === publisherId
      )
      if (!submission) return null
      const fromSubmission = submissionAtRevision(submission, fromRevision)
      const toSubmission = submissionAtRevision(submission, toRevision)
      const at = currentTime(options.now)
      const [fromVerified, toVerified] = await Promise.all([
        verifySubmissionArtifacts(options, publicBaseURL, state, fromSubmission, at, false),
        verifySubmissionArtifacts(options, publicBaseURL, state, toSubmission, at, false)
      ])
      const fromPresentation = createMarketplaceSubmissionPresentation(
        fromSubmission,
        fromVerified.manifest,
        fromVerified.runtime
      )
      const toPresentation = createMarketplaceSubmissionPresentation(
        toSubmission,
        toVerified.manifest,
        toVerified.runtime
      )
      return createMarketplaceSubmissionRevisionDiff(
        fromSubmission,
        toSubmission,
        fromPresentation,
        toPresentation
      )
    },
    async submissionCurrentCheckReport(submissionIdValue) {
      const submissionId = parseMarketplaceIdentity(submissionIdValue, 'submission id')
      const state = await options.repository.snapshot()
      const submission = state.submissions.find(({ id }) => id === submissionId)
      if (!submission) return null
      const evaluatedAt = currentTime(options.now)
      const { verifiedManifest, verifiedRuntime, runtimeArtifactDigest } =
        await inspectMarketplaceSubmissionAssurance(
          options,
          publicBaseURL,
          state,
          submission,
          evaluatedAt
        )
      const publisherActive = state.publishers.some(
        ({ id, status }) => id === submission.publisherId && status === 'active'
      )
      const ownershipActive = state.ownerships.some(
        ({ pluginId, publisherId, status }) =>
          pluginId === submission.coordinate.pluginId &&
          publisherId === submission.publisherId &&
          status === 'active'
      )
      const signingKeyActive =
        submission.signingKeyId !== null &&
        verifiedManifest !== null &&
        verifiedManifest.signingKeyId === submission.signingKeyId &&
        findActiveMarketplacePublisherKey(
          state,
          submission.publisherId,
          submission.signingKeyId,
          Date.parse(evaluatedAt)
        ) !== null
      const listingDigestValid =
        marketplaceListingDigest(submission.listing) === submission.listingDigest
      const manifestValid = verifiedManifest !== null
      let runtimeStatus: 'pass' | 'fail' | 'not_applicable' = 'not_applicable'
      if (submission.runtimeCoordinate) {
        runtimeStatus =
          verifiedRuntime &&
          runtimeArtifactDigest !== null &&
          verifiedRuntime.artifactDigest === runtimeArtifactDigest
            ? 'pass'
            : 'fail'
      }
      const checks = [
        marketplaceSubmissionCheck('publisher-active', publisherActive ? 'pass' : 'fail'),
        marketplaceSubmissionCheck('ownership-active', ownershipActive ? 'pass' : 'fail'),
        marketplaceSubmissionCheck('signing-key-active', signingKeyActive ? 'pass' : 'fail'),
        marketplaceSubmissionCheck('listing-digest-binding', listingDigestValid ? 'pass' : 'fail'),
        marketplaceSubmissionCheck(
          'manifest-artifact-signature-binding',
          manifestValid ? 'pass' : 'fail'
        ),
        marketplaceSubmissionCheck('runtime-artifact-signature-binding', runtimeStatus)
      ] as const
      return parseMarketplaceSubmissionCurrentCheckReport({
        schemaVersion: 1,
        scope: 'current',
        evaluatedAt,
        binding: {
          submissionId: submission.id,
          revision: submission.revision,
          publisherId: submission.publisherId,
          signingKeyId: submission.signingKeyId,
          coordinate: submission.coordinate,
          manifestDigest: submission.manifestDigest,
          artifactDigest: submission.artifactDigest,
          listingDigest: submission.listingDigest,
          runtime: submission.runtimeCoordinate
            ? {
                packageDigest: submission.runtimeCoordinate.packageDigest,
                artifactDigest: runtimeArtifactDigest,
                byteLength: submission.runtimeCoordinate.byteLength,
                kind: submission.runtimeCoordinate.kind
              }
            : null
        },
        valid: checks.every(({ status }) => status !== 'fail'),
        checks
      })
    },
    async submissionReviewerHistory(submissionId, query) {
      return createMarketplaceSubmissionReviewerHistory(
        await options.repository.snapshot(),
        submissionId,
        query
      )
    },
    async resolveActivePublisherKey(publisherId, keyId) {
      const state = await options.repository.snapshot()
      try {
        const trust = activePublisherKey(
          state,
          publisherId,
          keyId,
          Date.parse(currentTime(options.now))
        )
        return await importEd25519PublicKeyPem(trust.key.publicKeyPem)
      } catch {
        return null
      }
    },
    artifact: (digest) => options.artifacts.get(digest),
    async publicArtifact(digest) {
      const state = await immutablePublicState()
      const isPublic =
        state.releases.some(
          (release) =>
            release.artifactDigest === digest ||
            release.runtimeCoordinate?.packageUrl.endsWith(`/v1/artifacts/${digest}`)
        ) ||
        state.publications.some(
          (publication) =>
            publication.snapshotArtifactDigest === digest ||
            publication.runtimeIndexArtifactDigest === digest ||
            publication.catalogs.some(({ artifactDigest }) => artifactDigest === digest)
        )
      return isPublic ? options.artifacts.get(digest) : null
    },
    async latestSnapshotArtifact() {
      const publication = (await immutablePublicState()).publications.at(-1)
      if (!publication) return null
      const artifact = await options.artifacts.get(publication.snapshotArtifactDigest)
      if (!artifact) throw new Error('Published marketplace snapshot artifact is unavailable')
      return artifact
    },
    async latestSnapshot() {
      const state = await options.repository.snapshot()
      return latestSnapshotFromState(state)
    },
    async latestVerifiedSnapshot() {
      const state = await options.repository.snapshot()
      return latestVerifiedSnapshotFromState(state, currentTime(options.now))
    },
    async latestCatalog(channel) {
      if (!MARKETPLACE_RELEASE_CHANNELS.includes(channel)) {
        throw new TypeError('Marketplace catalog channel must be stable or beta')
      }
      const publication = (await immutablePublicState()).publications.at(-1)
      const digest = publication?.catalogs.find(
        (catalog) => catalog.channel === channel
      )?.artifactDigest
      return digest ? options.artifacts.get(digest) : null
    },
    async latestRuntimeIndex() {
      const publication = (await immutablePublicState()).publications.at(-1)
      return publication?.runtimeIndexArtifactDigest
        ? options.artifacts.get(publication.runtimeIndexArtifactDigest)
        : null
    },
    async search(searchOptions = {}) {
      const state = await immutablePublicState()
      const at = currentTime(options.now)
      const snapshot = await latestVerifiedSnapshotFromState(state, at)
      if (!snapshot) return []
      const listings = projectLiveMarketplaceListings(state, snapshot, Date.parse(at))
      return searchLiveMarketplaceListings(snapshot, listings, searchOptions)
    },
    async listing(pluginId) {
      const id = parseMarketplaceIdentity(pluginId, 'marketplace plugin id')
      const state = await immutablePublicState()
      const at = currentTime(options.now)
      const snapshot = await latestVerifiedSnapshotFromState(state, at)
      if (!snapshot) return null
      return (
        projectLiveMarketplaceListings(state, snapshot, Date.parse(at)).find(
          (candidate) => candidate.pluginId === id
        ) ?? null
      )
    },
    async publicAuditPage(query = {}) {
      const keys = Object.keys(query)
      if (keys.some((key) => key !== 'after' && key !== 'limit')) {
        throw new TypeError('Public audit query contains unknown fields')
      }
      const after = query.after ?? 0
      if (!Number.isSafeInteger(after) || after < 0) {
        throw new TypeError('Public audit after must be a non-negative safe integer')
      }
      const limit = query.limit ?? MARKETPLACE_PUBLIC_AUDIT_PAGE_LIMITS.defaultPageSize
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > MARKETPLACE_PUBLIC_AUDIT_PAGE_LIMITS.maxPageSize
      ) {
        throw new TypeError(
          `Public audit limit must be between 1 and ${MARKETPLACE_PUBLIC_AUDIT_PAGE_LIMITS.maxPageSize}`
        )
      }
      const auditEvents = (await immutablePublicState()).auditEvents
      if (after > auditEvents.length) {
        throw new TypeError('Public audit after references an unavailable sequence')
      }
      const end = Math.min(after + limit, auditEvents.length)
      return Object.freeze({
        events: Object.freeze(auditEvents.slice(after, end)),
        head: auditEvents.at(-1)?.eventHash ?? null,
        nextAfter: end < auditEvents.length ? end : null
      })
    }
  }
}
