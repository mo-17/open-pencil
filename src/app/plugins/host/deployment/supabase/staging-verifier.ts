/* oxlint-disable eslint(max-lines) -- Catalog, Edge, and Storage receipt gates stay together so one verifier owns their shared authority binding. */
import {
  createSupabaseInspectedMigrationReview,
  type BackendCapabilityDecision,
  type SupabaseInspectedMigrationReviewV1
} from '@open-pencil/compiler/backend'
import {
  BACKEND_PRODUCTION_GATE_IDS,
  normalizeBackendReleaseProviderAuthority,
  type BackendApplicationSpecV1,
  type BackendCredentialRef,
  type BackendProductionGateId,
  type BackendProductionGateResultV1,
  type BackendReleaseProviderAuthorityV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { SupabaseEdgeFunctionReleaseReceipt } from './edge-function-release'
import type { SupabaseStorageIsolationReceipt } from './storage-isolation-verifier'

const SERVER_CAPABILITIES = new Set(['server.functions', 'server.http'])
const EDGE_PLATFORM_SECRET_NAMES = Object.freeze([
  'SUPABASE_PUBLISHABLE_KEYS',
  'SUPABASE_URL'
] as const)
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const FUNCTION_SLUG = /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/u
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,127}$/u
const STORAGE_CHECK_IDS = Object.freeze([
  'owner-create',
  'owner-read',
  'owner-update',
  'owner-upsert',
  'anonymous-read-denied',
  'second-user-read-denied',
  'second-user-update-denied',
  'second-user-delete-denied',
  'second-user-create-owner-path-denied',
  'path-prefix-escape-denied',
  'mime-limit-denied',
  'size-limit-denied',
  'owner-delete'
] as const)

type ReceiptAssessment<T> =
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'valid'; value: T }>

interface RequiredStorageRule {
  readonly bucketId: string
  readonly bucketName: string
  readonly ruleId: string
  readonly principal: 'owner' | 'tenant-member'
}

export interface SupabaseStagingReceiptAuthorityV1 {
  /** Host-captured lower bound for every receipt and nested live evidence timestamp. */
  readonly startedAt: string
  /** Exact operation-scoped ID minted before Edge dispatch, or null when Edge is not required. */
  readonly edgeFunctionReleaseId: string | null
  /** Exact operation-scoped IDs minted before each Storage probe. */
  readonly storageVerificationIds: readonly Readonly<{
    bucketId: string
    ruleId: string
    verificationId: string
  }>[]
}

export interface SupabaseStagingVerificationInput {
  readonly application: BackendApplicationSpecV1
  readonly capabilities: readonly BackendCapabilityDecision[]
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  /** Provider authority retained from the exact, digest-reviewed Host artifact. */
  readonly reviewedBackendProvider: BackendReleaseProviderAuthorityV1
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly planDigest: string
  readonly reviewedArtifactDigest: string
  readonly expectedReviewedArtifactDigest: string
  readonly reviewed: SupabaseInspectedMigrationReviewV1
  readonly postApplySnapshot: unknown
  readonly expectedPostApplySchemaDigest: string
  readonly remoteOperationIds: readonly string[]
  readonly requiredEnvironmentNames: readonly string[]
  readonly requiredCredentialRefs: readonly BackendCredentialRef[]
  /** Trusted digest of the reviewed Edge Function artifact, never sourced from the receipt. */
  readonly expectedEdgeFunctionArtifactDigest?: string | null
  /** Trusted runtime identity and exact secret-name inventory from that reviewed artifact. */
  readonly expectedEdgeFunctionHealthIdentity?: string | null
  readonly expectedEdgeFunctionRequiredSecretNames?: readonly string[]
  readonly edgeFunctionReceipt?: SupabaseEdgeFunctionReleaseReceipt | null
  /** Trusted digest of the reviewed Storage policy artifact, never sourced from a receipt. */
  readonly expectedStoragePolicyArtifactDigest?: string | null
  readonly storageIsolationReceipts?: readonly SupabaseStorageIsolationReceipt[]
  /**
   * Operation-scoped Host authority for live receipts. Persisted or caller-replayed receipts are
   * invalid unless every ID and timestamp falls inside this exact verification operation.
   */
  readonly receiptAuthority?: SupabaseStagingReceiptAuthorityV1
  readonly checkedAt: string
}

export interface SupabaseStagingVerificationResult {
  readonly gates: readonly BackendProductionGateResultV1[]
  readonly postApplyReview: SupabaseInspectedMigrationReviewV1
  readonly schemaApplied: boolean
}

function unknown(gate: BackendProductionGateId): BackendProductionGateResultV1 {
  return { gate, status: 'unknown', checkedAt: null, evidenceDigest: null }
}

function failed(gate: BackendProductionGateId): BackendProductionGateResultV1 {
  return { gate, status: 'failed', checkedAt: null, evidenceDigest: null }
}

async function passed(
  gate: BackendProductionGateId,
  input: SupabaseStagingVerificationInput,
  evidence: Readonly<Record<string, unknown>>
): Promise<BackendProductionGateResultV1> {
  const evidenceDigest = await digestCanonicalManifest({
    format: 'openpencil.supabase-staging-gate-evidence.v1',
    version: 1,
    gate,
    checkedAt: input.checkedAt,
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration,
    planDigest: input.planDigest,
    reviewedArtifactDigest: input.reviewedArtifactDigest,
    backendProvider: input.backendProvider,
    remoteOperationIds: input.remoteOperationIds,
    evidence
  })
  return { gate, status: 'passed', checkedAt: input.checkedAt, evidenceDigest }
}

function includedCapability(
  input: SupabaseStagingVerificationInput,
  predicate: (capability: string) => boolean
): boolean {
  return input.capabilities.some((decision) => decision.included && predicate(decision.capability))
}

function targetCapabilitiesSupported(input: SupabaseStagingVerificationInput): boolean {
  return input.capabilities.every(
    (decision) =>
      !decision.required ||
      (decision.providerSupported && decision.resolution === 'supported' && decision.included)
  )
}

function providerAuthorityIsValid(input: SupabaseStagingVerificationInput): boolean {
  try {
    const actual = normalizeBackendReleaseProviderAuthority(input.backendProvider)
    const reviewed = normalizeBackendReleaseProviderAuthority(input.reviewedBackendProvider)
    if (actual.providerId !== 'supabase' || JSON.stringify(actual) !== JSON.stringify(reviewed)) {
      return false
    }
    const requiredCapabilities = new Set([
      'migrations.schema',
      ...input.capabilities
        .filter((decision) => decision.included)
        .map((decision) => decision.capability)
    ])
    if ([...requiredCapabilities].some((capability) => !actual.capabilities.includes(capability))) {
      return false
    }
    const requiredOutputs = new Set(['database-schema'])
    if (requiredCapabilities.has('storage.objects')) requiredOutputs.add('security-policy')
    if (requiredCapabilities.has('server.functions') || requiredCapabilities.has('server.http')) {
      requiredOutputs.add('server-runtime')
    }
    return [...requiredOutputs].every((kind) => actual.outputKinds.includes(kind))
  } catch {
    return false
  }
}

function sameProviderAuthority(
  actual: BackendReleaseProviderAuthorityV1,
  expected: BackendReleaseProviderAuthorityV1
): boolean {
  try {
    return (
      JSON.stringify(normalizeBackendReleaseProviderAuthority(actual)) ===
      JSON.stringify(normalizeBackendReleaseProviderAuthority(expected))
    )
  } catch {
    return false
  }
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function timestampNotAfter(value: unknown, ceiling: unknown): boolean {
  return (
    canonicalTimestamp(value) &&
    canonicalTimestamp(ceiling) &&
    Date.parse(value) <= Date.parse(ceiling)
  )
}

function timestampWithinOperation(
  value: unknown,
  input: SupabaseStagingVerificationInput
): boolean {
  const floor = input.receiptAuthority?.startedAt
  return (
    canonicalTimestamp(value) &&
    canonicalTimestamp(floor) &&
    canonicalTimestamp(input.checkedAt) &&
    Date.parse(floor) <= Date.parse(value) &&
    Date.parse(value) <= Date.parse(input.checkedAt)
  )
}

function stableId(value: unknown): value is string {
  return typeof value === 'string' && STABLE_ID.test(value)
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST.test(value)
}

/** Preserve runtime validation at persisted/remote Receipt boundaries even when callers are typed. */
function runtimeEquals(left: unknown, right: unknown): boolean {
  return left === right
}

function uniqueStableIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.some((entry) => !stableId(entry))) return null
  return new Set(value).size === value.length ? value : null
}

function requiredEnvironmentNames(value: readonly string[]): readonly string[] | null {
  if (!Array.isArray(value) || value.some((entry) => !ENVIRONMENT_NAME.test(entry))) return null
  const sorted = [...value].sort((left, right) => left.localeCompare(right, 'en'))
  return new Set(sorted).size === sorted.length ? Object.freeze(sorted) : null
}

function edgeReceiptEnvelopeMatches(
  input: SupabaseStagingVerificationInput,
  receipt: SupabaseEdgeFunctionReleaseReceipt,
  expectedArtifactDigest: string,
  expectedHealthIdentity: string,
  receiptSecretNames: readonly string[],
  expectedSecretNames: readonly string[]
): boolean {
  const secretInspection = receipt.secretInspection
  const exactSecretNames =
    receiptSecretNames.length === expectedSecretNames.length &&
    receiptSecretNames.every((name, index) => name === expectedSecretNames[index])
  return [
    runtimeEquals(receipt.format, 'openpencil.supabase-edge-function-deployment-receipt'),
    runtimeEquals(receipt.version, 1),
    receipt.environment === 'staging',
    receipt.projectRef === input.projectRef,
    receipt.accountId === input.accountId,
    receipt.grantGeneration === input.grantGeneration,
    sameProviderAuthority(receipt.provider, input.backendProvider),
    receipt.artifactDigest === expectedArtifactDigest,
    receipt.healthIdentity === expectedHealthIdentity,
    stableId(receipt.releaseId),
    receipt.releaseId === input.receiptAuthority?.edgeFunctionReleaseId,
    FUNCTION_SLUG.test(receipt.functionSlug),
    runtimeEquals(receipt.verifyJwt, true),
    receipt.dispatch === 'dispatched',
    receipt.outcome === 'succeeded',
    receipt.failureCode === null,
    timestampWithinOperation(receipt.recordedAt, input),
    exactSecretNames,
    secretInspection !== null,
    secretInspection?.projectRef === input.projectRef,
    secretInspection?.accountId === input.accountId,
    secretInspection?.grantGeneration === input.grantGeneration,
    secretInspection?.providerId === 'supabase',
    secretInspection?.functionSlug === receipt.functionSlug,
    secretInspection?.artifactDigest === expectedArtifactDigest,
    Array.isArray(secretInspection?.requiredSecretNames),
    JSON.stringify(secretInspection?.requiredSecretNames) === JSON.stringify(expectedSecretNames),
    validDigest(secretInspection?.evidenceDigest),
    timestampWithinOperation(secretInspection?.checkedAt, input),
    timestampNotAfter(secretInspection?.checkedAt, receipt.recordedAt)
  ].every(Boolean)
}

async function edgeReceiptRemoteMatches(
  input: SupabaseStagingVerificationInput,
  receipt: SupabaseEdgeFunctionReleaseReceipt,
  operationIds: readonly string[],
  expectedHealthIdentity: string,
  expectedSecretNames: readonly string[]
): Promise<boolean> {
  const health = receipt.health
  const secretInspection = receipt.secretInspection
  if (!health || !secretInspection) return false
  const expectedSecretEvidenceDigest = await digestCanonicalManifest({
    format: 'openpencil.supabase-edge-secret-inspection-evidence.v1',
    version: 1,
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration,
    providerId: 'supabase',
    functionSlug: receipt.functionSlug,
    artifactDigest: receipt.artifactDigest,
    requiredSecretNames: expectedSecretNames,
    checkedAt: secretInspection.checkedAt
  })
  const expectedHealthEvidenceDigest = await digestCanonicalManifest({
    format: 'openpencil.supabase-edge-health-evidence.v1',
    version: 1,
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration,
    functionSlug: receipt.functionSlug,
    functionId: receipt.remote.functionId,
    versionId: receipt.remote.versionId,
    expectedHealthIdentity,
    authenticated: true,
    healthy: true,
    checkedAt: health.checkedAt
  })
  return [
    stableId(receipt.remote.functionId),
    stableId(receipt.remote.versionId),
    operationIds.length >= 2,
    runtimeEquals(health.status, 200),
    runtimeEquals(health.authenticated, true),
    runtimeEquals(health.healthy, true),
    health.healthIdentity === expectedHealthIdentity,
    health.evidenceDigest === expectedHealthEvidenceDigest,
    health.operationId === `edge-health-${expectedHealthEvidenceDigest.slice(0, 32)}`,
    secretInspection.evidenceDigest === expectedSecretEvidenceDigest,
    stableId(health.operationId),
    operationIds.includes(health.operationId),
    timestampWithinOperation(health.checkedAt, input),
    timestampNotAfter(health.checkedAt, receipt.recordedAt)
  ].every(Boolean)
}

async function assessEdgeFunctionReceipt(
  input: SupabaseStagingVerificationInput
): Promise<ReceiptAssessment<SupabaseEdgeFunctionReleaseReceipt>> {
  const receipt = input.edgeFunctionReceipt
  if (!receipt) return { status: 'missing' }
  try {
    const expectedArtifactDigest = input.expectedEdgeFunctionArtifactDigest
    const expectedHealthIdentity = input.expectedEdgeFunctionHealthIdentity
    const expectedSecretNames = requiredEnvironmentNames(
      input.expectedEdgeFunctionRequiredSecretNames ?? []
    )
    const receiptSecretNames = requiredEnvironmentNames(receipt.requiredSecretNames)
    const operationIds = uniqueStableIds(receipt.remote.operationIds)
    if (
      !input.receiptAuthority ||
      !stableId(input.receiptAuthority.edgeFunctionReleaseId) ||
      !validDigest(expectedArtifactDigest) ||
      !validDigest(expectedHealthIdentity) ||
      !expectedSecretNames ||
      expectedSecretNames.length === 0 ||
      ![...EDGE_PLATFORM_SECRET_NAMES, ...input.requiredEnvironmentNames].every((name) =>
        expectedSecretNames.includes(name)
      ) ||
      !receiptSecretNames ||
      !operationIds ||
      !edgeReceiptEnvelopeMatches(
        input,
        receipt,
        expectedArtifactDigest,
        expectedHealthIdentity,
        receiptSecretNames,
        expectedSecretNames
      ) ||
      !(await edgeReceiptRemoteMatches(
        input,
        receipt,
        operationIds,
        expectedHealthIdentity,
        expectedSecretNames
      ))
    ) {
      return { status: 'invalid' }
    }
    return { status: 'valid', value: receipt }
  } catch {
    return { status: 'invalid' }
  }
}

function ruleSupportsCompleteProbe(operations: readonly string[]): boolean {
  const declared = new Set(operations)
  const upsert =
    declared.has('upsert') ||
    (declared.has('read') && declared.has('create') && declared.has('update'))
  return declared.has('delete') && upsert
}

function requiredStorageRules(
  application: BackendApplicationSpecV1
): readonly RequiredStorageRule[] {
  return Object.freeze(
    (application.storage?.buckets ?? [])
      .filter((bucket) => bucket.access === 'private')
      .flatMap((bucket) =>
        bucket.pathRules
          .filter((rule) => ruleSupportsCompleteProbe(rule.operations))
          .map((rule) => ({
            bucketId: bucket.id,
            bucketName: bucket.name,
            ruleId: rule.id,
            principal: rule.principal.kind
          }))
      )
      .sort((left, right) =>
        `${left.bucketId}\u0000${left.ruleId}`.localeCompare(
          `${right.bucketId}\u0000${right.ruleId}`,
          'en'
        )
      )
  )
}

function storageModelSupportsCompleteProbe(application: BackendApplicationSpecV1): boolean {
  const buckets = application.storage?.buckets ?? []
  return (
    buckets.length > 0 &&
    buckets.every(
      (bucket) =>
        bucket.access === 'private' &&
        bucket.pathRules.length > 0 &&
        bucket.pathRules.every((rule) => ruleSupportsCompleteProbe(rule.operations))
    )
  )
}

function storageReceiptChecksAreComplete(receipt: SupabaseStorageIsolationReceipt): boolean {
  if (!Array.isArray(receipt.checks) || receipt.checks.length !== STORAGE_CHECK_IDS.length) {
    return false
  }
  const operationIds = uniqueStableIds(receipt.remoteOperationIds)
  // Bucket inspection, initial actor binding, every object probe, and the final actor-session
  // liveness proof must all contribute distinct remote evidence.
  if (!operationIds || operationIds.length !== receipt.checks.length + 3) return false
  const seen = new Set<string>()
  for (const check of receipt.checks) {
    if (
      !STORAGE_CHECK_IDS.includes(check.check) ||
      seen.has(check.check) ||
      check.passed !== true ||
      !validDigest(check.evidenceDigest) ||
      !stableId(check.operationId) ||
      !operationIds.includes(check.operationId)
    ) {
      return false
    }
    seen.add(check.check)
  }
  return STORAGE_CHECK_IDS.every((check) => seen.has(check))
}

function storageReceiptMatches(
  input: SupabaseStagingVerificationInput,
  receipt: SupabaseStorageIsolationReceipt,
  expected: RequiredStorageRule,
  applicationDigest: string,
  expectedStoragePolicyArtifactDigest: string
): boolean {
  try {
    return [
      runtimeEquals(receipt.format, 'openpencil.supabase-storage-isolation-receipt'),
      runtimeEquals(receipt.version, 1),
      receipt.environment === 'staging',
      receipt.projectRef === input.projectRef,
      receipt.accountId === input.accountId,
      receipt.grantGeneration === input.grantGeneration,
      sameProviderAuthority(receipt.provider, input.backendProvider),
      receipt.applicationDigest === applicationDigest,
      receipt.storagePolicyArtifactDigest === expectedStoragePolicyArtifactDigest,
      receipt.bucketId === expected.bucketId,
      receipt.bucketName === expected.bucketName,
      receipt.ruleId === expected.ruleId,
      receipt.verificationId === expectedVerificationId(input, expected),
      receipt.principal === expected.principal,
      stableId(receipt.verificationId),
      validDigest(receipt.actorEvidenceDigest),
      validDigest(receipt.bucketEvidenceDigest),
      storageReceiptChecksAreComplete(receipt),
      Array.isArray(receipt.residualObjectPaths),
      receipt.residualObjectPaths.length === 0,
      receipt.dispatch === 'dispatched',
      receipt.outcome === 'succeeded',
      receipt.failureCode === null,
      timestampWithinOperation(receipt.checkedAt, input)
    ].every(Boolean)
  } catch {
    return false
  }
}

function expectedVerificationId(
  input: SupabaseStagingVerificationInput,
  expected: RequiredStorageRule
): string | null {
  const matches =
    input.receiptAuthority?.storageVerificationIds.filter(
      (entry) => entry.bucketId === expected.bucketId && entry.ruleId === expected.ruleId
    ) ?? []
  if (matches.length !== 1 || !stableId(matches[0]?.verificationId)) return null
  return matches[0]?.verificationId ?? null
}

function assessStorageIsolationReceipts(
  input: SupabaseStagingVerificationInput,
  requiredRules: readonly RequiredStorageRule[],
  applicationDigest: string
): ReceiptAssessment<readonly SupabaseStorageIsolationReceipt[]> {
  const receipts = input.storageIsolationReceipts
  if (!receipts || receipts.length === 0) return { status: 'missing' }
  const expectedPolicyDigest = input.expectedStoragePolicyArtifactDigest
  if (
    !Array.isArray(receipts) ||
    !validDigest(expectedPolicyDigest) ||
    !input.receiptAuthority ||
    input.receiptAuthority.storageVerificationIds.length !== requiredRules.length
  ) {
    return { status: 'invalid' }
  }
  try {
    const expected = new Map(
      requiredRules.map((rule) => [`${rule.bucketId}\u0000${rule.ruleId}`, rule])
    )
    const seen = new Set<string>()
    for (const receipt of receipts) {
      const key = `${receipt.bucketId}\u0000${receipt.ruleId}`
      const rule = expected.get(key)
      if (
        !rule ||
        seen.has(key) ||
        !storageReceiptMatches(input, receipt, rule, applicationDigest, expectedPolicyDigest)
      ) {
        return { status: 'invalid' }
      }
      seen.add(key)
    }
    if (seen.size !== requiredRules.length) return { status: 'missing' }
    return {
      status: 'valid',
      value: Object.freeze(
        [...receipts].sort((left, right) =>
          `${left.bucketId}\u0000${left.ruleId}`.localeCompare(
            `${right.bucketId}\u0000${right.ruleId}`,
            'en'
          )
        )
      )
    }
  } catch {
    return { status: 'invalid' }
  }
}

async function serverWorkflowGate(
  input: SupabaseStagingVerificationInput,
  required: boolean,
  receipt: ReceiptAssessment<SupabaseEdgeFunctionReleaseReceipt>
): Promise<BackendProductionGateResultV1> {
  if (!required) {
    return passed('server-workflows-deployed', input, { reason: 'not-required-by-plan' })
  }
  if (receipt.status === 'missing') return unknown('server-workflows-deployed')
  if (receipt.status === 'invalid') return failed('server-workflows-deployed')
  return passed('server-workflows-deployed', input, {
    releaseId: receipt.value.releaseId,
    functionSlug: receipt.value.functionSlug,
    artifactDigest: receipt.value.artifactDigest,
    operationIds: receipt.value.remote.operationIds
  })
}

async function requiredSecretsGate(
  input: SupabaseStagingVerificationInput,
  receipt: ReceiptAssessment<SupabaseEdgeFunctionReleaseReceipt>
): Promise<BackendProductionGateResultV1> {
  const environmentRequired = input.requiredEnvironmentNames.length > 0
  const credentialRequired = input.requiredCredentialRefs.length > 0
  if (!environmentRequired && !credentialRequired) {
    return passed('required-secrets-present', input, { reason: 'no-required-secret-refs' })
  }
  if (environmentRequired && receipt.status === 'invalid') {
    return failed('required-secrets-present')
  }
  if (credentialRequired || receipt.status === 'missing') {
    return unknown('required-secrets-present')
  }
  if (receipt.status !== 'valid') return failed('required-secrets-present')
  return passed('required-secrets-present', input, {
    releaseId: receipt.value.releaseId,
    requiredEnvironmentNames: [...input.requiredEnvironmentNames].sort(),
    receiptSecretNames: receipt.value.requiredSecretNames
  })
}

async function storagePolicyGate(
  input: SupabaseStagingVerificationInput,
  required: boolean,
  modelSupportsCompleteProbe: boolean,
  rules: readonly RequiredStorageRule[],
  receipts: ReceiptAssessment<readonly SupabaseStorageIsolationReceipt[]>,
  applicationDigest: string
): Promise<BackendProductionGateResultV1> {
  if (!required) return passed('storage-policy-verified', input, { reason: 'not-required-by-plan' })
  if (!modelSupportsCompleteProbe || rules.length === 0 || receipts.status === 'invalid') {
    return failed('storage-policy-verified')
  }
  if (receipts.status === 'missing') return unknown('storage-policy-verified')
  return passed('storage-policy-verified', input, {
    applicationDigest,
    storagePolicyArtifactDigest: input.expectedStoragePolicyArtifactDigest,
    receipts: receipts.value.map((receipt) => ({
      verificationId: receipt.verificationId,
      bucketId: receipt.bucketId,
      ruleId: receipt.ruleId,
      actorEvidenceDigest: receipt.actorEvidenceDigest,
      bucketEvidenceDigest: receipt.bucketEvidenceDigest,
      remoteOperationIds: receipt.remoteOperationIds
    }))
  })
}

async function backendHealthGate(
  input: SupabaseStagingVerificationInput,
  serverRequired: boolean,
  receipt: ReceiptAssessment<SupabaseEdgeFunctionReleaseReceipt>,
  postApplyReview: SupabaseInspectedMigrationReviewV1
): Promise<BackendProductionGateResultV1> {
  if (!serverRequired) {
    return passed('backend-health-check', input, {
      check: 'bounded-read-only-pg-catalog',
      postApplySchemaDigest: postApplyReview.manifest.inspectedSchemaDigest,
      postApplyCaptureDigest: postApplyReview.snapshot.captureDigest
    })
  }
  if (receipt.status === 'missing') return unknown('backend-health-check')
  if (receipt.status === 'invalid') return failed('backend-health-check')
  return passed('backend-health-check', input, {
    check: 'authenticated-edge-function-invoke',
    functionSlug: receipt.value.functionSlug,
    functionId: receipt.value.remote.functionId,
    versionId: receipt.value.remote.versionId,
    healthEvidenceDigest: receipt.value.health?.evidenceDigest,
    healthOperationId: receipt.value.health?.operationId
  })
}

function gateMap(
  entries: readonly BackendProductionGateResultV1[]
): readonly BackendProductionGateResultV1[] {
  const byId = new Map(entries.map((entry) => [entry.gate, entry]))
  return Object.freeze(BACKEND_PRODUCTION_GATE_IDS.map((gate) => byId.get(gate) ?? unknown(gate)))
}

/**
 * Catalog evidence proves schema state. Edge and Storage gates accept only separately issued,
 * exact-authority Host receipts; table JWT/RLS behavior remains unknown without its own probe.
 */
export async function verifySupabaseStagingRelease(
  input: SupabaseStagingVerificationInput
): Promise<SupabaseStagingVerificationResult> {
  if (!canonicalTimestamp(input.checkedAt)) {
    throw new TypeError('Supabase staging verification checkedAt must be canonical UTC.')
  }
  if (
    input.receiptAuthority &&
    (!canonicalTimestamp(input.receiptAuthority.startedAt) ||
      Date.parse(input.receiptAuthority.startedAt) > Date.parse(input.checkedAt))
  ) {
    throw new TypeError('Supabase staging receipt authority has an invalid operation window.')
  }
  const postApplyReview = await createSupabaseInspectedMigrationReview({
    application: input.application,
    snapshot: input.postApplySnapshot,
    expectedProjectRef: input.projectRef,
    expectedAccountId: input.accountId,
    expectedInspectedSchemaDigest: input.expectedPostApplySchemaDigest,
    expectedTargetModelDigest: input.reviewed.manifest.targetModelDigest
  })
  const schemaApplied =
    postApplyReview.manifest.currentModelDigest === input.reviewed.manifest.targetModelDigest &&
    postApplyReview.manifest.migrationPlan.operations.length === 0 &&
    postApplyReview.manifest.blockers.length === 0 &&
    postApplyReview.manifest.privilegeOperations.length === 0
  const artifactMatches =
    input.reviewedArtifactDigest === input.expectedReviewedArtifactDigest &&
    postApplyReview.manifest.applicationDigest === input.reviewed.manifest.applicationDigest &&
    postApplyReview.manifest.targetModelDigest === input.reviewed.manifest.targetModelDigest
  const serverRequired = includedCapability(input, (capability) =>
    SERVER_CAPABILITIES.has(capability)
  )
  const storageRequired = includedCapability(
    input,
    (capability) => capability === 'storage.objects'
  )
  const authPolicyRequired =
    input.application.auth.rowAccess.length > 0 ||
    includedCapability(input, (capability) => capability === 'policy.row-level')
  const capabilitiesSupported = targetCapabilitiesSupported(input)
  const providerAuthorityValid = providerAuthorityIsValid(input)
  const edgeFunctionReceipt = await assessEdgeFunctionReceipt(input)
  const storageRules = requiredStorageRules(input.application)
  const storageModelVerifiable = storageModelSupportsCompleteProbe(input.application)
  const storageIsolationReceipts = assessStorageIsolationReceipts(
    input,
    storageRules,
    postApplyReview.manifest.applicationDigest
  )

  const gates: BackendProductionGateResultV1[] = []
  gates.push(
    schemaApplied
      ? await passed('migration-applied', input, {
          targetModelDigest: postApplyReview.manifest.targetModelDigest,
          postApplySchemaDigest: postApplyReview.manifest.inspectedSchemaDigest,
          postApplyCaptureDigest: postApplyReview.snapshot.captureDigest
        })
      : failed('migration-applied')
  )
  gates.push(
    schemaApplied
      ? await passed('schema-drift-none', input, {
          currentModelDigest: postApplyReview.manifest.currentModelDigest,
          postApplyCaptureDigest: postApplyReview.snapshot.captureDigest,
          migrationOperationCount: 0,
          privilegeOperationCount: 0
        })
      : failed('schema-drift-none')
  )
  gates.push(
    authPolicyRequired
      ? unknown('auth-policy-verified')
      : await passed('auth-policy-verified', input, { reason: 'not-required-by-application' })
  )
  gates.push(await serverWorkflowGate(input, serverRequired, edgeFunctionReceipt))
  gates.push(await requiredSecretsGate(input, edgeFunctionReceipt))
  gates.push(
    await storagePolicyGate(
      input,
      storageRequired,
      storageModelVerifiable,
      storageRules,
      storageIsolationReceipts,
      postApplyReview.manifest.applicationDigest
    )
  )
  gates.push(await backendHealthGate(input, serverRequired, edgeFunctionReceipt, postApplyReview))
  gates.push(
    capabilitiesSupported
      ? await passed('target-capabilities-supported', input, {
          included: input.capabilities
            .filter((decision) => decision.included)
            .map((decision) => decision.capability)
            .sort()
        })
      : failed('target-capabilities-supported')
  )
  gates.push(
    artifactMatches
      ? await passed('artifact-review-match', input, {
          reviewedManifestDigest: input.reviewed.manifestDigest,
          reviewedSqlDigest: input.reviewed.manifest.sqlDigest
        })
      : failed('artifact-review-match')
  )
  gates.push(
    providerAuthorityValid
      ? await passed('provider-authority-valid', input, {
          providerId: input.backendProvider.providerId,
          packageDigest: input.backendProvider.packageDigest,
          reviewedPackageDigest: input.reviewedBackendProvider.packageDigest
        })
      : failed('provider-authority-valid')
  )

  return Object.freeze({
    gates: gateMap(gates),
    postApplyReview,
    schemaApplied
  })
}
