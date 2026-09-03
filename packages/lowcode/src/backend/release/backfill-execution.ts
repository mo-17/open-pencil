/* eslint-disable max-lines -- scope derivation, receipt parsing, hash-chain verification, and resumable transition invariants form one fail-closed boundary */
import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import { digestBackendApplicationV2, normalizedBackendApplicationV2 } from '../application-v2'
import type {
  BackendApplicationSpecV2,
  BackendDataMigrationDefinitionIR
} from '../application-v2-types'
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

export const BACKEND_BACKFILL_EXECUTION_VERSION = 1 as const
export const BACKEND_BACKFILL_EXECUTION_SCOPE_FORMAT =
  'openpencil.backend-backfill-execution-scope' as const
export const BACKEND_BACKFILL_EXECUTION_RECEIPT_FORMAT =
  'openpencil.backend-backfill-execution-receipt' as const
export const BACKEND_BACKFILL_EXECUTION_MAX_RECEIPTS = 10_000

export type BackendBackfillCursorFieldType = 'integer'
export type BackendBackfillCursorValue = number
export type BackendBackfillExecutionOutcome = 'in-progress' | 'completed' | 'failed'

export interface BackendBackfillExecutionAuthorityV1 {
  readonly providerId: string
  readonly environment: BackendReleaseEnvironment
  readonly authorityDigest: string
  readonly migrationId: string
}

export interface BackendBackfillExecutionTrustedContextV1 extends BackendBackfillExecutionAuthorityV1 {
  /** Host-accepted CAS head. Explicit null is required for a new execution. */
  readonly trustedHeadDigest: string | null
  readonly evaluatedAt: string
}

export interface BackendBackfillExecutionScopeV1 {
  readonly format: typeof BACKEND_BACKFILL_EXECUTION_SCOPE_FORMAT
  readonly version: typeof BACKEND_BACKFILL_EXECUTION_VERSION
  readonly providerId: string
  readonly environment: BackendReleaseEnvironment
  readonly authorityDigest: string
  readonly applicationDigest: string
  readonly migrationId: string
  readonly migrationDigest: string
  readonly cursorField: string
  readonly cursorFieldType: BackendBackfillCursorFieldType
  readonly batchSize: number
}

export interface BackendBackfillExecutionReceiptV1 {
  readonly format: typeof BACKEND_BACKFILL_EXECUTION_RECEIPT_FORMAT
  readonly version: typeof BACKEND_BACKFILL_EXECUTION_VERSION
  readonly receiptId: string
  readonly executionId: string
  readonly scope: BackendBackfillExecutionScopeV1
  readonly capturedHighWater: BackendBackfillCursorValue | null
  readonly lastProcessedKey: BackendBackfillCursorValue | null
  readonly batchIndex: number
  /** Cumulative counts through this checkpoint. */
  readonly scannedRowCount: number
  readonly matchedRowCount: number
  readonly updatedRowCount: number
  readonly outcome: BackendBackfillExecutionOutcome
  readonly stableErrorCode: string | null
  readonly previousReceiptDigest: string | null
  readonly checkedAt: string
  readonly evidenceDigest: string
}

/**
 * Host-owned observation used to construct a receipt candidate. Supplying these fields never
 * establishes trust without the independently accepted context and atomic CAS persistence.
 */
export type BackendBackfillExecutionAppendAuthorityV1 = Omit<
  BackendBackfillExecutionReceiptV1,
  'format' | 'version' | 'scope' | 'previousReceiptDigest'
>

export type BackendBackfillExecutionErrorCode =
  | 'backfill-execution-invalid'
  | 'backfill-execution-scope-mismatch'
  | 'backfill-execution-chain-broken'
  | 'backfill-execution-head-mismatch'
  | 'backfill-execution-future-dated'
  | 'backfill-execution-transition-invalid'
  | 'backfill-execution-progress-regressed'
  | 'backfill-execution-high-water-exceeded'
  | 'backfill-execution-terminal'
  | 'backfill-execution-receipt-id-duplicate'

export type BackendBackfillExecutionVerification =
  | Readonly<{
      ok: true
      scope: BackendBackfillExecutionScopeV1
      receipts: readonly BackendBackfillExecutionReceiptV1[]
      computedHeadDigest: string | null
      outcome: BackendBackfillExecutionOutcome | 'not-started'
    }>
  | Readonly<{
      ok: false
      index: number
      code: BackendBackfillExecutionErrorCode
      message: string
    }>

type BackfillFailure = Extract<BackendBackfillExecutionVerification, { ok: false }>

const ENVIRONMENTS = new Set<string>(['preview', 'staging', 'production'])
const CURSOR_FIELD_TYPES = new Set<string>(['integer'])
const OUTCOMES = new Set<string>(['in-progress', 'completed', 'failed'])

const AUTHORITY_KEYS = ['providerId', 'environment', 'authorityDigest', 'migrationId'] as const
const TRUSTED_CONTEXT_KEYS = [...AUTHORITY_KEYS, 'trustedHeadDigest', 'evaluatedAt'] as const
const SCOPE_KEYS = [
  'format',
  'version',
  'providerId',
  'environment',
  'authorityDigest',
  'applicationDigest',
  'migrationId',
  'migrationDigest',
  'cursorField',
  'cursorFieldType',
  'batchSize'
] as const
const RECEIPT_KEYS = [
  'format',
  'version',
  'receiptId',
  'executionId',
  'scope',
  'capturedHighWater',
  'lastProcessedKey',
  'batchIndex',
  'scannedRowCount',
  'matchedRowCount',
  'updatedRowCount',
  'outcome',
  'stableErrorCode',
  'previousReceiptDigest',
  'checkedAt',
  'evidenceDigest'
] as const
const RECEIPT_INPUT_KEYS = RECEIPT_KEYS.filter(
  (key) => !['format', 'version', 'scope', 'previousReceiptDigest'].includes(key)
)

function environment(value: unknown, path: string): BackendReleaseEnvironment {
  if (typeof value !== 'string' || !ENVIRONMENTS.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as BackendReleaseEnvironment
}

function cursorFieldType(value: unknown, path: string): BackendBackfillCursorFieldType {
  if (typeof value !== 'string' || !CURSOR_FIELD_TYPES.has(value)) {
    throw new TypeError(`${path} is not a stable ordered cursor type`)
  }
  return value as BackendBackfillCursorFieldType
}

function count(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`)
  }
  return value
}

function batchIndex(value: unknown, path: string): number {
  const parsed = count(value, path)
  if (parsed > BACKEND_BACKFILL_EXECUTION_MAX_RECEIPTS) {
    throw new TypeError(`${path} exceeds the maximum receipt count`)
  }
  return parsed
}

function migrationBatchSize(value: unknown, path: string): number {
  const parsed = count(value, path)
  if (parsed < 1 || parsed > 1_000) {
    throw new TypeError(`${path} must be between 1 and 1000`)
  }
  return parsed
}

function cursorValue(value: unknown, path: string): BackendBackfillCursorValue | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer cursor value`)
  }
  return value
}

function compareCursorValues(
  left: BackendBackfillCursorValue,
  right: BackendBackfillCursorValue
): -1 | 0 | 1 {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function parseAuthority(value: unknown, path: string): BackendBackfillExecutionAuthorityV1 {
  const source = exactRecord(value, path, AUTHORITY_KEYS)
  return Object.freeze({
    providerId: releaseIdentifier(
      stringValue(source.providerId, `${path}.providerId`),
      `${path}.providerId`
    ),
    environment: environment(source.environment, `${path}.environment`),
    authorityDigest: releaseDigest(
      stringValue(source.authorityDigest, `${path}.authorityDigest`),
      `${path}.authorityDigest`
    ),
    migrationId: releaseIdentifier(
      stringValue(source.migrationId, `${path}.migrationId`),
      `${path}.migrationId`
    )
  })
}

function parseTrustedContext(value: unknown): BackendBackfillExecutionTrustedContextV1 {
  const source = exactRecord(value, '$.trustedContext', TRUSTED_CONTEXT_KEYS)
  const authority = parseAuthority(
    {
      providerId: source.providerId,
      environment: source.environment,
      authorityDigest: source.authorityDigest,
      migrationId: source.migrationId
    },
    '$.trustedContext'
  )
  return Object.freeze({
    ...authority,
    trustedHeadDigest: nullableDigest(
      source.trustedHeadDigest,
      '$.trustedContext.trustedHeadDigest'
    ),
    evaluatedAt: releaseTimestamp(
      stringValue(source.evaluatedAt, '$.trustedContext.evaluatedAt'),
      '$.trustedContext.evaluatedAt'
    )
  })
}

export function parseBackendBackfillExecutionScope(
  value: unknown,
  path = '$.scope'
): BackendBackfillExecutionScopeV1 {
  const source = exactRecord(value, path, SCOPE_KEYS)
  if (source.format !== BACKEND_BACKFILL_EXECUTION_SCOPE_FORMAT) {
    throw new TypeError(`${path}.format is not supported`)
  }
  if (source.version !== BACKEND_BACKFILL_EXECUTION_VERSION) {
    throw new TypeError(`${path}.version is not supported`)
  }
  return Object.freeze({
    format: BACKEND_BACKFILL_EXECUTION_SCOPE_FORMAT,
    version: BACKEND_BACKFILL_EXECUTION_VERSION,
    providerId: releaseIdentifier(
      stringValue(source.providerId, `${path}.providerId`),
      `${path}.providerId`
    ),
    environment: environment(source.environment, `${path}.environment`),
    authorityDigest: releaseDigest(
      stringValue(source.authorityDigest, `${path}.authorityDigest`),
      `${path}.authorityDigest`
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
    cursorField: releaseIdentifier(
      stringValue(source.cursorField, `${path}.cursorField`),
      `${path}.cursorField`
    ),
    cursorFieldType: cursorFieldType(source.cursorFieldType, `${path}.cursorFieldType`),
    batchSize: migrationBatchSize(source.batchSize, `${path}.batchSize`)
  })
}

function migrationAndCursor(
  application: BackendApplicationSpecV2,
  migrationId: string
): {
  migration: BackendDataMigrationDefinitionIR
  cursorFieldType: BackendBackfillCursorFieldType
} {
  const migration = application.dataMigrations.migrations.find((entry) => entry.id === migrationId)
  if (!migration) throw new TypeError('Expected data migration does not exist in the application')
  const entity = application.dataModel.entities.find((entry) => entry.id === migration.entityId)
  const field = entity?.fields.find((entry) => entry.id === migration.cursor.fieldId)
  if (
    !field ||
    field.nullable ||
    field.type !== 'integer' ||
    field.default?.kind !== 'generated' ||
    field.default.generator !== 'identity' ||
    entity?.primaryKey?.fields.length !== 1 ||
    entity.primaryKey.fields[0] !== field.id
  ) {
    throw new TypeError('Data migration cursor must be a non-null integer identity primary key')
  }
  return { migration, cursorFieldType: 'integer' }
}

async function scopeForNormalizedApplication(
  application: BackendApplicationSpecV2,
  authority: BackendBackfillExecutionAuthorityV1
): Promise<BackendBackfillExecutionScopeV1> {
  const { migration, cursorFieldType: parsedCursorFieldType } = migrationAndCursor(
    application,
    authority.migrationId
  )
  const [applicationDigest, migrationDigest] = await Promise.all([
    digestBackendApplicationV2(application),
    digestCanonicalManifest(migration)
  ])
  return parseBackendBackfillExecutionScope({
    format: BACKEND_BACKFILL_EXECUTION_SCOPE_FORMAT,
    version: BACKEND_BACKFILL_EXECUTION_VERSION,
    providerId: authority.providerId,
    environment: authority.environment,
    authorityDigest: authority.authorityDigest,
    migrationId: authority.migrationId,
    applicationDigest,
    migrationDigest,
    cursorField: migration.cursor.fieldId,
    cursorFieldType: parsedCursorFieldType,
    batchSize: migration.batchSize
  })
}

export async function createBackendBackfillExecutionScope(
  application: BackendApplicationSpecV2,
  authority: BackendBackfillExecutionAuthorityV1
): Promise<BackendBackfillExecutionScopeV1> {
  const normalized = normalizedBackendApplicationV2(application)
  return scopeForNormalizedApplication(normalized, parseAuthority(authority, '$.authority'))
}

function parseReceiptSource(
  source: Record<string, unknown>,
  scope: BackendBackfillExecutionScopeV1,
  path: string
): BackendBackfillExecutionReceiptV1 {
  if (source.format !== BACKEND_BACKFILL_EXECUTION_RECEIPT_FORMAT) {
    throw new TypeError(`${path}.format is not supported`)
  }
  if (source.version !== BACKEND_BACKFILL_EXECUTION_VERSION) {
    throw new TypeError(`${path}.version is not supported`)
  }
  const parsedOutcome = source.outcome
  if (typeof parsedOutcome !== 'string' || !OUTCOMES.has(parsedOutcome)) {
    throw new TypeError(`${path}.outcome is not supported`)
  }
  const outcome = parsedOutcome as BackendBackfillExecutionOutcome
  const stableErrorCode =
    source.stableErrorCode === null
      ? null
      : releaseIdentifier(
          stringValue(source.stableErrorCode, `${path}.stableErrorCode`),
          `${path}.stableErrorCode`
        )
  if ((outcome === 'failed') !== (stableErrorCode !== null)) {
    throw new TypeError(`${path}.stableErrorCode does not match the outcome`)
  }
  const scannedRowCount = count(source.scannedRowCount, `${path}.scannedRowCount`)
  const matchedRowCount = count(source.matchedRowCount, `${path}.matchedRowCount`)
  const updatedRowCount = count(source.updatedRowCount, `${path}.updatedRowCount`)
  if (matchedRowCount > scannedRowCount || updatedRowCount > matchedRowCount) {
    throw new TypeError(`${path} cumulative row counts are inconsistent`)
  }
  return Object.freeze({
    format: BACKEND_BACKFILL_EXECUTION_RECEIPT_FORMAT,
    version: BACKEND_BACKFILL_EXECUTION_VERSION,
    receiptId: releaseIdentifier(
      stringValue(source.receiptId, `${path}.receiptId`),
      `${path}.receiptId`
    ),
    executionId: releaseIdentifier(
      stringValue(source.executionId, `${path}.executionId`),
      `${path}.executionId`
    ),
    scope,
    capturedHighWater: cursorValue(source.capturedHighWater, `${path}.capturedHighWater`),
    lastProcessedKey: cursorValue(source.lastProcessedKey, `${path}.lastProcessedKey`),
    batchIndex: batchIndex(source.batchIndex, `${path}.batchIndex`),
    scannedRowCount,
    matchedRowCount,
    updatedRowCount,
    outcome,
    stableErrorCode,
    previousReceiptDigest: nullableDigest(
      source.previousReceiptDigest,
      `${path}.previousReceiptDigest`
    ),
    checkedAt: releaseTimestamp(
      stringValue(source.checkedAt, `${path}.checkedAt`),
      `${path}.checkedAt`
    ),
    evidenceDigest: releaseDigest(
      stringValue(source.evidenceDigest, `${path}.evidenceDigest`),
      `${path}.evidenceDigest`
    )
  })
}

export function parseBackendBackfillExecutionReceipt(
  value: unknown,
  path = '$.receipt'
): BackendBackfillExecutionReceiptV1 {
  const source = exactRecord(value, path, RECEIPT_KEYS)
  const scope = parseBackendBackfillExecutionScope(source.scope, `${path}.scope`)
  return parseReceiptSource(source, scope, path)
}

export function canonicalBackendBackfillExecutionReceiptBytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(parseBackendBackfillExecutionReceipt(value))
}

export async function digestBackendBackfillExecutionReceipt(value: unknown): Promise<string> {
  return digestCanonicalManifest(parseBackendBackfillExecutionReceipt(value))
}

function sameScope(
  left: BackendBackfillExecutionScopeV1,
  right: BackendBackfillExecutionScopeV1
): boolean {
  return SCOPE_KEYS.every((key) => left[key] === right[key])
}

function sameCursorValue(
  left: BackendBackfillCursorValue | null,
  right: BackendBackfillCursorValue | null
): boolean {
  return left === right
}

function failure(
  index: number,
  code: BackendBackfillExecutionErrorCode,
  message: string
): BackfillFailure {
  return Object.freeze({ ok: false, index, code, message })
}

function firstReceiptFailure(
  receipt: BackendBackfillExecutionReceiptV1,
  index: number
): BackfillFailure | null {
  if (
    receipt.previousReceiptDigest !== null ||
    receipt.batchIndex !== 0 ||
    receipt.scannedRowCount !== 0 ||
    receipt.matchedRowCount !== 0 ||
    receipt.updatedRowCount !== 0 ||
    receipt.lastProcessedKey !== null
  ) {
    return failure(
      index,
      'backfill-execution-transition-invalid',
      'The first receipt must be a zero-progress high-water capture checkpoint'
    )
  }
  if (receipt.capturedHighWater === null && receipt.outcome !== 'completed') {
    return failure(
      index,
      'backfill-execution-transition-invalid',
      'An empty high-water capture must complete immediately'
    )
  }
  if (receipt.capturedHighWater !== null && receipt.outcome !== 'in-progress') {
    return failure(
      index,
      'backfill-execution-transition-invalid',
      'A non-empty high-water capture must begin in progress'
    )
  }
  return null
}

function rowCountFailure(
  receipt: BackendBackfillExecutionReceiptV1,
  previous: BackendBackfillExecutionReceiptV1,
  index: number
): BackfillFailure | null {
  const scannedDelta = receipt.scannedRowCount - previous.scannedRowCount
  const matchedDelta = receipt.matchedRowCount - previous.matchedRowCount
  const updatedDelta = receipt.updatedRowCount - previous.updatedRowCount
  if (
    scannedDelta < 0 ||
    matchedDelta < 0 ||
    updatedDelta < 0 ||
    matchedDelta > scannedDelta ||
    updatedDelta > matchedDelta
  ) {
    return failure(
      index,
      'backfill-execution-progress-regressed',
      'Cumulative or per-batch row counts regressed'
    )
  }
  return scannedDelta > receipt.scope.batchSize
    ? failure(
        index,
        'backfill-execution-transition-invalid',
        'A batch scanned more rows than the source migration batchSize permits'
      )
    : null
}

function progressFailure(
  receipt: BackendBackfillExecutionReceiptV1,
  previous: BackendBackfillExecutionReceiptV1,
  index: number
): BackfillFailure | null {
  if (previous.outcome !== 'in-progress') {
    return failure(index, 'backfill-execution-terminal', 'A terminal receipt cannot be extended')
  }
  if (
    receipt.executionId !== previous.executionId ||
    receipt.batchIndex !== previous.batchIndex + 1 ||
    !sameCursorValue(receipt.capturedHighWater, previous.capturedHighWater)
  ) {
    return failure(
      index,
      'backfill-execution-transition-invalid',
      'Execution, batch, or captured high-water binding changed'
    )
  }
  const scannedDelta = receipt.scannedRowCount - previous.scannedRowCount
  const countsFailure = rowCountFailure(receipt, previous, index)
  if (countsFailure) return countsFailure
  const cursorAdvanced =
    receipt.lastProcessedKey !== null &&
    (previous.lastProcessedKey === null ||
      compareCursorValues(receipt.lastProcessedKey, previous.lastProcessedKey) > 0)
  if (receipt.outcome !== 'failed' && (scannedDelta === 0 || !cursorAdvanced)) {
    return failure(
      index,
      'backfill-execution-progress-regressed',
      'A non-failed batch must scan rows and strictly advance the cursor'
    )
  }
  if (
    receipt.outcome === 'failed' &&
    ((scannedDelta === 0 &&
      !sameCursorValue(receipt.lastProcessedKey, previous.lastProcessedKey)) ||
      (scannedDelta > 0 && !cursorAdvanced))
  ) {
    return failure(
      index,
      'backfill-execution-progress-regressed',
      'A failed batch cursor must match its recorded progress'
    )
  }
  return null
}

function highWaterFailure(
  receipt: BackendBackfillExecutionReceiptV1,
  index: number
): BackfillFailure | null {
  const highWater = receipt.capturedHighWater
  const lastKey = receipt.lastProcessedKey
  if (highWater === null) return null
  if (lastKey !== null && compareCursorValues(lastKey, highWater) > 0) {
    return failure(
      index,
      'backfill-execution-high-water-exceeded',
      'Cursor progress exceeded the captured high-water mark'
    )
  }
  if (receipt.outcome === 'in-progress' && lastKey !== null) {
    if (compareCursorValues(lastKey, highWater) >= 0) {
      return failure(
        index,
        'backfill-execution-transition-invalid',
        'A receipt at the high-water mark must be completed'
      )
    }
  }
  if (
    receipt.outcome === 'completed' &&
    (lastKey === null || compareCursorValues(lastKey, highWater) !== 0)
  ) {
    return failure(
      index,
      'backfill-execution-transition-invalid',
      'Completed execution must reach the captured high-water mark'
    )
  }
  return null
}

async function inspectParsedReceipts(
  receipts: readonly BackendBackfillExecutionReceiptV1[],
  scope: BackendBackfillExecutionScopeV1,
  evaluatedAt: string
): Promise<BackendBackfillExecutionVerification> {
  let computedHeadDigest: string | null = null
  let previous: BackendBackfillExecutionReceiptV1 | undefined
  const receiptIds = new Set<string>()
  for (const [index, receipt] of receipts.entries()) {
    if (!sameScope(receipt.scope, scope)) {
      return failure(index, 'backfill-execution-scope-mismatch', 'Receipt scope changed')
    }
    if (receiptIds.has(receipt.receiptId)) {
      return failure(
        index,
        'backfill-execution-receipt-id-duplicate',
        'Receipt ID duplicates an earlier checkpoint'
      )
    }
    if (receipt.previousReceiptDigest !== computedHeadDigest) {
      return failure(index, 'backfill-execution-chain-broken', 'Previous receipt digest changed')
    }
    if (compareReleaseTimestamps(receipt.checkedAt, evaluatedAt) > 0) {
      return failure(
        index,
        'backfill-execution-future-dated',
        'Receipt is after Host evaluation time'
      )
    }
    if (previous && compareReleaseTimestamps(receipt.checkedAt, previous.checkedAt) <= 0) {
      return failure(
        index,
        'backfill-execution-transition-invalid',
        'Receipt timestamps must advance exactly'
      )
    }
    const transitionFailure = previous
      ? progressFailure(receipt, previous, index)
      : firstReceiptFailure(receipt, index)
    if (transitionFailure) return transitionFailure
    const highWaterError = highWaterFailure(receipt, index)
    if (highWaterError) return highWaterError
    receiptIds.add(receipt.receiptId)
    computedHeadDigest = await digestCanonicalManifest(receipt)
    previous = receipt
  }
  return Object.freeze({
    ok: true,
    scope,
    receipts: Object.freeze([...receipts]),
    computedHeadDigest,
    outcome: previous?.outcome ?? 'not-started'
  })
}

function parseReceiptArray(value: unknown): readonly BackendBackfillExecutionReceiptV1[] {
  return Object.freeze(
    exactArray(value, '$.receipts', BACKEND_BACKFILL_EXECUTION_MAX_RECEIPTS).map((entry, index) =>
      parseBackendBackfillExecutionReceipt(entry, `$.receipts[${index}]`)
    )
  )
}

export async function verifyBackendBackfillExecutionReceiptChain(
  application: BackendApplicationSpecV2,
  value: unknown,
  trustedContext: BackendBackfillExecutionTrustedContextV1
): Promise<BackendBackfillExecutionVerification> {
  let normalized: BackendApplicationSpecV2
  let receipts: readonly BackendBackfillExecutionReceiptV1[]
  let context: BackendBackfillExecutionTrustedContextV1
  try {
    normalized = normalizedBackendApplicationV2(application)
    receipts = parseReceiptArray(value)
    context = parseTrustedContext(trustedContext)
  } catch (cause) {
    return failure(
      0,
      'backfill-execution-invalid',
      cause instanceof Error ? cause.message : 'Backfill execution input is invalid.'
    )
  }
  let scope: BackendBackfillExecutionScopeV1
  try {
    scope = await scopeForNormalizedApplication(normalized, context)
  } catch (cause) {
    return failure(
      0,
      'backfill-execution-invalid',
      cause instanceof Error ? cause.message : 'Backfill execution scope is invalid.'
    )
  }
  const inspected = await inspectParsedReceipts(receipts, scope, context.evaluatedAt)
  if (!inspected.ok) return inspected
  if (inspected.computedHeadDigest !== context.trustedHeadDigest) {
    return failure(
      Math.max(0, inspected.receipts.length - 1),
      'backfill-execution-head-mismatch',
      'Receipt chain does not match the Host-trusted CAS head'
    )
  }
  return inspected
}

/**
 * Build a receipt candidate after authenticating the current Host CAS head.
 * This contract never executes a migration; persistence must compare-and-swap
 * the same trusted head and reserve receiptId/executionId atomically.
 */
export async function appendBackendBackfillExecutionReceipt(
  application: BackendApplicationSpecV2,
  history: unknown,
  trustedContext: BackendBackfillExecutionTrustedContextV1,
  appendAuthority: unknown
): Promise<Readonly<{ receipt: BackendBackfillExecutionReceiptV1; receiptDigest: string }>> {
  const normalized = normalizedBackendApplicationV2(application)
  const receipts = parseReceiptArray(history)
  const context = parseTrustedContext(trustedContext)
  const authoritySource = exactRecord(appendAuthority, '$.appendAuthority', RECEIPT_INPUT_KEYS)
  const scope = await scopeForNormalizedApplication(normalized, context)
  const inspected = await inspectParsedReceipts(receipts, scope, context.evaluatedAt)
  if (!inspected.ok)
    throw new TypeError(`Cannot append invalid backfill history: ${inspected.code}`)
  if (inspected.computedHeadDigest !== context.trustedHeadDigest) {
    throw new TypeError('Cannot append against a stale backfill receipt CAS head')
  }
  const receipt = parseReceiptSource(
    {
      format: BACKEND_BACKFILL_EXECUTION_RECEIPT_FORMAT,
      version: BACKEND_BACKFILL_EXECUTION_VERSION,
      ...authoritySource,
      scope,
      previousReceiptDigest: inspected.computedHeadDigest
    },
    scope,
    '$.appendAuthority'
  )
  const appended = await inspectParsedReceipts([...receipts, receipt], scope, context.evaluatedAt)
  if (!appended.ok) throw new TypeError(`Cannot append invalid backfill receipt: ${appended.code}`)
  const receiptDigest = appended.computedHeadDigest
  if (!receiptDigest) throw new TypeError('Appended backfill receipt digest is unavailable')
  return Object.freeze({ receipt, receiptDigest })
}
