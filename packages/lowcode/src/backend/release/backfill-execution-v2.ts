/* eslint-disable max-lines -- Receipt V2 parsing, canonical digests, and fail-closed transition verification form one portable audit boundary */
import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { BackendReleaseEnvironment } from './types'
import {
  compareReleaseTimestamps,
  exactArray,
  exactRecord,
  nullableDigest,
  releaseDigest,
  releaseIdentifier,
  releaseTimestamp,
  stringValue
} from './validation'

export const BACKEND_BACKFILL_EXECUTION_V2_VERSION = 2 as const
export const BACKEND_BACKFILL_EXECUTION_V2_SCOPE_FORMAT =
  'openpencil.backend-backfill-execution-scope' as const
export const BACKEND_BACKFILL_EXECUTION_V2_RECEIPT_FORMAT =
  'openpencil.backend-backfill-execution-receipt' as const
export const BACKEND_BACKFILL_EXECUTION_V2_MAX_RECEIPTS = 10_000
export const BACKEND_BACKFILL_EXECUTION_V2_MAX_BATCH_COUNT = 9_999
export const BACKEND_BACKFILL_EXECUTION_V2_MAX_BATCH_SIZE = 1_000
export const BACKEND_BACKFILL_EXECUTION_V2_MAX_VERIFICATION_PAGE_RECEIPTS = 64

export const BACKEND_BACKFILL_EXECUTION_V2_COMPLETION_RULE =
  'predicate-exhausted-and-postconditions-satisfied' as const
export const BACKEND_BACKFILL_EXECUTION_V2_RESUME_POLICY = 'from-receipt' as const

export type BackendBackfillCursorFieldTypeV2 = 'integer'
export type BackendBackfillCursorValueV2 = number
export type BackendBackfillExecutionCheckpointKindV2 = 'capture' | 'batch' | 'failure'
export type BackendBackfillExecutionOutcomeV2 = 'in-progress' | 'completed' | 'failed'
export type BackendBackfillExecutionTerminalReasonV2 =
  | 'already-satisfied'
  | 'predicate-exhausted'
  | 'stable-failure'
  | null

/**
 * Portable, provider-neutral identity for one bounded backfill execution.
 * Every digest is evidence only. This data never grants database or execution authority.
 */
export interface BackendBackfillExecutionScopeV2 {
  readonly format: typeof BACKEND_BACKFILL_EXECUTION_V2_SCOPE_FORMAT
  readonly version: typeof BACKEND_BACKFILL_EXECUTION_V2_VERSION
  readonly providerId: string
  readonly environment: BackendReleaseEnvironment
  readonly providerAuthorityDigest: string
  readonly applicationId: string
  readonly applicationDigest: string
  readonly migrationId: string
  readonly migrationDigest: string
  readonly migrationPlanDigest: string
  readonly sourceLedgerDigest: string
  readonly captureDigest: string
  readonly receiptZeroEvidenceDigest: string
  readonly resourceIdentityDigest: string
  readonly catalogPreconditionDigest: string
  readonly entityId: string
  readonly cursorField: string
  readonly cursorFieldType: BackendBackfillCursorFieldTypeV2
  readonly targetField: string
  readonly batchSize: number
  readonly maximumReceiptCount: typeof BACKEND_BACKFILL_EXECUTION_V2_MAX_RECEIPTS
  readonly maximumBatchCount: typeof BACKEND_BACKFILL_EXECUTION_V2_MAX_BATCH_COUNT
  readonly capturedHighWater: BackendBackfillCursorValueV2 | null
  /** Locked-capture count of all cursor-domain rows at or below capturedHighWater. */
  readonly initialRemainingEligibleRowCount: number
  /** Locked-capture target/predicate rows; always a subset of eligible cursor rows. */
  readonly initialRemainingTargetRowCount: number
  /** Exact maximum number of cursor windows derived from the locked capture. */
  readonly requiredBatchCount: number
  readonly requiredMatchedRowCount: number | null
  readonly resumePolicy: typeof BACKEND_BACKFILL_EXECUTION_V2_RESUME_POLICY
  readonly completionRule: typeof BACKEND_BACKFILL_EXECUTION_V2_COMPLETION_RULE
}

export interface BackendBackfillExecutionBatchCountsV2 {
  readonly scannedRowCount: number
  readonly matchedRowCount: number
  readonly updatedRowCount: number
}

export interface BackendBackfillExecutionExhaustionProofV2 {
  readonly checked: boolean
  /** Remaining cursor-domain rows after the checkpoint cursor and at/below capturedHighWater. */
  readonly remainingEligibleRowCount: number | null
  /** Remaining target/predicate rows; always a subset of remaining eligible rows. */
  readonly remainingTargetRowCount: number | null
}

export interface BackendBackfillExecutionPostconditionsV2 {
  readonly fieldNotNull: boolean
  readonly requiredMatchedRowCount: number | null
  readonly matchedRowCountSatisfied: boolean
}

/**
 * Immutable claim produced by a future trusted database ledger transaction.
 * Parsing or verifying this claim does not authenticate its producer, execute SQL, reserve an
 * idempotency key, compare-and-swap a database head, or create any release authority.
 */
export interface BackendBackfillExecutionReceiptV2 {
  readonly format: typeof BACKEND_BACKFILL_EXECUTION_V2_RECEIPT_FORMAT
  readonly version: typeof BACKEND_BACKFILL_EXECUTION_V2_VERSION
  readonly receiptId: string
  readonly executionId: string
  readonly idempotencyKey: string
  /** Digest of the exact Host request bound to this idempotency key. */
  readonly requestDigest: string
  readonly scope: BackendBackfillExecutionScopeV2
  readonly scopeDigest: string
  readonly checkpointKind: BackendBackfillExecutionCheckpointKindV2
  readonly batchIndex: number
  readonly previousCursor: BackendBackfillCursorValueV2 | null
  readonly lastProcessedKey: BackendBackfillCursorValueV2 | null
  readonly batchCounts: BackendBackfillExecutionBatchCountsV2
  readonly cumulativeCounts: BackendBackfillExecutionBatchCountsV2
  readonly exhaustion: BackendBackfillExecutionExhaustionProofV2
  readonly postconditions: BackendBackfillExecutionPostconditionsV2
  readonly outcome: BackendBackfillExecutionOutcomeV2
  readonly terminalReason: BackendBackfillExecutionTerminalReasonV2
  readonly stableErrorCode: string | null
  readonly previousReceiptDigest: string | null
  readonly catalogEvidenceDigest: string
  readonly operationAuthorityDigest: string
  readonly databaseEventId: string
  readonly databaseHeadVersion: number
  readonly committedAt: string
  readonly evidenceDigest: string
}

/**
 * Caller-supplied verification anchors. The caller must authenticate these values independently.
 * This context is deliberately not named or typed as execution/database authority.
 */
export interface BackendBackfillExecutionVerificationContextV2 {
  readonly scope: BackendBackfillExecutionScopeV2
  readonly expectedHeadDigest: string | null
  readonly evaluatedAt: string
}

export type BackendBackfillExecutionErrorCodeV2 =
  | 'backfill-execution-v2-invalid'
  | 'backfill-execution-v2-scope-mismatch'
  | 'backfill-execution-v2-capture-binding-mismatch'
  | 'backfill-execution-v2-chain-broken'
  | 'backfill-execution-v2-database-head-mismatch'
  | 'backfill-execution-v2-receipt-id-duplicate'
  | 'backfill-execution-v2-idempotency-key-reused'
  | 'backfill-execution-v2-request-digest-reused'
  | 'backfill-execution-v2-transition-invalid'
  | 'backfill-execution-v2-progress-regressed'
  | 'backfill-execution-v2-batch-limit-exceeded'
  | 'backfill-execution-v2-high-water-exceeded'
  | 'backfill-execution-v2-exhaustion-proof-required'
  | 'backfill-execution-v2-postcondition-failed'
  | 'backfill-execution-v2-terminal'
  | 'backfill-execution-v2-future-dated'

interface BackendBackfillExecutionNonAuthorityResultV2 {
  /** Static receipt verification alone can never make a release ready. */
  readonly releaseReady: false
  readonly databaseAuthorityGranted: false
  readonly executionAuthorityGranted: false
}

export type BackendBackfillExecutionVerificationV2 =
  | (BackendBackfillExecutionNonAuthorityResultV2 &
      Readonly<{
        ok: true
        scope: BackendBackfillExecutionScopeV2
        scopeDigest: string
        receipts: readonly BackendBackfillExecutionReceiptV2[]
        computedHeadDigest: string | null
        outcome: BackendBackfillExecutionOutcomeV2 | 'not-started'
      }>)
  | (BackendBackfillExecutionNonAuthorityResultV2 &
      Readonly<{
        ok: false
        index: number
        code: BackendBackfillExecutionErrorCodeV2
        message: string
      }>)

type BackfillFailureV2 = Extract<BackendBackfillExecutionVerificationV2, { ok: false }>

export type BackendBackfillExecutionReceiptChainFailureDispositionV2 =
  | 'initialization-rejected'
  | 'page-rejected'
  | 'operation-in-progress'
  | 'finalization-rejected'
  | 'already-finalized'

export type BackendBackfillExecutionReceiptChainFailureV2 = BackfillFailureV2 &
  (
    | Readonly<{
        /** Stable lifecycle classification; callers never parse the human-readable message. */
        failureDisposition: 'page-rejected' | 'operation-in-progress'
        finalized: false
        /** A later call may proceed after waiting or supplying corrected page input. */
        retryable: true
      }>
    | Readonly<{
        failureDisposition:
          | 'initialization-rejected'
          | 'finalization-rejected'
          | 'already-finalized'
        /** This verifier instance can no longer accept or validate another page. */
        finalized: true
        retryable: false
      }>
  )

export type BackendBackfillExecutionReceiptChainAppendResultV2 =
  | (BackendBackfillExecutionNonAuthorityResultV2 &
      Readonly<{
        ok: true
        finalized: false
        scopeDigest: string
        receiptCount: number
        lastDatabaseHeadVersion: number
        computedHeadDigest: string
        outcome: BackendBackfillExecutionOutcomeV2
      }>)
  | BackendBackfillExecutionReceiptChainFailureV2

export type BackendBackfillExecutionReceiptChainFinalizationV2 =
  | (BackendBackfillExecutionNonAuthorityResultV2 &
      Readonly<{
        ok: true
        finalized: true
        scope: BackendBackfillExecutionScopeV2
        scopeDigest: string
        receiptCount: number
        lastDatabaseHeadVersion: number | null
        computedHeadDigest: string | null
        outcome: BackendBackfillExecutionOutcomeV2 | 'not-started'
      }>)
  | BackendBackfillExecutionReceiptChainFailureV2

type ReceiptChainAppendSuccessV2 = Extract<
  BackendBackfillExecutionReceiptChainAppendResultV2,
  { ok: true }
>

/**
 * Incrementally verifies bounded pages without retaining all canonical Receipt bytes. Page commits
 * are atomic, finalization is terminal, and neither operation grants database or release authority.
 */
export interface BackendBackfillExecutionReceiptChainVerifierV2 {
  appendPage(value: unknown): Promise<BackendBackfillExecutionReceiptChainAppendResultV2>
  finalize(): Promise<BackendBackfillExecutionReceiptChainFinalizationV2>
}

const ENVIRONMENTS = new Set<string>(['preview', 'staging', 'production'])
const CHECKPOINT_KINDS = new Set<string>(['capture', 'batch', 'failure'])
const OUTCOMES = new Set<string>(['in-progress', 'completed', 'failed'])
const TERMINAL_REASONS = new Set<string>([
  'already-satisfied',
  'predicate-exhausted',
  'stable-failure'
])

const SCOPE_KEYS = [
  'format',
  'version',
  'providerId',
  'environment',
  'providerAuthorityDigest',
  'applicationId',
  'applicationDigest',
  'migrationId',
  'migrationDigest',
  'migrationPlanDigest',
  'sourceLedgerDigest',
  'captureDigest',
  'receiptZeroEvidenceDigest',
  'resourceIdentityDigest',
  'catalogPreconditionDigest',
  'entityId',
  'cursorField',
  'cursorFieldType',
  'targetField',
  'batchSize',
  'maximumReceiptCount',
  'maximumBatchCount',
  'capturedHighWater',
  'initialRemainingEligibleRowCount',
  'initialRemainingTargetRowCount',
  'requiredBatchCount',
  'requiredMatchedRowCount',
  'resumePolicy',
  'completionRule'
] as const
const COUNT_KEYS = ['scannedRowCount', 'matchedRowCount', 'updatedRowCount'] as const
const EXHAUSTION_KEYS = ['checked', 'remainingEligibleRowCount', 'remainingTargetRowCount'] as const
const POSTCONDITION_KEYS = [
  'fieldNotNull',
  'requiredMatchedRowCount',
  'matchedRowCountSatisfied'
] as const
const RECEIPT_KEYS = [
  'format',
  'version',
  'receiptId',
  'executionId',
  'idempotencyKey',
  'requestDigest',
  'scope',
  'scopeDigest',
  'checkpointKind',
  'batchIndex',
  'previousCursor',
  'lastProcessedKey',
  'batchCounts',
  'cumulativeCounts',
  'exhaustion',
  'postconditions',
  'outcome',
  'terminalReason',
  'stableErrorCode',
  'previousReceiptDigest',
  'catalogEvidenceDigest',
  'operationAuthorityDigest',
  'databaseEventId',
  'databaseHeadVersion',
  'committedAt',
  'evidenceDigest'
] as const
const CONTEXT_KEYS = ['scope', 'expectedHeadDigest', 'evaluatedAt'] as const

function environment(value: unknown, path: string): BackendReleaseEnvironment {
  if (typeof value !== 'string' || !ENVIRONMENTS.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as BackendReleaseEnvironment
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`)
  return value
}

function count(value: unknown, path: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < 0
  ) {
    throw new TypeError(`${path} must be a non-negative safe integer`)
  }
  return value
}

function nullableCount(value: unknown, path: string): number | null {
  return value === null ? null : count(value, path)
}

function positiveCount(value: unknown, path: string): number {
  const parsed = count(value, path)
  if (parsed < 1) throw new TypeError(`${path} must be a positive safe integer`)
  return parsed
}

function requiredBatchCountValue(
  value: unknown,
  initialRemainingEligibleRowCount: number,
  batchSize: number,
  path: string
): number {
  const requiredBatchCount = Math.ceil(initialRemainingEligibleRowCount / batchSize)
  if (count(value, `${path}.requiredBatchCount`) !== requiredBatchCount) {
    throw new TypeError(`${path}.requiredBatchCount does not match the locked capture bounds`)
  }
  if (requiredBatchCount > BACKEND_BACKFILL_EXECUTION_V2_MAX_BATCH_COUNT) {
    throw new TypeError(`${path}.initialRemainingEligibleRowCount exceeds bounded batch capacity`)
  }
  return requiredBatchCount
}

function parseCounts(value: unknown, path: string): BackendBackfillExecutionBatchCountsV2 {
  const source = exactRecord(value, path, COUNT_KEYS)
  const scannedRowCount = count(source.scannedRowCount, `${path}.scannedRowCount`)
  const matchedRowCount = count(source.matchedRowCount, `${path}.matchedRowCount`)
  const updatedRowCount = count(source.updatedRowCount, `${path}.updatedRowCount`)
  if (matchedRowCount > scannedRowCount || updatedRowCount > matchedRowCount) {
    throw new TypeError(`${path} row counts are inconsistent`)
  }
  return Object.freeze({ scannedRowCount, matchedRowCount, updatedRowCount })
}

function parseExhaustion(value: unknown, path: string): BackendBackfillExecutionExhaustionProofV2 {
  const source = exactRecord(value, path, EXHAUSTION_KEYS)
  const checked = booleanValue(source.checked, `${path}.checked`)
  const remainingEligibleRowCount = nullableCount(
    source.remainingEligibleRowCount,
    `${path}.remainingEligibleRowCount`
  )
  const remainingTargetRowCount = nullableCount(
    source.remainingTargetRowCount,
    `${path}.remainingTargetRowCount`
  )
  if (
    checked !== (remainingEligibleRowCount !== null) ||
    checked !== (remainingTargetRowCount !== null)
  ) {
    throw new TypeError(`${path} counts must be present exactly when exhaustion was checked`)
  }
  if (
    checked &&
    remainingEligibleRowCount !== null &&
    remainingTargetRowCount !== null &&
    remainingTargetRowCount > remainingEligibleRowCount
  ) {
    throw new TypeError(`${path}.remainingTargetRowCount cannot exceed eligible rows`)
  }
  return Object.freeze({ checked, remainingEligibleRowCount, remainingTargetRowCount })
}

function parsePostconditions(
  value: unknown,
  path: string
): BackendBackfillExecutionPostconditionsV2 {
  const source = exactRecord(value, path, POSTCONDITION_KEYS)
  return Object.freeze({
    fieldNotNull: booleanValue(source.fieldNotNull, `${path}.fieldNotNull`),
    requiredMatchedRowCount: nullableCount(
      source.requiredMatchedRowCount,
      `${path}.requiredMatchedRowCount`
    ),
    matchedRowCountSatisfied: booleanValue(
      source.matchedRowCountSatisfied,
      `${path}.matchedRowCountSatisfied`
    )
  })
}

export function parseBackendBackfillExecutionScopeV2(
  value: unknown,
  path = '$.scope'
): BackendBackfillExecutionScopeV2 {
  const source = exactRecord(value, path, SCOPE_KEYS)
  if (source.format !== BACKEND_BACKFILL_EXECUTION_V2_SCOPE_FORMAT) {
    throw new TypeError(`${path}.format is not supported`)
  }
  if (source.version !== BACKEND_BACKFILL_EXECUTION_V2_VERSION) {
    throw new TypeError(`${path}.version is not supported`)
  }
  if (source.cursorFieldType !== 'integer') {
    throw new TypeError(`${path}.cursorFieldType is not a stable ordered cursor type`)
  }
  const batchSize = count(source.batchSize, `${path}.batchSize`)
  if (batchSize < 1 || batchSize > BACKEND_BACKFILL_EXECUTION_V2_MAX_BATCH_SIZE) {
    throw new TypeError(`${path}.batchSize must be between 1 and 1000`)
  }
  if (source.maximumReceiptCount !== BACKEND_BACKFILL_EXECUTION_V2_MAX_RECEIPTS) {
    throw new TypeError(`${path}.maximumReceiptCount is not supported`)
  }
  if (source.maximumBatchCount !== BACKEND_BACKFILL_EXECUTION_V2_MAX_BATCH_COUNT) {
    throw new TypeError(`${path}.maximumBatchCount is not supported`)
  }
  if (source.resumePolicy !== BACKEND_BACKFILL_EXECUTION_V2_RESUME_POLICY) {
    throw new TypeError(`${path}.resumePolicy is not supported`)
  }
  if (source.completionRule !== BACKEND_BACKFILL_EXECUTION_V2_COMPLETION_RULE) {
    throw new TypeError(`${path}.completionRule is not supported`)
  }
  const captureDigest = releaseDigest(
    stringValue(source.captureDigest, `${path}.captureDigest`),
    `${path}.captureDigest`
  )
  const receiptZeroEvidenceDigest = releaseDigest(
    stringValue(source.receiptZeroEvidenceDigest, `${path}.receiptZeroEvidenceDigest`),
    `${path}.receiptZeroEvidenceDigest`
  )
  if (captureDigest !== receiptZeroEvidenceDigest) {
    throw new TypeError(`${path}.receiptZeroEvidenceDigest must equal captureDigest`)
  }
  const capturedHighWater = nullableCount(source.capturedHighWater, `${path}.capturedHighWater`)
  const initialRemainingEligibleRowCount = count(
    source.initialRemainingEligibleRowCount,
    `${path}.initialRemainingEligibleRowCount`
  )
  const initialRemainingTargetRowCount = count(
    source.initialRemainingTargetRowCount,
    `${path}.initialRemainingTargetRowCount`
  )
  if (
    capturedHighWater === null &&
    (initialRemainingEligibleRowCount !== 0 || initialRemainingTargetRowCount !== 0)
  ) {
    throw new TypeError(`${path} cannot bind remaining rows without a captured high-water mark`)
  }
  if (initialRemainingTargetRowCount > initialRemainingEligibleRowCount) {
    throw new TypeError(`${path}.initialRemainingTargetRowCount cannot exceed eligible rows`)
  }
  const requiredBatchCount = requiredBatchCountValue(
    source.requiredBatchCount,
    initialRemainingEligibleRowCount,
    batchSize,
    path
  )
  const requiredMatchedRowCount = nullableCount(
    source.requiredMatchedRowCount,
    `${path}.requiredMatchedRowCount`
  )
  if (
    requiredMatchedRowCount !== null &&
    requiredMatchedRowCount > initialRemainingTargetRowCount
  ) {
    throw new TypeError(`${path}.requiredMatchedRowCount exceeds captured target rows`)
  }
  return Object.freeze({
    format: BACKEND_BACKFILL_EXECUTION_V2_SCOPE_FORMAT,
    version: BACKEND_BACKFILL_EXECUTION_V2_VERSION,
    providerId: releaseIdentifier(
      stringValue(source.providerId, `${path}.providerId`),
      `${path}.providerId`
    ),
    environment: environment(source.environment, `${path}.environment`),
    providerAuthorityDigest: releaseDigest(
      stringValue(source.providerAuthorityDigest, `${path}.providerAuthorityDigest`),
      `${path}.providerAuthorityDigest`
    ),
    applicationId: releaseIdentifier(
      stringValue(source.applicationId, `${path}.applicationId`),
      `${path}.applicationId`
    ),
    applicationDigest: releaseDigest(
      stringValue(source.applicationDigest, `${path}.applicationDigest`),
      `${path}.applicationDigest`
    ),
    migrationId: releaseIdentifier(
      stringValue(source.migrationId, `${path}.migrationId`),
      `${path}.migrationId`
    ),
    migrationDigest: releaseDigest(
      stringValue(source.migrationDigest, `${path}.migrationDigest`),
      `${path}.migrationDigest`
    ),
    migrationPlanDigest: releaseDigest(
      stringValue(source.migrationPlanDigest, `${path}.migrationPlanDigest`),
      `${path}.migrationPlanDigest`
    ),
    sourceLedgerDigest: releaseDigest(
      stringValue(source.sourceLedgerDigest, `${path}.sourceLedgerDigest`),
      `${path}.sourceLedgerDigest`
    ),
    captureDigest,
    receiptZeroEvidenceDigest,
    resourceIdentityDigest: releaseDigest(
      stringValue(source.resourceIdentityDigest, `${path}.resourceIdentityDigest`),
      `${path}.resourceIdentityDigest`
    ),
    catalogPreconditionDigest: releaseDigest(
      stringValue(source.catalogPreconditionDigest, `${path}.catalogPreconditionDigest`),
      `${path}.catalogPreconditionDigest`
    ),
    entityId: releaseIdentifier(
      stringValue(source.entityId, `${path}.entityId`),
      `${path}.entityId`
    ),
    cursorField: releaseIdentifier(
      stringValue(source.cursorField, `${path}.cursorField`),
      `${path}.cursorField`
    ),
    cursorFieldType: 'integer',
    targetField: releaseIdentifier(
      stringValue(source.targetField, `${path}.targetField`),
      `${path}.targetField`
    ),
    batchSize,
    maximumReceiptCount: BACKEND_BACKFILL_EXECUTION_V2_MAX_RECEIPTS,
    maximumBatchCount: BACKEND_BACKFILL_EXECUTION_V2_MAX_BATCH_COUNT,
    capturedHighWater,
    initialRemainingEligibleRowCount,
    initialRemainingTargetRowCount,
    requiredBatchCount,
    requiredMatchedRowCount,
    resumePolicy: BACKEND_BACKFILL_EXECUTION_V2_RESUME_POLICY,
    completionRule: BACKEND_BACKFILL_EXECUTION_V2_COMPLETION_RULE
  })
}

export function canonicalBackendBackfillExecutionScopeV2Bytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(parseBackendBackfillExecutionScopeV2(value))
}

export async function digestBackendBackfillExecutionScopeV2(value: unknown): Promise<string> {
  return digestCanonicalManifest(parseBackendBackfillExecutionScopeV2(value))
}

function parseCheckpointKind(
  value: unknown,
  path: string
): BackendBackfillExecutionCheckpointKindV2 {
  if (typeof value !== 'string' || !CHECKPOINT_KINDS.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as BackendBackfillExecutionCheckpointKindV2
}

function parseOutcome(value: unknown, path: string): BackendBackfillExecutionOutcomeV2 {
  if (typeof value !== 'string' || !OUTCOMES.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as BackendBackfillExecutionOutcomeV2
}

function parseTerminalReason(
  value: unknown,
  path: string
): BackendBackfillExecutionTerminalReasonV2 {
  if (value === null) return null
  if (typeof value !== 'string' || !TERMINAL_REASONS.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as Exclude<BackendBackfillExecutionTerminalReasonV2, null>
}

export function parseBackendBackfillExecutionReceiptV2(
  value: unknown,
  path = '$.receipt'
): BackendBackfillExecutionReceiptV2 {
  const source = exactRecord(value, path, RECEIPT_KEYS)
  if (source.format !== BACKEND_BACKFILL_EXECUTION_V2_RECEIPT_FORMAT) {
    throw new TypeError(`${path}.format is not supported`)
  }
  if (source.version !== BACKEND_BACKFILL_EXECUTION_V2_VERSION) {
    throw new TypeError(`${path}.version is not supported`)
  }
  const checkpointKind = parseCheckpointKind(source.checkpointKind, `${path}.checkpointKind`)
  const outcome = parseOutcome(source.outcome, `${path}.outcome`)
  const terminalReason = parseTerminalReason(source.terminalReason, `${path}.terminalReason`)
  const stableErrorCode =
    source.stableErrorCode === null
      ? null
      : releaseIdentifier(
          stringValue(source.stableErrorCode, `${path}.stableErrorCode`),
          `${path}.stableErrorCode`
        )
  if (outcome === 'in-progress' && (terminalReason !== null || stableErrorCode !== null)) {
    throw new TypeError(`${path} in-progress outcome cannot carry terminal state`)
  }
  if (
    outcome === 'completed' &&
    (!['already-satisfied', 'predicate-exhausted'].includes(terminalReason ?? '') ||
      stableErrorCode !== null)
  ) {
    throw new TypeError(`${path} completed outcome must carry a completion reason only`)
  }
  if (outcome === 'failed' && (terminalReason !== 'stable-failure' || stableErrorCode === null)) {
    throw new TypeError(`${path} failed outcome must carry a stable error`)
  }
  if (checkpointKind === 'failure' && outcome !== 'failed') {
    throw new TypeError(`${path} failure checkpoint must have a failed outcome`)
  }
  const batchCounts = parseCounts(source.batchCounts, `${path}.batchCounts`)
  const cumulativeCounts = parseCounts(source.cumulativeCounts, `${path}.cumulativeCounts`)
  return Object.freeze({
    format: BACKEND_BACKFILL_EXECUTION_V2_RECEIPT_FORMAT,
    version: BACKEND_BACKFILL_EXECUTION_V2_VERSION,
    receiptId: releaseIdentifier(
      stringValue(source.receiptId, `${path}.receiptId`),
      `${path}.receiptId`
    ),
    executionId: releaseIdentifier(
      stringValue(source.executionId, `${path}.executionId`),
      `${path}.executionId`
    ),
    idempotencyKey: releaseIdentifier(
      stringValue(source.idempotencyKey, `${path}.idempotencyKey`),
      `${path}.idempotencyKey`
    ),
    requestDigest: releaseDigest(
      stringValue(source.requestDigest, `${path}.requestDigest`),
      `${path}.requestDigest`
    ),
    scope: parseBackendBackfillExecutionScopeV2(source.scope, `${path}.scope`),
    scopeDigest: releaseDigest(
      stringValue(source.scopeDigest, `${path}.scopeDigest`),
      `${path}.scopeDigest`
    ),
    checkpointKind,
    batchIndex: count(source.batchIndex, `${path}.batchIndex`),
    previousCursor: nullableCount(source.previousCursor, `${path}.previousCursor`),
    lastProcessedKey: nullableCount(source.lastProcessedKey, `${path}.lastProcessedKey`),
    batchCounts,
    cumulativeCounts,
    exhaustion: parseExhaustion(source.exhaustion, `${path}.exhaustion`),
    postconditions: parsePostconditions(source.postconditions, `${path}.postconditions`),
    outcome,
    terminalReason,
    stableErrorCode,
    previousReceiptDigest: nullableDigest(
      source.previousReceiptDigest,
      `${path}.previousReceiptDigest`
    ),
    catalogEvidenceDigest: releaseDigest(
      stringValue(source.catalogEvidenceDigest, `${path}.catalogEvidenceDigest`),
      `${path}.catalogEvidenceDigest`
    ),
    operationAuthorityDigest: releaseDigest(
      stringValue(source.operationAuthorityDigest, `${path}.operationAuthorityDigest`),
      `${path}.operationAuthorityDigest`
    ),
    databaseEventId: releaseIdentifier(
      stringValue(source.databaseEventId, `${path}.databaseEventId`),
      `${path}.databaseEventId`
    ),
    databaseHeadVersion: positiveCount(source.databaseHeadVersion, `${path}.databaseHeadVersion`),
    committedAt: releaseTimestamp(
      stringValue(source.committedAt, `${path}.committedAt`),
      `${path}.committedAt`
    ),
    evidenceDigest: releaseDigest(
      stringValue(source.evidenceDigest, `${path}.evidenceDigest`),
      `${path}.evidenceDigest`
    )
  })
}

export function canonicalBackendBackfillExecutionReceiptV2Bytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(parseBackendBackfillExecutionReceiptV2(value))
}

export async function digestBackendBackfillExecutionReceiptV2(value: unknown): Promise<string> {
  return digestCanonicalManifest(parseBackendBackfillExecutionReceiptV2(value))
}

function parseVerificationContext(value: unknown): BackendBackfillExecutionVerificationContextV2 {
  const source = exactRecord(value, '$.verificationContext', CONTEXT_KEYS)
  return Object.freeze({
    scope: parseBackendBackfillExecutionScopeV2(source.scope, '$.verificationContext.scope'),
    expectedHeadDigest: nullableDigest(
      source.expectedHeadDigest,
      '$.verificationContext.expectedHeadDigest'
    ),
    evaluatedAt: releaseTimestamp(
      stringValue(source.evaluatedAt, '$.verificationContext.evaluatedAt'),
      '$.verificationContext.evaluatedAt'
    )
  })
}

function failure(
  index: number,
  code: BackendBackfillExecutionErrorCodeV2,
  message: string
): BackfillFailureV2 {
  return Object.freeze({
    ok: false,
    releaseReady: false,
    databaseAuthorityGranted: false,
    executionAuthorityGranted: false,
    index,
    code,
    message
  })
}

function compareCursor(
  left: BackendBackfillCursorValueV2,
  right: BackendBackfillCursorValueV2
): -1 | 0 | 1 {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function countsEqual(
  left: BackendBackfillExecutionBatchCountsV2,
  right: BackendBackfillExecutionBatchCountsV2
): boolean {
  return COUNT_KEYS.every((key) => left[key] === right[key])
}

function countsAreZero(counts: BackendBackfillExecutionBatchCountsV2): boolean {
  return COUNT_KEYS.every((key) => counts[key] === 0)
}

function postconditionFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  index: number
): BackfillFailureV2 | null {
  const required = receipt.scope.requiredMatchedRowCount
  const expectedMatched = required === null || receipt.cumulativeCounts.matchedRowCount >= required
  if (
    receipt.postconditions.requiredMatchedRowCount !== required ||
    receipt.postconditions.matchedRowCountSatisfied !== expectedMatched
  ) {
    return failure(
      index,
      'backfill-execution-v2-postcondition-failed',
      'Matched-row postcondition does not match the immutable scope and cumulative counts'
    )
  }
  if (
    receipt.exhaustion.checked &&
    receipt.postconditions.fieldNotNull !== (receipt.exhaustion.remainingTargetRowCount === 0)
  ) {
    return failure(
      index,
      'backfill-execution-v2-postcondition-failed',
      'Field-not-null postcondition does not match the exhaustion observation'
    )
  }
  if (!receipt.exhaustion.checked && receipt.postconditions.fieldNotNull) {
    return failure(
      index,
      'backfill-execution-v2-postcondition-failed',
      'Field-not-null cannot be claimed without a same-checkpoint exhaustion observation'
    )
  }
  if (
    receipt.outcome === 'completed' &&
    (!receipt.postconditions.fieldNotNull || !receipt.postconditions.matchedRowCountSatisfied)
  ) {
    return failure(
      index,
      'backfill-execution-v2-postcondition-failed',
      'Completed execution requires all postconditions to be satisfied'
    )
  }
  return null
}

function completionFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  index: number
): BackfillFailureV2 | null {
  if (receipt.outcome !== 'completed') return null
  if (
    !receipt.exhaustion.checked ||
    receipt.exhaustion.remainingEligibleRowCount !== 0 ||
    receipt.exhaustion.remainingTargetRowCount !== 0
  ) {
    return failure(
      index,
      'backfill-execution-v2-exhaustion-proof-required',
      'Completed execution requires a same-checkpoint zero-remaining exhaustion proof'
    )
  }
  return null
}

function receiptZeroShapeFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  index: number
): BackfillFailureV2 | null {
  if (
    receipt.checkpointKind !== 'capture' ||
    receipt.batchIndex !== 0 ||
    receipt.databaseHeadVersion !== 1 ||
    receipt.previousReceiptDigest !== null ||
    receipt.previousCursor !== null ||
    receipt.lastProcessedKey !== null ||
    !countsAreZero(receipt.batchCounts) ||
    !countsAreZero(receipt.cumulativeCounts)
  ) {
    return failure(
      index,
      'backfill-execution-v2-transition-invalid',
      'Receipt zero must be a zero-progress capture checkpoint at database head version one'
    )
  }
  return null
}

function captureBindingFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  index: number
): BackfillFailureV2 | null {
  const scope = receipt.scope
  if (
    receipt.evidenceDigest !== scope.receiptZeroEvidenceDigest ||
    receipt.catalogEvidenceDigest !== scope.catalogPreconditionDigest
  ) {
    return failure(
      index,
      'backfill-execution-v2-capture-binding-mismatch',
      'Receipt zero is not bound to the captured evidence and catalog precondition'
    )
  }
  if (
    !receipt.exhaustion.checked ||
    receipt.exhaustion.remainingEligibleRowCount !== scope.initialRemainingEligibleRowCount ||
    receipt.exhaustion.remainingTargetRowCount !== scope.initialRemainingTargetRowCount
  ) {
    return failure(
      index,
      'backfill-execution-v2-capture-binding-mismatch',
      'Receipt zero does not reproduce the captured remaining-row observations'
    )
  }
  return null
}

function captureOutcomeFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  index: number
): BackfillFailureV2 | null {
  const scope = receipt.scope
  const postcondition = postconditionFailure(receipt, index)
  if (postcondition) return postcondition
  const initiallySatisfied =
    scope.initialRemainingTargetRowCount === 0 &&
    receipt.postconditions.fieldNotNull &&
    receipt.postconditions.matchedRowCountSatisfied
  if (receipt.outcome === 'failed') {
    return failure(
      index,
      'backfill-execution-v2-transition-invalid',
      'Receipt zero records the committed capture and cannot be a failure checkpoint'
    )
  }
  if (
    initiallySatisfied &&
    (receipt.outcome !== 'completed' || receipt.terminalReason !== 'already-satisfied')
  ) {
    return failure(
      index,
      'backfill-execution-v2-transition-invalid',
      'An already-satisfied capture must complete immediately'
    )
  }
  if (!initiallySatisfied && receipt.outcome === 'completed') {
    return failure(
      index,
      'backfill-execution-v2-transition-invalid',
      'An unsatisfied capture cannot complete immediately'
    )
  }
  if (
    receipt.outcome === 'in-progress' &&
    (scope.capturedHighWater === null || scope.initialRemainingTargetRowCount === 0)
  ) {
    return failure(
      index,
      'backfill-execution-v2-transition-invalid',
      'A capture without bounded eligible work cannot remain in progress'
    )
  }
  return null
}

function firstReceiptFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  index: number
): BackfillFailureV2 | null {
  return (
    receiptZeroShapeFailure(receipt, index) ??
    captureBindingFailure(receipt, index) ??
    captureOutcomeFailure(receipt, index)
  )
}

function batchLimitFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  index: number
): BackfillFailureV2 | null {
  if (
    receipt.batchIndex > receipt.scope.requiredBatchCount ||
    (receipt.batchIndex === receipt.scope.requiredBatchCount && receipt.outcome === 'in-progress')
  ) {
    return failure(
      index,
      'backfill-execution-v2-batch-limit-exceeded',
      'The bounded execution exceeded its maximum batch count or failed to terminalize at it'
    )
  }
  return null
}

function transitionBindingFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  previous: BackendBackfillExecutionReceiptV2,
  index: number
): BackfillFailureV2 | null {
  if (previous.outcome !== 'in-progress') {
    return failure(index, 'backfill-execution-v2-terminal', 'A terminal receipt cannot be extended')
  }
  if (
    receipt.executionId !== previous.executionId ||
    receipt.batchIndex !== previous.batchIndex + 1 ||
    receipt.databaseHeadVersion !== previous.databaseHeadVersion + 1 ||
    receipt.previousCursor !== previous.lastProcessedKey
  ) {
    return failure(
      index,
      'backfill-execution-v2-transition-invalid',
      'Execution, batch index, database head version, or previous cursor changed unexpectedly'
    )
  }
  if (receipt.checkpointKind === 'capture') {
    return failure(
      index,
      'backfill-execution-v2-transition-invalid',
      'Capture checkpoint can appear only at receipt zero'
    )
  }
  if (receipt.outcome === 'failed' && receipt.checkpointKind !== 'failure') {
    return failure(
      index,
      'backfill-execution-v2-transition-invalid',
      'A post-capture failed outcome must use a failure checkpoint'
    )
  }
  return null
}

function committedCountsFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  previous: BackendBackfillExecutionReceiptV2,
  index: number
): BackfillFailureV2 | null {
  const expectedCumulative = {
    scannedRowCount:
      previous.cumulativeCounts.scannedRowCount + receipt.batchCounts.scannedRowCount,
    matchedRowCount:
      previous.cumulativeCounts.matchedRowCount + receipt.batchCounts.matchedRowCount,
    updatedRowCount: previous.cumulativeCounts.updatedRowCount + receipt.batchCounts.updatedRowCount
  }
  if (!countsEqual(receipt.cumulativeCounts, expectedCumulative)) {
    return failure(
      index,
      'backfill-execution-v2-progress-regressed',
      'Cumulative counts do not equal the prior checkpoint plus the current batch'
    )
  }
  if (
    receipt.cumulativeCounts.scannedRowCount > receipt.scope.initialRemainingEligibleRowCount ||
    receipt.cumulativeCounts.matchedRowCount > receipt.scope.initialRemainingTargetRowCount ||
    receipt.cumulativeCounts.updatedRowCount > receipt.scope.initialRemainingTargetRowCount
  ) {
    return failure(
      index,
      'backfill-execution-v2-progress-regressed',
      'Cumulative counts exceed the immutable capture bounds'
    )
  }
  if (receipt.batchCounts.scannedRowCount > receipt.scope.batchSize) {
    return failure(
      index,
      'backfill-execution-v2-transition-invalid',
      'A batch scanned more rows than the immutable scope permits'
    )
  }
  if (
    receipt.checkpointKind === 'batch' &&
    receipt.batchCounts.updatedRowCount !== receipt.batchCounts.matchedRowCount
  ) {
    return failure(
      index,
      'backfill-execution-v2-progress-regressed',
      'Every matched exact-predicate row must be updated before the cursor advances'
    )
  }
  if (receipt.checkpointKind === 'failure') {
    if (
      !countsAreZero(receipt.batchCounts) ||
      receipt.lastProcessedKey !== previous.lastProcessedKey ||
      !countsEqual(receipt.cumulativeCounts, previous.cumulativeCounts)
    ) {
      return failure(
        index,
        'backfill-execution-v2-progress-regressed',
        'A failure checkpoint cannot claim committed row or cursor progress'
      )
    }
  }
  return null
}

function exhaustionProgressFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  lastChecked: BackendBackfillExecutionReceiptV2 | undefined,
  index: number
): BackfillFailureV2 | null {
  const lastEligible = lastChecked?.exhaustion.remainingEligibleRowCount
  const lastTarget = lastChecked?.exhaustion.remainingTargetRowCount
  if (
    !lastChecked ||
    lastEligible === null ||
    lastEligible === undefined ||
    lastTarget === null ||
    lastTarget === undefined
  ) {
    return failure(
      index,
      'backfill-execution-v2-progress-regressed',
      'The last checked exhaustion checkpoint is unavailable'
    )
  }
  const scannedSinceLastCheck =
    receipt.cumulativeCounts.scannedRowCount - lastChecked.cumulativeCounts.scannedRowCount
  const matchedSinceLastCheck =
    receipt.cumulativeCounts.matchedRowCount - lastChecked.cumulativeCounts.matchedRowCount
  if (scannedSinceLastCheck > lastEligible || matchedSinceLastCheck > lastTarget) {
    return failure(
      index,
      'backfill-execution-v2-progress-regressed',
      'Committed progress exceeds the last checked exhaustion bounds'
    )
  }
  if (!receipt.exhaustion.checked) return null
  const remainingEligible = receipt.exhaustion.remainingEligibleRowCount
  const remainingTarget = receipt.exhaustion.remainingTargetRowCount
  if (remainingEligible === null || remainingTarget === null) {
    return failure(
      index,
      'backfill-execution-v2-progress-regressed',
      'Checked exhaustion counts are unavailable'
    )
  }
  if (
    remainingEligible + receipt.cumulativeCounts.scannedRowCount >
      receipt.scope.initialRemainingEligibleRowCount ||
    remainingTarget + receipt.cumulativeCounts.matchedRowCount >
      receipt.scope.initialRemainingTargetRowCount
  ) {
    return failure(
      index,
      'backfill-execution-v2-progress-regressed',
      'Exhaustion counts exceed the immutable capture after committed progress'
    )
  }
  if (
    remainingEligible + scannedSinceLastCheck > lastEligible ||
    remainingTarget + matchedSinceLastCheck > lastTarget
  ) {
    return failure(
      index,
      'backfill-execution-v2-progress-regressed',
      'Exhaustion counts increased or failed to account for committed batch progress'
    )
  }
  return null
}

function cursorProgressFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  previous: BackendBackfillExecutionReceiptV2,
  index: number
): BackfillFailureV2 | null {
  if (receipt.checkpointKind === 'failure') return null
  const scanned = receipt.batchCounts.scannedRowCount
  const advanced =
    receipt.lastProcessedKey !== null &&
    (previous.lastProcessedKey === null || receipt.lastProcessedKey > previous.lastProcessedKey)
  if (scanned > 0 && !advanced) {
    return failure(
      index,
      'backfill-execution-v2-progress-regressed',
      'A non-empty batch must strictly advance the cursor'
    )
  }
  if (scanned === 0 && receipt.lastProcessedKey !== previous.lastProcessedKey) {
    return failure(
      index,
      'backfill-execution-v2-progress-regressed',
      'An empty batch cannot advance the cursor'
    )
  }
  if (receipt.outcome === 'in-progress' && scanned === 0) {
    return failure(
      index,
      'backfill-execution-v2-progress-regressed',
      'A zero-row checkpoint must terminalize with exhaustion evidence'
    )
  }
  if (receipt.outcome === 'in-progress' && scanned !== receipt.scope.batchSize) {
    return failure(
      index,
      'backfill-execution-v2-progress-regressed',
      'A non-terminal batch must fill its bounded cursor window'
    )
  }
  return null
}

function highWaterFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  index: number
): BackfillFailureV2 | null {
  const highWater = receipt.scope.capturedHighWater
  if (highWater === null) {
    return failure(
      index,
      'backfill-execution-v2-transition-invalid',
      'An empty high-water capture cannot have later checkpoints'
    )
  }
  if (receipt.lastProcessedKey !== null && compareCursor(receipt.lastProcessedKey, highWater) > 0) {
    return failure(
      index,
      'backfill-execution-v2-high-water-exceeded',
      'Cursor progress exceeded the captured high-water mark'
    )
  }
  return null
}

function progressOutcomeFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  index: number
): BackfillFailureV2 | null {
  const completion = completionFailure(receipt, index)
  if (completion) return completion
  const postcondition = postconditionFailure(receipt, index)
  if (postcondition) return postcondition
  if (receipt.outcome === 'completed' && receipt.terminalReason !== 'predicate-exhausted') {
    return failure(
      index,
      'backfill-execution-v2-transition-invalid',
      'A completed batch must terminalize because the bounded predicate is exhausted'
    )
  }
  if (
    receipt.outcome === 'in-progress' &&
    receipt.exhaustion.checked &&
    receipt.exhaustion.remainingEligibleRowCount === 0
  ) {
    return failure(
      index,
      'backfill-execution-v2-exhaustion-proof-required',
      'A zero-remaining observation cannot remain in progress'
    )
  }
  return null
}

function progressFailure(
  receipt: BackendBackfillExecutionReceiptV2,
  previous: BackendBackfillExecutionReceiptV2,
  lastChecked: BackendBackfillExecutionReceiptV2 | undefined,
  index: number
): BackfillFailureV2 | null {
  return (
    transitionBindingFailure(receipt, previous, index) ??
    committedCountsFailure(receipt, previous, index) ??
    exhaustionProgressFailure(receipt, lastChecked, index) ??
    cursorProgressFailure(receipt, previous, index) ??
    highWaterFailure(receipt, index) ??
    progressOutcomeFailure(receipt, index)
  )
}

interface ReceiptChainAccumulatorV2 {
  readonly context: BackendBackfillExecutionVerificationContextV2
  readonly scopeDigest: string
  computedHeadDigest: string | null
  previous: BackendBackfillExecutionReceiptV2 | undefined
  lastChecked: BackendBackfillExecutionReceiptV2 | undefined
  receiptCount: number
  readonly receiptIds: Set<string>
  readonly idempotencyKeys: Set<string>
  readonly requestDigests: Set<string>
  readonly databaseEventIds: Set<string>
}

interface ReceiptChainUniquenessDeltaV2 {
  readonly receiptIds: Set<string>
  readonly idempotencyKeys: Set<string>
  readonly requestDigests: Set<string>
  readonly databaseEventIds: Set<string>
}

function createReceiptChainAccumulator(
  context: BackendBackfillExecutionVerificationContextV2,
  scopeDigest: string
): ReceiptChainAccumulatorV2 {
  return {
    context,
    scopeDigest,
    computedHeadDigest: null,
    previous: undefined,
    lastChecked: undefined,
    receiptCount: 0,
    receiptIds: new Set(),
    idempotencyKeys: new Set(),
    requestDigests: new Set(),
    databaseEventIds: new Set()
  }
}

function createReceiptChainPageCandidate(
  source: ReceiptChainAccumulatorV2
): ReceiptChainAccumulatorV2 {
  return {
    context: source.context,
    scopeDigest: source.scopeDigest,
    computedHeadDigest: source.computedHeadDigest,
    previous: source.previous,
    lastChecked: source.lastChecked,
    receiptCount: source.receiptCount,
    receiptIds: source.receiptIds,
    idempotencyKeys: source.idempotencyKeys,
    requestDigests: source.requestDigests,
    databaseEventIds: source.databaseEventIds
  }
}

function createReceiptChainUniquenessDelta(): ReceiptChainUniquenessDeltaV2 {
  return {
    receiptIds: new Set(),
    idempotencyKeys: new Set(),
    requestDigests: new Set(),
    databaseEventIds: new Set()
  }
}

function uniquenessValueSeen(
  accepted: Set<string>,
  pending: Set<string> | undefined,
  value: string
): boolean {
  return accepted.has(value) || pending?.has(value) === true
}

function receiptUniquenessFailure(
  accumulator: ReceiptChainAccumulatorV2,
  delta: ReceiptChainUniquenessDeltaV2 | undefined,
  receipt: BackendBackfillExecutionReceiptV2,
  index: number
): BackfillFailureV2 | null {
  if (
    uniquenessValueSeen(accumulator.receiptIds, delta?.receiptIds, receipt.receiptId) ||
    uniquenessValueSeen(
      accumulator.databaseEventIds,
      delta?.databaseEventIds,
      receipt.databaseEventId
    )
  ) {
    return failure(
      index,
      'backfill-execution-v2-receipt-id-duplicate',
      'Receipt or database event ID duplicates an earlier checkpoint'
    )
  }
  if (
    uniquenessValueSeen(accumulator.idempotencyKeys, delta?.idempotencyKeys, receipt.idempotencyKey)
  ) {
    return failure(
      index,
      'backfill-execution-v2-idempotency-key-reused',
      'Idempotency key was reused by more than one committed receipt'
    )
  }
  if (
    uniquenessValueSeen(accumulator.requestDigests, delta?.requestDigests, receipt.requestDigest)
  ) {
    return failure(
      index,
      'backfill-execution-v2-request-digest-reused',
      'Request digest was reused by more than one committed receipt'
    )
  }
  return null
}

function rememberReceiptUniqueness(
  accumulator: ReceiptChainAccumulatorV2,
  receipt: BackendBackfillExecutionReceiptV2,
  delta: ReceiptChainUniquenessDeltaV2 | undefined
): void {
  const receiptIds = delta?.receiptIds ?? accumulator.receiptIds
  const idempotencyKeys = delta?.idempotencyKeys ?? accumulator.idempotencyKeys
  const requestDigests = delta?.requestDigests ?? accumulator.requestDigests
  const databaseEventIds = delta?.databaseEventIds ?? accumulator.databaseEventIds
  receiptIds.add(receipt.receiptId)
  idempotencyKeys.add(receipt.idempotencyKey)
  requestDigests.add(receipt.requestDigest)
  databaseEventIds.add(receipt.databaseEventId)
}

function commitReceiptChainPage(
  accepted: ReceiptChainAccumulatorV2,
  candidate: ReceiptChainAccumulatorV2,
  delta: ReceiptChainUniquenessDeltaV2
): void {
  for (const value of delta.receiptIds) accepted.receiptIds.add(value)
  for (const value of delta.idempotencyKeys) accepted.idempotencyKeys.add(value)
  for (const value of delta.requestDigests) accepted.requestDigests.add(value)
  for (const value of delta.databaseEventIds) accepted.databaseEventIds.add(value)
  accepted.computedHeadDigest = candidate.computedHeadDigest
  accepted.previous = candidate.previous
  accepted.lastChecked = candidate.lastChecked
  accepted.receiptCount = candidate.receiptCount
}

async function appendReceiptsToChain(
  accumulator: ReceiptChainAccumulatorV2,
  receipts: readonly BackendBackfillExecutionReceiptV2[],
  uniquenessDelta?: ReceiptChainUniquenessDeltaV2
): Promise<BackfillFailureV2 | null> {
  if (receipts.length > BACKEND_BACKFILL_EXECUTION_V2_MAX_RECEIPTS - accumulator.receiptCount) {
    return failure(
      accumulator.receiptCount,
      'backfill-execution-v2-invalid',
      'Receipt chain exceeds the maximum receipt count'
    )
  }
  for (const receipt of receipts) {
    const index = accumulator.receiptCount
    const receiptScopeDigest = await digestBackendBackfillExecutionScopeV2(receipt.scope)
    if (
      receipt.scopeDigest !== accumulator.scopeDigest ||
      receiptScopeDigest !== accumulator.scopeDigest
    ) {
      return failure(
        index,
        'backfill-execution-v2-scope-mismatch',
        'Receipt scope or scope digest changed'
      )
    }
    const uniquenessFailure = receiptUniquenessFailure(accumulator, uniquenessDelta, receipt, index)
    if (uniquenessFailure) return uniquenessFailure
    if (receipt.previousReceiptDigest !== accumulator.computedHeadDigest) {
      return failure(index, 'backfill-execution-v2-chain-broken', 'Previous receipt digest changed')
    }
    if (compareReleaseTimestamps(receipt.committedAt, accumulator.context.evaluatedAt) > 0) {
      return failure(
        index,
        'backfill-execution-v2-future-dated',
        'Receipt is after the caller evaluation time'
      )
    }
    if (
      accumulator.previous &&
      compareReleaseTimestamps(receipt.committedAt, accumulator.previous.committedAt) <= 0
    ) {
      return failure(
        index,
        'backfill-execution-v2-transition-invalid',
        'Receipt commit timestamps must strictly advance'
      )
    }
    const limit = batchLimitFailure(receipt, index)
    if (limit) return limit
    const transition = accumulator.previous
      ? progressFailure(receipt, accumulator.previous, accumulator.lastChecked, index)
      : firstReceiptFailure(receipt, index)
    if (transition) return transition
    const computedHeadDigest = await digestCanonicalManifest(receipt)
    rememberReceiptUniqueness(accumulator, receipt, uniquenessDelta)
    accumulator.computedHeadDigest = computedHeadDigest
    accumulator.previous = receipt
    if (receipt.exhaustion.checked) accumulator.lastChecked = receipt
    accumulator.receiptCount += 1
  }
  return null
}

function receiptChainHeadFailure(accumulator: ReceiptChainAccumulatorV2): BackfillFailureV2 | null {
  if (accumulator.computedHeadDigest === accumulator.context.expectedHeadDigest) return null
  return failure(
    Math.max(0, accumulator.receiptCount - 1),
    'backfill-execution-v2-database-head-mismatch',
    'Receipt chain does not match the caller-authenticated database head'
  )
}

class ReceiptVerificationEntryParseError extends Error {
  constructor(
    readonly index: number,
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : 'Receipt V2 entry is invalid')
    this.name = 'ReceiptVerificationEntryParseError'
  }
}

function parseReceiptArray(value: unknown): readonly BackendBackfillExecutionReceiptV2[] {
  const entries = exactArray(value, '$.receipts', BACKEND_BACKFILL_EXECUTION_V2_MAX_RECEIPTS)
  const receipts: BackendBackfillExecutionReceiptV2[] = []
  for (const [index, entry] of entries.entries()) {
    try {
      receipts.push(parseBackendBackfillExecutionReceiptV2(entry, `$.receipts[${index}]`))
    } catch (cause) {
      throw new ReceiptVerificationEntryParseError(index, cause)
    }
  }
  return Object.freeze(receipts)
}

/**
 * Verify a provider-neutral Receipt V2 chain against caller-authenticated evidence anchors.
 * A successful result remains review evidence only: it does not perform a database CAS, reserve
 * identifiers, authenticate operationAuthorityDigest, execute a backfill, or make a release ready.
 * `outcome-unknown` is intentionally absent: the Host must reconcile it before a receipt exists.
 */
export async function verifyBackendBackfillExecutionReceiptChainV2(
  value: unknown,
  verificationContext: BackendBackfillExecutionVerificationContextV2
): Promise<BackendBackfillExecutionVerificationV2> {
  let receipts: readonly BackendBackfillExecutionReceiptV2[]
  let context: BackendBackfillExecutionVerificationContextV2
  try {
    receipts = parseReceiptArray(value)
    context = parseVerificationContext(verificationContext)
  } catch (cause) {
    return failure(
      cause instanceof ReceiptVerificationEntryParseError ? cause.index : 0,
      'backfill-execution-v2-invalid',
      cause instanceof Error ? cause.message : 'Receipt V2 input is invalid'
    )
  }
  const scopeDigest = await digestBackendBackfillExecutionScopeV2(context.scope)
  const accumulator = createReceiptChainAccumulator(context, scopeDigest)
  const chainFailure = await appendReceiptsToChain(accumulator, receipts)
  if (chainFailure) return chainFailure
  const headFailure = receiptChainHeadFailure(accumulator)
  if (headFailure) return headFailure
  return Object.freeze({
    ok: true,
    releaseReady: false,
    databaseAuthorityGranted: false,
    executionAuthorityGranted: false,
    scope: context.scope,
    scopeDigest,
    receipts,
    computedHeadDigest: accumulator.computedHeadDigest,
    outcome: accumulator.previous?.outcome ?? 'not-started'
  })
}

function parseReceiptVerificationPage(
  value: unknown,
  startIndex: number
): readonly BackendBackfillExecutionReceiptV2[] {
  const entries = exactArray(
    value,
    '$.receiptPage',
    BACKEND_BACKFILL_EXECUTION_V2_MAX_VERIFICATION_PAGE_RECEIPTS
  )
  if (entries.length === 0) throw new TypeError('$.receiptPage must not be empty')
  const receipts: BackendBackfillExecutionReceiptV2[] = []
  for (const [pageIndex, entry] of entries.entries()) {
    const chainIndex = startIndex + pageIndex
    try {
      receipts.push(parseBackendBackfillExecutionReceiptV2(entry, `$.receipts[${chainIndex}]`))
    } catch (cause) {
      throw new ReceiptVerificationEntryParseError(chainIndex, cause)
    }
  }
  return Object.freeze(receipts)
}

function incrementalFailure(index: number, cause: unknown): BackfillFailureV2 {
  return failure(
    cause instanceof ReceiptVerificationEntryParseError ? cause.index : index,
    'backfill-execution-v2-invalid',
    cause instanceof Error ? cause.message : 'Receipt V2 page is invalid'
  )
}

function receiptChainFailure(
  value: BackfillFailureV2,
  failureDisposition: BackendBackfillExecutionReceiptChainFailureDispositionV2
): BackendBackfillExecutionReceiptChainFailureV2 {
  if (failureDisposition === 'page-rejected' || failureDisposition === 'operation-in-progress') {
    return Object.freeze({ ...value, failureDisposition, finalized: false, retryable: true })
  }
  return Object.freeze({ ...value, failureDisposition, finalized: true, retryable: false })
}

function failedReceiptChainVerifier(
  failureResult: BackendBackfillExecutionReceiptChainFailureV2
): BackendBackfillExecutionReceiptChainVerifierV2 {
  return Object.freeze({
    async appendPage() {
      return failureResult
    },
    async finalize() {
      return failureResult
    }
  })
}

function appendSuccess(
  accumulator: ReceiptChainAccumulatorV2
): ReceiptChainAppendSuccessV2 | BackfillFailureV2 {
  const previous = accumulator.previous
  const computedHeadDigest = accumulator.computedHeadDigest
  if (!previous || computedHeadDigest === null) {
    return failure(
      accumulator.receiptCount,
      'backfill-execution-v2-invalid',
      'A successful Receipt page must advance the chain'
    )
  }
  return Object.freeze({
    ok: true,
    finalized: false,
    releaseReady: false,
    databaseAuthorityGranted: false,
    executionAuthorityGranted: false,
    scopeDigest: accumulator.scopeDigest,
    receiptCount: accumulator.receiptCount,
    lastDatabaseHeadVersion: previous.databaseHeadVersion,
    computedHeadDigest,
    outcome: previous.outcome
  })
}

function finalizationSuccess(
  accumulator: ReceiptChainAccumulatorV2
): BackendBackfillExecutionReceiptChainFinalizationV2 {
  return Object.freeze({
    ok: true,
    finalized: true,
    releaseReady: false,
    databaseAuthorityGranted: false,
    executionAuthorityGranted: false,
    scope: accumulator.context.scope,
    scopeDigest: accumulator.scopeDigest,
    receiptCount: accumulator.receiptCount,
    lastDatabaseHeadVersion: accumulator.previous?.databaseHeadVersion ?? null,
    computedHeadDigest: accumulator.computedHeadDigest,
    outcome: accumulator.previous?.outcome ?? 'not-started'
  })
}

/**
 * Create a provider-neutral, in-memory incremental verifier. Each non-empty page is limited to 64
 * Receipts and is applied to a private copy, so an invalid page never advances accepted state. The
 * verifier retains transition summaries and uniqueness sets, not every canonical Receipt payload.
 */
export async function createBackendBackfillExecutionReceiptChainVerifierV2(
  verificationContext: BackendBackfillExecutionVerificationContextV2
): Promise<BackendBackfillExecutionReceiptChainVerifierV2> {
  let context: BackendBackfillExecutionVerificationContextV2
  let scopeDigest: string
  try {
    context = parseVerificationContext(verificationContext)
    scopeDigest = await digestBackendBackfillExecutionScopeV2(context.scope)
  } catch (cause) {
    return failedReceiptChainVerifier(
      receiptChainFailure(
        failure(
          0,
          'backfill-execution-v2-invalid',
          cause instanceof Error ? cause.message : 'Receipt V2 verification context is invalid'
        ),
        'initialization-rejected'
      )
    )
  }
  const accumulator = createReceiptChainAccumulator(context, scopeDigest)
  let lifecycle: 'ready' | 'appending' | 'finalized' = 'ready'
  let finalized: BackendBackfillExecutionReceiptChainFinalizationV2 | null = null

  return Object.freeze({
    async appendPage(value: unknown): Promise<BackendBackfillExecutionReceiptChainAppendResultV2> {
      if (lifecycle === 'finalized') {
        return receiptChainFailure(
          failure(
            accumulator.receiptCount,
            'backfill-execution-v2-invalid',
            'Receipt chain verifier is already finalized'
          ),
          'already-finalized'
        )
      }
      if (lifecycle === 'appending') {
        return receiptChainFailure(
          failure(
            accumulator.receiptCount,
            'backfill-execution-v2-invalid',
            'Concurrent Receipt page verification is forbidden'
          ),
          'operation-in-progress'
        )
      }
      lifecycle = 'appending'
      try {
        const receipts = parseReceiptVerificationPage(value, accumulator.receiptCount)
        const candidate = createReceiptChainPageCandidate(accumulator)
        const uniquenessDelta = createReceiptChainUniquenessDelta()
        const chainFailure = await appendReceiptsToChain(candidate, receipts, uniquenessDelta)
        if (chainFailure) return receiptChainFailure(chainFailure, 'page-rejected')
        const accepted = appendSuccess(candidate)
        if (!accepted.ok) return receiptChainFailure(accepted, 'page-rejected')
        commitReceiptChainPage(accumulator, candidate, uniquenessDelta)
        return accepted
      } catch (cause) {
        return receiptChainFailure(
          incrementalFailure(accumulator.receiptCount, cause),
          'page-rejected'
        )
      } finally {
        lifecycle = 'ready'
      }
    },

    async finalize(): Promise<BackendBackfillExecutionReceiptChainFinalizationV2> {
      if (finalized) return finalized
      if (lifecycle === 'appending') {
        return receiptChainFailure(
          failure(
            accumulator.receiptCount,
            'backfill-execution-v2-invalid',
            'Receipt chain cannot be finalized while a page is being verified'
          ),
          'operation-in-progress'
        )
      }
      lifecycle = 'finalized'
      const headFailure = receiptChainHeadFailure(accumulator)
      finalized = headFailure
        ? receiptChainFailure(headFailure, 'finalization-rejected')
        : finalizationSuccess(accumulator)
      return finalized
    }
  })
}
