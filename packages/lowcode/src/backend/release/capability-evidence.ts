/* eslint-disable max-lines -- subject, receipt, actual-IR derivation, and evidence evaluation form one fail-closed authority boundary */
import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  deriveBackendApplicationCapabilitiesV2,
  digestBackendApplicationV2,
  normalizedBackendApplicationV2
} from '../application-v2'
import type { BackendApplicationSpecV2, BackendCapabilityV2 } from '../application-v2-types'
import type { BackendReleaseEnvironment } from './types'
import {
  compareReleaseTimestamps,
  exactArray,
  exactRecord,
  nullableDigest,
  nullableTimestamp,
  releaseDigest,
  releaseIdentifier,
  releaseTimestamp,
  releaseTimestampInstantNanoseconds,
  stringValue
} from './validation'

export const BACKEND_RELEASE_EVIDENCE_VERSION = 1 as const
export const BACKEND_RELEASE_EVIDENCE_FORMAT = 'openpencil.backend-release-evidence' as const
export const BACKEND_RELEASE_EVIDENCE_SUBJECT_FORMAT =
  'openpencil.backend-release-evidence-subject' as const
export const BACKEND_RELEASE_EVIDENCE_RECEIPT_FORMAT =
  'openpencil.backend-release-evidence-receipt' as const
export const BACKEND_RELEASE_EVIDENCE_MAX_TTL_MS = 24 * 60 * 60 * 1_000

export const BACKEND_RELEASE_EVIDENCE_CAPABILITIES = Object.freeze([
  'audit.events',
  'auth.identity',
  'auth.roles',
  'data.read',
  'data.write',
  'drift.detect',
  'events.data-change',
  'jobs.schedule',
  'migrations.backfill',
  'migrations.data',
  'migrations.schema',
  'observability.logs',
  'observability.metrics',
  'observability.traces',
  'policy.row-level',
  'queues.consume',
  'queues.publish',
  'realtime.subscribe',
  'server.functions',
  'server.http',
  'storage.objects',
  'transactions.atomic',
  'webhooks.deliver',
  'webhooks.receive',
  'workflows.durable-execution',
  'workflows.idempotency',
  'workflows.retry'
] as const satisfies readonly BackendCapabilityV2[])

export type BackendReleaseEvidenceCapability =
  (typeof BACKEND_RELEASE_EVIDENCE_CAPABILITIES)[number]

export const BACKEND_RELEASE_INVARIANT_EVIDENCE_IDS = Object.freeze([
  'artifact-review-match',
  'provider-authority-valid',
  'target-capabilities-supported'
] as const)

export type BackendReleaseInvariantEvidenceId =
  (typeof BACKEND_RELEASE_INVARIANT_EVIDENCE_IDS)[number]

export const BACKEND_RELEASE_CAPABILITY_EVIDENCE_IDS = Object.freeze({
  'audit.events': 'audit-events-verified',
  'auth.identity': 'auth-identity-verified',
  'auth.roles': 'auth-roles-verified',
  'data.read': 'data-read-verified',
  'data.write': 'data-write-verified',
  'drift.detect': 'drift-detection-verified',
  'events.data-change': 'data-change-events-verified',
  'jobs.schedule': 'scheduled-jobs-verified',
  'migrations.backfill': 'data-backfill-verified',
  'migrations.data': 'data-migration-verified',
  'migrations.schema': 'schema-migration-verified',
  'observability.logs': 'observability-logs-verified',
  'observability.metrics': 'observability-metrics-verified',
  'observability.traces': 'observability-traces-verified',
  'policy.row-level': 'row-level-policy-verified',
  'queues.consume': 'queue-consume-verified',
  'queues.publish': 'queue-publish-verified',
  'realtime.subscribe': 'realtime-subscription-verified',
  'server.functions': 'server-functions-deployed',
  'server.http': 'server-http-verified',
  'storage.objects': 'storage-policy-verified',
  'transactions.atomic': 'atomic-transaction-verified',
  'webhooks.deliver': 'outbound-webhook-verified',
  'webhooks.receive': 'inbound-webhook-verified',
  'workflows.durable-execution': 'workflow-durable-execution-verified',
  'workflows.idempotency': 'workflow-idempotency-verified',
  'workflows.retry': 'workflow-retry-verified'
} as const satisfies Record<BackendCapabilityV2, string>)

export type BackendReleaseCapabilityEvidenceId =
  (typeof BACKEND_RELEASE_CAPABILITY_EVIDENCE_IDS)[BackendReleaseEvidenceCapability]
export type BackendReleaseEvidenceId =
  | BackendReleaseInvariantEvidenceId
  | BackendReleaseCapabilityEvidenceId
export const BACKEND_RELEASE_WEBHOOK_HMAC_PURPOSE_VERIFIER_CHECK =
  'dedicated-webhook-hmac-credential-purpose-verified' as const
export const BACKEND_RELEASE_BACKFILL_CURSOR_VERIFIER_CHECK =
  'integer-identity-cursor-immutable-append-monotonic-verified' as const
export type BackendReleaseEvidenceVerifierCheck =
  | BackendReleaseEvidenceId
  | typeof BACKEND_RELEASE_WEBHOOK_HMAC_PURPOSE_VERIFIER_CHECK
  | typeof BACKEND_RELEASE_BACKFILL_CURSOR_VERIFIER_CHECK
export type BackendReleaseEvidenceStatus = 'passed' | 'unknown' | 'failed'
export type BackendReleaseTrustedEvidenceStatus = Exclude<BackendReleaseEvidenceStatus, 'unknown'>

export interface BackendReleaseEvidenceSubjectV1 {
  readonly format: typeof BACKEND_RELEASE_EVIDENCE_SUBJECT_FORMAT
  readonly version: typeof BACKEND_RELEASE_EVIDENCE_VERSION
  readonly applicationDigest: string
  readonly authorityDigest: string
  readonly providerId: string
  readonly environment: BackendReleaseEnvironment
  readonly planDigest: string
  readonly artifactManifestDigest: string
  readonly verifierId: string
  readonly verifierVersion: string
}

export type CreateBackendReleaseEvidenceSubjectInput = Omit<
  BackendReleaseEvidenceSubjectV1,
  'format' | 'version' | 'applicationDigest'
>

export interface BackendReleaseEvidenceRequirementV1 {
  readonly requirementId: BackendReleaseEvidenceId
  readonly source: 'release-invariant' | 'capability'
  readonly capability: BackendReleaseEvidenceCapability | null
  /** Every claim the Host verifier must accept before issuing one receipt. */
  readonly verifierChecks: readonly BackendReleaseEvidenceVerifierCheck[]
}

export interface BackendReleaseEvidenceRecordV1 {
  readonly requirementId: BackendReleaseEvidenceId
  readonly status: BackendReleaseEvidenceStatus
  readonly subjectDigest: string
  readonly trustedReceiptDigest: string | null
  readonly checkedAt: string | null
  readonly expiresAt: string | null
  readonly evidenceDigest: string | null
}

export interface BackendReleaseEvidenceReceiptCandidatePayloadV1 {
  readonly format: typeof BACKEND_RELEASE_EVIDENCE_RECEIPT_FORMAT
  readonly version: typeof BACKEND_RELEASE_EVIDENCE_VERSION
  readonly requirementId: BackendReleaseEvidenceId
  readonly subjectDigest: string
  readonly status: BackendReleaseTrustedEvidenceStatus
  readonly checkedAt: string
  readonly expiresAt: string
  readonly evidenceDigest: string
}

export interface BackendReleaseEvidenceReceiptCandidateV1 extends BackendReleaseEvidenceReceiptCandidatePayloadV1 {
  readonly receiptDigest: string
}

export type CreateBackendReleaseEvidenceReceiptCandidateInput = Omit<
  BackendReleaseEvidenceReceiptCandidatePayloadV1,
  'format' | 'version'
>

/** Values supplied independently by the trusted Host, never by provider output. */
export interface BackendReleaseHostAcceptedEvidenceContextV1 {
  readonly expectedSubject: BackendReleaseEvidenceSubjectV1
  /** Receipt candidates independently authenticated and accepted by Host policy/storage. */
  readonly trustedReceipts: readonly BackendReleaseEvidenceReceiptCandidateV1[]
  readonly evaluatedAt: string
}

export type BackendReleaseEvidenceBlockerCode =
  | 'release-evidence-missing'
  | 'release-evidence-failed'
  | 'release-evidence-expected-subject-invalid'
  | 'release-evidence-subject-mismatch'
  | 'release-evidence-receipt-untrusted'
  | 'release-evidence-receipt-mismatch'
  | 'release-evidence-future-dated'
  | 'release-evidence-expired'

export interface BackendReleaseEvidenceBlocker {
  readonly requirementId: BackendReleaseEvidenceId
  readonly capability: BackendReleaseEvidenceCapability | null
  readonly status: 'unknown' | 'failed' | 'blocked'
  readonly code: BackendReleaseEvidenceBlockerCode
}

/**
 * `releaseReady` means ready only inside the supplied Host-accepted evidence
 * context. It does not replace the authority-bound Backend Release receipt,
 * verifier authentication, signature policy, or accepted receipt store.
 */
export interface BackendReleaseEvidenceAssessmentV1 {
  readonly format: typeof BACKEND_RELEASE_EVIDENCE_FORMAT
  readonly version: typeof BACKEND_RELEASE_EVIDENCE_VERSION
  readonly expectedSubject: BackendReleaseEvidenceSubjectV1
  readonly expectedSubjectDigest: string
  readonly trustedReceiptDigests: readonly string[]
  readonly evaluatedAt: string
  readonly releaseReady: boolean
  readonly requirements: readonly BackendReleaseEvidenceRequirementV1[]
  readonly evidence: readonly BackendReleaseEvidenceRecordV1[]
  readonly blockers: readonly BackendReleaseEvidenceBlocker[]
}

const CAPABILITIES = new Set<string>(BACKEND_RELEASE_EVIDENCE_CAPABILITIES)
const INVARIANT_IDS = new Set<string>(BACKEND_RELEASE_INVARIANT_EVIDENCE_IDS)
const CAPABILITY_BY_EVIDENCE_ID = new Map<string, BackendReleaseEvidenceCapability>(
  BACKEND_RELEASE_EVIDENCE_CAPABILITIES.map((capability) => [
    BACKEND_RELEASE_CAPABILITY_EVIDENCE_IDS[capability],
    capability
  ])
)
const EVIDENCE_IDS = new Set<string>([
  ...BACKEND_RELEASE_INVARIANT_EVIDENCE_IDS,
  ...CAPABILITY_BY_EVIDENCE_ID.keys()
])
const EVIDENCE_STATUSES = new Set<string>(['passed', 'unknown', 'failed'])
const TRUSTED_EVIDENCE_STATUSES = new Set<string>(['passed', 'failed'])
const ENVIRONMENTS = new Set<string>(['preview', 'staging', 'production'])

const SUBJECT_KEYS = [
  'format',
  'version',
  'applicationDigest',
  'authorityDigest',
  'providerId',
  'environment',
  'planDigest',
  'artifactManifestDigest',
  'verifierId',
  'verifierVersion'
] as const
const SUBJECT_INPUT_KEYS = SUBJECT_KEYS.filter(
  (key) => !['format', 'version', 'applicationDigest'].includes(key)
)
const RECEIPT_PAYLOAD_KEYS = [
  'format',
  'version',
  'requirementId',
  'subjectDigest',
  'status',
  'checkedAt',
  'expiresAt',
  'evidenceDigest'
] as const

function freezeArray<Value>(values: Value[]): readonly Value[] {
  for (const value of values) {
    if (value !== null && typeof value === 'object') Object.freeze(value)
  }
  return Object.freeze(values)
}

function evidenceId(value: unknown, path: string): BackendReleaseEvidenceId {
  const parsed = releaseIdentifier(stringValue(value, path), path)
  if (!EVIDENCE_IDS.has(parsed)) {
    throw new TypeError(`${path} is not supported by the release evidence contract`)
  }
  return parsed as BackendReleaseEvidenceId
}

function settledStatus(value: unknown, path: string): BackendReleaseTrustedEvidenceStatus {
  if (typeof value !== 'string' || !TRUSTED_EVIDENCE_STATUSES.has(value)) {
    throw new TypeError(`${path} must be passed or failed`)
  }
  return value as BackendReleaseTrustedEvidenceStatus
}

export function parseBackendReleaseEvidenceSubject(
  value: unknown,
  path = '$.subject'
): BackendReleaseEvidenceSubjectV1 {
  const source = exactRecord(value, path, SUBJECT_KEYS)
  if (source.format !== BACKEND_RELEASE_EVIDENCE_SUBJECT_FORMAT) {
    throw new TypeError(`${path}.format is not supported`)
  }
  if (source.version !== BACKEND_RELEASE_EVIDENCE_VERSION) {
    throw new TypeError(`${path}.version is not supported`)
  }
  if (typeof source.environment !== 'string' || !ENVIRONMENTS.has(source.environment)) {
    throw new TypeError(`${path}.environment is not supported`)
  }
  return Object.freeze({
    format: BACKEND_RELEASE_EVIDENCE_SUBJECT_FORMAT,
    version: BACKEND_RELEASE_EVIDENCE_VERSION,
    applicationDigest: releaseDigest(
      stringValue(source.applicationDigest, `${path}.applicationDigest`),
      `${path}.applicationDigest`
    ),
    authorityDigest: releaseDigest(
      stringValue(source.authorityDigest, `${path}.authorityDigest`),
      `${path}.authorityDigest`
    ),
    providerId: releaseIdentifier(
      stringValue(source.providerId, `${path}.providerId`),
      `${path}.providerId`
    ),
    environment: source.environment as BackendReleaseEnvironment,
    planDigest: releaseDigest(
      stringValue(source.planDigest, `${path}.planDigest`),
      `${path}.planDigest`
    ),
    artifactManifestDigest: releaseDigest(
      stringValue(source.artifactManifestDigest, `${path}.artifactManifestDigest`),
      `${path}.artifactManifestDigest`
    ),
    verifierId: releaseIdentifier(
      stringValue(source.verifierId, `${path}.verifierId`),
      `${path}.verifierId`
    ),
    verifierVersion: releaseIdentifier(
      stringValue(source.verifierVersion, `${path}.verifierVersion`),
      `${path}.verifierVersion`
    )
  })
}

export async function createBackendReleaseEvidenceSubject(
  application: BackendApplicationSpecV2,
  input: CreateBackendReleaseEvidenceSubjectInput
): Promise<BackendReleaseEvidenceSubjectV1> {
  const normalized = normalizedBackendApplicationV2(application)
  const source = exactRecord(input, '$.subjectInput', SUBJECT_INPUT_KEYS)
  return parseBackendReleaseEvidenceSubject({
    format: BACKEND_RELEASE_EVIDENCE_SUBJECT_FORMAT,
    version: BACKEND_RELEASE_EVIDENCE_VERSION,
    applicationDigest: await digestBackendApplicationV2(normalized),
    ...source
  })
}

export function canonicalBackendReleaseEvidenceSubjectBytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(parseBackendReleaseEvidenceSubject(value))
}

export async function digestBackendReleaseEvidenceSubject(value: unknown): Promise<string> {
  return digestCanonicalManifest(parseBackendReleaseEvidenceSubject(value))
}

function parseReceiptPayload(
  value: unknown,
  path: string
): BackendReleaseEvidenceReceiptCandidatePayloadV1 {
  const source = exactRecord(value, path, RECEIPT_PAYLOAD_KEYS)
  if (source.format !== BACKEND_RELEASE_EVIDENCE_RECEIPT_FORMAT) {
    throw new TypeError(`${path}.format is not supported`)
  }
  if (source.version !== BACKEND_RELEASE_EVIDENCE_VERSION) {
    throw new TypeError(`${path}.version is not supported`)
  }
  const checkedAt = releaseTimestamp(
    stringValue(source.checkedAt, `${path}.checkedAt`),
    `${path}.checkedAt`
  )
  const expiresAt = releaseTimestamp(
    stringValue(source.expiresAt, `${path}.expiresAt`),
    `${path}.expiresAt`
  )
  if (compareReleaseTimestamps(expiresAt, checkedAt) <= 0) {
    throw new TypeError(`${path}.expiresAt must be later than checkedAt`)
  }
  const ttlNanoseconds =
    releaseTimestampInstantNanoseconds(expiresAt, `${path}.expiresAt`) -
    releaseTimestampInstantNanoseconds(checkedAt, `${path}.checkedAt`)
  if (ttlNanoseconds > BigInt(BACKEND_RELEASE_EVIDENCE_MAX_TTL_MS) * 1_000_000n) {
    throw new TypeError(`${path}.expiresAt exceeds the maximum evidence TTL`)
  }
  return Object.freeze({
    format: BACKEND_RELEASE_EVIDENCE_RECEIPT_FORMAT,
    version: BACKEND_RELEASE_EVIDENCE_VERSION,
    requirementId: evidenceId(source.requirementId, `${path}.requirementId`),
    subjectDigest: releaseDigest(
      stringValue(source.subjectDigest, `${path}.subjectDigest`),
      `${path}.subjectDigest`
    ),
    status: settledStatus(source.status, `${path}.status`),
    checkedAt,
    expiresAt,
    evidenceDigest: releaseDigest(
      stringValue(source.evidenceDigest, `${path}.evidenceDigest`),
      `${path}.evidenceDigest`
    )
  })
}

/**
 * Create a hash-bound receipt candidate. Its unkeyed digest provides integrity
 * only; it does not prove verifier identity, signature, provenance, or Host
 * acceptance and must never establish trust by itself.
 */
export async function createBackendReleaseEvidenceReceiptCandidate(
  input: CreateBackendReleaseEvidenceReceiptCandidateInput
): Promise<BackendReleaseEvidenceReceiptCandidateV1> {
  const source = exactRecord(input, '$.receiptInput', RECEIPT_PAYLOAD_KEYS.slice(2))
  const payload = parseReceiptPayload(
    {
      format: BACKEND_RELEASE_EVIDENCE_RECEIPT_FORMAT,
      version: BACKEND_RELEASE_EVIDENCE_VERSION,
      ...source
    },
    '$.receiptInput'
  )
  return Object.freeze({ ...payload, receiptDigest: await digestCanonicalManifest(payload) })
}

export async function parseBackendReleaseEvidenceReceiptCandidate(
  value: unknown,
  path = '$.receipt'
): Promise<BackendReleaseEvidenceReceiptCandidateV1> {
  const source = exactRecord(value, path, [...RECEIPT_PAYLOAD_KEYS, 'receiptDigest'])
  const payload = parseReceiptPayload(
    {
      format: source.format,
      version: source.version,
      requirementId: source.requirementId,
      subjectDigest: source.subjectDigest,
      status: source.status,
      checkedAt: source.checkedAt,
      expiresAt: source.expiresAt,
      evidenceDigest: source.evidenceDigest
    },
    path
  )
  const receiptDigest = releaseDigest(
    stringValue(source.receiptDigest, `${path}.receiptDigest`),
    `${path}.receiptDigest`
  )
  if ((await digestCanonicalManifest(payload)) !== receiptDigest) {
    throw new TypeError(`${path}.receiptDigest does not bind the receipt claims`)
  }
  return Object.freeze({ ...payload, receiptDigest })
}

function parseEvidenceRecord(value: unknown, path: string): BackendReleaseEvidenceRecordV1 {
  const source = exactRecord(value, path, [
    'requirementId',
    'status',
    'subjectDigest',
    'trustedReceiptDigest',
    'checkedAt',
    'expiresAt',
    'evidenceDigest'
  ])
  if (typeof source.status !== 'string' || !EVIDENCE_STATUSES.has(source.status)) {
    throw new TypeError(`${path}.status is not supported`)
  }
  const status = source.status as BackendReleaseEvidenceStatus
  const trustedReceiptDigest = nullableDigest(
    source.trustedReceiptDigest,
    `${path}.trustedReceiptDigest`
  )
  const checkedAt = nullableTimestamp(source.checkedAt, `${path}.checkedAt`)
  const expiresAt = nullableTimestamp(source.expiresAt, `${path}.expiresAt`)
  const evidenceDigest = nullableDigest(source.evidenceDigest, `${path}.evidenceDigest`)
  if (
    status === 'unknown' &&
    (trustedReceiptDigest !== null ||
      checkedAt !== null ||
      expiresAt !== null ||
      evidenceDigest !== null)
  ) {
    throw new TypeError(`${path} unknown evidence must not claim a receipt or evidence`)
  }
  if (
    status !== 'unknown' &&
    (trustedReceiptDigest === null ||
      checkedAt === null ||
      expiresAt === null ||
      evidenceDigest === null)
  ) {
    throw new TypeError(
      `${path} settled evidence requires receipt, checkedAt, expiresAt, and digest`
    )
  }
  if (checkedAt && expiresAt && compareReleaseTimestamps(expiresAt, checkedAt) <= 0) {
    throw new TypeError(`${path}.expiresAt must be later than checkedAt`)
  }
  return Object.freeze({
    requirementId: evidenceId(source.requirementId, `${path}.requirementId`),
    status,
    subjectDigest: releaseDigest(
      stringValue(source.subjectDigest, `${path}.subjectDigest`),
      `${path}.subjectDigest`
    ),
    trustedReceiptDigest,
    checkedAt,
    expiresAt,
    evidenceDigest
  })
}

export function parseBackendReleaseEvidenceRecords(
  value: unknown,
  path = '$.evidence'
): readonly BackendReleaseEvidenceRecordV1[] {
  const records = exactArray(value, path).map((entry, index) =>
    parseEvidenceRecord(entry, `${path}[${index}]`)
  )
  if (new Set(records.map((entry) => entry.requirementId)).size !== records.length) {
    throw new TypeError(`${path} must not contain duplicate requirement IDs`)
  }
  records.sort((left, right) => left.requirementId.localeCompare(right.requirementId, 'en'))
  return freezeArray(records)
}

async function trustedContext(
  value: unknown
): Promise<BackendReleaseHostAcceptedEvidenceContextV1> {
  const source = exactRecord(value, '$.trustedContext', [
    'expectedSubject',
    'trustedReceipts',
    'evaluatedAt'
  ])
  const expectedSubject = parseBackendReleaseEvidenceSubject(source.expectedSubject)
  const trustedReceipts: BackendReleaseEvidenceReceiptCandidateV1[] = []
  for (const [index, receipt] of exactArray(
    source.trustedReceipts,
    '$.trustedContext.trustedReceipts'
  ).entries()) {
    trustedReceipts.push(
      await parseBackendReleaseEvidenceReceiptCandidate(
        receipt,
        `$.trustedContext.trustedReceipts[${index}]`
      )
    )
  }
  if (
    new Set(trustedReceipts.map((entry) => entry.receiptDigest)).size !== trustedReceipts.length
  ) {
    throw new TypeError('$.trustedContext.trustedReceipts contains duplicate receipt digests')
  }
  if (
    new Set(trustedReceipts.map((entry) => entry.requirementId)).size !== trustedReceipts.length
  ) {
    throw new TypeError('$.trustedContext.trustedReceipts contains duplicate requirement IDs')
  }
  trustedReceipts.sort((left, right) => left.requirementId.localeCompare(right.requirementId, 'en'))
  return Object.freeze({
    expectedSubject,
    trustedReceipts: Object.freeze(trustedReceipts),
    evaluatedAt: releaseTimestamp(
      stringValue(source.evaluatedAt, '$.trustedContext.evaluatedAt'),
      '$.trustedContext.evaluatedAt'
    )
  })
}

export function backendReleaseEvidenceVerifierChecksForCapability(
  capability: BackendReleaseEvidenceCapability
): readonly BackendReleaseEvidenceVerifierCheck[] {
  const requirementId = BACKEND_RELEASE_CAPABILITY_EVIDENCE_IDS[capability]
  const checks: BackendReleaseEvidenceVerifierCheck[] = [requirementId]
  if (capability === 'webhooks.receive' || capability === 'webhooks.deliver') {
    checks.push(BACKEND_RELEASE_WEBHOOK_HMAC_PURPOSE_VERIFIER_CHECK)
  }
  if (capability === 'migrations.backfill') {
    checks.push(BACKEND_RELEASE_BACKFILL_CURSOR_VERIFIER_CHECK)
  }
  return Object.freeze(checks)
}

function verifierChecks(
  requirementId: BackendReleaseEvidenceId,
  capability: BackendReleaseEvidenceCapability | null
): readonly BackendReleaseEvidenceVerifierCheck[] {
  return capability
    ? backendReleaseEvidenceVerifierChecksForCapability(capability)
    : Object.freeze([requirementId])
}

function requirementsForNormalizedApplication(
  application: BackendApplicationSpecV2
): readonly BackendReleaseEvidenceRequirementV1[] {
  const requirements: BackendReleaseEvidenceRequirementV1[] =
    BACKEND_RELEASE_INVARIANT_EVIDENCE_IDS.map((requirementId) => ({
      requirementId,
      source: 'release-invariant',
      capability: null,
      verifierChecks: verifierChecks(requirementId, null)
    }))
  for (const actualCapability of deriveBackendApplicationCapabilitiesV2(application)) {
    if (!CAPABILITIES.has(actualCapability)) {
      throw new TypeError(`Actual Backend capability is not supported by the evidence contract`)
    }
    const capability = actualCapability as BackendReleaseEvidenceCapability
    const requirementId = BACKEND_RELEASE_CAPABILITY_EVIDENCE_IDS[capability]
    requirements.push({
      requirementId,
      source: 'capability',
      capability,
      verifierChecks: verifierChecks(requirementId, capability)
    })
  }
  requirements.sort((left, right) => left.requirementId.localeCompare(right.requirementId, 'en'))
  return freezeArray(requirements)
}

export function deriveBackendReleaseEvidenceRequirements(
  application: BackendApplicationSpecV2
): readonly BackendReleaseEvidenceRequirementV1[] {
  return requirementsForNormalizedApplication(normalizedBackendApplicationV2(application))
}

function missingEvidence(
  requirementId: BackendReleaseEvidenceId,
  expectedSubjectDigest: string
): BackendReleaseEvidenceRecordV1 {
  return {
    requirementId,
    status: 'unknown',
    subjectDigest: expectedSubjectDigest,
    trustedReceiptDigest: null,
    checkedAt: null,
    expiresAt: null,
    evidenceDigest: null
  }
}

function blocker(
  requirement: BackendReleaseEvidenceRequirementV1,
  status: BackendReleaseEvidenceBlocker['status'],
  code: BackendReleaseEvidenceBlockerCode
): BackendReleaseEvidenceBlocker {
  return {
    requirementId: requirement.requirementId,
    capability: requirement.capability,
    status,
    code
  }
}

function receiptMatchesRecord(
  receipt: BackendReleaseEvidenceReceiptCandidateV1,
  record: BackendReleaseEvidenceRecordV1
): boolean {
  return (
    receipt.requirementId === record.requirementId &&
    receipt.subjectDigest === record.subjectDigest &&
    receipt.status === record.status &&
    receipt.checkedAt === record.checkedAt &&
    receipt.expiresAt === record.expiresAt &&
    receipt.evidenceDigest === record.evidenceDigest
  )
}

/**
 * Evaluate actual V2 IR against Host-authenticated, subject-bound, expiring
 * receipts. Caller-authored capability declarations and bare digests cannot
 * create release authority.
 */
export async function evaluateBackendReleaseEvidence(
  application: BackendApplicationSpecV2,
  evidence: unknown,
  hostAcceptedContext: BackendReleaseHostAcceptedEvidenceContextV1
): Promise<BackendReleaseEvidenceAssessmentV1> {
  const normalized = normalizedBackendApplicationV2(application)
  const requirements = requirementsForNormalizedApplication(normalized)
  const context = await trustedContext(hostAcceptedContext)
  const expectedSubjectDigest = await digestBackendReleaseEvidenceSubject(context.expectedSubject)
  const actualApplicationDigest = await digestBackendApplicationV2(normalized)
  const expectedSubjectIsValid =
    context.expectedSubject.applicationDigest === actualApplicationDigest
  const records = parseBackendReleaseEvidenceRecords(evidence)
  const requirementById = new Map(requirements.map((entry) => [entry.requirementId, entry]))
  for (const receipt of context.trustedReceipts) {
    if (!requirementById.has(receipt.requirementId)) {
      throw new TypeError(
        '$.trustedContext.trustedReceipts contains evidence outside actual Backend IR requirements'
      )
    }
    if (receipt.subjectDigest !== expectedSubjectDigest) {
      throw new TypeError(
        '$.trustedContext.trustedReceipts contains a receipt for a different release subject'
      )
    }
  }
  for (const record of records) {
    if (!requirementById.has(record.requirementId)) {
      throw new TypeError(`$.evidence contains evidence that was not required by actual Backend IR`)
    }
  }
  const trustedReceiptByDigest = new Map(
    context.trustedReceipts.map((entry) => [entry.receiptDigest, entry])
  )
  const provided = new Map(records.map((entry) => [entry.requirementId, entry]))
  const normalizedEvidence = requirements.map(
    (requirement) =>
      provided.get(requirement.requirementId) ??
      missingEvidence(requirement.requirementId, expectedSubjectDigest)
  )
  const blockers: BackendReleaseEvidenceBlocker[] = []
  for (const record of normalizedEvidence) {
    const requirement = requirementById.get(record.requirementId)
    if (!requirement) throw new TypeError('Release evidence requirement lookup failed')
    if (!expectedSubjectIsValid) {
      blockers.push(blocker(requirement, 'blocked', 'release-evidence-expected-subject-invalid'))
    }
    if (record.status === 'unknown') {
      blockers.push(blocker(requirement, 'unknown', 'release-evidence-missing'))
      continue
    }
    if (record.subjectDigest !== expectedSubjectDigest) {
      blockers.push(blocker(requirement, 'blocked', 'release-evidence-subject-mismatch'))
    }
    const receipt = record.trustedReceiptDigest
      ? trustedReceiptByDigest.get(record.trustedReceiptDigest)
      : undefined
    if (!receipt) {
      blockers.push(blocker(requirement, 'blocked', 'release-evidence-receipt-untrusted'))
    } else if (!receiptMatchesRecord(receipt, record)) {
      blockers.push(blocker(requirement, 'blocked', 'release-evidence-receipt-mismatch'))
    }
    if (!record.checkedAt || compareReleaseTimestamps(record.checkedAt, context.evaluatedAt) > 0) {
      blockers.push(blocker(requirement, 'blocked', 'release-evidence-future-dated'))
    }
    if (!record.expiresAt || compareReleaseTimestamps(record.expiresAt, context.evaluatedAt) <= 0) {
      blockers.push(blocker(requirement, 'blocked', 'release-evidence-expired'))
    }
    if (record.status === 'failed') {
      blockers.push(blocker(requirement, 'failed', 'release-evidence-failed'))
    }
  }
  const assessment: BackendReleaseEvidenceAssessmentV1 = {
    format: BACKEND_RELEASE_EVIDENCE_FORMAT,
    version: BACKEND_RELEASE_EVIDENCE_VERSION,
    expectedSubject: context.expectedSubject,
    expectedSubjectDigest,
    trustedReceiptDigests: Object.freeze(
      context.trustedReceipts.map((entry) => entry.receiptDigest).sort()
    ),
    evaluatedAt: context.evaluatedAt,
    releaseReady: blockers.length === 0,
    requirements,
    evidence: freezeArray(normalizedEvidence),
    blockers: freezeArray(blockers)
  }
  return Object.freeze(assessment)
}

export async function digestBackendReleaseEvidenceAssessment(
  application: BackendApplicationSpecV2,
  evidence: unknown,
  hostAcceptedContext: BackendReleaseHostAcceptedEvidenceContextV1
): Promise<string> {
  return digestCanonicalManifest(
    await evaluateBackendReleaseEvidence(application, evidence, hostAcceptedContext)
  )
}

export function backendReleaseEvidenceCapabilityForId(
  requirementId: BackendReleaseEvidenceId
): BackendReleaseEvidenceCapability | null {
  if (INVARIANT_IDS.has(requirementId)) return null
  return CAPABILITY_BY_EVIDENCE_ID.get(requirementId) ?? null
}
