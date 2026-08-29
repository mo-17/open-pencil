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
import { MARKETPLACE_REQUEST_AUTH_LIMITS, type MarketplaceNonceStore } from './auth'
import {
  toMarketplaceControlPublisherKey,
  toMarketplaceControlSubmissionSummary
} from './control-contract'
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
  MarketplacePublisherMutationTerminalError,
  MarketplacePublisherMutationCommitPlan,
  createMarketplacePublisherMutationResponse,
  type MarketplacePublisherMutationExecution,
  type MarketplacePublisherMutationTerminalCode,
  type MarketplaceVerifiedPublisherMutationRequest
} from './publisher/idempotency'
import { findActiveMarketplacePublisherKey } from './publisher/trust'
import {
  MarketplacePublisherMutationAuthorityError,
  assertActiveMarketplacePublisherMutationAuthority,
  type MarketplacePublisherMutationAuthority,
  type MarketplaceRepository
} from './repository'
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
  canTransitionMarketplaceSubmission,
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
}

export interface CreateMarketplaceServiceOptions {
  repository: MarketplaceRepository
  artifacts: MarketplaceArtifactStore
  marketplaceId: string
  publicBaseUrl: string
  root?: MarketplaceRootTrust
  now?: () => Date
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

export type MarketplacePublisherMutationCommand =
  | { readonly type: 'publisher.register'; readonly input: RegisterMarketplacePublisherInput }
  | {
      readonly type: 'ownership.request'
      readonly pluginId: string
      readonly publisherId: string
    }
  | {
      readonly type: 'key.rotate'
      readonly input: RegisterMarketplacePublisherKeyInput
    }
  | {
      readonly type: 'submission.create'
      readonly input: SubmitMarketplacePluginInput
    }
  | {
      readonly type: 'submission.revise'
      readonly submissionId: string
      readonly input: Omit<ReviseMarketplaceSubmissionInput, 'channel'>
    }
  | {
      readonly type: 'submission.withdraw'
      readonly submissionId: string
      readonly publisherId: string
      readonly reason: string
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
  readonly nonces: MarketplaceNonceStore
  snapshot(): Promise<MarketplaceStateV1>
  registerPublisher(
    input: RegisterMarketplacePublisherInput,
    context: MarketplaceMutationContext
  ): Promise<MarketplacePublisherV1>
  registerPublisherKey(
    input: RegisterMarketplacePublisherKeyInput,
    context: MarketplaceMutationContext,
    authority?: MarketplacePublisherMutationAuthority
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
    context: MarketplaceMutationContext,
    authority?: MarketplacePublisherMutationAuthority
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
  executePublisherMutation(
    request: MarketplaceVerifiedPublisherMutationRequest,
    command: MarketplacePublisherMutationCommand,
    verifiedAt: number
  ): Promise<MarketplacePublisherMutationExecution>
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
    context: Omit<MarketplaceMutationContext, 'reason'>,
    authority?: MarketplacePublisherMutationAuthority
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
  resolveActivePublisherKey(
    publisherId: string,
    keyId: string,
    verifiedAt?: number
  ): Promise<CryptoKey | null>
  resolvePublisherKey(publisherId: string, keyId: string): Promise<CryptoKey | null>
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

function isolatedPublisherMutationAuthority(
  authority: MarketplacePublisherMutationAuthority | undefined
): MarketplacePublisherMutationAuthority | undefined {
  if (!authority) return undefined
  return Object.freeze({
    publisherId: parseMarketplaceIdentity(authority.publisherId, 'authenticated publisher id'),
    keyId: parseMarketplaceIdentity(authority.keyId, 'authenticated publisher key id')
  })
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

interface PublisherMutationExecutionContext {
  readonly options: CreateMarketplaceServiceOptions
  readonly publicBaseURL: string
  readonly request: MarketplaceVerifiedPublisherMutationRequest
  readonly actor: string
  readonly mutationTime: string
  readonly serverTime: number
}

type PublisherCommand<Type extends MarketplacePublisherMutationCommand['type']> = Extract<
  MarketplacePublisherMutationCommand,
  { readonly type: Type }
>

function unsupportedPublisherMutation(command: never): never {
  throw new TypeError(`Unsupported Publisher mutation command: ${String(command)}`)
}

function terminalPublisherMutation(code: MarketplacePublisherMutationTerminalCode): never {
  throw new MarketplacePublisherMutationTerminalError(code)
}

function publisherMutationInput<Value>(operation: () => Value): Value {
  try {
    return operation()
  } catch (error) {
    if (error instanceof MarketplacePublisherMutationTerminalError) throw error
    if (error instanceof TypeError) terminalPublisherMutation('invalid-request')
    throw error
  }
}

async function publisherMutationInputAsync<Value>(operation: () => Promise<Value>): Promise<Value> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof MarketplacePublisherMutationTerminalError) throw error
    if (
      error instanceof TypeError ||
      (error instanceof DOMException &&
        (error.name === 'DataError' || error.name === 'OperationError'))
    ) {
      terminalPublisherMutation('invalid-request')
    }
    throw error
  }
}

function assertPublisherMutationAuthority(
  state: MarketplaceStateV1,
  request: MarketplaceVerifiedPublisherMutationRequest,
  publisherId: string,
  mutationTime: string
): void {
  try {
    assertActiveMarketplacePublisherMutationAuthority(state, request, publisherId, mutationTime)
  } catch (error) {
    if (error instanceof MarketplacePublisherMutationAuthorityError) {
      terminalPublisherMutation('authority-inactive')
    }
    throw error
  }
}

async function preparePublisherSubmission(
  context: PublisherMutationExecutionContext,
  state: MarketplaceStateV1,
  input: SubmitMarketplacePluginInput,
  allowedSubmissionId?: string
): Promise<PreparedMarketplaceSubmission> {
  try {
    return await prepareSubmission(
      context.options,
      context.publicBaseURL,
      state,
      input,
      context.mutationTime,
      allowedSubmissionId
    )
  } catch (error) {
    if (error instanceof MarketplacePublisherMutationTerminalError) throw error
    if (
      error instanceof TypeError ||
      (error instanceof DOMException &&
        (error.name === 'DataError' || error.name === 'OperationError'))
    ) {
      terminalPublisherMutation('invalid-request')
    }
    if (error instanceof Error) {
      if (
        /^Publisher .+ is not active$/.test(error.message) ||
        /^Publisher key .+ is not active at the submission time$/.test(error.message) ||
        /^Authenticated request key .+ is not active at the submission time$/.test(error.message)
      ) {
        terminalPublisherMutation('authority-inactive')
      }
      if (
        error.message === 'Publisher does not own the submitted plugin id' ||
        /^Submission .+ already exists$/.test(error.message) ||
        /^Release coordinate .+ already has a submission$/.test(error.message)
      ) {
        terminalPublisherMutation('state-conflict')
      }
      if (
        error.message === 'Plugin manifest publisher does not match the authenticated publisher' ||
        error.message === 'Plugin manifest digest mismatch' ||
        error.message === 'Plugin manifest signature verification failed' ||
        error.message.startsWith('Plugin requires OpenPencil ')
      ) {
        terminalPublisherMutation('invalid-request')
      }
    }
    throw error
  }
}

async function executePublisherRegistration(
  context: PublisherMutationExecutionContext,
  command: PublisherCommand<'publisher.register'>
): Promise<MarketplacePublisherMutationExecution> {
  const { actor, mutationTime, options, request } = context
  const id = publisherMutationInput(() =>
    parseMarketplaceIdentity(command.input.publisher.id, 'publisher id')
  )
  if (id === 'admin-assertion-v1' || id === 'admin-assertion-v2') {
    terminalPublisherMutation('invalid-request')
  }
  if (
    id !== request.publisherId ||
    command.input.key.publisherId !== request.publisherId ||
    command.input.key.keyId !== request.keyId
  ) {
    terminalPublisherMutation('authority-mismatch')
  }
  if (command.input.publisher.displayName.length > 128) {
    terminalPublisherMutation('invalid-request')
  }
  const existing = await options.repository.snapshot()
  if (
    existing.publishers.some(({ id: publisherId }) => publisherId === id) ||
    existing.publisherKeys.some(({ keyId }) => keyId === command.input.key.keyId)
  ) {
    terminalPublisherMutation('publisher-registration-conflict')
  }
  const canonical = await publisherMutationInputAsync(() => canonicalPublicKey(command.input.key))
  return options.repository.executePublisherMutation(
    request,
    context.serverTime,
    async (transaction) => {
      const current = transaction.snapshot()
      if (
        current.publishers.some(({ id: publisherId }) => publisherId === id) ||
        current.publisherKeys.some(({ keyId }) => keyId === canonical.input.keyId)
      ) {
        terminalPublisherMutation('publisher-registration-conflict')
      }
      const publisher = await transaction.createPublisher(
        { id, displayName: command.input.publisher.displayName },
        { actor, time: mutationTime }
      )
      await transaction.registerPublisherKey(canonical.input, { actor, time: mutationTime })
      return createMarketplacePublisherMutationResponse('publisher.register', publisher)
    }
  )
}

function executePublisherOwnership(
  context: PublisherMutationExecutionContext,
  command: PublisherCommand<'ownership.request'>
): Promise<MarketplacePublisherMutationExecution> {
  const { actor, mutationTime, options, request } = context
  const publisherId = publisherMutationInput(() =>
    parseMarketplaceIdentity(command.publisherId, 'publisher id')
  )
  if (publisherId !== request.publisherId) {
    terminalPublisherMutation('authority-mismatch')
  }
  const pluginId = publisherMutationInput(() =>
    parseMarketplaceIdentity(command.pluginId, 'ownership plugin id')
  )
  return options.repository.executePublisherMutation(
    request,
    context.serverTime,
    async (transaction) => {
      const current = transaction.snapshot()
      assertPublisherMutationAuthority(current, request, publisherId, mutationTime)
      if (current.ownerships.some((ownership) => ownership.pluginId === pluginId)) {
        terminalPublisherMutation('state-conflict')
      }
      const ownership = await transaction.requestOwnership(
        { pluginId, publisherId },
        { actor, time: mutationTime }
      )
      return createMarketplacePublisherMutationResponse('ownership.request', ownership)
    }
  )
}

async function executePublisherKeyRotation(
  context: PublisherMutationExecutionContext,
  command: PublisherCommand<'key.rotate'>
): Promise<MarketplacePublisherMutationExecution> {
  const { actor, mutationTime, options, request } = context
  const canonical = await publisherMutationInputAsync(() => canonicalPublicKey(command.input))
  if (
    canonical.input.publisherId !== request.publisherId ||
    canonical.input.predecessorKeyId !== request.keyId
  ) {
    terminalPublisherMutation('authority-mismatch')
  }
  return options.repository.executePublisherMutation(
    request,
    context.serverTime,
    async (transaction) => {
      const current = transaction.snapshot()
      assertPublisherMutationAuthority(current, request, canonical.input.publisherId, mutationTime)
      if (current.publisherKeys.some(({ keyId }) => keyId === canonical.input.keyId)) {
        terminalPublisherMutation('state-conflict')
      }
      const predecessor = current.publisherKeys.find(({ keyId }) => keyId === request.keyId)
      if (
        !predecessor ||
        Date.parse(predecessor.notBefore) >= Date.parse(canonical.input.notBefore)
      ) {
        terminalPublisherMutation('invalid-request')
      }
      const key = await transaction.registerPublisherKey(canonical.input, {
        actor,
        time: mutationTime
      })
      return createMarketplacePublisherMutationResponse(
        'key.rotate',
        toMarketplaceControlPublisherKey(key)
      )
    }
  )
}

async function executePublisherSubmissionCreation(
  context: PublisherMutationExecutionContext,
  command: PublisherCommand<'submission.create'>
): Promise<MarketplacePublisherMutationExecution> {
  const { actor, mutationTime, options, publicBaseURL, request } = context
  if (
    command.input.publisherId !== request.publisherId ||
    command.input.authenticatedRequestKeyId !== request.keyId
  ) {
    terminalPublisherMutation('authority-mismatch')
  }
  const initialState = await options.repository.snapshot()
  assertPublisherMutationAuthority(initialState, request, command.input.publisherId, mutationTime)
  const prepared = await preparePublisherSubmission(context, initialState, command.input)
  return options.repository.executePublisherMutation(
    request,
    context.serverTime,
    async (transaction) => {
      const current = transaction.snapshot()
      assertPublisherMutationAuthority(current, request, command.input.publisherId, mutationTime)
      const currentKey = current.publisherKeys.find(
        ({ keyId }) => keyId === prepared.validation.signingKeyId
      )
      if (currentKey?.publicKeyPem !== prepared.signingPublicKeyPem) {
        terminalPublisherMutation('state-conflict')
      }
      if (
        current.submissions.some(
          (submission) =>
            submission.id === command.input.id ||
            (submission.coordinate.pluginId === prepared.validation.coordinate.pluginId &&
              submission.coordinate.version === prepared.validation.coordinate.version &&
              submission.coordinate.channel === prepared.validation.coordinate.channel)
        )
      ) {
        terminalPublisherMutation('state-conflict')
      }
      const submission = await transaction.createSubmission(
        {
          id: parseMarketplaceIdentity(command.input.id, 'submission id'),
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
        { actor, time: mutationTime }
      )
      await transaction.transitionSubmission(submission.id, 'awaiting_review', {
        actor,
        time: mutationTime
      })
      const committed = transaction
        .snapshot()
        .submissions.find(({ id }) => id === submission.id) as MarketplaceSubmissionV1
      return new MarketplacePublisherMutationCommitPlan(
        'submission.create',
        createMarketplacePublisherMutationResponse(
          'submission.create',
          toMarketplaceControlSubmissionSummary(committed)
        ),
        () => persistPreparedSubmissionArtifacts(options.artifacts, prepared)
      )
    }
  )
}

async function executePublisherSubmissionRevision(
  context: PublisherMutationExecutionContext,
  command: PublisherCommand<'submission.revise'>
): Promise<MarketplacePublisherMutationExecution> {
  const { actor, mutationTime, options, publicBaseURL, request } = context
  const submissionId = publisherMutationInput(() =>
    parseMarketplaceIdentity(command.submissionId, 'submission id')
  )
  const publisherId = publisherMutationInput(() =>
    parseMarketplaceIdentity(command.input.publisherId, 'publisher id')
  )
  if (publisherId !== request.publisherId) {
    terminalPublisherMutation('resource-not-found')
  }
  if (!Number.isSafeInteger(command.input.expectedRevision) || command.input.expectedRevision < 1) {
    terminalPublisherMutation('invalid-request')
  }
  const initialState = await options.repository.snapshot()
  assertPublisherMutationAuthority(initialState, request, publisherId, mutationTime)
  const current = initialState.submissions.find(({ id }) => id === submissionId)
  if (!current || current.publisherId !== publisherId) {
    terminalPublisherMutation('resource-not-found')
  }
  if (current.status !== 'validation_failed' && current.status !== 'changes_requested') {
    terminalPublisherMutation('state-conflict')
  }
  if (current.revision !== command.input.expectedRevision) {
    terminalPublisherMutation('state-conflict')
  }
  const prepared = await preparePublisherSubmission(
    context,
    initialState,
    {
      id: submissionId,
      publisherId,
      channel: current.coordinate.channel,
      manifest: command.input.manifest,
      listing: command.input.listing,
      ...(command.input.runtimePackage === undefined
        ? {}
        : { runtimePackage: command.input.runtimePackage }),
      authenticatedRequestKeyId: request.keyId
    },
    submissionId
  )
  if (
    prepared.validation.coordinate.pluginId !== current.coordinate.pluginId ||
    prepared.validation.coordinate.version !== current.coordinate.version ||
    prepared.validation.coordinate.channel !== current.coordinate.channel
  ) {
    terminalPublisherMutation('state-conflict')
  }
  if (prepared.validation.manifestDigest === current.manifestDigest) {
    terminalPublisherMutation('state-conflict')
  }
  return options.repository.executePublisherMutation(
    request,
    context.serverTime,
    async (transaction) => {
      const transactionState = transaction.snapshot()
      assertPublisherMutationAuthority(transactionState, request, publisherId, mutationTime)
      const transactionSubmission = transactionState.submissions.find(
        ({ id }) => id === submissionId
      )
      if (!transactionSubmission || transactionSubmission.publisherId !== publisherId) {
        terminalPublisherMutation('resource-not-found')
      }
      if (
        (transactionSubmission.status !== 'validation_failed' &&
          transactionSubmission.status !== 'changes_requested') ||
        transactionSubmission.revision !== command.input.expectedRevision ||
        transactionSubmission.coordinate.pluginId !== prepared.validation.coordinate.pluginId ||
        transactionSubmission.coordinate.version !== prepared.validation.coordinate.version ||
        transactionSubmission.coordinate.channel !== prepared.validation.coordinate.channel
      ) {
        terminalPublisherMutation('state-conflict')
      }
      const currentSigningKey = transactionState.publisherKeys.find(
        ({ keyId }) => keyId === prepared.validation.signingKeyId
      )
      if (currentSigningKey?.publicKeyPem !== prepared.signingPublicKeyPem) {
        terminalPublisherMutation('state-conflict')
      }
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
        command.input.expectedRevision,
        { actor, time: mutationTime }
      )
      return new MarketplacePublisherMutationCommitPlan(
        'submission.revise',
        createMarketplacePublisherMutationResponse(
          'submission.revise',
          toMarketplaceControlSubmissionSummary(revised)
        ),
        () => persistPreparedSubmissionArtifacts(options.artifacts, prepared)
      )
    }
  )
}

function executePublisherSubmissionWithdrawal(
  context: PublisherMutationExecutionContext,
  command: PublisherCommand<'submission.withdraw'>
): Promise<MarketplacePublisherMutationExecution> {
  const { actor, mutationTime, options, request } = context
  const publisherId = publisherMutationInput(() =>
    parseMarketplaceIdentity(command.publisherId, 'publisher id')
  )
  if (publisherId !== request.publisherId) {
    terminalPublisherMutation('authority-mismatch')
  }
  const submissionId = publisherMutationInput(() =>
    parseMarketplaceIdentity(command.submissionId, 'submission id')
  )
  const reason = publisherMutationInput(() =>
    parseMarketplaceReason(command.reason, 'withdrawal reason')
  )
  return options.repository.executePublisherMutation(
    request,
    context.serverTime,
    async (transaction) => {
      const current = transaction.snapshot()
      assertPublisherMutationAuthority(current, request, publisherId, mutationTime)
      const submission = current.submissions.find(({ id }) => id === submissionId)
      if (!submission || submission.publisherId !== publisherId) {
        terminalPublisherMutation('resource-not-found')
      }
      if (!canTransitionMarketplaceSubmission(submission.status, 'withdrawn')) {
        terminalPublisherMutation('state-conflict')
      }
      const withdrawn = await transaction.transitionSubmission(submissionId, 'withdrawn', {
        actor,
        reason,
        time: mutationTime
      })
      return createMarketplacePublisherMutationResponse(
        'submission.withdraw',
        toMarketplaceControlSubmissionSummary(withdrawn)
      )
    }
  )
}

export function createMarketplaceService(
  options: CreateMarketplaceServiceOptions
): MarketplaceService {
  if (options.root && Object.hasOwn(options.root, 'privateKey')) {
    throw new TypeError(
      'Marketplace service does not accept Root private keys; use the offline publication signer'
    )
  }
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
    nonces: options.repository.nonces,
    snapshot: () => options.repository.snapshot(),
    async registerPublisher(input, context) {
      const id = parseMarketplaceIdentity(input.publisher.id, 'publisher id')
      if (id === 'admin-assertion-v1' || id === 'admin-assertion-v2') {
        throw new TypeError('Publisher id is reserved for a Marketplace authority namespace')
      }
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
    async registerPublisherKey(input, context, authority) {
      const mutationAuthority = isolatedPublisherMutationAuthority(authority)
      const canonical = await canonicalPublicKey(input)
      return options.repository.transaction((transaction) => {
        const mutationContext = normalizedContext(context, currentTime(options.now))
        if (mutationAuthority) {
          assertActiveMarketplacePublisherMutationAuthority(
            transaction.snapshot(),
            mutationAuthority,
            canonical.input.publisherId,
            mutationContext.time as string
          )
          if (canonical.input.predecessorKeyId !== mutationAuthority.keyId) {
            throw new MarketplacePublisherMutationAuthorityError(
              'Publisher key rotation is not bound to the authenticated predecessor key'
            )
          }
        }
        return transaction.registerPublisherKey(canonical.input, mutationContext)
      })
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
    requestOwnership(pluginId, publisherId, context, authority) {
      const mutationAuthority = isolatedPublisherMutationAuthority(authority)
      return options.repository.transaction((transaction) => {
        const mutationContext = normalizedContext(context, currentTime(options.now))
        if (mutationAuthority) {
          assertActiveMarketplacePublisherMutationAuthority(
            transaction.snapshot(),
            mutationAuthority,
            publisherId,
            mutationContext.time as string
          )
        }
        return transaction.requestOwnership({ pluginId, publisherId }, mutationContext)
      })
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
    async executePublisherMutation(request, command, verifiedAt) {
      if (request.operation !== command.type) {
        throw new TypeError('Publisher mutation command does not match its signed route')
      }
      const signedAt = Date.parse(request.timestamp)
      if (
        !Number.isSafeInteger(verifiedAt) ||
        !Number.isSafeInteger(signedAt) ||
        request.freshUntil !== signedAt + MARKETPLACE_REQUEST_AUTH_LIMITS.maxClockSkewMs ||
        Math.abs(verifiedAt - signedAt) > MARKETPLACE_REQUEST_AUTH_LIMITS.maxClockSkewMs
      ) {
        throw new TypeError('Publisher mutation verification time is invalid')
      }
      const serverTime = verifiedAt
      const mutationTime = new Date(serverTime).toISOString()
      const cached = await options.repository.inspectPublisherMutation(request, serverTime)
      if (cached) return cached
      const context: PublisherMutationExecutionContext = {
        options,
        publicBaseURL,
        request,
        actor: `publisher:${request.publisherId}`,
        mutationTime,
        serverTime
      }
      try {
        switch (command.type) {
          case 'publisher.register':
            return await executePublisherRegistration(context, command)
          case 'ownership.request':
            return await executePublisherOwnership(context, command)
          case 'key.rotate':
            return await executePublisherKeyRotation(context, command)
          case 'submission.create':
            return await executePublisherSubmissionCreation(context, command)
          case 'submission.revise':
            return await executePublisherSubmissionRevision(context, command)
          case 'submission.withdraw':
            return await executePublisherSubmissionWithdrawal(context, command)
        }
        return unsupportedPublisherMutation(command)
      } catch (error) {
        if (!(error instanceof MarketplacePublisherMutationTerminalError)) throw error
        return options.repository.executePublisherMutation(request, serverTime, async () => {
          throw error
        })
      }
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
    withdrawSubmission(submissionId, publisherId, reason, context, authority) {
      const parsedReason = parseMarketplaceReason(reason, 'withdrawal reason')
      const mutationAuthority = isolatedPublisherMutationAuthority(authority)
      return options.repository.transaction((transaction) => {
        const mutationContext = normalizedContext(
          { ...context, reason: parsedReason },
          context.time ?? currentTime(options.now)
        )
        if (mutationAuthority) {
          assertActiveMarketplacePublisherMutationAuthority(
            transaction.snapshot(),
            mutationAuthority,
            publisherId,
            mutationContext.time as string
          )
        }
        const submission = transaction.snapshot().submissions.find(({ id }) => id === submissionId)
        if (!submission || submission.publisherId !== publisherId) {
          throw new Error('Submission does not belong to the authenticated publisher')
        }
        if (submission.status === 'published' || submission.status === 'yanked') {
          throw new Error(
            'Published submissions cannot be withdrawn; an administrator must yank them'
          )
        }
        return transaction.transitionSubmission(submissionId, 'withdrawn', mutationContext)
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
    async resolveActivePublisherKey(publisherId, keyId, verifiedAt) {
      const state = await options.repository.snapshot()
      try {
        const at = verifiedAt ?? Date.parse(currentTime(options.now))
        if (!Number.isSafeInteger(at)) return null
        const trust = activePublisherKey(state, publisherId, keyId, at)
        return await importEd25519PublicKeyPem(trust.key.publicKeyPem)
      } catch {
        return null
      }
    },
    async resolvePublisherKey(publisherIdValue, keyIdValue) {
      const publisherId = parseMarketplaceIdentity(publisherIdValue, 'publisher id')
      const keyId = parseMarketplaceIdentity(keyIdValue, 'publisher key id')
      const state = await options.repository.snapshot()
      const key = state.publisherKeys.find(
        (candidate) => candidate.publisherId === publisherId && candidate.keyId === keyId
      )
      if (!key) return null
      try {
        return await importEd25519PublicKeyPem(key.publicKeyPem)
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
