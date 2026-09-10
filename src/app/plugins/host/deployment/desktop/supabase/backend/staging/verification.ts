/* oxlint-disable eslint(complexity), eslint(max-lines), typescript-eslint(no-unnecessary-condition), typescript-eslint(no-unnecessary-boolean-literal-compare), typescript-eslint(prefer-optional-chain) -- This Host trust boundary intentionally revalidates runtime-shaped authority and keeps claim, evidence, settlement, replay, and transient credential cleanup together. */
import type { BackendReleaseProviderAuthorityV1 } from '@open-pencil/lowcode/backend'
import type { SupabaseConfig } from '@open-pencil/scene-graph'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { SupabaseStagingTestUserInput } from '@/app/lowcode/supabase/credentials'
import {
  normalizeSupabaseSchemaName,
  projectRefFromSupabaseURL
} from '@/app/lowcode/supabase/management-client'
import type { SupabaseStagingTargetBindingV1 } from '@/app/lowcode/supabase/staging-target'
import type {
  AppBackendProviderDocumentGraph,
  PreparedAppBackendProviderBuild
} from '@/app/plugins/host/backend-provider'
import {
  BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION,
  BACKEND_RELEASE_DISPATCH_LEASE_MS,
  BackendHostReleaseUnresolvedScopeError,
  parseBackendHostReleaseDispatchEvidenceRecord,
  parseBackendHostReleaseDispatchJournalRecord,
  type BackendHostReleaseDispatchEvidenceRecord,
  type BackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchJournalRecord
} from '@/app/plugins/host/deployment/backend/release-journal'
import type { SupabaseEdgeFunctionReleaseReceipt } from '@/app/plugins/host/deployment/supabase/edge-function-release'
import type { SupabaseStagingVerificationResult } from '@/app/plugins/host/deployment/supabase/staging-verifier'
import type { SupabaseStorageIsolationReceipt } from '@/app/plugins/host/deployment/supabase/storage-isolation-verifier'
import type { CredentialStatus } from '@/app/settings/credentials/types'

import type { DesktopSupabaseBackendReviewResult } from '../review'

type MaybePromise<T> = T | Promise<T>

const GRANT_GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MAX_CREDENTIAL_LENGTH = 16 * 1024

export type DesktopSupabaseBackendStagingVerificationErrorCode =
  | 'aborted'
  | 'already-running'
  | 'backend-provider-missing'
  | 'backend-provider-unavailable'
  | 'binding-mismatch'
  | 'binding-unavailable'
  | 'credential-missing'
  | 'desktop-required'
  | 'grant-changed'
  | 'grant-unavailable'
  | 'invalid-config'
  | 'review-stale'
  | 'reconciliation-required'
  | 'schema-not-applied'
  | 'transient-auth-missing'
  | 'verification-failed'
  | 'write-credential-missing'
  | 'write-credential-not-independent'

const ERROR_MESSAGES = Object.freeze({
  aborted: 'Supabase staging capability verification was cancelled.',
  'already-running': 'A Supabase staging capability verification is already running.',
  'backend-provider-missing': 'This document has no Backend Provider declaration to verify.',
  'backend-provider-unavailable':
    'The declared Supabase Backend Provider is unavailable or its authority changed.',
  'binding-mismatch': 'The saved Supabase staging target does not match the reviewed authority.',
  'binding-unavailable': 'Bind an independent Supabase staging target before verification.',
  'credential-missing': 'A read-only Supabase Management API token is required.',
  'desktop-required': 'Supabase staging capability verification is available only on desktop.',
  'grant-changed': 'Supabase credential authority changed during verification. Start again.',
  'grant-unavailable': 'Supabase credential authority is unavailable. Save the tokens again.',
  'invalid-config': 'A canonical Supabase project URL and publishable key are required.',
  'review-stale': 'The reviewed artifact, document, configuration, or staging binding changed.',
  'reconciliation-required':
    'A prior Supabase capability mutation has an unresolved remote outcome. Inspect and reconcile it with the provider before retrying.',
  'schema-not-applied':
    'The live staging schema does not yet match the reviewed target. Apply the source migration first.',
  'transient-auth-missing':
    'Authenticated Edge or Storage verification requires operation-scoped staging user sessions.',
  'verification-failed': 'Supabase staging capability verification failed closed.',
  'write-credential-missing':
    'A separate Supabase mutation-capable personal access token is required.',
  'write-credential-not-independent':
    'The Supabase mutation-capable token must be different from the read-only token.'
}) satisfies Readonly<Record<DesktopSupabaseBackendStagingVerificationErrorCode, string>>

export class DesktopSupabaseBackendStagingVerificationError extends Error {
  constructor(readonly code: DesktopSupabaseBackendStagingVerificationErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'DesktopSupabaseBackendStagingVerificationError'
  }
}

export type DesktopSupabaseStagingTestUserInput = SupabaseStagingTestUserInput

export interface DesktopSupabaseBackendStagingVerificationInput {
  readonly config: SupabaseConfig | undefined
  /** Live reread used before every remote inspection or mutation. */
  readonly readConfig?: () => SupabaseConfig | undefined
  readonly graph: AppBackendProviderDocumentGraph
  readonly reviewed: DesktopSupabaseBackendReviewResult
  readonly projectRefConfirmation: string
  readonly confirmedIndependentStaging: true
  /** Operation-scoped authenticated session used only for an Edge health request. */
  readonly edgeUserAccessToken?: string
  /** Operation-scoped, distinct users used only for Storage isolation probes. */
  readonly storageUserA?: DesktopSupabaseStagingTestUserInput
  readonly storageUserB?: DesktopSupabaseStagingTestUserInput
  /** Non-secret tenant partitions keyed by `<bucket-name>/<rule-id>`. */
  readonly tenantPartitions?: Readonly<
    Record<string, Readonly<{ allowedPartition: string; deniedPartition: string }>>
  >
  /** Called only after the durable claim and initial evidence are persisted. */
  readonly onDispatch?: () => void
  readonly signal?: AbortSignal
}

export type DesktopSupabaseBackendStagingVerificationOutcome =
  | 'succeeded'
  | 'blocked'
  | 'failed'
  | 'outcome-unknown'

export interface DesktopSupabaseBackendStagingCapabilityReceiptV1 {
  readonly format: 'openpencil.supabase-backend-staging-capability-receipt.v1'
  readonly version: 1
  readonly verificationId: string
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly reviewedArtifactDigest: string
  readonly outcome: DesktopSupabaseBackendStagingVerificationOutcome
  readonly schemaApplied: boolean
  readonly edgeFunctionReceipt: SupabaseEdgeFunctionReleaseReceipt | null
  readonly storageIsolationReceipts: readonly SupabaseStorageIsolationReceipt[]
  readonly gates: SupabaseStagingVerificationResult['gates']
  readonly startedAt: string
  readonly completedAt: string
}

export interface DesktopSupabaseBackendStagingVerificationResult {
  readonly receipt: DesktopSupabaseBackendStagingCapabilityReceiptV1
  readonly receiptDigest: string
  readonly productionReleaseReady: false
}

export interface DesktopSupabaseStrictStagingVerificationInput {
  readonly verificationId: string
  readonly build: PreparedAppBackendProviderBuild
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  readonly documentDigest: string
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly expectedReview: DesktopSupabaseBackendReviewResult
  /** Test-only renderer transport credential; null means the fixed native vault owns the value. */
  readonly readPersonalAccessToken: string | null
  readonly writePersonalAccessToken: string
  readonly publishableKey: string
  readonly edgeUserAccessToken: string | null
  readonly storageUserA: DesktopSupabaseStagingTestUserInput | null
  readonly storageUserB: DesktopSupabaseStagingTestUserInput | null
  readonly tenantPartitions: Readonly<
    Record<string, Readonly<{ allowedPartition: string; deniedPartition: string }>>
  >
  readonly revalidateLocalAuthority: () => Promise<void>
  readonly claimBeforeMutation: (
    progress: DesktopSupabaseCapabilityDispatchProgressV1
  ) => Promise<void>
  readonly recordMutationProgress: (
    progress: DesktopSupabaseCapabilityDispatchProgressV1
  ) => Promise<void>
  readonly signal?: AbortSignal
}

export interface DesktopSupabaseCapabilityDispatchProgressV1 {
  readonly format: 'openpencil.supabase-capability-dispatch-progress.v1'
  readonly version: 1
  readonly verificationId: string
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly documentDigest: string
  readonly reviewedArtifactDigest: string
  readonly target: Readonly<{
    target: string
    applicationDigest: string
    planDigest: string
    emissionManifestDigest: string
  }>
  readonly stage:
    | 'edge-pre-dispatch'
    | 'edge-deployed'
    | 'edge-settled'
    | 'storage-pre-dispatch'
    | 'storage-progress'
    | 'storage-settled'
  readonly edge: Readonly<{
    readonly releaseId: string
    readonly functionSlug: string
    readonly artifactDigest: string
    readonly secretInspectionEvidenceDigest: string
    readonly functionId: string | null
    readonly versionId: string | null
    readonly operationId: string | null
    readonly outcome: SupabaseEdgeFunctionReleaseReceipt['outcome'] | null
  }> | null
  readonly storage: readonly Readonly<{
    readonly verificationId: string
    readonly bucketId: string
    readonly bucketName: string
    readonly ruleId: string
    readonly potentialResidualObjectPaths: readonly string[]
    readonly residualObjectPaths: readonly string[]
    readonly remoteOperationIds: readonly string[]
    readonly outcome: SupabaseStorageIsolationReceipt['outcome'] | null
  }>[]
}

export interface DesktopSupabaseBackendStagingVerificationDependencies {
  readonly isDesktop: () => boolean
  readonly nextId: () => string
  readonly now: () => string
  readonly dispatchJournal: BackendHostReleaseDispatchJournal
  readonly prepareBuild: (
    graph: AppBackendProviderDocumentGraph
  ) => MaybePromise<PreparedAppBackendProviderBuild | null>
  readonly resolveBackendProviderAuthority: (
    build: PreparedAppBackendProviderBuild
  ) => MaybePromise<BackendReleaseProviderAuthorityV1 | null>
  /** Legacy renderer transport seam. Exactly one read credential resolver must be configured. */
  readonly resolveReadCredential?: () => Promise<string | null>
  /** Native-vault mode checks presence without returning the read PAT to the renderer. */
  readonly resolveReadCredentialStatus?: () => Promise<CredentialStatus>
  readonly resolveWriteCredential: () => Promise<string | null>
  readonly resolveGrantGeneration: () => Promise<string | null>
  readonly resolveStagingTargetBinding: () => MaybePromise<SupabaseStagingTargetBindingV1 | null>
  readonly prepareStrictVerification: (
    input: DesktopSupabaseStrictStagingVerificationInput
  ) => Promise<DesktopSupabaseBackendStagingVerificationResult>
}

export interface DesktopSupabaseBackendStagingVerificationService {
  verify(
    input: DesktopSupabaseBackendStagingVerificationInput
  ): Promise<DesktopSupabaseBackendStagingVerificationResult>
  readonly inspectUnresolved?: (
    projectRef: string
  ) => Promise<readonly DesktopSupabaseCapabilityUnresolvedInspection[]>
}

export interface DesktopSupabaseCapabilityUnresolvedInspection {
  readonly format: 'openpencil.supabase-capability-unresolved-inspection.v1'
  readonly version: 1
  readonly projectRef: string
  readonly singleFlightKey: string
  readonly releaseId: string
  readonly planDigest: string
  readonly outcome: Extract<
    BackendHostReleaseDispatchJournalRecord['outcome'],
    'pending' | 'outcome-unknown'
  >
  readonly code: string | null
  readonly claimedAt: string
  readonly settledAt: string | null
  readonly evidenceIntegrity: 'verified' | 'unavailable' | 'invalid'
  readonly evidencePhase: 'progress' | 'final' | null
  readonly evidencePayloadDigest: string | null
  readonly evidenceRecordedAt: string | null
  readonly evidence: Readonly<Record<string, unknown>> | null
  readonly automaticRetryAllowed: false
  readonly providerAuthoritativeReconciliationRequired: true
}

function fail(code: DesktopSupabaseBackendStagingVerificationErrorCode): never {
  throw new DesktopSupabaseBackendStagingVerificationError(code)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) fail('aborted')
}

function validSecret(value: unknown, maximum = MAX_CREDENTIAL_LENGTH): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    new TextEncoder().encode(value).byteLength <= maximum &&
    !/\p{Cc}/u.test(value)
  )
}

function sameAuthority(
  left: BackendReleaseProviderAuthorityV1,
  right: BackendReleaseProviderAuthorityV1
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameBuild(
  left: PreparedAppBackendProviderBuild,
  right: PreparedAppBackendProviderBuild
): boolean {
  return (
    JSON.stringify(left.request) === JSON.stringify(right.request) &&
    left.plan.applicationDigest === right.plan.applicationDigest &&
    left.plan.planDigest === right.plan.planDigest &&
    left.emission.manifestDigest === right.emission.manifestDigest
  )
}

function normalizedConfig(
  value: SupabaseConfig | undefined
): Readonly<{ projectRef: string; schema: 'public'; publishableKey: string }> | null {
  try {
    const projectRef = projectRefFromSupabaseURL(value?.url ?? '')
    const schema = normalizeSupabaseSchemaName(value?.schema)
    const publishableKey = value?.anonKey ?? ''
    return schema === 'public' && validSecret(publishableKey, 4_096)
      ? Object.freeze({ projectRef, schema, publishableKey })
      : null
  } catch {
    return null
  }
}

async function backendDocumentDigest(
  graph: AppBackendProviderDocumentGraph,
  build: PreparedAppBackendProviderBuild,
  projectRef: string,
  schema: 'public'
): Promise<string> {
  return digestCanonicalManifest({
    format: 'openpencil.desktop-supabase-backend-review-document.v1',
    rootId: graph.rootId,
    projectRef,
    schema,
    backendProviderRequest: build.request
  })
}

function snapshotReview(
  value: DesktopSupabaseBackendReviewResult
): DesktopSupabaseBackendReviewResult {
  try {
    return structuredClone(value)
  } catch {
    return fail('review-stale')
  }
}

// oxlint-disable-next-line eslint(complexity) -- The complete reviewed authority is deliberately checked in one predicate.
async function assertExpectedReview(
  reviewed: DesktopSupabaseBackendReviewResult,
  expected: Readonly<{
    build: PreparedAppBackendProviderBuild
    backendProvider: BackendReleaseProviderAuthorityV1
    documentDigest: string
    projectRef: string
    grantGeneration: string
  }>
): Promise<void> {
  const artifact = reviewed.artifact
  const manifest = artifact.manifest
  const inspected = artifact.inspectedReview
  if (
    artifact.format !== 'openpencil.supabase-backend-review-artifact.v1' ||
    artifact.version !== 1 ||
    manifest.format !== 'openpencil.supabase-backend-host-review.v1' ||
    manifest.version !== 1 ||
    manifest.environment !== 'staging' ||
    reviewed.reviewReady !== true ||
    reviewed.blockerCount !== 0 ||
    reviewed.applyAvailable !== false ||
    reviewed.applyPerformed !== false ||
    reviewed.documentDigest !== expected.documentDigest ||
    manifest.documentDigest !== expected.documentDigest ||
    reviewed.projectRef !== expected.projectRef ||
    reviewed.accountId !== manifest.remoteAuthority.accountId ||
    reviewed.grantGeneration !== expected.grantGeneration ||
    manifest.compiler.applicationDigest !== expected.build.plan.applicationDigest ||
    manifest.compiler.planDigest !== expected.build.plan.planDigest ||
    manifest.compiler.emissionManifestDigest !== expected.build.emission.manifestDigest ||
    !sameAuthority(manifest.backendProvider, expected.backendProvider) ||
    manifest.remoteAuthority.projectRef !== expected.projectRef ||
    manifest.remoteAuthority.grantGeneration !== expected.grantGeneration ||
    manifest.inspectedReview.manifestDigest !== inspected.manifestDigest ||
    manifest.inspectedReview.reviewReady !== true ||
    manifest.inspectedReview.applyAllowed !== false ||
    manifest.inspectedReview.releaseReady !== false ||
    inspected.manifest.reviewReady !== true ||
    inspected.manifest.blockers.length !== 0 ||
    inspected.manifest.applyAllowed !== false ||
    inspected.manifest.releaseReady !== false ||
    inspected.manifest.inspectedSchemaDigest !== manifest.remoteAuthority.inspectedSchemaDigest ||
    (await digestCanonicalManifest(manifest)) !== artifact.manifestDigest
  ) {
    fail('review-stale')
  }
}

function assertBinding(
  binding: SupabaseStagingTargetBindingV1 | null,
  projectRef: string,
  accountId: string
): void {
  if (!binding) fail('binding-unavailable')
  if (binding.projectRef !== projectRef || binding.accountId !== accountId) fail('binding-mismatch')
}

function copiedUser(value: DesktopSupabaseStagingTestUserInput | undefined) {
  if (!value) return null
  return Object.freeze({ userId: value.userId, accessToken: value.accessToken })
}

function copyTenantPartitions(
  value: DesktopSupabaseBackendStagingVerificationInput['tenantPartitions']
): DesktopSupabaseStrictStagingVerificationInput['tenantPartitions'] {
  if (!value) return Object.freeze({})
  const copied: Record<string, Readonly<{ allowedPartition: string; deniedPartition: string }>> = {}
  for (const [key, partitions] of Object.entries(value)) {
    copied[key] = Object.freeze({
      allowedPartition: partitions.allowedPartition,
      deniedPartition: partitions.deniedPartition
    })
  }
  return Object.freeze(copied)
}

function receiptIsBound(
  result: DesktopSupabaseBackendStagingVerificationResult,
  expected: Readonly<{
    verificationId: string
    projectRef: string
    accountId: string
    grantGeneration: string
    reviewedArtifactDigest: string
  }>
): boolean {
  const receipt = result.receipt
  return (
    receipt.format === 'openpencil.supabase-backend-staging-capability-receipt.v1' &&
    receipt.version === 1 &&
    receipt.verificationId === expected.verificationId &&
    receipt.projectRef === expected.projectRef &&
    receipt.accountId === expected.accountId &&
    receipt.grantGeneration === expected.grantGeneration &&
    receipt.reviewedArtifactDigest === expected.reviewedArtifactDigest &&
    result.productionReleaseReady === false
  )
}

const CAPABILITY_JOURNAL_UNKNOWN_CODE = 'supabase-capability-reconciliation-required'

class PriorCapabilityResultError extends Error {
  constructor(readonly result: DesktopSupabaseBackendStagingVerificationResult) {
    super('A durable Supabase capability result already exists.')
    this.name = 'PriorCapabilityResultError'
  }
}

function canonicalNow(now: () => string): string {
  const value = now()
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail('verification-failed')
  }
  return value
}

function capabilityDispatchScopeKey(projectRef: string): string {
  return ['backend-release-dispatch-scope-v1', 'supabase', projectRef]
    .map((part) => encodeURIComponent(part))
    .join(':')
}

function capabilitySingleFlightKey(projectRef: string, semanticDigest: string): string {
  return ['backend-release-v3', 'supabase', projectRef, 'capability-verification', semanticDigest]
    .map((part) => encodeURIComponent(part))
    .join(':')
}

async function capabilitySemanticDigest(input: {
  readonly build: PreparedAppBackendProviderBuild
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  readonly documentDigest: string
  readonly reviewedArtifactDigest: string
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly binding: SupabaseStagingTargetBindingV1
  readonly publishableKey: string
  readonly storageUserA: DesktopSupabaseStagingTestUserInput | null
  readonly storageUserB: DesktopSupabaseStagingTestUserInput | null
  readonly tenantPartitions: DesktopSupabaseStrictStagingVerificationInput['tenantPartitions']
}): Promise<string> {
  const [publishableKeyDigest, storageProbeAuthorityDigest] = await Promise.all([
    digestCanonicalManifest({
      format: 'openpencil.supabase-publishable-key-authority.v1',
      value: input.publishableKey
    }),
    digestCanonicalManifest({
      format: 'openpencil.supabase-storage-actor-authority.v1',
      userAId: input.storageUserA?.userId ?? null,
      userBId: input.storageUserB?.userId ?? null,
      tenantPartitions: input.tenantPartitions
    })
  ])
  return digestCanonicalManifest({
    format: 'openpencil.supabase-capability-dispatch-authority.v1',
    version: 1,
    environment: 'staging',
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration,
    documentDigest: input.documentDigest,
    reviewedArtifactDigest: input.reviewedArtifactDigest,
    stagingBinding: input.binding,
    backendProvider: input.backendProvider,
    target: {
      compilerTarget: input.build.plan.target,
      applicationDigest: input.build.plan.applicationDigest,
      planDigest: input.build.plan.planDigest,
      emissionManifestDigest: input.build.emission.manifestDigest
    },
    publishableKeyDigest,
    storageProbeAuthorityDigest
  })
}

function deepFreezeJSON<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreezeJSON(Reflect.get(value, key))
    Object.freeze(value)
  }
  return value
}

interface CapabilityEvidencePayload {
  readonly [key: string]: unknown
}

function isCapabilityEvidencePayload(value: unknown): value is CapabilityEvidencePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Reflect.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactResultShape(
  value: unknown
): value is DesktopSupabaseBackendStagingVerificationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Reflect.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const keys = Reflect.ownKeys(value)
  return (
    keys.length === 3 &&
    keys.every(
      (key) =>
        typeof key === 'string' &&
        (key === 'receipt' || key === 'receiptDigest' || key === 'productionReleaseReady')
    )
  )
}

function remoteOperationIds(
  result: DesktopSupabaseBackendStagingVerificationResult
): readonly string[] {
  return Object.freeze(
    [
      ...(result.receipt.edgeFunctionReceipt?.remote.operationIds ?? []),
      ...result.receipt.storageIsolationReceipts.flatMap((receipt) => receipt.remoteOperationIds)
    ]
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 256)
  )
}

function settlementCode(outcome: DesktopSupabaseBackendStagingVerificationOutcome): string | null {
  if (outcome === 'succeeded') return null
  if (outcome === 'blocked') return 'supabase-capability-blocked'
  if (outcome === 'failed') return 'supabase-capability-failed'
  return CAPABILITY_JOURNAL_UNKNOWN_CODE
}

function assertClaimBinding(
  raw: BackendHostReleaseDispatchJournalRecord,
  expected: Readonly<{
    singleFlightKey: string
    dispatchScopeKey: string
    planDigest: string
  }>
): BackendHostReleaseDispatchJournalRecord {
  const record = parseBackendHostReleaseDispatchJournalRecord(raw)
  if (
    record.version !== BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION ||
    record.singleFlightKey !== expected.singleFlightKey ||
    record.dispatchScopeKey !== expected.dispatchScopeKey ||
    record.planDigest !== expected.planDigest
  ) {
    throw new TypeError('Supabase capability journal claim authority is invalid.')
  }
  return record
}

async function evidenceInput(
  binding: Readonly<{
    singleFlightKey: string
    dispatchScopeKey: string
    releaseId: string
    planDigest: string
  }>,
  phase: BackendHostReleaseDispatchEvidenceRecord['phase'],
  value: unknown,
  recordedAt: string
) {
  return Object.freeze({
    ...binding,
    phase,
    payload: JSON.stringify(value),
    payloadDigest: await digestCanonicalManifest(value),
    recordedAt
  })
}

async function validateEvidenceResult(
  raw: BackendHostReleaseDispatchEvidenceRecord | null,
  expected: Readonly<{
    singleFlightKey: string
    dispatchScopeKey: string
    releaseId: string
    planDigest: string
    verificationId: string
    projectRef: string
    accountId: string
    grantGeneration: string
    reviewedArtifactDigest: string
  }>
): Promise<DesktopSupabaseBackendStagingVerificationResult | null> {
  if (!raw) return null
  const evidence = parseBackendHostReleaseDispatchEvidenceRecord(raw)
  if (
    evidence.phase !== 'final' ||
    evidence.singleFlightKey !== expected.singleFlightKey ||
    evidence.dispatchScopeKey !== expected.dispatchScopeKey ||
    evidence.releaseId !== expected.releaseId ||
    evidence.planDigest !== expected.planDigest
  ) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(evidence.payload) as unknown
  } catch {
    return null
  }
  if (
    !exactResultShape(value) ||
    value.productionReleaseReady !== false ||
    typeof value.receiptDigest !== 'string' ||
    !receiptIsBound(value, expected) ||
    (await digestCanonicalManifest(value.receipt)) !== value.receiptDigest ||
    (await digestCanonicalManifest(value)) !== evidence.payloadDigest
  ) {
    return null
  }
  return deepFreezeJSON(value)
}

/**
 * One explicit, single-flight staging capability operation. It snapshots caller-owned inputs,
 * resolves credentials only after review/binding validation, and clears every transient token on
 * completion. Production authority is intentionally absent.
 */
export function createDesktopSupabaseBackendStagingVerificationService(
  dependencies: DesktopSupabaseBackendStagingVerificationDependencies
): DesktopSupabaseBackendStagingVerificationService {
  let active = false

  return Object.freeze({
    async verify(
      input: DesktopSupabaseBackendStagingVerificationInput
    ): Promise<DesktopSupabaseBackendStagingVerificationResult> {
      if (active) fail('already-running')
      active = true
      let readPersonalAccessToken: string | null = null
      let writePersonalAccessToken: string | null = null
      let edgeUserAccessToken: string | null = null
      let storageUserA: DesktopSupabaseStagingTestUserInput | null = null
      let storageUserB: DesktopSupabaseStagingTestUserInput | null = null
      let dispatchClaim: BackendHostReleaseDispatchJournalRecord | null = null
      let latestEvidenceAt: string | null = null
      try {
        if (!dependencies.isDesktop()) fail('desktop-required')
        const graph = input.graph
        const config = input.config ? Object.freeze({ ...input.config }) : undefined
        const readConfig = input.readConfig
        const reviewed = snapshotReview(input.reviewed)
        const projectRefConfirmation = input.projectRefConfirmation
        const confirmedIndependentStaging = input.confirmedIndependentStaging
        const signal = input.signal
        edgeUserAccessToken = input.edgeUserAccessToken ?? null
        storageUserA = copiedUser(input.storageUserA)
        storageUserB = copiedUser(input.storageUserB)
        const tenantPartitions = copyTenantPartitions(input.tenantPartitions)
        throwIfAborted(signal)

        const initialConfig = normalizedConfig(readConfig?.() ?? config)
        if (!initialConfig) fail('invalid-config')
        const { projectRef, schema, publishableKey } = initialConfig
        if (confirmedIndependentStaging !== true || projectRefConfirmation !== projectRef) {
          fail('binding-mismatch')
        }

        let build: PreparedAppBackendProviderBuild | null
        try {
          build = await dependencies.prepareBuild(graph)
        } catch {
          return fail('backend-provider-unavailable')
        }
        if (!build) fail('backend-provider-missing')
        if (build.descriptor.providerId !== 'supabase') fail('backend-provider-unavailable')

        let backendProvider: BackendReleaseProviderAuthorityV1 | null
        try {
          backendProvider = await dependencies.resolveBackendProviderAuthority(build)
        } catch {
          return fail('backend-provider-unavailable')
        }
        if (backendProvider?.providerId !== 'supabase') fail('backend-provider-unavailable')

        const documentDigest = await backendDocumentDigest(graph, build, projectRef, schema)
        const grantGeneration = await dependencies.resolveGrantGeneration()
        if (!grantGeneration || !GRANT_GENERATION.test(grantGeneration)) fail('grant-unavailable')
        await assertExpectedReview(reviewed, {
          build,
          backendProvider,
          documentDigest,
          projectRef,
          grantGeneration
        })

        let binding: SupabaseStagingTargetBindingV1 | null
        try {
          binding = await dependencies.resolveStagingTargetBinding()
        } catch {
          return fail('binding-unavailable')
        }
        assertBinding(binding, projectRef, reviewed.accountId)

        const hasReadValueResolver = dependencies.resolveReadCredential !== undefined
        const hasReadStatusResolver = dependencies.resolveReadCredentialStatus !== undefined
        if (hasReadValueResolver === hasReadStatusResolver) fail('credential-missing')
        if (dependencies.resolveReadCredentialStatus) {
          if ((await dependencies.resolveReadCredentialStatus()) !== 'configured') {
            fail('credential-missing')
          }
        } else {
          const resolveReadCredential = dependencies.resolveReadCredential
          if (!resolveReadCredential) fail('credential-missing')
          readPersonalAccessToken = await resolveReadCredential()
          if (!validSecret(readPersonalAccessToken, 4_096)) fail('credential-missing')
        }
        writePersonalAccessToken = await dependencies.resolveWriteCredential()
        if (!validSecret(writePersonalAccessToken, 4_096)) fail('write-credential-missing')
        if (
          readPersonalAccessToken !== null &&
          readPersonalAccessToken === writePersonalAccessToken
        ) {
          fail('write-credential-not-independent')
        }
        if ((await dependencies.resolveGrantGeneration()) !== grantGeneration) fail('grant-changed')

        const semanticDigest = await capabilitySemanticDigest({
          build,
          backendProvider,
          documentDigest,
          reviewedArtifactDigest: reviewed.artifact.manifestDigest,
          projectRef,
          accountId: reviewed.accountId,
          grantGeneration,
          binding: binding as SupabaseStagingTargetBindingV1,
          publishableKey,
          storageUserA,
          storageUserB,
          tenantPartitions
        })
        const singleFlightKey = capabilitySingleFlightKey(projectRef, semanticDigest)
        const dispatchScopeKey = capabilityDispatchScopeKey(projectRef)
        const verificationId = dependencies.nextId()
        const journalBinding = Object.freeze({
          singleFlightKey,
          dispatchScopeKey,
          releaseId: verificationId,
          planDigest: semanticDigest
        })
        const expectedProgress = Object.freeze({
          verificationId,
          projectRef,
          accountId: reviewed.accountId,
          grantGeneration,
          documentDigest,
          reviewedArtifactDigest: reviewed.artifact.manifestDigest,
          target: Object.freeze({
            target: build.plan.target,
            applicationDigest: build.plan.applicationDigest,
            planDigest: build.plan.planDigest,
            emissionManifestDigest: build.emission.manifestDigest
          })
        })

        const nextEvidenceTimestamp = (): string => {
          const candidate = canonicalNow(dependencies.now)
          if (latestEvidenceAt !== null && Date.parse(candidate) < Date.parse(latestEvidenceAt)) {
            return latestEvidenceAt
          }
          latestEvidenceAt = candidate
          return candidate
        }

        const progressIsBound = (progress: DesktopSupabaseCapabilityDispatchProgressV1): boolean =>
          progress.format === 'openpencil.supabase-capability-dispatch-progress.v1' &&
          progress.version === 1 &&
          progress.verificationId === expectedProgress.verificationId &&
          progress.projectRef === expectedProgress.projectRef &&
          progress.accountId === expectedProgress.accountId &&
          progress.grantGeneration === expectedProgress.grantGeneration &&
          progress.documentDigest === expectedProgress.documentDigest &&
          progress.reviewedArtifactDigest === expectedProgress.reviewedArtifactDigest &&
          JSON.stringify(progress.target) === JSON.stringify(expectedProgress.target)

        const persistEvidence = async (
          phase: BackendHostReleaseDispatchEvidenceRecord['phase'],
          value: unknown,
          claim: BackendHostReleaseDispatchJournalRecord
        ): Promise<void> => {
          const inputEvidence = await evidenceInput(
            {
              ...journalBinding,
              releaseId: claim.releaseId,
              planDigest: claim.planDigest
            },
            phase,
            value,
            nextEvidenceTimestamp()
          )
          const persisted = parseBackendHostReleaseDispatchEvidenceRecord(
            await dependencies.dispatchJournal.recordEvidence(inputEvidence)
          )
          if (
            persisted.singleFlightKey !== inputEvidence.singleFlightKey ||
            persisted.dispatchScopeKey !== inputEvidence.dispatchScopeKey ||
            persisted.releaseId !== inputEvidence.releaseId ||
            persisted.planDigest !== inputEvidence.planDigest ||
            persisted.phase !== inputEvidence.phase ||
            persisted.payload !== inputEvidence.payload ||
            persisted.payloadDigest !== inputEvidence.payloadDigest ||
            persisted.recordedAt !== inputEvidence.recordedAt
          ) {
            throw new TypeError('Supabase capability evidence was not persisted exactly.')
          }
        }

        const claimBeforeMutation = async (
          progress: DesktopSupabaseCapabilityDispatchProgressV1
        ): Promise<void> => {
          if (!progressIsBound(progress)) fail('review-stale')
          if (dispatchClaim) {
            await persistEvidence('progress', progress, dispatchClaim)
            return
          }
          const claimedAt = canonicalNow(dependencies.now)
          latestEvidenceAt = claimedAt
          let rawClaim
          try {
            rawClaim = await dependencies.dispatchJournal.claim({
              ...journalBinding,
              ownerId: `supabase-capability-${verificationId}`,
              claimedAt,
              leaseExpiresAt: new Date(
                Date.parse(claimedAt) + BACKEND_RELEASE_DISPATCH_LEASE_MS
              ).toISOString()
            })
          } catch (cause) {
            if (cause instanceof BackendHostReleaseUnresolvedScopeError) {
              fail('reconciliation-required')
            }
            return fail('reconciliation-required')
          }
          if (!rawClaim || typeof rawClaim !== 'object' || typeof rawClaim.claimed !== 'boolean') {
            fail('reconciliation-required')
          }
          const record = assertClaimBinding(rawClaim.record, journalBinding)
          if (!rawClaim.claimed) {
            if (record.outcome === 'applied' || record.outcome === 'failed') {
              const prior = await validateEvidenceResult(
                await dependencies.dispatchJournal.readEvidence(singleFlightKey),
                {
                  ...journalBinding,
                  releaseId: record.releaseId,
                  planDigest: record.planDigest,
                  verificationId: record.releaseId,
                  projectRef,
                  accountId: reviewed.accountId,
                  grantGeneration,
                  reviewedArtifactDigest: reviewed.artifact.manifestDigest
                }
              )
              if (prior) throw new PriorCapabilityResultError(prior)
            }
            fail('reconciliation-required')
          }
          if (record.outcome !== 'pending' || record.releaseId !== verificationId) {
            fail('reconciliation-required')
          }
          dispatchClaim = record
          await persistEvidence('progress', progress, record)
          try {
            input.onDispatch?.()
            // oxlint-disable-next-line open-pencil/no-silent-catch -- UI observers cannot invalidate a durable Host claim.
          } catch {
            // A UI observer has no authority to roll back a durable Host claim.
          }
        }

        const recordMutationProgress = async (
          progress: DesktopSupabaseCapabilityDispatchProgressV1
        ): Promise<void> => {
          if (!progressIsBound(progress) || !dispatchClaim) {
            fail('reconciliation-required')
          }
          await persistEvidence('progress', progress, dispatchClaim)
        }

        const settleExact = async (
          claim: BackendHostReleaseDispatchJournalRecord,
          outcome: 'applied' | 'failed' | 'outcome-unknown',
          code: string | null,
          operations: readonly string[]
        ): Promise<BackendHostReleaseDispatchJournalRecord> => {
          const settledAt = nextEvidenceTimestamp()
          const persisted = assertClaimBinding(
            await dependencies.dispatchJournal.settle({
              singleFlightKey: claim.singleFlightKey,
              releaseId: claim.releaseId,
              planDigest: claim.planDigest,
              settledAt,
              outcome,
              code,
              remoteOperationIds: operations
            }),
            journalBinding
          )
          if (
            persisted.outcome !== outcome ||
            persisted.code !== code ||
            persisted.settledAt !== settledAt ||
            JSON.stringify(persisted.remoteOperationIds) !== JSON.stringify(operations)
          ) {
            throw new TypeError('Supabase capability settlement was not persisted exactly.')
          }
          return persisted
        }

        const preserveUnknown = async (): Promise<void> => {
          if (!dispatchClaim || dispatchClaim.outcome !== 'pending') return
          try {
            dispatchClaim = await settleExact(
              dispatchClaim,
              'outcome-unknown',
              CAPABILITY_JOURNAL_UNKNOWN_CODE,
              []
            )
            // oxlint-disable-next-line open-pencil/no-silent-catch -- A failed settlement leaves the durable pending claim unresolved.
          } catch {
            // The original pending claim remains a durable unresolved lock if settlement fails.
          }
        }

        const revalidateLocalAuthority = async (): Promise<void> => {
          throwIfAborted(signal)
          if ((await dependencies.resolveGrantGeneration()) !== grantGeneration) {
            fail('grant-changed')
          }
          const currentConfig = normalizedConfig(readConfig?.() ?? config)
          let currentBuild: PreparedAppBackendProviderBuild | null
          try {
            currentBuild = await dependencies.prepareBuild(graph)
          } catch {
            return fail('review-stale')
          }
          if (
            !currentConfig ||
            currentConfig.projectRef !== projectRef ||
            currentConfig.publishableKey !== publishableKey ||
            !currentBuild ||
            !sameBuild(currentBuild, build) ||
            (await backendDocumentDigest(graph, currentBuild, projectRef, schema)) !==
              documentDigest
          ) {
            fail('review-stale')
          }
          let currentProvider: BackendReleaseProviderAuthorityV1 | null
          try {
            currentProvider = await dependencies.resolveBackendProviderAuthority(currentBuild)
          } catch {
            return fail('backend-provider-unavailable')
          }
          if (!currentProvider || !sameAuthority(currentProvider, backendProvider)) {
            fail('backend-provider-unavailable')
          }
          let currentBinding: SupabaseStagingTargetBindingV1 | null
          try {
            currentBinding = await dependencies.resolveStagingTargetBinding()
          } catch {
            return fail('review-stale')
          }
          assertBinding(currentBinding, projectRef, reviewed.accountId)
          throwIfAborted(signal)
        }

        let result: DesktopSupabaseBackendStagingVerificationResult
        try {
          const prepared = await dependencies.prepareStrictVerification({
            verificationId,
            build,
            backendProvider,
            documentDigest,
            projectRef,
            accountId: reviewed.accountId,
            grantGeneration,
            expectedReview: reviewed,
            readPersonalAccessToken,
            writePersonalAccessToken,
            publishableKey,
            edgeUserAccessToken,
            storageUserA,
            storageUserB,
            tenantPartitions,
            revalidateLocalAuthority,
            claimBeforeMutation,
            recordMutationProgress,
            signal
          })
          result = deepFreezeJSON(structuredClone(prepared))
        } catch (cause) {
          if (cause instanceof PriorCapabilityResultError) return cause.result
          if (dispatchClaim) {
            await preserveUnknown()
            return fail('reconciliation-required')
          }
          if (cause instanceof DesktopSupabaseBackendStagingVerificationError) throw cause
          throwIfAborted(signal)
          return fail('verification-failed')
        }
        if (
          !receiptIsBound(result, {
            verificationId,
            projectRef,
            accountId: reviewed.accountId,
            grantGeneration,
            reviewedArtifactDigest: reviewed.artifact.manifestDigest
          }) ||
          (await digestCanonicalManifest(result.receipt)) !== result.receiptDigest
        ) {
          if (dispatchClaim) {
            await preserveUnknown()
            return fail('reconciliation-required')
          }
          fail('verification-failed')
        }
        if (dispatchClaim) {
          const operations = remoteOperationIds(result)
          try {
            dispatchClaim = await settleExact(
              dispatchClaim,
              'outcome-unknown',
              CAPABILITY_JOURNAL_UNKNOWN_CODE,
              operations
            )
            await persistEvidence('final', result, dispatchClaim)
            if (result.receipt.outcome !== 'outcome-unknown') {
              dispatchClaim = await settleExact(
                dispatchClaim,
                result.receipt.outcome === 'succeeded' ? 'applied' : 'failed',
                settlementCode(result.receipt.outcome),
                operations
              )
            }
          } catch {
            await preserveUnknown()
            return fail('reconciliation-required')
          }
        }
        return result
      } finally {
        readPersonalAccessToken = null
        writePersonalAccessToken = null
        edgeUserAccessToken = null
        storageUserA = null
        storageUserB = null
        active = false
      }
    },

    async inspectUnresolved(
      projectRef: string
    ): Promise<readonly DesktopSupabaseCapabilityUnresolvedInspection[]> {
      if (!/^[a-z]{20}$/u.test(projectRef)) fail('invalid-config')
      const dispatchScopeKey = capabilityDispatchScopeKey(projectRef)
      const records = await dependencies.dispatchJournal.listUnresolvedForScope(dispatchScopeKey)
      const inspections: DesktopSupabaseCapabilityUnresolvedInspection[] = []
      for (const raw of records) {
        const record = parseBackendHostReleaseDispatchJournalRecord(raw)
        if (
          record.version !== BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION ||
          record.dispatchScopeKey !== dispatchScopeKey ||
          (record.outcome !== 'pending' && record.outcome !== 'outcome-unknown')
        ) {
          throw new TypeError('Supabase capability unresolved journal response is invalid.')
        }
        let evidenceIntegrity: DesktopSupabaseCapabilityUnresolvedInspection['evidenceIntegrity'] =
          'unavailable'
        let evidencePhase: DesktopSupabaseCapabilityUnresolvedInspection['evidencePhase'] = null
        let evidencePayloadDigest: string | null = null
        let evidenceRecordedAt: string | null = null
        let evidence: Readonly<Record<string, unknown>> | null = null
        try {
          const stored = await dependencies.dispatchJournal.readEvidence(record.singleFlightKey)
          if (stored) {
            const parsed = parseBackendHostReleaseDispatchEvidenceRecord(stored)
            evidencePhase = parsed.phase
            evidencePayloadDigest = parsed.payloadDigest
            evidenceRecordedAt = parsed.recordedAt
            const payload = JSON.parse(parsed.payload) as unknown
            if (
              parsed.singleFlightKey !== record.singleFlightKey ||
              parsed.dispatchScopeKey !== dispatchScopeKey ||
              parsed.releaseId !== record.releaseId ||
              parsed.planDigest !== record.planDigest ||
              !isCapabilityEvidencePayload(payload) ||
              (await digestCanonicalManifest(payload)) !== parsed.payloadDigest
            ) {
              evidenceIntegrity = 'invalid'
            } else {
              evidenceIntegrity = 'verified'
              evidence = deepFreezeJSON(payload)
            }
          }
        } catch {
          evidenceIntegrity = 'invalid'
          evidence = null
        }
        inspections.push(
          Object.freeze({
            format: 'openpencil.supabase-capability-unresolved-inspection.v1' as const,
            version: 1 as const,
            projectRef,
            singleFlightKey: record.singleFlightKey,
            releaseId: record.releaseId,
            planDigest: record.planDigest,
            outcome: record.outcome,
            code: record.code,
            claimedAt: record.claimedAt,
            settledAt: record.settledAt,
            evidenceIntegrity,
            evidencePhase,
            evidencePayloadDigest,
            evidenceRecordedAt,
            evidence,
            automaticRetryAllowed: false as const,
            providerAuthoritativeReconciliationRequired: true as const
          })
        )
      }
      return Object.freeze(inspections)
    }
  })
}
