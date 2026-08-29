/* eslint-disable max-lines -- Offline evidence verification and Root signing intentionally share one fail-closed trust boundary. */
import { createHash } from 'node:crypto'

import {
  MARKETPLACE_SNAPSHOT_FORMAT,
  MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
  MARKETPLACE_SNAPSHOT_LIMITS,
  PLUGIN_CATALOG_LIMITS,
  PLUGIN_RUNTIME_INDEX_LIMITS,
  parseMarketplaceSnapshotBytes,
  parsePluginCatalogBytes,
  parsePluginCatalogPayload,
  parsePluginRuntimeIndexBytes,
  parsePluginRuntimeIndexPayload,
  serializeMarketplaceSnapshot,
  serializePluginCatalog,
  serializePluginRuntimeIndex,
  signMarketplaceSnapshot,
  signPluginCatalog,
  signPluginRuntimeIndex,
  verifyMarketplaceCatalog,
  verifyMarketplaceRuntimeIndex,
  verifyMarketplaceSnapshot,
  type MarketplaceSnapshotPayloadV1,
  type SignedMarketplaceSnapshotV1,
  type SignedPluginCatalogV1,
  type SignedPluginRuntimeIndexV1
} from '@open-pencil/plugin-contracts'
import {
  assertEd25519PrivateKey,
  assertEd25519PublicKey,
  canonicalManifestJSON,
  decodeBase64URL,
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseSha256Base64URL,
  signEd25519,
  verifyEd25519,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import type { MarketplaceArtifactStore } from '../artifacts'
import { marketplaceAuditPayloadDigest, verifyMarketplaceAuditChain } from '../audit'
import { prepareMarketplacePublicationProjection } from '../publication'
import type { MarketplacePublicationReservationRepository } from '../repository'
import {
  MARKETPLACE_RELEASE_CHANNELS,
  parseMarketplaceAuditActor,
  parseMarketplacePublicURL,
  parseRecordMarketplacePublicationInput,
  parseMarketplaceState,
  parseMarketplaceTimestamp,
  type MarketplacePublicationCatalogV1,
  type MarketplacePublicationV1,
  type MarketplaceReleaseChannel,
  type MarketplaceStateV1,
  type RecordMarketplacePublicationInput
} from '../types'
import {
  MARKETPLACE_PUBLICATION_REQUEST_LIMITS,
  assertMarketplaceEmergencyPublicationReduction,
  assertMarketplacePublicationRequestState,
  assertMarketplacePublicationNoExpansion,
  marketplacePublicationRequestDigest,
  marketplacePublicationStateDigest,
  parseMarketplacePublicationRequestBytes,
  parseMarketplacePublicationRequestJSON,
  serializeMarketplacePublicationRequest,
  type MarketplacePublicationProjectionV1,
  type MarketplacePublicationRequestV1
} from './request'
import {
  MarketplacePublicationReservationConflictError,
  marketplacePublicationReservationFromRequest,
  sameMarketplacePublicationReservation,
  type MarketplacePublicationCompletionReceiptV1
} from './reservation'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export interface MarketplacePublicationEvidenceArtifact {
  readonly bytes: Uint8Array
}

export interface MarketplacePublicationEvidenceCatalog extends MarketplacePublicationEvidenceArtifact {
  readonly channel: MarketplaceReleaseChannel
}

export interface MarketplacePreviousPublicationEvidence {
  readonly snapshot: MarketplacePublicationEvidenceArtifact
  readonly catalogs: readonly MarketplacePublicationEvidenceCatalog[]
  readonly runtimeIndex: MarketplacePublicationEvidenceArtifact | null
}

export interface VerifyMarketplacePreviousPublicationEvidenceInput {
  readonly state: unknown
  readonly previousPublication: MarketplacePreviousPublicationEvidence
  readonly marketplaceId: string
  readonly rootKeyId: string
  readonly publicBaseUrl: string
}

export interface VerifyMarketplacePublicationRequestEvidenceInput {
  readonly requestBytes: Uint8Array
  readonly state: unknown
  readonly previousPublication: MarketplacePreviousPublicationEvidence | null
}

export interface VerifiedMarketplacePublicationRequestEvidence {
  readonly request: MarketplacePublicationRequestV1
  readonly requestDigest: string
  readonly state: MarketplaceStateV1
  readonly reconstructedBaseline: MarketplacePublicationProjectionV1 | null
}

export interface SignMarketplacePublicationRequestOptions extends VerifyMarketplacePublicationRequestEvidenceInput {
  readonly rootPublicKey: CryptoKey
  readonly rootPrivateKey: CryptoKey
  readonly artifacts: MarketplaceArtifactStore
  readonly policyStore: MarketplaceOfflineSignerPolicyStore
  readonly now?: () => number
}

export interface OfflineMarketplacePublicationArtifact<Value> {
  readonly value: Value
  readonly bytes: Uint8Array
  readonly payloadDigest: string
  readonly artifactDigest: string
}

export interface OfflineMarketplacePublicationCatalog extends OfflineMarketplacePublicationArtifact<SignedPluginCatalogV1> {
  readonly channel: MarketplaceReleaseChannel
}

export interface OfflineMarketplacePublication {
  readonly request: MarketplacePublicationRequestV1
  readonly requestDigest: string
  readonly stateDigest: string
  readonly sequence: number
  readonly snapshot: OfflineMarketplacePublicationArtifact<SignedMarketplaceSnapshotV1>
  readonly catalogs: readonly OfflineMarketplacePublicationCatalog[]
  readonly runtimeIndex: OfflineMarketplacePublicationArtifact<SignedPluginRuntimeIndexV1> | null
  readonly record: RecordMarketplacePublicationInput
  readonly authorization: MarketplacePublicationAuthorizationV1
}

export const MARKETPLACE_PUBLICATION_AUTHORIZATION_FORMAT =
  'openpencil-marketplace-publication-authorization' as const
export const MARKETPLACE_PUBLICATION_AUTHORIZATION_SCHEMA_VERSION = 1 as const
export const MARKETPLACE_PUBLICATION_AUTHORIZATION_ALGORITHM = 'Ed25519' as const

export interface MarketplacePublicationAuthorizationPayloadV1 {
  readonly format: typeof MARKETPLACE_PUBLICATION_AUTHORIZATION_FORMAT
  readonly schemaVersion: typeof MARKETPLACE_PUBLICATION_AUTHORIZATION_SCHEMA_VERSION
  readonly marketplaceId: string
  readonly rootKeyId: string
  readonly sequence: number
  readonly requestDigest: string
  readonly stateDigest: string
  readonly record: RecordMarketplacePublicationInput
}

export interface MarketplacePublicationAuthorizationV1 {
  readonly algorithm: typeof MARKETPLACE_PUBLICATION_AUTHORIZATION_ALGORITHM
  readonly keyId: string
  readonly value: string
}

export const MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_FORMAT =
  'openpencil-marketplace-signed-publication' as const
export const MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_SCHEMA_VERSION = 1 as const
export const MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_LIMITS = Object.freeze({
  maxJsonBytes: 96 * 1024 * 1024,
  maxEmbeddedRequestBytes: 32 * 1024 * 1024
})

export interface MarketplaceSignedPublicationBundleCatalogV1 {
  readonly channel: MarketplaceReleaseChannel
  readonly json: string
}

export interface MarketplaceSignedPublicationBundleV1 {
  readonly format: typeof MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_FORMAT
  readonly schemaVersion: typeof MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_SCHEMA_VERSION
  readonly marketplaceId: string
  readonly rootKeyId: string
  readonly sequence: number
  readonly requestDigest: string
  readonly stateDigest: string
  readonly requestJson: string
  readonly snapshotJson: string
  readonly catalogs: readonly MarketplaceSignedPublicationBundleCatalogV1[]
  readonly runtimeIndexJson: string | null
  readonly record: RecordMarketplacePublicationInput
  readonly authorization: MarketplacePublicationAuthorizationV1
}

export interface VerifyMarketplaceSignedPublicationBundleOptions {
  readonly state: unknown
  readonly previousPublication: MarketplacePreviousPublicationEvidence | null
  readonly rootPublicKey: CryptoKey
  readonly now?: () => number
}

export interface ImportMarketplaceSignedPublicationBundleOptions {
  readonly bundle: unknown
  readonly repository: MarketplacePublicationReservationRepository
  readonly artifacts: MarketplaceArtifactStore
  readonly rootPublicKey: CryptoKey
  readonly actor: string
  readonly now?: () => number
}

export interface ImportedMarketplaceSignedPublication {
  readonly publication: MarketplacePublicationV1
  readonly verified: OfflineMarketplacePublication
}

export const MARKETPLACE_OFFLINE_SIGNER_POLICY_SCHEMA_VERSION = 1 as const
export const MARKETPLACE_OFFLINE_SIGNER_POLICY_LIMITS = Object.freeze({
  maxJsonBytes:
    MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_LIMITS.maxJsonBytes +
    MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxJsonBytes +
    1024 * 1024
})

export interface MarketplaceOfflineSignerBootstrapV1 {
  readonly stateDigest: string
  readonly auditSequence: number
  readonly auditHead: string
}

export interface MarketplaceOfflineSignerHighWaterV1 {
  readonly sequence: number
  readonly snapshotDigest: string
  readonly snapshotArtifactDigest: string
  readonly auditSequence: number
  readonly auditHead: string
  readonly requestDigest: string
  readonly bundleJson: string | null
}

export interface MarketplaceOfflineSignerPendingV1 {
  readonly sequence: number
  readonly requestDigest: string
  readonly stateDigest: string
  readonly auditSequence: number
  readonly auditHead: string
  readonly reservedAt: string
}

export interface MarketplaceOfflineSignerPolicyV1 {
  readonly schemaVersion: typeof MARKETPLACE_OFFLINE_SIGNER_POLICY_SCHEMA_VERSION
  readonly marketplaceId: string
  readonly rootKeyId: string
  readonly publicBaseUrl: string
  readonly rootSpkiSha256: string
  readonly bootstrap: MarketplaceOfflineSignerBootstrapV1
  readonly highWater: MarketplaceOfflineSignerHighWaterV1 | null
  readonly pending: MarketplaceOfflineSignerPendingV1 | null
  readonly revocationFloorRequestJson: string | null
}

export interface MarketplaceOfflineSignerPolicyUpdate<Value> {
  readonly policy: MarketplaceOfflineSignerPolicyV1
  readonly result: Value
}

export interface MarketplaceOfflineSignerPolicyStore {
  transaction<Value>(
    operation: (
      policy: MarketplaceOfflineSignerPolicyV1
    ) => Promise<MarketplaceOfflineSignerPolicyUpdate<Value>>
  ): Promise<Value>
}

export interface CreateMarketplaceOfflineSignerPolicyInput {
  readonly marketplaceId: string
  readonly rootKeyId: string
  readonly publicBaseUrl: string
  readonly rootPublicKey: CryptoKey
  readonly bootstrapState: unknown
}

const OFFLINE_SIGNER_POLICY_KEYS = new Set([
  'schemaVersion',
  'marketplaceId',
  'rootKeyId',
  'publicBaseUrl',
  'rootSpkiSha256',
  'bootstrap',
  'highWater',
  'pending',
  'revocationFloorRequestJson'
])
const OFFLINE_SIGNER_BOOTSTRAP_KEYS = new Set(['stateDigest', 'auditSequence', 'auditHead'])
const OFFLINE_SIGNER_HIGH_WATER_KEYS = new Set([
  'sequence',
  'snapshotDigest',
  'snapshotArtifactDigest',
  'auditSequence',
  'auditHead',
  'requestDigest',
  'bundleJson'
])
const OFFLINE_SIGNER_PENDING_KEYS = new Set([
  'sequence',
  'requestDigest',
  'stateDigest',
  'auditSequence',
  'auditHead',
  'reservedAt'
])

const SIGNED_BUNDLE_KEYS = new Set([
  'format',
  'schemaVersion',
  'marketplaceId',
  'rootKeyId',
  'sequence',
  'requestDigest',
  'stateDigest',
  'requestJson',
  'snapshotJson',
  'catalogs',
  'runtimeIndexJson',
  'record',
  'authorization'
])
const SIGNED_BUNDLE_CATALOG_KEYS = new Set(['channel', 'json'])
const PUBLICATION_AUTHORIZATION_KEYS = new Set(['algorithm', 'keyId', 'value'])

function digestBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64url')
}

function digestValue(value: unknown): string {
  return digestBytes(encoder.encode(canonicalManifestJSON(value)))
}

function exactBytes(value: unknown, path: string, maxBytes: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > maxBytes) {
    throw new TypeError(`${path} must be non-empty bounded raw bytes`)
  }
  return new Uint8Array(value)
}

function exactJSON<Value>(
  value: unknown,
  path: string,
  maxBytes: number,
  parse: (bytes: Uint8Array) => Value,
  serialize: (value: unknown) => string
): { value: Value; bytes: Uint8Array } {
  const bytes = exactBytes(value, path, maxBytes)
  const parsed = parse(bytes)
  let source: string
  try {
    source = decoder.decode(bytes)
  } catch {
    throw new TypeError(`${path} must contain valid UTF-8`)
  }
  if (serialize(parsed) !== source) {
    throw new TypeError(`${path} must use the exact canonical JSON encoding`)
  }
  return { value: parsed, bytes }
}

function exactSnapshot(value: unknown, path: string) {
  return exactJSON(
    value,
    path,
    MARKETPLACE_SNAPSHOT_LIMITS.maxJsonBytes,
    parseMarketplaceSnapshotBytes,
    serializeMarketplaceSnapshot
  )
}

function exactCatalog(value: unknown, path: string) {
  return exactJSON(
    value,
    path,
    PLUGIN_CATALOG_LIMITS.maxJsonBytes,
    parsePluginCatalogBytes,
    serializePluginCatalog
  )
}

function exactRuntimeIndex(value: unknown, path: string) {
  return exactJSON(
    value,
    path,
    PLUGIN_RUNTIME_INDEX_LIMITS.maxJsonBytes,
    parsePluginRuntimeIndexBytes,
    serializePluginRuntimeIndex
  )
}

function artifactURL(baseURL: string, artifactDigest: string): string {
  return new URL(`v1/artifacts/${artifactDigest}`, baseURL).href
}

function assertArtifactURL(
  actual: string,
  baseURL: string,
  artifactDigest: string,
  path: string
): void {
  if (actual !== artifactURL(baseURL, artifactDigest)) {
    throw new TypeError(`${path} is not bound to its exact raw artifact bytes`)
  }
}

function trustedVerificationTime(generatedAt: string): number {
  const value = Date.parse(generatedAt)
  if (!Number.isSafeInteger(value)) throw new TypeError('Publication generatedAt is invalid')
  return value
}

function copyPreviousPublicationEvidence(
  value: MarketplacePreviousPublicationEvidence | null
): MarketplacePreviousPublicationEvidence | null {
  if (value === null) return null
  return Object.freeze({
    snapshot: Object.freeze({ bytes: new Uint8Array(value.snapshot.bytes) }),
    catalogs: Object.freeze(
      value.catalogs.map(({ channel, bytes }) =>
        Object.freeze({ channel, bytes: new Uint8Array(bytes) })
      )
    ),
    runtimeIndex: value.runtimeIndex
      ? Object.freeze({ bytes: new Uint8Array(value.runtimeIndex.bytes) })
      : null
  })
}

function catalogEvidenceByChannel(
  evidence: readonly MarketplacePublicationEvidenceCatalog[]
): ReadonlyMap<MarketplaceReleaseChannel, MarketplacePublicationEvidenceCatalog> {
  if (evidence.length !== MARKETPLACE_RELEASE_CHANNELS.length) {
    throw new TypeError(
      'Previous publication evidence must contain every catalog channel exactly once'
    )
  }
  const result = new Map<MarketplaceReleaseChannel, MarketplacePublicationEvidenceCatalog>()
  for (const entry of evidence) {
    if (!MARKETPLACE_RELEASE_CHANNELS.includes(entry.channel)) {
      throw new TypeError('Previous publication evidence contains an unsupported catalog channel')
    }
    if (result.has(entry.channel)) {
      throw new TypeError('Previous publication evidence contains a duplicate catalog channel')
    }
    result.set(entry.channel, entry)
  }
  return result
}

function signerIndependentSnapshot(
  snapshot: SignedMarketplaceSnapshotV1
): MarketplacePublicationProjectionV1['snapshot'] {
  const { integrity, catalogs, runtimeIndex, ...projection } = snapshot
  void integrity
  void catalogs
  void runtimeIndex
  return Object.freeze(projection)
}

function publicationCatalogRecord(
  channel: MarketplaceReleaseChannel,
  payloadDigest: string,
  artifactDigest: string
): MarketplacePublicationCatalogV1 {
  return Object.freeze({ channel, catalogDigest: payloadDigest, artifactDigest })
}

async function verifiedState(value: unknown): Promise<MarketplaceStateV1> {
  const parsed = parseMarketplaceState(value)
  const auditEvents = await verifyMarketplaceAuditChain(parsed.auditEvents)
  return Object.freeze({ ...parsed, auditEvents })
}

function assertPublicationAuditAnchor(
  state: MarketplaceStateV1,
  snapshot: SignedMarketplaceSnapshotV1
): void {
  const event = state.auditEvents.at(snapshot.auditHead.sequence - 1)
  if (!event || event.eventHash !== snapshot.auditHead.headDigest) {
    throw new TypeError('Previous signed snapshot audit head is not present in the supplied state')
  }
}

async function assertPreviousPublicationRecord(
  state: MarketplaceStateV1,
  snapshot: SignedMarketplaceSnapshotV1,
  snapshotArtifactDigest: string,
  catalogs: readonly MarketplacePublicationCatalogV1[],
  runtimeIndexDigest: string | null,
  runtimeIndexArtifactDigest: string | null
): Promise<void> {
  const record = state.publications.at(-1)
  if (
    !record ||
    record.sequence !== snapshot.sequence ||
    record.snapshotDigest !== snapshot.integrity.digest ||
    record.snapshotArtifactDigest !== snapshotArtifactDigest ||
    record.publishedAt !== snapshot.generatedAt ||
    record.auditSequence !== snapshot.auditHead.sequence ||
    record.auditHead !== snapshot.auditHead.headDigest ||
    record.runtimeIndexDigest !== runtimeIndexDigest ||
    record.runtimeIndexArtifactDigest !== runtimeIndexArtifactDigest ||
    canonicalManifestJSON(record.catalogs) !== canonicalManifestJSON(catalogs)
  ) {
    throw new TypeError(
      'Previous signed publication evidence does not match the trusted state record'
    )
  }
  const recordedEvent = state.auditEvents.at(record.auditSequence)
  const expectedPayloadDigest = await marketplaceAuditPayloadDigest({
    auditHead: record.auditHead,
    auditSequence: record.auditSequence,
    sequence: record.sequence,
    snapshotArtifactDigest: record.snapshotArtifactDigest,
    snapshotDigest: record.snapshotDigest
  })
  if (
    !recordedEvent ||
    recordedEvent.sequence !== record.auditSequence + 1 ||
    recordedEvent.previousHash !== record.auditHead ||
    recordedEvent.action !== 'publication.recorded' ||
    recordedEvent.subject !== 'publication:global' ||
    recordedEvent.time !== record.publishedAt ||
    recordedEvent.payloadDigest !== expectedPayloadDigest
  ) {
    throw new TypeError('Previous publication does not have its exact recorded audit event')
  }
}

async function reconstructPreviousPublicationForAuthority(
  authority: Readonly<{
    marketplaceId: string
    rootKeyId: string
    publicBaseUrl: string
  }>,
  state: MarketplaceStateV1,
  evidence: MarketplacePreviousPublicationEvidence,
  rootPublicKey: CryptoKey
): Promise<MarketplacePublicationProjectionV1> {
  const previous = state.publications.at(-1)
  if (!previous)
    throw new TypeError('Previous publication evidence requires a recorded publication')
  const exactSnapshotArtifact = exactSnapshot(
    evidence.snapshot.bytes,
    'previousPublication.snapshot.bytes'
  )
  const snapshotArtifactDigest = digestBytes(exactSnapshotArtifact.bytes)
  if (snapshotArtifactDigest !== previous.snapshotArtifactDigest) {
    throw new TypeError('Previous snapshot raw artifact digest does not match trusted state')
  }
  const snapshot = exactSnapshotArtifact.value
  const verificationTime = trustedVerificationTime(snapshot.generatedAt)
  const verifiedSnapshot = await verifyMarketplaceSnapshot(snapshot, rootPublicKey, {
    expectedMarketplaceId: authority.marketplaceId,
    expectedKeyId: authority.rootKeyId,
    now: verificationTime,
    maxClockSkewMilliseconds: 0
  })
  if (
    verifiedSnapshot.verifiedDigest !== previous.snapshotDigest ||
    snapshot.sequence !== previous.sequence
  ) {
    throw new TypeError('Previous signed snapshot does not match trusted state lineage')
  }

  const evidenceCatalogs = catalogEvidenceByChannel(evidence.catalogs)
  const catalogs: MarketplacePublicationProjectionV1['catalogs'][number][] = []
  const catalogRecords: MarketplacePublicationCatalogV1[] = []
  for (const channel of MARKETPLACE_RELEASE_CHANNELS) {
    const source = evidenceCatalogs.get(channel)
    if (!source) throw new TypeError(`Previous ${channel} catalog evidence is unavailable`)
    const exact = exactCatalog(source.bytes, `previousPublication.catalogs.${channel}.bytes`)
    const artifactDigest = digestBytes(exact.bytes)
    const reference = snapshot.catalogs.find((candidate) => candidate.channel === channel)
    if (!reference) throw new TypeError(`Previous snapshot does not bind a ${channel} catalog`)
    assertArtifactURL(
      reference.url,
      authority.publicBaseUrl,
      artifactDigest,
      `previous snapshot ${channel} catalog URL`
    )
    const verified = await verifyMarketplaceCatalog(exact.value, {
      snapshot: verifiedSnapshot,
      channel,
      now: verificationTime,
      maxClockSkewMilliseconds: 0
    })
    const { integrity, ...payload } = verified.catalog.catalog
    void integrity
    catalogs.push(Object.freeze({ channel, catalog: parsePluginCatalogPayload(payload) }))
    catalogRecords.push(
      publicationCatalogRecord(channel, verified.catalog.verifiedDigest, artifactDigest)
    )
  }

  let runtimeIndex: MarketplacePublicationProjectionV1['runtimeIndex'] = null
  let runtimeIndexDigest: string | null = null
  let runtimeIndexArtifactDigest: string | null = null
  if (snapshot.runtimeIndex) {
    if (!evidence.runtimeIndex) {
      throw new TypeError('Previous runtime index evidence is unavailable')
    }
    const exact = exactRuntimeIndex(
      evidence.runtimeIndex.bytes,
      'previousPublication.runtimeIndex.bytes'
    )
    runtimeIndexArtifactDigest = digestBytes(exact.bytes)
    assertArtifactURL(
      snapshot.runtimeIndex.url,
      authority.publicBaseUrl,
      runtimeIndexArtifactDigest,
      'previous snapshot runtime index URL'
    )
    const verified = await verifyMarketplaceRuntimeIndex(exact.value, {
      snapshot: verifiedSnapshot,
      now: verificationTime,
      maxClockSkewMilliseconds: 0
    })
    const { integrity, ...payload } = verified.index
    void integrity
    runtimeIndex = parsePluginRuntimeIndexPayload(payload)
    runtimeIndexDigest = verified.verifiedDigest
  } else if (evidence.runtimeIndex) {
    throw new TypeError('Previous runtime evidence is not authorized by its signed snapshot')
  }

  assertPublicationAuditAnchor(state, snapshot)
  await assertPreviousPublicationRecord(
    state,
    snapshot,
    snapshotArtifactDigest,
    catalogRecords,
    runtimeIndexDigest,
    runtimeIndexArtifactDigest
  )
  const projection = Object.freeze({
    catalogs: Object.freeze(catalogs),
    runtimeIndex,
    snapshot: signerIndependentSnapshot(snapshot)
  })
  return projection
}

export async function verifyMarketplacePreviousPublicationEvidence(
  input: VerifyMarketplacePreviousPublicationEvidenceInput,
  rootPublicKey: CryptoKey
): Promise<MarketplacePublicationProjectionV1> {
  assertEd25519PublicKey(rootPublicKey)
  const state = await verifiedState(input.state)
  return reconstructPreviousPublicationForAuthority(
    {
      marketplaceId: identity(input.marketplaceId, 'previous publication marketplace id'),
      rootKeyId: identity(input.rootKeyId, 'previous publication Root key id'),
      publicBaseUrl: canonicalPublicBaseURL(
        input.publicBaseUrl,
        'previous publication public base URL'
      )
    },
    state,
    copyPreviousPublicationEvidence(
      input.previousPublication
    ) as MarketplacePreviousPublicationEvidence,
    rootPublicKey
  )
}

async function reconstructPreviousPublication(
  request: MarketplacePublicationRequestV1,
  state: MarketplaceStateV1,
  evidence: MarketplacePreviousPublicationEvidence,
  rootPublicKey: CryptoKey
): Promise<MarketplacePublicationProjectionV1> {
  const previous = state.publications.at(-1)
  if (
    !previous ||
    request.previousPublicationSnapshotDigest !== previous.snapshotDigest ||
    request.previousPublicationSnapshotArtifactDigest !== previous.snapshotArtifactDigest ||
    request.expectedNextSequence !== previous.sequence + 1
  ) {
    throw new TypeError('Previous publication does not match the publication request lineage')
  }
  const projection = await reconstructPreviousPublicationForAuthority(
    request,
    state,
    evidence,
    rootPublicKey
  )
  if (
    request.baseline === null ||
    request.baselineDigest === null ||
    digestValue(projection) !== request.baselineDigest ||
    canonicalManifestJSON(projection) !== canonicalManifestJSON(request.baseline)
  ) {
    throw new TypeError('Publication request baseline was not reconstructed from signed evidence')
  }
  return projection
}

function assertSigningTime(request: MarketplacePublicationRequestV1, now: number): void {
  if (!Number.isSafeInteger(now))
    throw new TypeError('Offline publication signing clock is invalid')
  if (now < Date.parse(request.generatedAt) || now >= Date.parse(request.expiresAt)) {
    throw new TypeError('Offline publication request is outside its signing validity window')
  }
}

export async function verifyMarketplacePublicationRequestEvidence(
  input: VerifyMarketplacePublicationRequestEvidenceInput,
  rootPublicKey: CryptoKey,
  options: { now?: () => number } = {}
): Promise<VerifiedMarketplacePublicationRequestEvidence> {
  assertEd25519PublicKey(rootPublicKey)
  const request = parseMarketplacePublicationRequestBytes(input.requestBytes)
  assertSigningTime(request, (options.now ?? Date.now)())
  const state = await verifiedState(input.state)
  assertMarketplacePublicationRequestState(request, state)

  let reconstructedBaseline: MarketplacePublicationProjectionV1 | null = null
  if (request.expectedNextSequence === 1) {
    if (
      input.previousPublication !== null ||
      request.baseline !== null ||
      state.publications.length
    ) {
      throw new TypeError('Initial publication may not carry previous publication evidence')
    }
  } else {
    if (!input.previousPublication) {
      throw new TypeError('Publication continuation requires previous signed publication evidence')
    }
    reconstructedBaseline = await reconstructPreviousPublication(
      request,
      state,
      input.previousPublication,
      rootPublicKey
    )
  }
  return Object.freeze({
    request,
    requestDigest: marketplacePublicationRequestDigest(request),
    state,
    reconstructedBaseline
  })
}

function signedArtifact<Value>(
  value: Value,
  source: string,
  payloadDigest: string
): OfflineMarketplacePublicationArtifact<Value> {
  const bytes = encoder.encode(source)
  return Object.freeze({
    value,
    bytes,
    payloadDigest,
    artifactDigest: digestBytes(bytes)
  })
}

async function signMarketplacePublicationRequestWithoutPolicy(
  evidence: VerifiedMarketplacePublicationRequestEvidence,
  rootPrivateKey: CryptoKey,
  rootPublicKey: CryptoKey
): Promise<OfflineMarketplacePublication> {
  assertEd25519PrivateKey(rootPrivateKey)
  const { request } = evidence
  const catalogs: OfflineMarketplacePublicationCatalog[] = []
  for (const channel of MARKETPLACE_RELEASE_CHANNELS) {
    const projection = request.plan.catalogs.find((candidate) => candidate.channel === channel)
    if (!projection) throw new TypeError(`Publication plan is missing its ${channel} catalog`)
    const catalog = await signPluginCatalog(projection.catalog, rootPrivateKey, {
      keyId: request.rootKeyId
    })
    const artifact = signedArtifact(
      catalog,
      serializePluginCatalog(catalog),
      catalog.integrity.digest
    )
    catalogs.push(Object.freeze({ channel, ...artifact }))
  }

  let runtimeIndex: OfflineMarketplacePublication['runtimeIndex'] = null
  if (request.plan.runtimeIndex) {
    const value = await signPluginRuntimeIndex(request.plan.runtimeIndex, rootPrivateKey, {
      keyId: request.rootKeyId
    })
    runtimeIndex = signedArtifact(value, serializePluginRuntimeIndex(value), value.integrity.digest)
  }

  const snapshotPayload: MarketplaceSnapshotPayloadV1 = {
    ...request.plan.snapshot,
    format: MARKETPLACE_SNAPSHOT_FORMAT,
    schemaVersion: MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
    catalogs: catalogs.map(({ channel, value, artifactDigest }) => ({
      channel,
      catalogId: value.catalogId,
      keyId: request.rootKeyId,
      url: artifactURL(request.publicBaseUrl, artifactDigest),
      digest: value.integrity.digest
    })),
    ...(runtimeIndex
      ? {
          runtimeIndex: {
            url: artifactURL(request.publicBaseUrl, runtimeIndex.artifactDigest),
            indexId: runtimeIndex.value.indexId,
            keyId: request.rootKeyId,
            digest: runtimeIndex.value.integrity.digest
          }
        }
      : {})
  }
  const snapshotValue = await signMarketplaceSnapshot(snapshotPayload, rootPrivateKey, {
    keyId: request.rootKeyId
  })
  const snapshot = signedArtifact(
    snapshotValue,
    serializeMarketplaceSnapshot(snapshotValue),
    snapshotValue.integrity.digest
  )

  const verificationTime = trustedVerificationTime(request.generatedAt)
  const verifiedSnapshot = await verifyMarketplaceSnapshot(snapshot.value, rootPublicKey, {
    expectedMarketplaceId: request.marketplaceId,
    expectedKeyId: request.rootKeyId,
    now: verificationTime,
    maxClockSkewMilliseconds: 0
  })
  for (const catalog of catalogs) {
    await verifyMarketplaceCatalog(catalog.value, {
      snapshot: verifiedSnapshot,
      channel: catalog.channel,
      now: verificationTime,
      maxClockSkewMilliseconds: 0
    })
  }
  if (runtimeIndex) {
    await verifyMarketplaceRuntimeIndex(runtimeIndex.value, {
      snapshot: verifiedSnapshot,
      now: verificationTime,
      maxClockSkewMilliseconds: 0
    })
  }

  const record: RecordMarketplacePublicationInput = Object.freeze({
    snapshotDigest: snapshot.payloadDigest,
    snapshotArtifactDigest: snapshot.artifactDigest,
    catalogs: Object.freeze(
      catalogs.map(({ channel, payloadDigest, artifactDigest }) =>
        publicationCatalogRecord(channel, payloadDigest, artifactDigest)
      )
    ),
    runtimeIndexDigest: runtimeIndex?.payloadDigest ?? null,
    runtimeIndexArtifactDigest: runtimeIndex?.artifactDigest ?? null
  })
  const stateDigest = marketplacePublicationStateDigest(evidence.state)
  const authorizationInput = {
    marketplaceId: request.marketplaceId,
    rootKeyId: request.rootKeyId,
    sequence: request.expectedNextSequence,
    requestDigest: evidence.requestDigest,
    stateDigest,
    record
  }
  const authorization = await signMarketplacePublicationAuthorization(
    authorizationInput,
    rootPrivateKey
  )
  await assertMarketplacePublicationAuthorization(authorizationInput, authorization, rootPublicKey)
  return Object.freeze({
    request,
    requestDigest: evidence.requestDigest,
    stateDigest,
    sequence: request.expectedNextSequence,
    snapshot,
    catalogs: Object.freeze(catalogs),
    runtimeIndex,
    record,
    authorization
  })
}

function identity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${path} must be a positive safe integer`)
  }
  return value as number
}

function ed25519Signature(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new TypeError(`${path} must be an Ed25519 signature`)
  let decoded: Uint8Array
  try {
    decoded = decodeBase64URL(value)
  } catch {
    throw new TypeError(`${path} must be a canonical base64url Ed25519 signature`)
  }
  if (decoded.byteLength !== 64) {
    throw new TypeError(`${path} must contain exactly 64 signature bytes`)
  }
  return value
}

function parseMarketplacePublicationAuthorization(
  value: unknown,
  rootKeyId: string
): MarketplacePublicationAuthorizationV1 {
  const source = parseExactManifestRecord(
    value,
    'marketplaceSignedPublicationBundle.authorization',
    PUBLICATION_AUTHORIZATION_KEYS,
    PUBLICATION_AUTHORIZATION_KEYS
  )
  if (source.algorithm !== MARKETPLACE_PUBLICATION_AUTHORIZATION_ALGORITHM) {
    throw new TypeError('Signed publication authorization algorithm is not supported')
  }
  const keyId = identity(source.keyId, 'marketplaceSignedPublicationBundle.authorization.keyId')
  if (keyId !== rootKeyId) {
    throw new TypeError('Signed publication authorization does not use the bundle Root key')
  }
  return Object.freeze({
    algorithm: MARKETPLACE_PUBLICATION_AUTHORIZATION_ALGORITHM,
    keyId,
    value: ed25519Signature(source.value, 'marketplaceSignedPublicationBundle.authorization.value')
  })
}

interface MarketplacePublicationAuthorizationInput {
  readonly marketplaceId: string
  readonly rootKeyId: string
  readonly sequence: number
  readonly requestDigest: string
  readonly stateDigest: string
  readonly record: RecordMarketplacePublicationInput
}

function marketplacePublicationAuthorizationPayload(
  input: MarketplacePublicationAuthorizationInput
): MarketplacePublicationAuthorizationPayloadV1 {
  return Object.freeze({
    format: MARKETPLACE_PUBLICATION_AUTHORIZATION_FORMAT,
    schemaVersion: MARKETPLACE_PUBLICATION_AUTHORIZATION_SCHEMA_VERSION,
    marketplaceId: identity(input.marketplaceId, 'publication authorization marketplace id'),
    rootKeyId: identity(input.rootKeyId, 'publication authorization Root key id'),
    sequence: positiveSafeInteger(input.sequence, 'publication authorization sequence'),
    requestDigest: parseSha256Base64URL(
      input.requestDigest,
      'publication authorization request digest'
    ),
    stateDigest: parseSha256Base64URL(input.stateDigest, 'publication authorization state digest'),
    record: parseRecordMarketplacePublicationInput(input.record)
  })
}

function marketplacePublicationAuthorizationBytes(
  input: MarketplacePublicationAuthorizationInput
): Uint8Array {
  return encoder.encode(canonicalManifestJSON(marketplacePublicationAuthorizationPayload(input)))
}

async function signMarketplacePublicationAuthorization(
  input: MarketplacePublicationAuthorizationInput,
  rootPrivateKey: CryptoKey
): Promise<MarketplacePublicationAuthorizationV1> {
  return Object.freeze({
    algorithm: MARKETPLACE_PUBLICATION_AUTHORIZATION_ALGORITHM,
    keyId: input.rootKeyId,
    value: await signEd25519(marketplacePublicationAuthorizationBytes(input), rootPrivateKey)
  })
}

async function assertMarketplacePublicationAuthorization(
  input: MarketplacePublicationAuthorizationInput,
  authorization: MarketplacePublicationAuthorizationV1,
  rootPublicKey: CryptoKey
): Promise<void> {
  assertEd25519PublicKey(rootPublicKey)
  if (
    authorization.keyId !== input.rootKeyId ||
    !(await verifyEd25519(
      marketplacePublicationAuthorizationBytes(input),
      authorization.value,
      rootPublicKey
    ))
  ) {
    throw new TypeError('Signed publication authorization signature is invalid')
  }
}

function embeddedJSON(value: unknown, path: string, maxBytes: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    encoder.encode(value).byteLength > maxBytes
  ) {
    throw new TypeError(`${path} must be non-empty bounded JSON text`)
  }
  return value
}

function releaseChannel(value: unknown, path: string): MarketplaceReleaseChannel {
  if (!MARKETPLACE_RELEASE_CHANNELS.includes(value as MarketplaceReleaseChannel)) {
    throw new TypeError(`${path} is not a supported release channel`)
  }
  return value as MarketplaceReleaseChannel
}

function canonicalBundleText(value: MarketplaceSignedPublicationBundleV1): string {
  return `${JSON.stringify(JSON.parse(canonicalManifestJSON(value)), null, 2)}\n`
}

function assertBundleSize(value: MarketplaceSignedPublicationBundleV1): void {
  if (
    encoder.encode(canonicalBundleText(value)).byteLength >
    MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_LIMITS.maxJsonBytes
  ) {
    throw new TypeError('Signed marketplace publication bundle exceeds its JSON byte limit')
  }
}

export function parseMarketplaceSignedPublicationBundle(
  value: unknown
): MarketplaceSignedPublicationBundleV1 {
  const source = parseExactManifestRecord(
    value,
    'marketplaceSignedPublicationBundle',
    SIGNED_BUNDLE_KEYS,
    SIGNED_BUNDLE_KEYS
  )
  if (source.format !== MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_FORMAT) {
    throw new TypeError('marketplaceSignedPublicationBundle.format is not supported')
  }
  if (source.schemaVersion !== MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_SCHEMA_VERSION) {
    throw new TypeError('marketplaceSignedPublicationBundle.schemaVersion is not supported')
  }
  const marketplaceId = identity(
    source.marketplaceId,
    'marketplaceSignedPublicationBundle.marketplaceId'
  )
  const rootKeyId = identity(source.rootKeyId, 'marketplaceSignedPublicationBundle.rootKeyId')
  const sequence = positiveSafeInteger(
    source.sequence,
    'marketplaceSignedPublicationBundle.sequence'
  )
  const requestDigest = parseSha256Base64URL(
    source.requestDigest,
    'marketplaceSignedPublicationBundle.requestDigest'
  )
  const stateDigest = parseSha256Base64URL(
    source.stateDigest,
    'marketplaceSignedPublicationBundle.stateDigest'
  )
  const requestJSON = embeddedJSON(
    source.requestJson,
    'marketplaceSignedPublicationBundle.requestJson',
    MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_LIMITS.maxEmbeddedRequestBytes
  )
  const request = parseMarketplacePublicationRequestBytes(encoder.encode(requestJSON))
  if (
    marketplacePublicationRequestDigest(request) !== requestDigest ||
    request.marketplaceId !== marketplaceId ||
    request.rootKeyId !== rootKeyId ||
    request.expectedNextSequence !== sequence ||
    request.stateDigest !== stateDigest
  ) {
    throw new TypeError('Signed publication bundle identity is not bound to its exact request')
  }
  const snapshotJSON = embeddedJSON(
    source.snapshotJson,
    'marketplaceSignedPublicationBundle.snapshotJson',
    MARKETPLACE_SNAPSHOT_LIMITS.maxJsonBytes
  )
  exactSnapshot(encoder.encode(snapshotJSON), 'marketplaceSignedPublicationBundle.snapshotJson')
  const catalogValues = parseBoundedManifestArray(
    source.catalogs,
    'marketplaceSignedPublicationBundle.catalogs',
    MARKETPLACE_RELEASE_CHANNELS.length
  )
  if (catalogValues.length !== MARKETPLACE_RELEASE_CHANNELS.length) {
    throw new TypeError('Signed publication bundle must contain every catalog channel')
  }
  const catalogs = catalogValues.map((value, index) => {
    const catalogSource = parseExactManifestRecord(
      value,
      `marketplaceSignedPublicationBundle.catalogs[${index}]`,
      SIGNED_BUNDLE_CATALOG_KEYS,
      SIGNED_BUNDLE_CATALOG_KEYS
    )
    const channel = releaseChannel(
      catalogSource.channel,
      `marketplaceSignedPublicationBundle.catalogs[${index}].channel`
    )
    if (channel !== MARKETPLACE_RELEASE_CHANNELS[index]) {
      throw new TypeError('Signed publication bundle catalogs must use canonical channel order')
    }
    const json = embeddedJSON(
      catalogSource.json,
      `marketplaceSignedPublicationBundle.catalogs[${index}].json`,
      PLUGIN_CATALOG_LIMITS.maxJsonBytes
    )
    exactCatalog(encoder.encode(json), `marketplaceSignedPublicationBundle.catalogs[${index}].json`)
    return Object.freeze({ channel, json })
  })
  const runtimeIndexJSON =
    source.runtimeIndexJson === null
      ? null
      : embeddedJSON(
          source.runtimeIndexJson,
          'marketplaceSignedPublicationBundle.runtimeIndexJson',
          PLUGIN_RUNTIME_INDEX_LIMITS.maxJsonBytes
        )
  if (runtimeIndexJSON) {
    exactRuntimeIndex(
      encoder.encode(runtimeIndexJSON),
      'marketplaceSignedPublicationBundle.runtimeIndexJson'
    )
  }
  const record = parseRecordMarketplacePublicationInput(source.record)
  const authorization = parseMarketplacePublicationAuthorization(source.authorization, rootKeyId)
  const bundle = Object.freeze({
    format: MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_FORMAT,
    schemaVersion: MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_SCHEMA_VERSION,
    marketplaceId,
    rootKeyId,
    sequence,
    requestDigest,
    stateDigest,
    requestJson: requestJSON,
    snapshotJson: snapshotJSON,
    catalogs: Object.freeze(catalogs),
    runtimeIndexJson: runtimeIndexJSON,
    record,
    authorization
  })
  assertBundleSize(bundle)
  return bundle
}

export function createMarketplaceSignedPublicationBundle(
  publication: OfflineMarketplacePublication
): MarketplaceSignedPublicationBundleV1 {
  return parseMarketplaceSignedPublicationBundle({
    format: MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_FORMAT,
    schemaVersion: MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_SCHEMA_VERSION,
    marketplaceId: publication.request.marketplaceId,
    rootKeyId: publication.request.rootKeyId,
    sequence: publication.sequence,
    requestDigest: publication.requestDigest,
    stateDigest: publication.stateDigest,
    requestJson: serializeMarketplacePublicationRequest(publication.request),
    snapshotJson: decoder.decode(publication.snapshot.bytes),
    catalogs: publication.catalogs.map(({ channel, bytes }) => ({
      channel,
      json: decoder.decode(bytes)
    })),
    runtimeIndexJson: publication.runtimeIndex
      ? decoder.decode(publication.runtimeIndex.bytes)
      : null,
    record: publication.record,
    authorization: publication.authorization
  })
}

export function serializeMarketplaceSignedPublicationBundle(value: unknown): string {
  return canonicalBundleText(parseMarketplaceSignedPublicationBundle(value))
}

export function marketplaceSignedPublicationBundleBytes(value: unknown): Uint8Array {
  return encoder.encode(serializeMarketplaceSignedPublicationBundle(value))
}

export function marketplaceSignedPublicationBundleDigest(value: unknown): string {
  return digestBytes(marketplaceSignedPublicationBundleBytes(value))
}

export function parseMarketplaceSignedPublicationBundleJSON(
  source: string
): MarketplaceSignedPublicationBundleV1 {
  if (
    typeof source !== 'string' ||
    source.length === 0 ||
    encoder.encode(source).byteLength > MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_LIMITS.maxJsonBytes
  ) {
    throw new TypeError('Signed marketplace publication bundle must be non-empty bounded JSON text')
  }
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch {
    throw new TypeError('Signed marketplace publication bundle must contain valid JSON')
  }
  const parsed = parseMarketplaceSignedPublicationBundle(value)
  if (serializeMarketplaceSignedPublicationBundle(parsed) !== source) {
    throw new TypeError('Signed marketplace publication bundle must use exact canonical JSON')
  }
  return parsed
}

export function parseMarketplaceSignedPublicationBundleBytes(
  source: Uint8Array
): MarketplaceSignedPublicationBundleV1 {
  const bytes = exactBytes(
    source,
    'marketplaceSignedPublicationBundle',
    MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_LIMITS.maxJsonBytes
  )
  let text: string
  try {
    text = decoder.decode(bytes)
  } catch {
    throw new TypeError('Signed marketplace publication bundle must contain valid UTF-8')
  }
  return parseMarketplaceSignedPublicationBundleJSON(text)
}

function bundleCatalogsByChannel(
  catalogs: readonly MarketplaceSignedPublicationBundleCatalogV1[]
): ReadonlyMap<MarketplaceReleaseChannel, MarketplaceSignedPublicationBundleCatalogV1> {
  return new Map(catalogs.map((catalog) => [catalog.channel, catalog]))
}

type ExactSignedSnapshotArtifact = ReturnType<typeof exactSnapshot>
type VerifiedSignedSnapshot = Awaited<ReturnType<typeof verifyMarketplaceSnapshot>>

async function verifySignedPublicationCatalogs(
  bundle: MarketplaceSignedPublicationBundleV1,
  evidence: VerifiedMarketplacePublicationRequestEvidence,
  snapshotArtifact: ExactSignedSnapshotArtifact,
  verifiedSnapshot: VerifiedSignedSnapshot,
  verifiedAt: number
): Promise<{
  catalogs: OfflineMarketplacePublicationCatalog[]
  records: MarketplacePublicationCatalogV1[]
}> {
  const bundleCatalogs = bundleCatalogsByChannel(bundle.catalogs)
  const catalogs: OfflineMarketplacePublicationCatalog[] = []
  const records: MarketplacePublicationCatalogV1[] = []
  for (const channel of MARKETPLACE_RELEASE_CHANNELS) {
    const source = bundleCatalogs.get(channel)
    const plan = evidence.request.plan.catalogs.find((candidate) => candidate.channel === channel)
    if (!source || !plan)
      throw new TypeError(`Signed publication ${channel} catalog is unavailable`)
    const exact = exactCatalog(
      encoder.encode(source.json),
      `marketplaceSignedPublicationBundle.catalogs.${channel}.json`
    )
    const artifactDigest = digestBytes(exact.bytes)
    const reference = snapshotArtifact.value.catalogs.find(
      (candidate) => candidate.channel === channel
    )
    if (!reference) throw new TypeError(`Signed snapshot does not bind its ${channel} catalog`)
    assertArtifactURL(
      reference.url,
      evidence.request.publicBaseUrl,
      artifactDigest,
      `signed snapshot ${channel} catalog URL`
    )
    const verified = await verifyMarketplaceCatalog(exact.value, {
      snapshot: verifiedSnapshot,
      channel,
      now: verifiedAt,
      maxClockSkewMilliseconds: 0
    })
    const { integrity, ...payload } = verified.catalog.catalog
    void integrity
    if (
      canonicalManifestJSON(parsePluginCatalogPayload(payload)) !==
      canonicalManifestJSON(plan.catalog)
    ) {
      throw new TypeError(`Signed ${channel} catalog does not match its exact reviewed plan`)
    }
    const artifact = Object.freeze({
      channel,
      value: exact.value,
      bytes: exact.bytes,
      payloadDigest: verified.catalog.verifiedDigest,
      artifactDigest
    })
    catalogs.push(artifact)
    records.push(publicationCatalogRecord(channel, artifact.payloadDigest, artifact.artifactDigest))
  }
  return { catalogs, records }
}

async function verifySignedPublicationRuntimeIndex(
  bundle: MarketplaceSignedPublicationBundleV1,
  evidence: VerifiedMarketplacePublicationRequestEvidence,
  snapshotArtifact: ExactSignedSnapshotArtifact,
  verifiedSnapshot: VerifiedSignedSnapshot,
  verifiedAt: number
): Promise<OfflineMarketplacePublication['runtimeIndex']> {
  if (bundle.runtimeIndexJson === null) {
    if (evidence.request.plan.runtimeIndex || snapshotArtifact.value.runtimeIndex) {
      throw new TypeError('Reviewed runtime index is missing from the signed publication bundle')
    }
    return null
  }
  if (!evidence.request.plan.runtimeIndex || !snapshotArtifact.value.runtimeIndex) {
    throw new TypeError('Signed runtime index is not present in the reviewed snapshot plan')
  }
  const exact = exactRuntimeIndex(
    encoder.encode(bundle.runtimeIndexJson),
    'marketplaceSignedPublicationBundle.runtimeIndexJson'
  )
  const artifactDigest = digestBytes(exact.bytes)
  assertArtifactURL(
    snapshotArtifact.value.runtimeIndex.url,
    evidence.request.publicBaseUrl,
    artifactDigest,
    'signed snapshot runtime index URL'
  )
  const verified = await verifyMarketplaceRuntimeIndex(exact.value, {
    snapshot: verifiedSnapshot,
    now: verifiedAt,
    maxClockSkewMilliseconds: 0
  })
  const { integrity, ...payload } = verified.index
  void integrity
  if (
    canonicalManifestJSON(parsePluginRuntimeIndexPayload(payload)) !==
    canonicalManifestJSON(evidence.request.plan.runtimeIndex)
  ) {
    throw new TypeError('Signed runtime index does not match its exact reviewed plan')
  }
  return Object.freeze({
    value: exact.value,
    bytes: exact.bytes,
    payloadDigest: verified.verifiedDigest,
    artifactDigest
  })
}

export async function verifyMarketplaceSignedPublicationBundle(
  value: unknown,
  options: VerifyMarketplaceSignedPublicationBundleOptions
): Promise<OfflineMarketplacePublication> {
  const bundle = parseMarketplaceSignedPublicationBundle(value)
  const rootPublicKey = options.rootPublicKey
  await assertMarketplacePublicationAuthorization(bundle, bundle.authorization, rootPublicKey)
  const verifiedAt = (options.now ?? Date.now)()
  if (!Number.isSafeInteger(verifiedAt)) {
    throw new TypeError('Signed publication verification clock is invalid')
  }
  const evidence = await verifyMarketplacePublicationRequestEvidence(
    {
      requestBytes: encoder.encode(bundle.requestJson),
      state: options.state,
      previousPublication: options.previousPublication
    },
    rootPublicKey,
    { now: () => verifiedAt }
  )
  if (
    evidence.requestDigest !== bundle.requestDigest ||
    marketplacePublicationStateDigest(evidence.state) !== bundle.stateDigest
  ) {
    throw new TypeError('Signed publication bundle is not bound to its verified request and state')
  }

  const exactSnapshotArtifact = exactSnapshot(
    encoder.encode(bundle.snapshotJson),
    'marketplaceSignedPublicationBundle.snapshotJson'
  )
  const snapshotArtifactDigest = digestBytes(exactSnapshotArtifact.bytes)
  const verifiedSnapshot = await verifyMarketplaceSnapshot(
    exactSnapshotArtifact.value,
    rootPublicKey,
    {
      expectedMarketplaceId: bundle.marketplaceId,
      expectedKeyId: bundle.rootKeyId,
      now: verifiedAt,
      maxClockSkewMilliseconds: 0
    }
  )
  if (
    exactSnapshotArtifact.value.sequence !== bundle.sequence ||
    verifiedSnapshot.verifiedDigest !== bundle.record.snapshotDigest ||
    snapshotArtifactDigest !== bundle.record.snapshotArtifactDigest ||
    canonicalManifestJSON(signerIndependentSnapshot(exactSnapshotArtifact.value)) !==
      canonicalManifestJSON(evidence.request.plan.snapshot)
  ) {
    throw new TypeError('Signed publication snapshot does not match its exact reviewed plan')
  }

  const { catalogs, records: catalogRecords } = await verifySignedPublicationCatalogs(
    bundle,
    evidence,
    exactSnapshotArtifact,
    verifiedSnapshot,
    verifiedAt
  )
  const runtimeIndex = await verifySignedPublicationRuntimeIndex(
    bundle,
    evidence,
    exactSnapshotArtifact,
    verifiedSnapshot,
    verifiedAt
  )

  const derivedRecord = parseRecordMarketplacePublicationInput({
    snapshotDigest: verifiedSnapshot.verifiedDigest,
    snapshotArtifactDigest,
    catalogs: catalogRecords,
    runtimeIndexDigest: runtimeIndex?.payloadDigest ?? null,
    runtimeIndexArtifactDigest: runtimeIndex?.artifactDigest ?? null
  })
  if (canonicalManifestJSON(derivedRecord) !== canonicalManifestJSON(bundle.record)) {
    throw new TypeError('Signed publication record does not match its exact artifact bytes')
  }
  return Object.freeze({
    request: evidence.request,
    requestDigest: evidence.requestDigest,
    stateDigest: bundle.stateDigest,
    sequence: bundle.sequence,
    snapshot: Object.freeze({
      value: exactSnapshotArtifact.value,
      bytes: exactSnapshotArtifact.bytes,
      payloadDigest: verifiedSnapshot.verifiedDigest,
      artifactDigest: snapshotArtifactDigest
    }),
    catalogs: Object.freeze(catalogs),
    runtimeIndex,
    record: derivedRecord,
    authorization: bundle.authorization
  })
}

async function loadExactPublicationArtifact(
  artifacts: MarketplaceArtifactStore,
  artifactDigest: string,
  label: string
): Promise<MarketplacePublicationEvidenceArtifact> {
  const artifact = await artifacts.get(artifactDigest)
  if (!artifact) throw new Error(`${label} artifact is unavailable`)
  if (
    artifact.digest !== artifactDigest ||
    artifact.byteLength !== artifact.bytes.byteLength ||
    digestBytes(artifact.bytes) !== artifactDigest
  ) {
    throw new Error(`${label} artifact store result does not match its requested digest`)
  }
  return Object.freeze({ bytes: new Uint8Array(artifact.bytes) })
}

export async function loadMarketplacePreviousPublicationEvidence(
  state: unknown,
  artifacts: MarketplaceArtifactStore
): Promise<MarketplacePreviousPublicationEvidence | null> {
  const trustedState = await verifiedState(state)
  const previous = trustedState.publications.at(-1)
  if (!previous) return null
  const snapshot = await loadExactPublicationArtifact(
    artifacts,
    previous.snapshotArtifactDigest,
    'Previous publication snapshot'
  )
  const catalogs = await Promise.all(
    previous.catalogs.map(async ({ channel, artifactDigest }) => {
      const artifact = await loadExactPublicationArtifact(
        artifacts,
        artifactDigest,
        `Previous ${channel} catalog`
      )
      return Object.freeze({ channel, bytes: artifact.bytes })
    })
  )
  const runtimeIndex = previous.runtimeIndexArtifactDigest
    ? await loadExactPublicationArtifact(
        artifacts,
        previous.runtimeIndexArtifactDigest,
        'Previous publication runtime index'
      )
    : null
  return Object.freeze({
    snapshot,
    catalogs: Object.freeze(catalogs),
    runtimeIndex
  })
}

async function putExactArtifact(
  artifacts: MarketplaceArtifactStore,
  bytes: Uint8Array,
  expectedDigest: string
): Promise<void> {
  if (digestBytes(bytes) !== expectedDigest) {
    throw new TypeError('Signed publication artifact bytes changed before persistence')
  }
  const stored = await artifacts.put(new Uint8Array(bytes))
  if (
    stored.digest !== expectedDigest ||
    stored.byteLength !== bytes.byteLength ||
    digestBytes(stored.bytes) !== expectedDigest
  ) {
    throw new Error('Marketplace artifact store did not preserve exact signed bytes')
  }
}

function completedPublicationFromReceipt(
  bundle: MarketplaceSignedPublicationBundleV1,
  receipt: MarketplacePublicationCompletionReceiptV1
): OfflineMarketplacePublication {
  const request = parseMarketplacePublicationRequestJSON(bundle.requestJson)
  const publicationRecord = parseRecordMarketplacePublicationInput({
    snapshotDigest: receipt.publication.snapshotDigest,
    snapshotArtifactDigest: receipt.publication.snapshotArtifactDigest,
    catalogs: receipt.publication.catalogs,
    runtimeIndexDigest: receipt.publication.runtimeIndexDigest,
    runtimeIndexArtifactDigest: receipt.publication.runtimeIndexArtifactDigest
  })
  if (
    bundle.requestDigest !== receipt.requestDigest ||
    bundle.stateDigest !== receipt.stateDigest ||
    bundle.sequence !== receipt.expectedNextSequence ||
    canonicalManifestJSON(bundle.record) !== canonicalManifestJSON(publicationRecord)
  ) {
    throw new MarketplacePublicationReservationConflictError()
  }
  const snapshot = exactSnapshot(
    encoder.encode(bundle.snapshotJson),
    'marketplaceSignedPublicationBundle.snapshotJson'
  )
  if (digestBytes(snapshot.bytes) !== receipt.publication.snapshotArtifactDigest) {
    throw new MarketplacePublicationReservationConflictError()
  }
  const catalogsByChannel = bundleCatalogsByChannel(bundle.catalogs)
  const catalogs = receipt.publication.catalogs.map((record) => {
    const source = catalogsByChannel.get(record.channel)
    if (!source) throw new MarketplacePublicationReservationConflictError()
    const exact = exactCatalog(
      encoder.encode(source.json),
      `marketplaceSignedPublicationBundle.catalogs.${record.channel}.json`
    )
    if (digestBytes(exact.bytes) !== record.artifactDigest) {
      throw new MarketplacePublicationReservationConflictError()
    }
    return Object.freeze({
      channel: record.channel,
      value: exact.value,
      bytes: exact.bytes,
      payloadDigest: record.catalogDigest,
      artifactDigest: record.artifactDigest
    })
  })
  let runtimeIndex: OfflineMarketplacePublication['runtimeIndex'] = null
  if (bundle.runtimeIndexJson !== null) {
    if (
      receipt.publication.runtimeIndexDigest === null ||
      receipt.publication.runtimeIndexArtifactDigest === null
    ) {
      throw new MarketplacePublicationReservationConflictError()
    }
    const exact = exactRuntimeIndex(
      encoder.encode(bundle.runtimeIndexJson),
      'marketplaceSignedPublicationBundle.runtimeIndexJson'
    )
    if (digestBytes(exact.bytes) !== receipt.publication.runtimeIndexArtifactDigest) {
      throw new MarketplacePublicationReservationConflictError()
    }
    runtimeIndex = Object.freeze({
      value: exact.value,
      bytes: exact.bytes,
      payloadDigest: receipt.publication.runtimeIndexDigest,
      artifactDigest: receipt.publication.runtimeIndexArtifactDigest
    })
  } else if (
    receipt.publication.runtimeIndexDigest !== null ||
    receipt.publication.runtimeIndexArtifactDigest !== null
  ) {
    throw new MarketplacePublicationReservationConflictError()
  }
  return Object.freeze({
    request,
    requestDigest: receipt.requestDigest,
    stateDigest: receipt.stateDigest,
    sequence: receipt.expectedNextSequence,
    snapshot: Object.freeze({
      value: snapshot.value,
      bytes: snapshot.bytes,
      payloadDigest: receipt.publication.snapshotDigest,
      artifactDigest: receipt.publication.snapshotArtifactDigest
    }),
    catalogs: Object.freeze(catalogs),
    runtimeIndex,
    record: publicationRecord,
    authorization: bundle.authorization
  })
}

export async function importMarketplaceSignedPublicationBundle(
  options: ImportMarketplaceSignedPublicationBundleOptions
): Promise<ImportedMarketplaceSignedPublication> {
  const bundleInput = options.bundle
  const repository = options.repository
  const artifacts = options.artifacts
  const rootPublicKey = options.rootPublicKey
  const actorInput = options.actor
  const actor = parseMarketplaceAuditActor(actorInput, 'offline publication import actor')
  const bundle = parseMarketplaceSignedPublicationBundle(bundleInput)
  const bundleDigest = marketplaceSignedPublicationBundleDigest(bundle)
  await assertMarketplacePublicationAuthorization(bundle, bundle.authorization, rootPublicKey)
  const completed = await repository.inspectPublicationCompletion(
    bundle.requestDigest,
    bundleDigest
  )
  if (completed) {
    return Object.freeze({
      publication: completed.publication,
      verified: completedPublicationFromReceipt(bundle, completed)
    })
  }
  const request = parseMarketplacePublicationRequestJSON(bundle.requestJson)
  const verificationTime = trustedVerificationTime(request.generatedAt)
  const state = await verifiedState(await repository.snapshot())
  const previousPublication = await loadMarketplacePreviousPublicationEvidence(state, artifacts)
  const verified = await verifyMarketplaceSignedPublicationBundle(bundle, {
    state,
    previousPublication,
    rootPublicKey,
    now: () => verificationTime
  })
  await assertPlanDerivedFromState(verified.request, state, artifacts)
  const reservation = marketplacePublicationReservationFromRequest(verified.request)
  const activeReservation = await repository.inspectPublicationReservation()
  if (
    !activeReservation ||
    !sameMarketplacePublicationReservation(activeReservation, reservation)
  ) {
    throw new MarketplacePublicationReservationConflictError()
  }

  for (const catalog of verified.catalogs) {
    await putExactArtifact(artifacts, catalog.bytes, catalog.artifactDigest)
  }
  if (verified.runtimeIndex) {
    await putExactArtifact(
      artifacts,
      verified.runtimeIndex.bytes,
      verified.runtimeIndex.artifactDigest
    )
  }
  await putExactArtifact(artifacts, verified.snapshot.bytes, verified.snapshot.artifactDigest)

  const completion = await repository.completePublication(
    reservation,
    bundleDigest,
    async (transaction) => {
      const current = transaction.snapshot()
      if (marketplacePublicationStateDigest(current) !== verified.stateDigest) {
        throw new TypeError('Marketplace state changed after offline publication review')
      }
      assertMarketplacePublicationRequestState(verified.request, current)
      return transaction.recordPublication(verified.record, {
        actor,
        time: verified.request.generatedAt,
        correlationId: verified.requestDigest
      })
    }
  )
  return Object.freeze({ publication: completion.publication, verified })
}

function canonicalPublicBaseURL(value: unknown, path: string): string {
  const parsed = new URL(parseMarketplacePublicURL(value, path))
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new TypeError(`${path} must be an HTTPS origin without a path, query, or fragment`)
  }
  return parsed.href
}

async function rootSpkiSha256(publicKey: CryptoKey): Promise<string> {
  assertEd25519PublicKey(publicKey)
  let bytes: ArrayBuffer
  try {
    bytes = await crypto.subtle.exportKey('spki', publicKey)
  } catch {
    throw new TypeError('Offline signer Root public key must expose its SPKI authority')
  }
  return digestBytes(new Uint8Array(bytes))
}

function parseOfflineSignerBootstrap(value: unknown): MarketplaceOfflineSignerBootstrapV1 {
  const source = parseExactManifestRecord(
    value,
    'marketplaceOfflineSignerPolicy.bootstrap',
    OFFLINE_SIGNER_BOOTSTRAP_KEYS,
    OFFLINE_SIGNER_BOOTSTRAP_KEYS
  )
  return Object.freeze({
    stateDigest: parseSha256Base64URL(
      source.stateDigest,
      'marketplaceOfflineSignerPolicy.bootstrap.stateDigest'
    ),
    auditSequence: positiveSafeInteger(
      source.auditSequence,
      'marketplaceOfflineSignerPolicy.bootstrap.auditSequence'
    ),
    auditHead: parseSha256Base64URL(
      source.auditHead,
      'marketplaceOfflineSignerPolicy.bootstrap.auditHead'
    )
  })
}

function parseOfflineSignerHighWater(
  value: unknown,
  authority: { marketplaceId: string; rootKeyId: string; publicBaseUrl: string }
): MarketplaceOfflineSignerHighWaterV1 | null {
  if (value === null) return null
  const source = parseExactManifestRecord(
    value,
    'marketplaceOfflineSignerPolicy.highWater',
    OFFLINE_SIGNER_HIGH_WATER_KEYS,
    OFFLINE_SIGNER_HIGH_WATER_KEYS
  )
  const highWater = Object.freeze({
    sequence: positiveSafeInteger(
      source.sequence,
      'marketplaceOfflineSignerPolicy.highWater.sequence'
    ),
    snapshotDigest: parseSha256Base64URL(
      source.snapshotDigest,
      'marketplaceOfflineSignerPolicy.highWater.snapshotDigest'
    ),
    snapshotArtifactDigest: parseSha256Base64URL(
      source.snapshotArtifactDigest,
      'marketplaceOfflineSignerPolicy.highWater.snapshotArtifactDigest'
    ),
    auditSequence: positiveSafeInteger(
      source.auditSequence,
      'marketplaceOfflineSignerPolicy.highWater.auditSequence'
    ),
    auditHead: parseSha256Base64URL(
      source.auditHead,
      'marketplaceOfflineSignerPolicy.highWater.auditHead'
    ),
    requestDigest: parseSha256Base64URL(
      source.requestDigest,
      'marketplaceOfflineSignerPolicy.highWater.requestDigest'
    ),
    bundleJson:
      source.bundleJson === null
        ? null
        : embeddedJSON(
            source.bundleJson,
            'marketplaceOfflineSignerPolicy.highWater.bundleJson',
            MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_LIMITS.maxJsonBytes
          )
  })
  if (highWater.bundleJson) {
    const bundle = parseMarketplaceSignedPublicationBundleJSON(highWater.bundleJson)
    if (
      bundle.marketplaceId !== authority.marketplaceId ||
      bundle.rootKeyId !== authority.rootKeyId ||
      bundle.sequence !== highWater.sequence ||
      bundle.requestDigest !== highWater.requestDigest ||
      bundle.record.snapshotDigest !== highWater.snapshotDigest ||
      bundle.record.snapshotArtifactDigest !== highWater.snapshotArtifactDigest ||
      bundle.requestJson.length === 0
    ) {
      throw new TypeError('Offline signer high-water bundle does not match its authority record')
    }
    const request = parseMarketplacePublicationRequestBytes(encoder.encode(bundle.requestJson))
    if (
      request.publicBaseUrl !== authority.publicBaseUrl ||
      request.auditSequence !== highWater.auditSequence ||
      request.auditHead !== highWater.auditHead
    ) {
      throw new TypeError('Offline signer high-water bundle does not match its audit authority')
    }
  }
  return highWater
}

function parseOfflineSignerPending(
  value: unknown,
  highWater: MarketplaceOfflineSignerHighWaterV1 | null
): MarketplaceOfflineSignerPendingV1 | null {
  if (value === null) return null
  const source = parseExactManifestRecord(
    value,
    'marketplaceOfflineSignerPolicy.pending',
    OFFLINE_SIGNER_PENDING_KEYS,
    OFFLINE_SIGNER_PENDING_KEYS
  )
  const pending = Object.freeze({
    sequence: positiveSafeInteger(
      source.sequence,
      'marketplaceOfflineSignerPolicy.pending.sequence'
    ),
    requestDigest: parseSha256Base64URL(
      source.requestDigest,
      'marketplaceOfflineSignerPolicy.pending.requestDigest'
    ),
    stateDigest: parseSha256Base64URL(
      source.stateDigest,
      'marketplaceOfflineSignerPolicy.pending.stateDigest'
    ),
    auditSequence: positiveSafeInteger(
      source.auditSequence,
      'marketplaceOfflineSignerPolicy.pending.auditSequence'
    ),
    auditHead: parseSha256Base64URL(
      source.auditHead,
      'marketplaceOfflineSignerPolicy.pending.auditHead'
    ),
    reservedAt: parseMarketplaceTimestamp(
      source.reservedAt,
      'marketplaceOfflineSignerPolicy.pending.reservedAt'
    )
  })
  if (pending.sequence !== (highWater?.sequence ?? 0) + 1) {
    throw new TypeError('Offline signer pending request does not reserve the exact next sequence')
  }
  return pending
}

function parseRevocationFloorRequestJSON(
  value: unknown,
  authority: { marketplaceId: string; rootKeyId: string; publicBaseUrl: string },
  highWater: MarketplaceOfflineSignerHighWaterV1 | null
): string | null {
  if (value === null) return null
  if (!highWater)
    throw new TypeError('Offline signer revocation floor requires a signed high-water')
  const json = embeddedJSON(
    value,
    'marketplaceOfflineSignerPolicy.revocationFloorRequestJson',
    MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxJsonBytes
  )
  const request = parseMarketplacePublicationRequestJSON(json)
  if (
    request.purpose !== 'emergency-revocation' ||
    request.marketplaceId !== authority.marketplaceId ||
    request.rootKeyId !== authority.rootKeyId ||
    request.publicBaseUrl !== authority.publicBaseUrl ||
    request.expectedNextSequence > highWater.sequence
  ) {
    throw new TypeError('Offline signer revocation floor does not match its publication authority')
  }
  return json
}

export function parseMarketplaceOfflineSignerPolicy(
  value: unknown
): MarketplaceOfflineSignerPolicyV1 {
  const source = parseExactManifestRecord(
    value,
    'marketplaceOfflineSignerPolicy',
    OFFLINE_SIGNER_POLICY_KEYS,
    OFFLINE_SIGNER_POLICY_KEYS
  )
  if (source.schemaVersion !== MARKETPLACE_OFFLINE_SIGNER_POLICY_SCHEMA_VERSION) {
    throw new TypeError('marketplaceOfflineSignerPolicy.schemaVersion is not supported')
  }
  const authority = {
    marketplaceId: identity(source.marketplaceId, 'marketplaceOfflineSignerPolicy.marketplaceId'),
    rootKeyId: identity(source.rootKeyId, 'marketplaceOfflineSignerPolicy.rootKeyId'),
    publicBaseUrl: canonicalPublicBaseURL(
      source.publicBaseUrl,
      'marketplaceOfflineSignerPolicy.publicBaseUrl'
    )
  }
  const highWater = parseOfflineSignerHighWater(source.highWater, authority)
  const policy = Object.freeze({
    schemaVersion: MARKETPLACE_OFFLINE_SIGNER_POLICY_SCHEMA_VERSION,
    ...authority,
    rootSpkiSha256: parseSha256Base64URL(
      source.rootSpkiSha256,
      'marketplaceOfflineSignerPolicy.rootSpkiSha256'
    ),
    bootstrap: parseOfflineSignerBootstrap(source.bootstrap),
    highWater,
    pending: parseOfflineSignerPending(source.pending, highWater),
    revocationFloorRequestJson: parseRevocationFloorRequestJSON(
      source.revocationFloorRequestJson,
      authority,
      highWater
    )
  })
  return policy
}

export function serializeMarketplaceOfflineSignerPolicy(value: unknown): string {
  const text = `${JSON.stringify(JSON.parse(canonicalManifestJSON(parseMarketplaceOfflineSignerPolicy(value))), null, 2)}\n`
  if (encoder.encode(text).byteLength > MARKETPLACE_OFFLINE_SIGNER_POLICY_LIMITS.maxJsonBytes) {
    throw new TypeError('Offline signer policy exceeds its bounded canonical JSON size')
  }
  return text
}

export function parseMarketplaceOfflineSignerPolicyJSON(
  source: string
): MarketplaceOfflineSignerPolicyV1 {
  if (
    typeof source !== 'string' ||
    source.length === 0 ||
    encoder.encode(source).byteLength > MARKETPLACE_OFFLINE_SIGNER_POLICY_LIMITS.maxJsonBytes
  ) {
    throw new TypeError('Offline signer policy JSON must be non-empty bounded text')
  }
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch {
    throw new TypeError('Offline signer policy must contain valid JSON')
  }
  const policy = parseMarketplaceOfflineSignerPolicy(value)
  if (serializeMarketplaceOfflineSignerPolicy(policy) !== source) {
    throw new TypeError('Offline signer policy must use the exact canonical JSON encoding')
  }
  return policy
}

export async function createMarketplaceOfflineSignerPolicy(
  input: CreateMarketplaceOfflineSignerPolicyInput
): Promise<MarketplaceOfflineSignerPolicyV1> {
  const state = await verifiedState(input.bootstrapState)
  if (state.publications.length !== 0) {
    throw new TypeError('Offline signer bootstrap policy requires an unpublished state')
  }
  const auditHead = state.auditEvents.at(-1)?.eventHash
  if (!auditHead || state.auditEvents.length === 0) {
    throw new TypeError('Offline signer bootstrap policy requires a non-empty audit anchor')
  }
  return parseMarketplaceOfflineSignerPolicy({
    schemaVersion: MARKETPLACE_OFFLINE_SIGNER_POLICY_SCHEMA_VERSION,
    marketplaceId: input.marketplaceId,
    rootKeyId: input.rootKeyId,
    publicBaseUrl: input.publicBaseUrl,
    rootSpkiSha256: await rootSpkiSha256(input.rootPublicKey),
    bootstrap: {
      stateDigest: marketplacePublicationStateDigest(state),
      auditSequence: state.auditEvents.length,
      auditHead
    },
    highWater: null,
    pending: null,
    revocationFloorRequestJson: null
  })
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return canonicalManifestJSON(left) === canonicalManifestJSON(right)
}

function assertOfflineSignerPolicyAuthorityTransition(
  current: MarketplaceOfflineSignerPolicyV1,
  next: MarketplaceOfflineSignerPolicyV1
): void {
  if (
    current.marketplaceId !== next.marketplaceId ||
    current.rootKeyId !== next.rootKeyId ||
    current.publicBaseUrl !== next.publicBaseUrl ||
    current.rootSpkiSha256 !== next.rootSpkiSha256 ||
    !sameCanonicalValue(current.bootstrap, next.bootstrap)
  ) {
    throw new TypeError('Offline signer policy authority and bootstrap are immutable')
  }
}

function assertSameSequenceOfflineSignerTransition(
  current: MarketplaceOfflineSignerPolicyV1,
  next: MarketplaceOfflineSignerPolicyV1
): void {
  if (current.pending && !sameCanonicalValue(current.pending, next.pending)) {
    throw new TypeError('Offline signer pending reservation may not be replaced or cleared')
  }
  if (!sameCanonicalValue(current.revocationFloorRequestJson, next.revocationFloorRequestJson)) {
    throw new TypeError('Offline signer revocation floor may change only with a signed publication')
  }
}

function signedRequestForOfflineSignerAdvance(
  current: MarketplaceOfflineSignerPolicyV1,
  next: MarketplaceOfflineSignerPolicyV1
): string {
  const pending = current.pending
  const highWater = next.highWater
  if (
    !pending ||
    !highWater ||
    next.pending !== null ||
    highWater.sequence !== pending.sequence ||
    highWater.requestDigest !== pending.requestDigest ||
    highWater.auditSequence !== pending.auditSequence ||
    highWater.auditHead !== pending.auditHead ||
    !highWater.bundleJson
  ) {
    throw new TypeError('Offline signer high-water advance must finalize its exact reservation')
  }
  return parseMarketplaceSignedPublicationBundleJSON(highWater.bundleJson).requestJson
}

function assertOfflineSignerRevocationFloorTransition(
  current: MarketplaceOfflineSignerPolicyV1,
  next: MarketplaceOfflineSignerPolicyV1,
  signedRequest: string
): void {
  const request = parseMarketplacePublicationRequestJSON(signedRequest)
  if (request.purpose === 'emergency-revocation') {
    if (next.revocationFloorRequestJson !== signedRequest) {
      throw new TypeError('Emergency publication must persist its exact revocation floor')
    }
  } else if (request.purpose === 'revocation-recovery') {
    if (!current.revocationFloorRequestJson || next.revocationFloorRequestJson !== null) {
      throw new TypeError('Revocation recovery must explicitly clear an existing floor')
    }
  } else if (next.revocationFloorRequestJson !== current.revocationFloorRequestJson) {
    throw new TypeError('Routine publication must preserve the existing revocation floor')
  }
}

export function assertMarketplaceOfflineSignerPolicyTransition(
  currentValue: unknown,
  nextValue: unknown
): MarketplaceOfflineSignerPolicyV1 {
  const current = parseMarketplaceOfflineSignerPolicy(currentValue)
  const next = parseMarketplaceOfflineSignerPolicy(nextValue)
  assertOfflineSignerPolicyAuthorityTransition(current, next)

  const currentSequence = current.highWater?.sequence ?? 0
  const nextSequence = next.highWater?.sequence ?? 0
  if (nextSequence < currentSequence || nextSequence > currentSequence + 1) {
    throw new TypeError('Offline signer high-water may only advance by one sequence')
  }
  if (nextSequence === currentSequence && !sameCanonicalValue(current.highWater, next.highWater)) {
    throw new TypeError('Offline signer high-water may not change at the same sequence')
  }

  if (nextSequence === currentSequence) {
    assertSameSequenceOfflineSignerTransition(current, next)
    return next
  }

  const signedRequest = signedRequestForOfflineSignerAdvance(current, next)
  assertOfflineSignerRevocationFloorTransition(current, next, signedRequest)
  return next
}

export function createMemoryMarketplaceOfflineSignerPolicyStore(
  initialPolicy: unknown
): MarketplaceOfflineSignerPolicyStore {
  let policy = parseMarketplaceOfflineSignerPolicy(initialPolicy)
  let queue: Promise<void> = Promise.resolve()
  return Object.freeze({
    transaction<Value>(
      operation: (
        current: MarketplaceOfflineSignerPolicyV1
      ) => Promise<MarketplaceOfflineSignerPolicyUpdate<Value>>
    ): Promise<Value> {
      const running = queue.then(async () => {
        const update = await operation(parseMarketplaceOfflineSignerPolicy(structuredClone(policy)))
        const next = assertMarketplaceOfflineSignerPolicyTransition(policy, update.policy)
        policy = next
        return update.result
      })
      queue = running.then(
        () => undefined,
        () => undefined
      )
      return running
    }
  })
}

function assertSignerPolicyAuthority(
  policy: MarketplaceOfflineSignerPolicyV1,
  request: MarketplacePublicationRequestV1,
  fingerprint: string
): void {
  if (
    policy.marketplaceId !== request.marketplaceId ||
    policy.rootKeyId !== request.rootKeyId ||
    policy.publicBaseUrl !== request.publicBaseUrl ||
    policy.rootSpkiSha256 !== fingerprint
  ) {
    throw new TypeError('Offline signer policy does not authorize this publication authority')
  }
}

function assertSignerBootstrapSequence(
  policy: MarketplaceOfflineSignerPolicyV1,
  request: MarketplacePublicationRequestV1
): void {
  if (
    request.expectedNextSequence !== 1 ||
    request.stateDigest !== policy.bootstrap.stateDigest ||
    request.auditSequence !== policy.bootstrap.auditSequence ||
    request.auditHead !== policy.bootstrap.auditHead
  ) {
    throw new TypeError('Offline signer bootstrap state is not explicitly authorized')
  }
}

function assertSignerReplaySequence(
  highWater: MarketplaceOfflineSignerHighWaterV1,
  requestDigest: string
): void {
  if (requestDigest !== highWater.requestDigest || !highWater.bundleJson) {
    throw new TypeError('Offline signer refuses a second plan for an already signed sequence')
  }
}

function assertSignerHighWaterAdvance(
  highWater: MarketplaceOfflineSignerHighWaterV1,
  evidence: VerifiedMarketplacePublicationRequestEvidence
): void {
  const { request, state } = evidence
  const previous = state.publications.at(-1)
  const recordedEvent = previous ? state.auditEvents[previous.auditSequence] : undefined
  const recordedContext = recordedEvent
    ? state.auditContexts.find(({ sequence }) => sequence === recordedEvent.sequence)
    : undefined
  if (
    request.expectedNextSequence !== highWater.sequence + 1 ||
    request.previousPublicationSnapshotDigest !== highWater.snapshotDigest ||
    request.previousPublicationSnapshotArtifactDigest !== highWater.snapshotArtifactDigest ||
    !previous ||
    previous.sequence !== highWater.sequence ||
    previous.snapshotDigest !== highWater.snapshotDigest ||
    previous.snapshotArtifactDigest !== highWater.snapshotArtifactDigest ||
    previous.auditSequence !== highWater.auditSequence ||
    previous.auditHead !== highWater.auditHead ||
    recordedEvent?.action !== 'publication.recorded' ||
    recordedEvent.contextDigest === undefined ||
    !recordedContext ||
    recordedContext.contextDigest !== recordedEvent.contextDigest ||
    recordedContext.reason !== null ||
    recordedContext.correlationId !== highWater.requestDigest
  ) {
    throw new TypeError('Offline signer request does not advance its trusted high-water mark')
  }
}

function assertSignerSequence(
  policy: MarketplaceOfflineSignerPolicyV1,
  evidence: VerifiedMarketplacePublicationRequestEvidence
): 'sign' | 'replay' {
  const { request, requestDigest } = evidence
  const highWater = policy.highWater
  if (!highWater) {
    assertSignerBootstrapSequence(policy, request)
    return 'sign'
  }
  if (request.expectedNextSequence === highWater.sequence) {
    assertSignerReplaySequence(highWater, requestDigest)
    return 'replay'
  }
  assertSignerHighWaterAdvance(highWater, evidence)
  return 'sign'
}

async function assertPlanDerivedFromState(
  request: MarketplacePublicationRequestV1,
  state: MarketplaceStateV1,
  artifacts: MarketplaceArtifactStore
): Promise<void> {
  const validityMilliseconds = Date.parse(request.expiresAt) - Date.parse(request.generatedAt)
  const derived = await prepareMarketplacePublicationProjection(state, artifacts, {
    marketplaceId: request.marketplaceId,
    rootKeyId: request.rootKeyId,
    publicBaseUrl: request.publicBaseUrl,
    now: () => new Date(request.generatedAt),
    validityMilliseconds
  })
  if (canonicalManifestJSON(derived) === canonicalManifestJSON(request.plan)) return
  if (request.purpose === 'emergency-revocation') {
    assertMarketplaceEmergencyPublicationReduction(derived, request.plan)
    return
  }
  throw new TypeError('Offline publication plan was not independently derived from trusted state')
}

function assertRevocationFloor(
  policy: MarketplaceOfflineSignerPolicyV1,
  request: MarketplacePublicationRequestV1
): void {
  const floor = policy.revocationFloorRequestJson
    ? parseMarketplacePublicationRequestJSON(policy.revocationFloorRequestJson)
    : null
  if (request.purpose === 'revocation-recovery') {
    if (!floor) throw new TypeError('Offline signer has no emergency revocation floor to recover')
    return
  }
  if (floor) assertMarketplacePublicationNoExpansion(floor.plan, request.plan)
}

function pendingReservation(
  evidence: VerifiedMarketplacePublicationRequestEvidence,
  reservedAt: number
): MarketplaceOfflineSignerPendingV1 {
  if (!Number.isSafeInteger(reservedAt)) {
    throw new TypeError('Offline publication signing clock is invalid')
  }
  assertSigningTime(evidence.request, reservedAt)
  return Object.freeze({
    sequence: evidence.request.expectedNextSequence,
    requestDigest: evidence.requestDigest,
    stateDigest: evidence.request.stateDigest,
    auditSequence: evidence.request.auditSequence,
    auditHead: evidence.request.auditHead,
    reservedAt: new Date(reservedAt).toISOString()
  })
}

function assertExactPendingReservation(
  pending: MarketplaceOfflineSignerPendingV1 | null,
  evidence: VerifiedMarketplacePublicationRequestEvidence
): void {
  if (
    !pending ||
    pending.sequence !== evidence.request.expectedNextSequence ||
    pending.requestDigest !== evidence.requestDigest ||
    pending.stateDigest !== evidence.request.stateDigest ||
    pending.auditSequence !== evidence.request.auditSequence ||
    pending.auditHead !== evidence.request.auditHead
  ) {
    throw new TypeError('Offline signer is reserved for a different publication request')
  }
}

function nextRevocationFloorRequestJSON(
  current: MarketplaceOfflineSignerPolicyV1,
  request: MarketplacePublicationRequestV1
): string | null {
  if (request.purpose === 'emergency-revocation') {
    return serializeMarketplacePublicationRequest(request)
  }
  if (request.purpose === 'revocation-recovery') return null
  return current.revocationFloorRequestJson
}

type OfflineSignerReservationResult =
  | Readonly<{ kind: 'replay'; publication: OfflineMarketplacePublication }>
  | Readonly<{ kind: 'reserved' }>

async function replayMarketplaceSignedPublication(
  policy: MarketplaceOfflineSignerPolicyV1,
  evidence: VerifiedMarketplacePublicationRequestEvidence,
  previousPublication: MarketplacePreviousPublicationEvidence | null,
  rootPublicKey: CryptoKey,
  verificationTime: number
): Promise<OfflineMarketplacePublication> {
  const bundleJSON = policy.highWater?.bundleJson
  if (!bundleJSON) throw new TypeError('Offline signer replay bundle is unavailable')
  return verifyMarketplaceSignedPublicationBundle(
    parseMarketplaceSignedPublicationBundleJSON(bundleJSON),
    {
      state: evidence.state,
      previousPublication,
      rootPublicKey,
      now: () => verificationTime
    }
  )
}

export async function signMarketplacePublicationRequest(
  options: SignMarketplacePublicationRequestOptions
): Promise<OfflineMarketplacePublication> {
  const rootPublicKey = options.rootPublicKey
  const rootPrivateKey = options.rootPrivateKey
  const artifacts = options.artifacts
  const policyStore = options.policyStore
  const signingClock = options.now ?? Date.now
  const requestBytes = new Uint8Array(options.requestBytes)
  const previousPublication = copyPreviousPublicationEvidence(options.previousPublication)
  const parsedRequest = parseMarketplacePublicationRequestBytes(requestBytes)
  const verificationTime = trustedVerificationTime(parsedRequest.generatedAt)
  const fingerprint = await rootSpkiSha256(rootPublicKey)
  const evidence = await verifyMarketplacePublicationRequestEvidence(
    { requestBytes, state: options.state, previousPublication },
    rootPublicKey,
    { now: () => verificationTime }
  )
  const reservation = await policyStore.transaction<OfflineSignerReservationResult>(
    async (policy) => {
      assertSignerPolicyAuthority(policy, evidence.request, fingerprint)
      const operation = assertSignerSequence(policy, evidence)
      if (operation === 'replay') {
        return Object.freeze({
          policy,
          result: Object.freeze({
            kind: 'replay' as const,
            publication: await replayMarketplaceSignedPublication(
              policy,
              evidence,
              previousPublication,
              rootPublicKey,
              verificationTime
            )
          })
        })
      }

      assertRevocationFloor(policy, evidence.request)
      await assertPlanDerivedFromState(evidence.request, evidence.state, artifacts)
      if (policy.pending) assertExactPendingReservation(policy.pending, evidence)
      const pending = policy.pending ?? pendingReservation(evidence, signingClock())
      const next = parseMarketplaceOfflineSignerPolicy({
        ...policy,
        pending
      })
      return Object.freeze({
        policy: next,
        result: Object.freeze({ kind: 'reserved' as const })
      })
    }
  )
  if (reservation.kind === 'replay') return reservation.publication

  const signed = await signMarketplacePublicationRequestWithoutPolicy(
    evidence,
    rootPrivateKey,
    rootPublicKey
  )
  const bundleJSON = serializeMarketplaceSignedPublicationBundle(
    createMarketplaceSignedPublicationBundle(signed)
  )
  return policyStore.transaction(async (policy) => {
    assertSignerPolicyAuthority(policy, evidence.request, fingerprint)
    const operation = assertSignerSequence(policy, evidence)
    if (operation === 'replay') {
      return Object.freeze({
        policy,
        result: await replayMarketplaceSignedPublication(
          policy,
          evidence,
          previousPublication,
          rootPublicKey,
          verificationTime
        )
      })
    }
    assertExactPendingReservation(policy.pending, evidence)
    assertRevocationFloor(policy, evidence.request)
    const next = parseMarketplaceOfflineSignerPolicy({
      ...policy,
      highWater: {
        sequence: signed.sequence,
        snapshotDigest: signed.record.snapshotDigest,
        snapshotArtifactDigest: signed.record.snapshotArtifactDigest,
        auditSequence: signed.request.auditSequence,
        auditHead: signed.request.auditHead,
        requestDigest: signed.requestDigest,
        bundleJson: bundleJSON
      },
      pending: null,
      revocationFloorRequestJson: nextRevocationFloorRequestJSON(policy, evidence.request)
    })
    return Object.freeze({ policy: next, result: signed })
  })
}
