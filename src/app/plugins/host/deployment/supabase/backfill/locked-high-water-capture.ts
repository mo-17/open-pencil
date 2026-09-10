/* oxlint-disable eslint(max-lines), eslint/complexity -- Keep the complete lock-bound capture and strict proof decoder together for auditability. */

import {
  createSupabaseBackfillInspectionSubjectV1,
  type SupabaseBackfillInspectionSubjectEnvelopeV1,
  type SupabaseBackfillInspectionSubjectV1
} from '@open-pencil/compiler/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  parseSupabaseStagingTargetBinding,
  type SupabaseStagingTargetBindingV1
} from '@/app/lowcode/supabase/staging-target'

import {
  type SupabaseBackfillLiveCatalogAuthorityV1,
  type SupabaseBackfillLiveCatalogCompilerInputV1,
  type SupabaseBackfillLiveCatalogInspectionV1
} from './live-inspector'
import type { SupabaseBackfillWriteBarrierInstallDispatchContextV1 } from './write-barrier/install'
import {
  consumeTrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1,
  trustedSupabaseBackfillWriteBarrierAppliedReconciliationV1,
  type SupabaseBackfillWriteBarrierInstallReconciliationResultV1,
  type TrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1
} from './write-barrier/install-controller'

export const SUPABASE_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_REVIEW_FORMAT =
  'openpencil.supabase-backfill-locked-high-water-capture-review.v1' as const
export const SUPABASE_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_FORMAT =
  'openpencil.supabase-backfill-locked-high-water-capture.v1' as const
export const SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_ID =
  'backfill-locked-high-water-capture' as const
export const SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_VERSION =
  'openpencil-supabase-backfill-locked-high-water-capture-v1' as const
export const SUPABASE_BACKFILL_LOCKED_HIGH_WATER_ARTIFACT_PATH =
  'backend/supabase-v2/backfill/locked-high-water-capture.sql' as const

export const SUPABASE_BACKFILL_LOCKED_HIGH_WATER_EXECUTION_POLICY = Object.freeze({
  transactionIsolation: 'serializable' as const,
  lockMode: 'share-row-exclusive' as const,
  lockTimeoutMs: 5_000,
  statementTimeoutMs: 15_000,
  lockBeforeFirstRead: true as const,
  reinspectionUnderLockRequired: true as const,
  fixedManagementQueryRequired: true as const
})

export interface SupabaseBackfillLockedHighWaterWriteAuthorityV1 {
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly scope: 'database:write'
  readonly permission: 'database_write'
}

export interface SupabaseBackfillLockedHighWaterCaptureReviewV1 {
  readonly format: typeof SUPABASE_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_REVIEW_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly environmentVerified: false
  readonly reviewOnly: true
  readonly captureAvailable: false
  readonly releaseReady: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly bindings: Readonly<{
    subjectDigest: string
    sourceReviewDigest: string
    appliedSingleFlightKey: string
    installedVerificationDigest: string
    installDigest: string
    providerAuthorityDigest: string
    applicationDigest: string
    backendPlanDigest: string
    adapterPlanDigest: string
    manifestDigest: string
    migrationDigest: string
    catalogPreconditionDigest: string
    queryDigest: string
  }>
  readonly authority: Readonly<{
    projectRef: string
    accountId: string
    readGrantGeneration: string
    installWriteGrantGeneration: string
  }>
  readonly address: Readonly<{
    schemaName: 'public'
    schemaOid: string
    tableName: string
    tableOid: string
    cursorField: string
    cursorSubId: number
    cursorTypeOid: string
    targetField: string
    targetSubId: number
    targetTypeOid: string
    primaryKeyOid: string
    sequenceOid: string
    barrierConstraintOid: string
  }>
  readonly barrier: Readonly<{
    constraintName: string
    marker: string
    constraintOid: string
    installedVerificationDigest: string
  }>
  readonly query: Readonly<{
    id: typeof SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_ID
    version: typeof SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_VERSION
    digest: string
    statementCount: 10
    accessMode: 'read-write-locked-read'
    snapshotScope: 'explicit-serializable-transaction'
    lockMode: 'share-row-exclusive'
    containsCatalogRead: true
    containsManagedDataRead: true
    containsDml: false
    performsSchemaChange: false
  }>
  readonly artifact: Readonly<{
    path: typeof SUPABASE_BACKFILL_LOCKED_HIGH_WATER_ARTIFACT_PATH
    kind: 'database-locked-read-review'
    mediaType: 'application/sql; charset=utf-8'
    byteLength: number
    digest: string
    mutationDispatched: false
    hostDispatchAvailable: false
  }>
  readonly highWater: Readonly<{
    status: 'not-captured'
    lockedCapture: false
    environmentSpecific: true
  }>
  readonly receipt: Readonly<{
    mayCreate: false
    authorityCreated: false
    databaseLedgerBound: false
  }>
  readonly executionPolicy: typeof SUPABASE_BACKFILL_LOCKED_HIGH_WATER_EXECUTION_POLICY
  readonly blockers: readonly string[]
}

export interface SupabaseBackfillLockedHighWaterCaptureReviewEnvelopeV1 {
  readonly review: SupabaseBackfillLockedHighWaterCaptureReviewV1
  readonly reviewDigest: string
  readonly captureSql: string
}

export interface CreateSupabaseBackfillLockedHighWaterCaptureReviewOptionsV1 {
  readonly context: SupabaseBackfillWriteBarrierInstallDispatchContextV1
  readonly reconciliation: SupabaseBackfillWriteBarrierInstallReconciliationResultV1
}

export interface SupabaseBackfillLockedHighWaterCaptureConfirmationV1 {
  readonly reviewDigest: string
  readonly sourceReviewDigest: string
  readonly installedVerificationDigest: string
  readonly queryDigest: string
  readonly projectRefConfirmation: string
  readonly accountIdConfirmation: string
  readonly captureGrantGeneration: string
  readonly confirmedIndependentStaging: true
  readonly confirmedLockedHighWaterCapture: true
}

export interface SupabaseBackfillLockedHighWaterCaptureRequestV1 {
  readonly format: 'openpencil.supabase-backfill-locked-high-water-capture-request.v1'
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly reviewDigest: string
  readonly queryId: typeof SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_ID
  readonly queryVersion: typeof SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_VERSION
  readonly queryDigest: string
  readonly statementCount: 10
  readonly accessMode: 'read-write-locked-read'
  readonly snapshotScope: 'explicit-serializable-transaction'
  readonly lockMode: 'share-row-exclusive'
}

export interface SupabaseBackfillLockedHighWaterCaptureHostTransportV1 {
  runLockedHighWaterCapture(
    request: SupabaseBackfillLockedHighWaterCaptureRequestV1
  ): Promise<unknown>
}

type MaybePromise<T> = T | Promise<T>

export interface CaptureSupabaseBackfillLockedHighWaterOptionsV1 {
  readonly captureReview: SupabaseBackfillLockedHighWaterCaptureReviewEnvelopeV1
  readonly stagingTargetBinding: SupabaseStagingTargetBindingV1
  readonly confirmation: SupabaseBackfillLockedHighWaterCaptureConfirmationV1
  readonly readCurrentCompilerInput: () => MaybePromise<SupabaseBackfillLiveCatalogCompilerInputV1>
  readonly readCurrentReadAuthority: () => MaybePromise<SupabaseBackfillLiveCatalogAuthorityV1>
  readonly readCurrentWriteAuthority: () => MaybePromise<SupabaseBackfillLockedHighWaterWriteAuthorityV1>
  readonly readCurrentStagingTargetBinding: () => MaybePromise<SupabaseStagingTargetBindingV1 | null>
  readonly transport: SupabaseBackfillLockedHighWaterCaptureHostTransportV1
}

export interface SupabaseBackfillLockedHighWaterCaptureV1 {
  readonly format: typeof SUPABASE_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly releaseReady: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly sourceLedgerBound: false
  readonly databaseLedgerBound: false
  readonly bindings: Readonly<{
    subjectDigest: string
    sourceReviewDigest: string
    captureReviewDigest: string
    appliedSingleFlightKey: string
    installedVerificationDigest: string
    installDigest: string
    providerAuthorityDigest: string
    applicationId: string
    applicationDigest: string
    backendPlanDigest: string
    adapterPlanDigest: string
    manifestDigest: string
    migrationId: string
    migrationDigest: string
    catalogPreconditionDigest: string
    queryDigest: string
  }>
  readonly authority: Readonly<{
    projectRef: string
    accountId: string
    readGrantGeneration: string
    installWriteGrantGeneration: string
    captureWriteGrantGeneration: string
  }>
  readonly query: SupabaseBackfillLockedHighWaterCaptureReviewV1['query']
  readonly observedAt: string
  readonly snapshotMarker: string
  readonly serverVersionNum: string
  readonly roles: Readonly<{
    currentOid: string
    currentName: string
    currentSuperuser: boolean
    currentBypassRls: boolean
    sessionOid: string
    sessionName: string
    sessionSuperuser: boolean
    sessionBypassRls: boolean
  }>
  readonly settings: Readonly<{
    transactionIsolation: 'serializable'
    transactionReadOnly: false
    rowSecurity: false
    searchPath: 'pg_catalog'
    databasePrimary: true
  }>
  readonly address: SupabaseBackfillLockedHighWaterCaptureReviewV1['address']
  readonly highWater: Readonly<{
    status: 'captured'
    lockedCapture: true
    capturedHighWater: number | null
    minimumCursor: number | null
    totalRowCount: number
    remainingNullTargetRowCount: number
    unsafeCursorRowCount: 0
    requiredBatchReceiptCount: number
    maximumBatchReceiptCount: number
    withinReceiptCountLimit: true
  }>
  readonly receipt: Readonly<{
    mayCreate: false
    authorityCreated: false
    databaseLedgerBound: false
    futureReceiptZeroEvidenceBinding: 'captureDigest'
  }>
  readonly checks: Readonly<{
    queryBindingsMatch: true
    currentAndSessionRoleMatch: true
    fullTableReadAuthorityObserved: true
    exactAddressMatches: true
    cursorRangeSafe: true
    receiptCapacityFits: true
    allCaptureChecksPassed: true
  }>
  readonly blockers: readonly string[]
  readonly captureDigest: string
}

export type SupabaseBackfillLockedHighWaterCaptureErrorCode =
  | 'supabase-backfill-locked-high-water-input-invalid'
  | 'supabase-backfill-locked-high-water-proof-invalid'
  | 'supabase-backfill-locked-high-water-confirmation-mismatch'
  | 'supabase-backfill-locked-high-water-staging-target-mismatch'
  | 'supabase-backfill-locked-high-water-write-authority-invalid'
  | 'supabase-backfill-locked-high-water-write-authority-not-separated'
  | 'supabase-backfill-locked-high-water-input-changed'
  | 'supabase-backfill-locked-high-water-project-authority-mismatch'
  | 'supabase-backfill-locked-high-water-response-invalid'
  | 'supabase-backfill-locked-high-water-query-binding-mismatch'
  | 'supabase-backfill-locked-high-water-address-mismatch'
  | 'supabase-backfill-locked-high-water-unsafe-cursor'
  | 'supabase-backfill-locked-high-water-receipt-capacity-exceeded'
  | 'supabase-backfill-locked-high-water-transport-failed'
  | 'supabase-backfill-locked-high-water-digest-failed'

export class SupabaseBackfillLockedHighWaterCaptureError extends Error {
  constructor(readonly code: SupabaseBackfillLockedHighWaterCaptureErrorCode) {
    super(`Supabase backfill locked high-water capture failed: ${code}.`)
    this.name = 'SupabaseBackfillLockedHighWaterCaptureError'
  }
}

interface TrustedCaptureReviewContext {
  readonly envelope: SupabaseBackfillLockedHighWaterCaptureReviewEnvelopeV1
  readonly installContext: SupabaseBackfillWriteBarrierInstallDispatchContextV1
  readonly reconciliation: SupabaseBackfillWriteBarrierInstallReconciliationResultV1
  readonly applied: TrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1
  readonly captureSql: string
}

/**
 * Process-local context retained for the Receipt V2 / database-ledger boundary. The public capture
 * remains inert after serialization; only the exact factory-created identity can recover this
 * context, and only the future ledger initializer may consume it.
 */
export interface TrustedSupabaseBackfillLockedHighWaterCaptureContextV1 {
  readonly capture: SupabaseBackfillLockedHighWaterCaptureV1
  readonly subject: SupabaseBackfillInspectionSubjectV1
  readonly subjectDigest: string
}

export interface TrustedSupabaseBackfillLockedHighWaterCaptureRequestV1 {
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly captureSql: string
  readonly queryDigest: string
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

const CREATE_REVIEW_KEYS = ['context', 'reconciliation'] as const
const CAPTURE_OPTION_KEYS = [
  'captureReview',
  'stagingTargetBinding',
  'confirmation',
  'readCurrentCompilerInput',
  'readCurrentReadAuthority',
  'readCurrentWriteAuthority',
  'readCurrentStagingTargetBinding',
  'transport'
] as const
const CONFIRMATION_KEYS = [
  'reviewDigest',
  'sourceReviewDigest',
  'installedVerificationDigest',
  'queryDigest',
  'projectRefConfirmation',
  'accountIdConfirmation',
  'captureGrantGeneration',
  'confirmedIndependentStaging',
  'confirmedLockedHighWaterCapture'
] as const
const WRITE_AUTHORITY_KEYS = [
  'projectRef',
  'accountId',
  'grantGeneration',
  'scope',
  'permission'
] as const
const RESPONSE_KEYS = [
  'format',
  'version',
  'subjectDigest',
  'sourceReviewDigest',
  'appliedSingleFlightKey',
  'installedVerificationDigest',
  'projectRef',
  'accountId',
  'installGrantGeneration',
  'queryVersion',
  'accessMode',
  'snapshotScope',
  'lockMode',
  'serverVersionNum',
  'snapshotMarker',
  'observedAt',
  'roles',
  'settings',
  'address',
  'highWater'
] as const
const ROLE_KEYS = [
  'currentOid',
  'currentName',
  'currentSuperuser',
  'currentBypassRls',
  'sessionOid',
  'sessionName',
  'sessionSuperuser',
  'sessionBypassRls'
] as const
const SETTINGS_KEYS = [
  'transactionIsolation',
  'transactionReadOnly',
  'rowSecurity',
  'searchPath',
  'databasePrimary'
] as const
const ADDRESS_KEYS = [
  'schemaOid',
  'tableOid',
  'cursorSubId',
  'cursorTypeOid',
  'targetSubId',
  'targetTypeOid',
  'primaryKeyOid',
  'sequenceOid',
  'barrierConstraintOid'
] as const
const HIGH_WATER_KEYS = [
  'capturedHighWater',
  'minimumCursor',
  'totalRowCount',
  'remainingNullTargetRowCount',
  'unsafeCursorRowCount',
  'requiredBatchReceiptCount',
  'maximumBatchReceiptCount',
  'withinReceiptCountLimit'
] as const
const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const OID = /^(?:0|[1-9][0-9]{0,9})$/u
const SNAPSHOT_MARKER = /^[0-9:,]{1,512}$/u
const SUPPORTED_SERVER_VERSION = /^(?:15|16|17)[0-9]{4}$/u
const MAX_SAFE_CURSOR = Number.MAX_SAFE_INTEGER

const trustedCaptureReviewContexts = new WeakMap<object, TrustedCaptureReviewContext>()
const consumedCaptureReviews = new WeakSet<object>()
const trustedCaptureRequests = new WeakMap<
  object,
  TrustedSupabaseBackfillLockedHighWaterCaptureRequestV1
>()
const consumedCaptureRequests = new WeakSet<object>()
const trustedCaptureProofs = new WeakMap<
  object,
  TrustedSupabaseBackfillLockedHighWaterCaptureContextV1
>()
const consumedCaptureProofs = new WeakSet<object>()

function fail(code: SupabaseBackfillLockedHighWaterCaptureErrorCode): never {
  throw new SupabaseBackfillLockedHighWaterCaptureError(code)
}

function ownData(
  value: object,
  key: PropertyKey,
  code: SupabaseBackfillLockedHighWaterCaptureErrorCode
): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail(code)
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail(code)
  return descriptor.value
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: SupabaseBackfillLockedHighWaterCaptureErrorCode
): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code)
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail(code)
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail(code)
  }
  for (const key of keys) ownData(value, key, code)
  return value as UnknownRecord
}

function text(value: unknown, code: SupabaseBackfillLockedHighWaterCaptureErrorCode): string {
  if (typeof value !== 'string' || value.includes('\0') || value.length > 8_192) return fail(code)
  return value
}

function stableId(value: unknown, code: SupabaseBackfillLockedHighWaterCaptureErrorCode): string {
  const result = text(value, code)
  if (!STABLE_ID.test(result)) return fail(code)
  return result
}

function digestText(value: unknown, code: SupabaseBackfillLockedHighWaterCaptureErrorCode): string {
  const result = text(value, code)
  if (!DIGEST.test(result)) return fail(code)
  return result
}

function oid(value: unknown, code: SupabaseBackfillLockedHighWaterCaptureErrorCode): string {
  if (typeof value !== 'string' || !OID.test(value)) return fail(code)
  return value
}

function booleanValue(
  value: unknown,
  code: SupabaseBackfillLockedHighWaterCaptureErrorCode
): boolean {
  if (typeof value !== 'boolean') return fail(code)
  return value
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return fail('supabase-backfill-locked-high-water-response-invalid')
  }
  if (new Date(value).toISOString() !== value) {
    return fail('supabase-backfill-locked-high-water-response-invalid')
  }
  return value
}

function decimalBigInt(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 19 || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return fail('supabase-backfill-locked-high-water-response-invalid')
  }
  try {
    return BigInt(value)
  } catch {
    return fail('supabase-backfill-locked-high-water-response-invalid')
  }
}

function signedDecimalBigInt(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 20 || !/^(?:0|-?[1-9][0-9]*)$/u.test(value)) {
    return fail('supabase-backfill-locked-high-water-response-invalid')
  }
  try {
    return BigInt(value)
  } catch {
    return fail('supabase-backfill-locked-high-water-response-invalid')
  }
}

function positiveInteger(
  value: unknown,
  code: SupabaseBackfillLockedHighWaterCaptureErrorCode
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) return fail(code)
  return value as number
}

function safeNumber(value: bigint, code: SupabaseBackfillLockedHighWaterCaptureErrorCode): number {
  if (value > BigInt(MAX_SAFE_CURSOR)) return fail(code)
  return Number(value)
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string): string {
  return `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

function booleanSql(value: boolean): 'TRUE' | 'FALSE' {
  return value ? 'TRUE' : 'FALSE'
}

function oidSql(value: string): string {
  return `${value}::"pg_catalog"."oid"`
}

function integerSql(value: number): string {
  if (!Number.isSafeInteger(value)) return fail('supabase-backfill-locked-high-water-input-invalid')
  return String(value)
}

function equalityCount(sql: string, expected: number): string {
  return `(SELECT COUNT(*) FROM ${sql}) = ${integerSql(expected)}`
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-locked-high-water-digest-failed')
  }
}

function encodeBase64URL(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function digestSql(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-locked-high-water-digest-failed')
  }
}

function tablePredicate(inspection: SupabaseBackfillLiveCatalogInspectionV1): string {
  const { table, schema } = inspection.catalog
  return `EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_class" AS "table_entry"
      JOIN "pg_catalog"."pg_namespace" AS "schema_entry"
        ON "schema_entry"."oid" = "table_entry"."relnamespace"
      JOIN "pg_catalog"."pg_roles" AS "owner_entry"
        ON "owner_entry"."oid" = "table_entry"."relowner"
      WHERE "schema_entry"."oid" = ${oidSql(schema.oid)}
        AND "schema_entry"."nspname" = ${quoteLiteral(schema.name)}::"pg_catalog"."name"
        AND "table_entry"."oid" = ${oidSql(table.oid)}
        AND "table_entry"."relname" = ${quoteLiteral(table.name)}::"pg_catalog"."name"
        AND "table_entry"."relkind" = 'r'
        AND "table_entry"."relowner" = ${oidSql(table.ownerOid)}
        AND "owner_entry"."rolname" = ${quoteLiteral(table.ownerName)}::"pg_catalog"."name"
        AND "table_entry"."relrowsecurity" IS ${booleanSql(table.rlsEnabled)}
        AND "table_entry"."relforcerowsecurity" IS ${booleanSql(table.rlsForced)}
        AND "table_entry"."relchecks" = ${integerSql(inspection.hazards.checkConstraintCount + 1)}
        AND "pg_catalog"."obj_description"("table_entry"."oid", 'pg_class') =
          ${quoteLiteral(table.marker)}
        AND COALESCE("pg_catalog"."cardinality"("table_entry"."relacl"), 0) =
          ${integerSql(inspection.hazards.tableAclEntryCount)}
    )`
}

function cursorPredicate(inspection: SupabaseBackfillLiveCatalogInspectionV1): string {
  const cursor = inspection.catalog.cursor
  return `EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_attribute" AS "column_entry"
      JOIN "pg_catalog"."pg_type" AS "type_entry"
        ON "type_entry"."oid" = "column_entry"."atttypid"
      JOIN "pg_catalog"."pg_namespace" AS "type_schema"
        ON "type_schema"."oid" = "type_entry"."typnamespace"
      WHERE "column_entry"."attrelid" = ${oidSql(cursor.objectOid)}
        AND "column_entry"."attnum" = ${integerSql(cursor.subId)}
        AND "column_entry"."attname" = ${quoteLiteral(cursor.name)}::"pg_catalog"."name"
        AND "column_entry"."atttypid" = ${oidSql(cursor.typeOid)}
        AND "type_schema"."nspname" = ${quoteLiteral(cursor.typeSchema)}::"pg_catalog"."name"
        AND "type_entry"."typname" = ${quoteLiteral(cursor.typeName)}::"pg_catalog"."name"
        AND "column_entry"."atttypmod" = ${integerSql(cursor.typeModifier)}
        AND "column_entry"."attnotnull" IS ${booleanSql(cursor.notNull)}
        AND "column_entry"."attidentity" = ${quoteLiteral(cursor.identityKind)}::"pg_catalog"."char"
        AND "column_entry"."attgenerated" = ${quoteLiteral(cursor.generatedKind)}::"pg_catalog"."char"
        AND NOT "column_entry"."attisdropped"
        AND "pg_catalog"."col_description"(
          "column_entry"."attrelid", "column_entry"."attnum"
        ) = ${quoteLiteral(cursor.marker)}
    )`
}

function targetPredicate(inspection: SupabaseBackfillLiveCatalogInspectionV1): string {
  const target = inspection.catalog.target
  const enumValues = quoteLiteral(JSON.stringify(target.enumValues))
  const enumMarker = target.enumMarker === null ? 'IS NULL' : `= ${quoteLiteral(target.enumMarker)}`
  return `EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_attribute" AS "column_entry"
      JOIN "pg_catalog"."pg_type" AS "type_entry"
        ON "type_entry"."oid" = "column_entry"."atttypid"
      JOIN "pg_catalog"."pg_namespace" AS "type_schema"
        ON "type_schema"."oid" = "type_entry"."typnamespace"
      WHERE "column_entry"."attrelid" = ${oidSql(target.objectOid)}
        AND "column_entry"."attnum" = ${integerSql(target.subId)}
        AND "column_entry"."attname" = ${quoteLiteral(target.name)}::"pg_catalog"."name"
        AND "column_entry"."atttypid" = ${oidSql(target.typeOid)}
        AND "type_schema"."oid" = ${oidSql(target.typeSchemaOid)}
        AND "type_schema"."nspname" = ${quoteLiteral(target.typeSchema)}::"pg_catalog"."name"
        AND "type_entry"."typname" = ${quoteLiteral(target.typeName)}::"pg_catalog"."name"
        AND "type_entry"."typtype" = ${quoteLiteral(target.typeKind)}::"pg_catalog"."char"
        AND "column_entry"."atttypmod" = ${integerSql(target.typeModifier)}
        AND "column_entry"."attnotnull" IS ${booleanSql(target.notNull)}
        AND "column_entry"."attidentity" = ${quoteLiteral(target.identityKind)}::"pg_catalog"."char"
        AND "column_entry"."attgenerated" = ${quoteLiteral(target.generatedKind)}::"pg_catalog"."char"
        AND NOT "column_entry"."attisdropped"
        AND "pg_catalog"."col_description"(
          "column_entry"."attrelid", "column_entry"."attnum"
        ) = ${quoteLiteral(target.marker)}
        AND ${target.hasDefault ? '' : 'NOT '}EXISTS (
          SELECT 1 FROM "pg_catalog"."pg_attrdef" AS "column_default"
          WHERE "column_default"."adrelid" = "column_entry"."attrelid"
            AND "column_default"."adnum" = "column_entry"."attnum"
        )
        AND "pg_catalog"."obj_description"("type_entry"."oid", 'pg_type') ${enumMarker}
        AND COALESCE((
          SELECT "pg_catalog"."jsonb_agg"(
            "enum_entry"."enumlabel" ORDER BY "enum_entry"."enumsortorder"
          )
          FROM "pg_catalog"."pg_enum" AS "enum_entry"
          WHERE "enum_entry"."enumtypid" = "type_entry"."oid"
        ), '[]'::"pg_catalog"."jsonb") = ${enumValues}::"pg_catalog"."jsonb"
    )`
}

function primaryKeyPredicate(inspection: SupabaseBackfillLiveCatalogInspectionV1): string {
  const primaryKey = inspection.catalog.primaryKey
  return `EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_constraint" AS "constraint_entry"
      WHERE "constraint_entry"."oid" = ${oidSql(primaryKey.oid)}
        AND "constraint_entry"."conrelid" = ${oidSql(primaryKey.tableOid)}
        AND "constraint_entry"."conname" =
          ${quoteLiteral(primaryKey.name)}::"pg_catalog"."name"
        AND "constraint_entry"."contype" = 'p'
        AND "constraint_entry"."conkey" =
          ARRAY[${integerSql(primaryKey.cursorSubId)}]::"pg_catalog"."int2"[]
        AND "pg_catalog"."cardinality"("constraint_entry"."conkey") =
          ${integerSql(primaryKey.fieldCount)}
        AND "pg_catalog"."obj_description"("constraint_entry"."oid", 'pg_constraint') =
          ${quoteLiteral(primaryKey.marker)}
    )`
}

function sequencePredicate(inspection: SupabaseBackfillLiveCatalogInspectionV1): string {
  const sequence = inspection.catalog.sequence
  return `EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_class" AS "sequence_entry"
      JOIN "pg_catalog"."pg_namespace" AS "sequence_schema"
        ON "sequence_schema"."oid" = "sequence_entry"."relnamespace"
      JOIN "pg_catalog"."pg_sequence" AS "sequence_state"
        ON "sequence_state"."seqrelid" = "sequence_entry"."oid"
      JOIN "pg_catalog"."pg_depend" AS "sequence_dependency"
        ON "sequence_dependency"."objid" = "sequence_entry"."oid"
       AND "sequence_dependency"."classid" =
         'pg_catalog.pg_class'::"pg_catalog"."regclass"
       AND "sequence_dependency"."refclassid" =
         'pg_catalog.pg_class'::"pg_catalog"."regclass"
      WHERE "sequence_entry"."oid" = ${oidSql(sequence.oid)}
        AND "sequence_entry"."relkind" = 'S'
        AND "sequence_schema"."oid" = ${oidSql(sequence.schemaOid)}
        AND "sequence_schema"."nspname" =
          ${quoteLiteral(sequence.schema)}::"pg_catalog"."name"
        AND "sequence_entry"."relname" =
          ${quoteLiteral(sequence.name)}::"pg_catalog"."name"
        AND "sequence_dependency"."deptype" = ${quoteLiteral(sequence.dependencyType)}::"pg_catalog"."char"
        AND "sequence_dependency"."refobjid" = ${oidSql(sequence.ownedTableOid)}
        AND "sequence_dependency"."refobjsubid" = ${integerSql(sequence.ownedSubId)}
        AND "sequence_state"."seqincrement" = ${quoteLiteral(sequence.incrementBy)}::"pg_catalog"."int8"
        AND "sequence_state"."seqmin" = ${quoteLiteral(sequence.minimumValue)}::"pg_catalog"."int8"
        AND "sequence_state"."seqmax" = ${quoteLiteral(sequence.maximumValue)}::"pg_catalog"."int8"
        AND "sequence_state"."seqcache" = ${quoteLiteral(sequence.cacheSize)}::"pg_catalog"."int8"
        AND "sequence_state"."seqcycle" IS ${booleanSql(sequence.cycle)}
    )`
}

function hazardPredicates(inspection: SupabaseBackfillLiveCatalogInspectionV1): readonly string[] {
  const tableOid = oidSql(inspection.catalog.table.oid)
  const hazards = inspection.hazards
  return Object.freeze([
    equalityCount(
      `"pg_catalog"."pg_constraint" AS "entry" WHERE "entry"."conrelid" = ${tableOid} AND "entry"."contype" IN ('u', 'x')`,
      hazards.nonPrimaryUniqueOrExclusionConstraintCount
    ),
    equalityCount(
      `"pg_catalog"."pg_index" AS "entry" WHERE "entry"."indrelid" = ${tableOid} AND NOT "entry"."indisprimary"`,
      hazards.nonPrimaryIndexCount
    ),
    equalityCount(
      `"pg_catalog"."pg_index" AS "entry" WHERE "entry"."indrelid" = ${tableOid} AND ("entry"."indpred" IS NOT NULL OR "entry"."indexprs" IS NOT NULL)`,
      hazards.partialOrExpressionIndexCount
    ),
    equalityCount(
      `"pg_catalog"."pg_constraint" AS "entry" WHERE "entry"."conrelid" = ${tableOid} AND "entry"."contype" = 'c'`,
      hazards.checkConstraintCount + 1
    ),
    equalityCount(
      `"pg_catalog"."pg_constraint" AS "entry" WHERE "entry"."conrelid" = ${tableOid} AND "entry"."contype" = 'f'`,
      hazards.outboundForeignKeyConstraintCount
    ),
    equalityCount(
      `"pg_catalog"."pg_constraint" AS "entry" WHERE "entry"."confrelid" = ${tableOid} AND "entry"."contype" = 'f'`,
      hazards.inboundForeignKeyConstraintCount
    ),
    equalityCount(
      `"pg_catalog"."pg_attribute" AS "entry" WHERE "entry"."attrelid" = ${tableOid} AND "entry"."attnum" > 0 AND NOT "entry"."attisdropped" AND "entry"."attgenerated" <> ''`,
      hazards.generatedColumnCount
    ),
    equalityCount(
      `"pg_catalog"."pg_inherits" AS "entry" WHERE "entry"."inhrelid" = ${tableOid} OR "entry"."inhparent" = ${tableOid}`,
      hazards.inheritanceRelationCount
    ),
    equalityCount(
      `"pg_catalog"."pg_trigger" AS "entry" WHERE "entry"."tgrelid" = ${tableOid} AND NOT "entry"."tgisinternal"`,
      hazards.userTriggerCount
    ),
    equalityCount(
      `"pg_catalog"."pg_rewrite" AS "entry" WHERE "entry"."ev_class" = ${tableOid} AND "entry"."rulename" <> '_RETURN'`,
      hazards.userRuleCount
    ),
    equalityCount(
      `"pg_catalog"."pg_policy" AS "entry" WHERE "entry"."polrelid" = ${tableOid}`,
      hazards.policyCount
    ),
    equalityCount(
      `"pg_catalog"."pg_publication_rel" AS "entry" WHERE "entry"."prrelid" = ${tableOid}`,
      hazards.publicationMembershipCount
    ),
    equalityCount(
      `"pg_catalog"."pg_attribute" AS "entry" WHERE "entry"."attrelid" = ${tableOid} AND "entry"."attnum" > 0 AND NOT "entry"."attisdropped" AND "entry"."attacl" IS NOT NULL`,
      hazards.columnAclCount
    )
  ])
}

function barrierPredicates(
  applied: TrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1
): readonly string[] {
  const review = applied.sourceReview.review
  const tableOid = oidSql(review.address.tableOid)
  const targetSubId = integerSql(review.address.targetSubId)
  const constraintOid = oidSql(applied.installedEvidence.constraintOid)
  const constraintName = quoteLiteral(review.barrier.constraintName)
  const marker = quoteLiteral(review.barrier.marker)
  const target = quoteLiteral(review.address.targetField)
  return Object.freeze([
    `EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_constraint" AS "constraint_entry"
      WHERE "constraint_entry"."oid" = ${constraintOid}
        AND "constraint_entry"."conrelid" = ${tableOid}
        AND "constraint_entry"."conname" = ${constraintName}::"pg_catalog"."name"
        AND "constraint_entry"."contype" = 'c'
        AND "constraint_entry"."conkey" = ARRAY[${targetSubId}]::"pg_catalog"."int2"[]
        AND "constraint_entry"."contypid" = 0
        AND "constraint_entry"."conindid" = 0
        AND "constraint_entry"."confrelid" = 0
        AND "constraint_entry"."conparentid" = 0
        AND NOT "constraint_entry"."condeferrable"
        AND NOT "constraint_entry"."condeferred"
        AND NOT "constraint_entry"."convalidated"
        AND "constraint_entry"."connoinherit"
        AND "constraint_entry"."conislocal"
        AND "constraint_entry"."coninhcount" = 0
        AND "constraint_entry"."conbin" IS NOT NULL
        AND "pg_catalog"."pg_get_expr"(
          "constraint_entry"."conbin", "constraint_entry"."conrelid", FALSE
        ) = "pg_catalog"."format"('(%I IS NOT NULL)', ${target})
        AND "pg_catalog"."obj_description"(
          "constraint_entry"."oid", 'pg_constraint'
        ) = ${marker}
    )`,
    `(SELECT COUNT(*) FROM "pg_catalog"."pg_constraint" AS "entry"
      WHERE "entry"."conrelid" = ${tableOid}
        AND "entry"."conname" = ${constraintName}::"pg_catalog"."name") = 1`,
    `(SELECT COUNT(*) FROM "pg_catalog"."pg_constraint" AS "entry"
      WHERE "pg_catalog"."obj_description"(
        "entry"."oid", 'pg_constraint'
      ) = ${marker}) = 1`
  ])
}

function lockedCaptureSql(
  applied: TrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1
): string {
  const inspection = applied.inspection
  const subject = applied.subject
  const review = applied.sourceReview.review
  const qualifiedTable = `${quoteIdentifier('public')}.${quoteIdentifier(
    inspection.catalog.table.name
  )}`
  const cursor = quoteIdentifier(inspection.catalog.cursor.name)
  const target = quoteIdentifier(inspection.catalog.target.name)
  const batchSize = integerSql(subject.migration.batchSize)
  const maximumBatchReceiptCount = integerSql(subject.migration.maximumBatchReceiptCount)
  const maxSafeCursor = integerSql(MAX_SAFE_CURSOR)
  const predicates = [
    `"pg_catalog"."current_setting"('transaction_isolation') = 'serializable'`,
    `"pg_catalog"."current_setting"('transaction_read_only') = 'off'`,
    `"pg_catalog"."current_setting"('row_security') = 'off'`,
    `"pg_catalog"."current_setting"('search_path') = 'pg_catalog'`,
    `"pg_catalog"."current_setting"('server_version_num') = ${quoteLiteral(
      applied.installedEvidence.serverVersionNum
    )}`,
    `CURRENT_USER = SESSION_USER`,
    `NOT "pg_catalog"."pg_is_in_recovery"()`,
    tablePredicate(inspection),
    cursorPredicate(inspection),
    targetPredicate(inspection),
    primaryKeyPredicate(inspection),
    sequencePredicate(inspection),
    ...hazardPredicates(inspection),
    ...barrierPredicates(applied)
  ]
  return [
    '-- OpenPencil Supabase locked high-water capture v1.',
    '-- Host-dispatch only. Lock and all catalog rechecks precede the first read.',
    '-- This captures evidence only; it creates no Receipt, ledger, or runner authority.',
    'BEGIN;',
    'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
    'SET LOCAL search_path = pg_catalog;',
    'SET LOCAL row_security = off;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '15s';",
    `LOCK TABLE ONLY ${qualifiedTable} IN SHARE ROW EXCLUSIVE MODE;`,
    'DO $openpencil$',
    'DECLARE',
    '  "catalog_ready" "pg_catalog"."bool";',
    'BEGIN',
    '  SELECT',
    predicates.map((predicate, index) => `    ${index === 0 ? '' : 'AND '}${predicate}`).join('\n'),
    '  INTO "catalog_ready";',
    '  IF "catalog_ready" IS DISTINCT FROM TRUE THEN',
    "    RAISE EXCEPTION USING ERRCODE = 'P0001',",
    "      MESSAGE = 'OpenPencil locked high-water catalog precondition failed';",
    '  END IF;',
    'END',
    '$openpencil$;',
    'SELECT',
    `  ${quoteLiteral(SUPABASE_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_FORMAT)}::"pg_catalog"."text" AS "format",`,
    '  1::"pg_catalog"."int4" AS "version",',
    `  ${quoteLiteral(review.bindings.subjectDigest)}::"pg_catalog"."text" AS "subjectDigest",`,
    `  ${quoteLiteral(applied.sourceReview.reviewDigest)}::"pg_catalog"."text" AS "sourceReviewDigest",`,
    `  ${quoteLiteral(applied.result.singleFlightKey)}::"pg_catalog"."text" AS "appliedSingleFlightKey",`,
    `  ${quoteLiteral(applied.installedEvidence.verificationDigest)}::"pg_catalog"."text" AS "installedVerificationDigest",`,
    `  ${quoteLiteral(applied.writeAuthority.projectRef)}::"pg_catalog"."text" AS "projectRef",`,
    `  ${quoteLiteral(applied.writeAuthority.accountId)}::"pg_catalog"."text" AS "accountId",`,
    `  ${quoteLiteral(applied.writeAuthority.grantGeneration)}::"pg_catalog"."text" AS "installGrantGeneration",`,
    `  ${quoteLiteral(SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_VERSION)}::"pg_catalog"."text" AS "queryVersion",`,
    `  'read-write-locked-read'::"pg_catalog"."text" AS "accessMode",`,
    `  'explicit-serializable-transaction'::"pg_catalog"."text" AS "snapshotScope",`,
    `  'share-row-exclusive'::"pg_catalog"."text" AS "lockMode",`,
    `  "pg_catalog"."current_setting"('server_version_num') AS "serverVersionNum",`,
    `  "pg_catalog"."txid_current_snapshot"()::"pg_catalog"."text" AS "snapshotMarker",`,
    '  "pg_catalog"."to_char"(',
    '    "pg_catalog"."clock_timestamp"() AT TIME ZONE \'UTC\',',
    `    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`,
    '  ) AS "observedAt",',
    '  "pg_catalog"."jsonb_build_object"(',
    `    'currentOid', (SELECT "oid"::"pg_catalog"."text" FROM "pg_catalog"."pg_roles" WHERE "rolname" = CURRENT_USER),`,
    `    'currentName', CURRENT_USER::"pg_catalog"."text",`,
    `    'currentSuperuser', (SELECT "rolsuper" FROM "pg_catalog"."pg_roles" WHERE "rolname" = CURRENT_USER),`,
    `    'currentBypassRls', (SELECT "rolbypassrls" FROM "pg_catalog"."pg_roles" WHERE "rolname" = CURRENT_USER),`,
    `    'sessionOid', (SELECT "oid"::"pg_catalog"."text" FROM "pg_catalog"."pg_roles" WHERE "rolname" = SESSION_USER),`,
    `    'sessionName', SESSION_USER::"pg_catalog"."text",`,
    `    'sessionSuperuser', (SELECT "rolsuper" FROM "pg_catalog"."pg_roles" WHERE "rolname" = SESSION_USER),`,
    `    'sessionBypassRls', (SELECT "rolbypassrls" FROM "pg_catalog"."pg_roles" WHERE "rolname" = SESSION_USER)`,
    '  ) AS "roles",',
    '  "pg_catalog"."jsonb_build_object"(',
    `    'transactionIsolation', "pg_catalog"."current_setting"('transaction_isolation'),`,
    `    'transactionReadOnly', "pg_catalog"."current_setting"('transaction_read_only') = 'on',`,
    `    'rowSecurity', "pg_catalog"."current_setting"('row_security') = 'on',`,
    `    'searchPath', "pg_catalog"."current_setting"('search_path'),`,
    `    'databasePrimary', NOT "pg_catalog"."pg_is_in_recovery"()`,
    '  ) AS "settings",',
    '  "pg_catalog"."jsonb_build_object"(',
    `    'schemaOid', ${quoteLiteral(review.address.schemaOid)}::"pg_catalog"."text",`,
    `    'tableOid', ${quoteLiteral(review.address.tableOid)}::"pg_catalog"."text",`,
    `    'cursorSubId', ${integerSql(review.address.cursorSubId)},`,
    `    'cursorTypeOid', ${quoteLiteral(review.address.cursorTypeOid)}::"pg_catalog"."text",`,
    `    'targetSubId', ${integerSql(review.address.targetSubId)},`,
    `    'targetTypeOid', ${quoteLiteral(review.address.targetTypeOid)}::"pg_catalog"."text",`,
    `    'primaryKeyOid', ${quoteLiteral(inspection.catalog.primaryKey.oid)}::"pg_catalog"."text",`,
    `    'sequenceOid', ${quoteLiteral(review.address.sequenceOid)}::"pg_catalog"."text",`,
    `    'barrierConstraintOid', ${quoteLiteral(applied.installedEvidence.constraintOid)}::"pg_catalog"."text"`,
    '  ) AS "address",',
    '  "pg_catalog"."jsonb_build_object"(',
    `    'capturedHighWater', MAX(${cursor})::"pg_catalog"."text",`,
    `    'minimumCursor', MIN(${cursor})::"pg_catalog"."text",`,
    `    'totalRowCount', COUNT(*)::"pg_catalog"."text",`,
    `    'remainingNullTargetRowCount', COUNT(*) FILTER (WHERE ${target} IS NULL)::"pg_catalog"."text",`,
    `    'unsafeCursorRowCount', COUNT(*) FILTER (WHERE ${cursor} < 0 OR ${cursor} > ${maxSafeCursor})::"pg_catalog"."text",`,
    `    'requiredBatchReceiptCount', CEIL(COUNT(*)::"pg_catalog"."numeric" / ${batchSize})::"pg_catalog"."int8"::"pg_catalog"."text",`,
    `    'maximumBatchReceiptCount', ${quoteLiteral(maximumBatchReceiptCount)}::"pg_catalog"."text",`,
    `    'withinReceiptCountLimit', CEIL(COUNT(*)::"pg_catalog"."numeric" / ${batchSize}) <= ${maximumBatchReceiptCount}`,
    '  ) AS "highWater"',
    `FROM ${qualifiedTable};`,
    'COMMIT;',
    ''
  ].join('\n')
}

function reviewOptions(
  value: unknown
): CreateSupabaseBackfillLockedHighWaterCaptureReviewOptionsV1 {
  const source = exactRecord(
    value,
    CREATE_REVIEW_KEYS,
    'supabase-backfill-locked-high-water-input-invalid'
  )
  const context = ownData(source, 'context', 'supabase-backfill-locked-high-water-input-invalid')
  const reconciliation = ownData(
    source,
    'reconciliation',
    'supabase-backfill-locked-high-water-input-invalid'
  )
  if (
    context === null ||
    typeof context !== 'object' ||
    reconciliation === null ||
    typeof reconciliation !== 'object'
  ) {
    return fail('supabase-backfill-locked-high-water-input-invalid')
  }
  return Object.freeze({
    context: context as SupabaseBackfillWriteBarrierInstallDispatchContextV1,
    reconciliation: reconciliation as SupabaseBackfillWriteBarrierInstallReconciliationResultV1
  })
}

function captureReviewBlockers(): readonly string[] {
  return Object.freeze([
    'locked-high-water-not-captured',
    'management-query-transaction-result-contract-not-staging-verified',
    'runtime-sequence-and-cursor-mutation-authority-not-inspected',
    'live-schema-object-identity-and-catalog-digest-not-bound-per-batch',
    'runtime-table-policy-trigger-rule-function-and-acl-authority-not-inspected',
    'trusted-read-only-query-authority-not-bound',
    'p1-unbounded-staged-backfill-path-not-retired',
    'provider-v2-receipt-binding-not-implemented',
    'database-batch-ledger-not-implemented',
    'source-ledger-artifact-authority-binding-not-implemented',
    'trusted-live-dry-run-and-postconditions-not-executed',
    'execution-runner-unavailable'
  ])
}

function capturedBlockers(): readonly string[] {
  return Object.freeze(
    captureReviewBlockers().filter((blocker) => blocker !== 'locked-high-water-not-captured')
  )
}

/** Build deterministic lock-bound SQL from one genuine applied reconciliation without consuming it. */
export async function createSupabaseBackfillLockedHighWaterCaptureReviewV1(
  input: CreateSupabaseBackfillLockedHighWaterCaptureReviewOptionsV1
): Promise<SupabaseBackfillLockedHighWaterCaptureReviewEnvelopeV1> {
  const options = reviewOptions(input)
  const applied = trustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(
    options.reconciliation,
    options.context
  )
  if (!applied) return fail('supabase-backfill-locked-high-water-proof-invalid')
  const captureSql = lockedCaptureSql(applied)
  const queryDigest = await digestSql(captureSql)
  const source = applied.sourceReview.review
  const reviewWithoutDigest = Object.freeze({
    format: SUPABASE_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_REVIEW_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    environmentVerified: false as const,
    reviewOnly: true as const,
    captureAvailable: false as const,
    releaseReady: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    bindings: Object.freeze({
      subjectDigest: source.bindings.subjectDigest,
      sourceReviewDigest: applied.sourceReview.reviewDigest,
      appliedSingleFlightKey: applied.result.singleFlightKey,
      installedVerificationDigest: applied.installedEvidence.verificationDigest,
      installDigest: applied.context.installDigest,
      providerAuthorityDigest: source.bindings.providerAuthorityDigest,
      applicationDigest: source.bindings.applicationDigest,
      backendPlanDigest: source.bindings.backendPlanDigest,
      adapterPlanDigest: source.bindings.adapterPlanDigest,
      manifestDigest: source.bindings.manifestDigest,
      migrationDigest: source.bindings.migrationDigest,
      catalogPreconditionDigest: source.bindings.catalogPreconditionDigest,
      queryDigest
    }),
    authority: Object.freeze({
      projectRef: source.authority.projectRef,
      accountId: source.authority.accountId,
      readGrantGeneration: source.authority.grantGeneration,
      installWriteGrantGeneration: applied.writeAuthority.grantGeneration
    }),
    address: Object.freeze({
      schemaName: source.address.schemaName,
      schemaOid: source.address.schemaOid,
      tableName: source.address.tableName,
      tableOid: source.address.tableOid,
      cursorField: source.address.cursorField,
      cursorSubId: source.address.cursorSubId,
      cursorTypeOid: source.address.cursorTypeOid,
      targetField: source.address.targetField,
      targetSubId: source.address.targetSubId,
      targetTypeOid: source.address.targetTypeOid,
      primaryKeyOid: applied.inspection.catalog.primaryKey.oid,
      sequenceOid: source.address.sequenceOid,
      barrierConstraintOid: applied.installedEvidence.constraintOid
    }),
    barrier: Object.freeze({
      constraintName: source.barrier.constraintName,
      marker: source.barrier.marker,
      constraintOid: applied.installedEvidence.constraintOid,
      installedVerificationDigest: applied.installedEvidence.verificationDigest
    }),
    query: Object.freeze({
      id: SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_ID,
      version: SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_VERSION,
      digest: queryDigest,
      statementCount: 10 as const,
      accessMode: 'read-write-locked-read' as const,
      snapshotScope: 'explicit-serializable-transaction' as const,
      lockMode: 'share-row-exclusive' as const,
      containsCatalogRead: true as const,
      containsManagedDataRead: true as const,
      containsDml: false as const,
      performsSchemaChange: false as const
    }),
    artifact: Object.freeze({
      path: SUPABASE_BACKFILL_LOCKED_HIGH_WATER_ARTIFACT_PATH,
      kind: 'database-locked-read-review' as const,
      mediaType: 'application/sql; charset=utf-8' as const,
      byteLength: new TextEncoder().encode(captureSql).byteLength,
      digest: queryDigest,
      mutationDispatched: false as const,
      hostDispatchAvailable: false as const
    }),
    highWater: Object.freeze({
      status: 'not-captured' as const,
      lockedCapture: false as const,
      environmentSpecific: true as const
    }),
    receipt: Object.freeze({
      mayCreate: false as const,
      authorityCreated: false as const,
      databaseLedgerBound: false as const
    }),
    executionPolicy: SUPABASE_BACKFILL_LOCKED_HIGH_WATER_EXECUTION_POLICY,
    blockers: captureReviewBlockers()
  }) satisfies SupabaseBackfillLockedHighWaterCaptureReviewV1
  const reviewDigest = await digest(reviewWithoutDigest)
  const envelope = Object.freeze({ review: reviewWithoutDigest, reviewDigest, captureSql })
  trustedCaptureReviewContexts.set(
    envelope,
    Object.freeze({
      envelope,
      installContext: options.context,
      reconciliation: options.reconciliation,
      applied,
      captureSql
    })
  )
  return envelope
}

function confirmationSnapshot(
  value: unknown
): SupabaseBackfillLockedHighWaterCaptureConfirmationV1 {
  const source = exactRecord(
    value,
    CONFIRMATION_KEYS,
    'supabase-backfill-locked-high-water-input-invalid'
  )
  const result = Object.freeze({
    reviewDigest: digestText(
      ownData(source, 'reviewDigest', 'supabase-backfill-locked-high-water-input-invalid'),
      'supabase-backfill-locked-high-water-input-invalid'
    ),
    sourceReviewDigest: digestText(
      ownData(source, 'sourceReviewDigest', 'supabase-backfill-locked-high-water-input-invalid'),
      'supabase-backfill-locked-high-water-input-invalid'
    ),
    installedVerificationDigest: digestText(
      ownData(
        source,
        'installedVerificationDigest',
        'supabase-backfill-locked-high-water-input-invalid'
      ),
      'supabase-backfill-locked-high-water-input-invalid'
    ),
    queryDigest: digestText(
      ownData(source, 'queryDigest', 'supabase-backfill-locked-high-water-input-invalid'),
      'supabase-backfill-locked-high-water-input-invalid'
    ),
    projectRefConfirmation: text(
      ownData(
        source,
        'projectRefConfirmation',
        'supabase-backfill-locked-high-water-input-invalid'
      ),
      'supabase-backfill-locked-high-water-input-invalid'
    ),
    accountIdConfirmation: stableId(
      ownData(source, 'accountIdConfirmation', 'supabase-backfill-locked-high-water-input-invalid'),
      'supabase-backfill-locked-high-water-input-invalid'
    ),
    captureGrantGeneration: stableId(
      ownData(
        source,
        'captureGrantGeneration',
        'supabase-backfill-locked-high-water-input-invalid'
      ),
      'supabase-backfill-locked-high-water-input-invalid'
    ),
    confirmedIndependentStaging: ownData(
      source,
      'confirmedIndependentStaging',
      'supabase-backfill-locked-high-water-input-invalid'
    ),
    confirmedLockedHighWaterCapture: ownData(
      source,
      'confirmedLockedHighWaterCapture',
      'supabase-backfill-locked-high-water-input-invalid'
    )
  })
  if (
    !PROJECT_REF.test(result.projectRefConfirmation) ||
    result.confirmedIndependentStaging !== true ||
    result.confirmedLockedHighWaterCapture !== true
  ) {
    return fail('supabase-backfill-locked-high-water-input-invalid')
  }
  return result as SupabaseBackfillLockedHighWaterCaptureConfirmationV1
}

function captureOptions(value: unknown): CaptureSupabaseBackfillLockedHighWaterOptionsV1 {
  const source = exactRecord(
    value,
    CAPTURE_OPTION_KEYS,
    'supabase-backfill-locked-high-water-input-invalid'
  )
  const captureReview = ownData(
    source,
    'captureReview',
    'supabase-backfill-locked-high-water-input-invalid'
  )
  const stagingTargetBinding = ownData(
    source,
    'stagingTargetBinding',
    'supabase-backfill-locked-high-water-input-invalid'
  )
  const readCurrentCompilerInput = ownData(
    source,
    'readCurrentCompilerInput',
    'supabase-backfill-locked-high-water-input-invalid'
  )
  const readCurrentReadAuthority = ownData(
    source,
    'readCurrentReadAuthority',
    'supabase-backfill-locked-high-water-input-invalid'
  )
  const readCurrentWriteAuthority = ownData(
    source,
    'readCurrentWriteAuthority',
    'supabase-backfill-locked-high-water-input-invalid'
  )
  const readCurrentStagingTargetBinding = ownData(
    source,
    'readCurrentStagingTargetBinding',
    'supabase-backfill-locked-high-water-input-invalid'
  )
  const transport = ownData(
    source,
    'transport',
    'supabase-backfill-locked-high-water-input-invalid'
  )
  if (
    captureReview === null ||
    typeof captureReview !== 'object' ||
    typeof readCurrentCompilerInput !== 'function' ||
    typeof readCurrentReadAuthority !== 'function' ||
    typeof readCurrentWriteAuthority !== 'function' ||
    typeof readCurrentStagingTargetBinding !== 'function' ||
    transport === null ||
    typeof transport !== 'object'
  ) {
    return fail('supabase-backfill-locked-high-water-input-invalid')
  }
  let stagingTarget: SupabaseStagingTargetBindingV1
  try {
    stagingTarget = parseSupabaseStagingTargetBinding(stagingTargetBinding)
  } catch {
    return fail('supabase-backfill-locked-high-water-staging-target-mismatch')
  }
  return Object.freeze({
    captureReview: captureReview as SupabaseBackfillLockedHighWaterCaptureReviewEnvelopeV1,
    stagingTargetBinding: stagingTarget,
    confirmation: confirmationSnapshot(
      ownData(source, 'confirmation', 'supabase-backfill-locked-high-water-input-invalid')
    ),
    readCurrentCompilerInput:
      readCurrentCompilerInput as CaptureSupabaseBackfillLockedHighWaterOptionsV1['readCurrentCompilerInput'],
    readCurrentReadAuthority:
      readCurrentReadAuthority as CaptureSupabaseBackfillLockedHighWaterOptionsV1['readCurrentReadAuthority'],
    readCurrentWriteAuthority:
      readCurrentWriteAuthority as CaptureSupabaseBackfillLockedHighWaterOptionsV1['readCurrentWriteAuthority'],
    readCurrentStagingTargetBinding:
      readCurrentStagingTargetBinding as CaptureSupabaseBackfillLockedHighWaterOptionsV1['readCurrentStagingTargetBinding'],
    transport: transport as SupabaseBackfillLockedHighWaterCaptureHostTransportV1
  })
}

function readAuthoritySnapshot(value: unknown): SupabaseBackfillLiveCatalogAuthorityV1 {
  const source = exactRecord(
    value,
    ['projectRef', 'accountId', 'grantGeneration'],
    'supabase-backfill-locked-high-water-input-invalid'
  )
  const projectRef = ownData(
    source,
    'projectRef',
    'supabase-backfill-locked-high-water-input-invalid'
  )
  if (typeof projectRef !== 'string' || !PROJECT_REF.test(projectRef)) {
    return fail('supabase-backfill-locked-high-water-input-invalid')
  }
  return Object.freeze({
    projectRef,
    accountId: stableId(
      ownData(source, 'accountId', 'supabase-backfill-locked-high-water-input-invalid'),
      'supabase-backfill-locked-high-water-input-invalid'
    ),
    grantGeneration: stableId(
      ownData(source, 'grantGeneration', 'supabase-backfill-locked-high-water-input-invalid'),
      'supabase-backfill-locked-high-water-input-invalid'
    )
  })
}

function writeAuthoritySnapshot(value: unknown): SupabaseBackfillLockedHighWaterWriteAuthorityV1 {
  const source = exactRecord(
    value,
    WRITE_AUTHORITY_KEYS,
    'supabase-backfill-locked-high-water-write-authority-invalid'
  )
  const projectRef = ownData(
    source,
    'projectRef',
    'supabase-backfill-locked-high-water-write-authority-invalid'
  )
  const scope = ownData(
    source,
    'scope',
    'supabase-backfill-locked-high-water-write-authority-invalid'
  )
  const permission = ownData(
    source,
    'permission',
    'supabase-backfill-locked-high-water-write-authority-invalid'
  )
  if (
    typeof projectRef !== 'string' ||
    !PROJECT_REF.test(projectRef) ||
    scope !== 'database:write' ||
    permission !== 'database_write'
  ) {
    return fail('supabase-backfill-locked-high-water-write-authority-invalid')
  }
  return Object.freeze({
    projectRef,
    accountId: stableId(
      ownData(source, 'accountId', 'supabase-backfill-locked-high-water-write-authority-invalid'),
      'supabase-backfill-locked-high-water-write-authority-invalid'
    ),
    grantGeneration: stableId(
      ownData(
        source,
        'grantGeneration',
        'supabase-backfill-locked-high-water-write-authority-invalid'
      ),
      'supabase-backfill-locked-high-water-write-authority-invalid'
    ),
    scope: 'database:write' as const,
    permission: 'database_write' as const
  })
}

function sameReadAuthority(
  left: SupabaseBackfillLiveCatalogAuthorityV1,
  right: SupabaseBackfillLiveCatalogAuthorityV1
): boolean {
  return (
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.grantGeneration === right.grantGeneration
  )
}

function sameWriteAuthority(
  left: SupabaseBackfillLockedHighWaterWriteAuthorityV1,
  right: SupabaseBackfillLockedHighWaterWriteAuthorityV1
): boolean {
  return (
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.grantGeneration === right.grantGeneration
  )
}

function sameStagingTarget(
  left: SupabaseStagingTargetBindingV1,
  right: SupabaseStagingTargetBindingV1
): boolean {
  return (
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.boundAt === right.boundAt
  )
}

interface LiveCaptureBinding {
  readonly subject: SupabaseBackfillInspectionSubjectEnvelopeV1
  readonly readAuthority: SupabaseBackfillLiveCatalogAuthorityV1
  readonly writeAuthority: SupabaseBackfillLockedHighWaterWriteAuthorityV1
  readonly stagingTarget: SupabaseStagingTargetBindingV1
}

async function liveCaptureBinding(
  options: CaptureSupabaseBackfillLockedHighWaterOptionsV1
): Promise<LiveCaptureBinding> {
  try {
    const compilerInput = await options.readCurrentCompilerInput()
    const readAuthority = readAuthoritySnapshot(await options.readCurrentReadAuthority())
    const writeAuthority = writeAuthoritySnapshot(await options.readCurrentWriteAuthority())
    const rawStagingTarget = await options.readCurrentStagingTargetBinding()
    if (rawStagingTarget === null) {
      return fail('supabase-backfill-locked-high-water-staging-target-mismatch')
    }
    const stagingTarget = parseSupabaseStagingTargetBinding(rawStagingTarget)
    const subject = createSupabaseBackfillInspectionSubjectV1(compilerInput.registry, {
      plan: compilerInput.plan,
      selection: compilerInput.selection
    })
    return Object.freeze({ subject, readAuthority, writeAuthority, stagingTarget })
  } catch (cause) {
    if (cause instanceof SupabaseBackfillLockedHighWaterCaptureError) throw cause
    return fail('supabase-backfill-locked-high-water-input-invalid')
  }
}

function requireLiveCaptureBinding(
  live: LiveCaptureBinding,
  context: TrustedCaptureReviewContext,
  expectedWriteAuthority: SupabaseBackfillLockedHighWaterWriteAuthorityV1,
  stagingTarget: SupabaseStagingTargetBindingV1
): void {
  const source = context.applied.sourceReview.review
  if (
    live.subject.subjectDigest !== source.bindings.subjectDigest ||
    live.subject.subject.providerAuthority.digest !== source.bindings.providerAuthorityDigest ||
    !sameReadAuthority(live.readAuthority, source.authority) ||
    !sameWriteAuthority(live.writeAuthority, expectedWriteAuthority) ||
    !sameStagingTarget(live.stagingTarget, stagingTarget)
  ) {
    fail('supabase-backfill-locked-high-water-input-changed')
  }
}

function requireConfirmation(
  context: TrustedCaptureReviewContext,
  stagingTarget: SupabaseStagingTargetBindingV1,
  confirmation: SupabaseBackfillLockedHighWaterCaptureConfirmationV1
): void {
  const review = context.envelope
  const source = context.applied.sourceReview
  if (
    confirmation.reviewDigest !== review.reviewDigest ||
    confirmation.sourceReviewDigest !== source.reviewDigest ||
    confirmation.installedVerificationDigest !==
      context.applied.installedEvidence.verificationDigest ||
    confirmation.queryDigest !== review.review.query.digest ||
    confirmation.projectRefConfirmation !== source.review.authority.projectRef ||
    confirmation.accountIdConfirmation !== source.review.authority.accountId ||
    stagingTarget.projectRef !== source.review.authority.projectRef ||
    stagingTarget.accountId !== source.review.authority.accountId
  ) {
    fail('supabase-backfill-locked-high-water-confirmation-mismatch')
  }
}

function captureRequest(
  context: TrustedCaptureReviewContext,
  writeAuthority: SupabaseBackfillLockedHighWaterWriteAuthorityV1
): SupabaseBackfillLockedHighWaterCaptureRequestV1 {
  const request = Object.freeze({
    format: 'openpencil.supabase-backfill-locked-high-water-capture-request.v1' as const,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    projectRef: writeAuthority.projectRef,
    accountId: writeAuthority.accountId,
    grantGeneration: writeAuthority.grantGeneration,
    reviewDigest: context.envelope.reviewDigest,
    queryId: SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_ID,
    queryVersion: SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_VERSION,
    queryDigest: context.envelope.review.query.digest,
    statementCount: 10 as const,
    accessMode: 'read-write-locked-read' as const,
    snapshotScope: 'explicit-serializable-transaction' as const,
    lockMode: 'share-row-exclusive' as const
  }) satisfies SupabaseBackfillLockedHighWaterCaptureRequestV1
  trustedCaptureRequests.set(
    request,
    Object.freeze({
      projectRef: writeAuthority.projectRef,
      accountId: writeAuthority.accountId,
      grantGeneration: writeAuthority.grantGeneration,
      captureSql: context.captureSql,
      queryDigest: context.envelope.review.query.digest
    })
  )
  return request
}

function parseRoles(value: unknown) {
  const code = 'supabase-backfill-locked-high-water-response-invalid' as const
  const source = exactRecord(value, ROLE_KEYS, code)
  const parsed = Object.freeze({
    currentOid: oid(ownData(source, 'currentOid', code), code),
    currentName: stableId(ownData(source, 'currentName', code), code),
    currentSuperuser: booleanValue(ownData(source, 'currentSuperuser', code), code),
    currentBypassRls: booleanValue(ownData(source, 'currentBypassRls', code), code),
    sessionOid: oid(ownData(source, 'sessionOid', code), code),
    sessionName: stableId(ownData(source, 'sessionName', code), code),
    sessionSuperuser: booleanValue(ownData(source, 'sessionSuperuser', code), code),
    sessionBypassRls: booleanValue(ownData(source, 'sessionBypassRls', code), code)
  })
  if (
    parsed.currentOid !== parsed.sessionOid ||
    parsed.currentName !== parsed.sessionName ||
    parsed.currentSuperuser !== parsed.sessionSuperuser ||
    parsed.currentBypassRls !== parsed.sessionBypassRls ||
    (!parsed.currentSuperuser && !parsed.currentBypassRls)
  ) {
    return fail(code)
  }
  return parsed
}

function parseSettings(value: unknown) {
  const code = 'supabase-backfill-locked-high-water-response-invalid' as const
  const source = exactRecord(value, SETTINGS_KEYS, code)
  const parsed = Object.freeze({
    transactionIsolation: ownData(source, 'transactionIsolation', code),
    transactionReadOnly: booleanValue(ownData(source, 'transactionReadOnly', code), code),
    rowSecurity: booleanValue(ownData(source, 'rowSecurity', code), code),
    searchPath: ownData(source, 'searchPath', code),
    databasePrimary: booleanValue(ownData(source, 'databasePrimary', code), code)
  })
  if (
    parsed.transactionIsolation !== 'serializable' ||
    parsed.transactionReadOnly ||
    parsed.rowSecurity ||
    parsed.searchPath !== 'pg_catalog' ||
    !parsed.databasePrimary
  ) {
    return fail(code)
  }
  return parsed as SupabaseBackfillLockedHighWaterCaptureV1['settings']
}

function parseAddress(
  value: unknown,
  expected: SupabaseBackfillLockedHighWaterCaptureReviewV1['address']
): SupabaseBackfillLockedHighWaterCaptureReviewV1['address'] {
  const code = 'supabase-backfill-locked-high-water-response-invalid' as const
  const source = exactRecord(value, ADDRESS_KEYS, code)
  const parsed = Object.freeze({
    schemaName: 'public' as const,
    schemaOid: oid(ownData(source, 'schemaOid', code), code),
    tableName: expected.tableName,
    tableOid: oid(ownData(source, 'tableOid', code), code),
    cursorField: expected.cursorField,
    cursorSubId: positiveInteger(ownData(source, 'cursorSubId', code), code),
    cursorTypeOid: oid(ownData(source, 'cursorTypeOid', code), code),
    targetField: expected.targetField,
    targetSubId: positiveInteger(ownData(source, 'targetSubId', code), code),
    targetTypeOid: oid(ownData(source, 'targetTypeOid', code), code),
    primaryKeyOid: oid(ownData(source, 'primaryKeyOid', code), code),
    sequenceOid: oid(ownData(source, 'sequenceOid', code), code),
    barrierConstraintOid: oid(ownData(source, 'barrierConstraintOid', code), code)
  })
  if (
    Object.entries(parsed).some(([key, entry]) => expected[key as keyof typeof expected] !== entry)
  ) {
    return fail('supabase-backfill-locked-high-water-address-mismatch')
  }
  return parsed
}

function nullableCursor(value: unknown): bigint | null {
  return value === null ? null : signedDecimalBigInt(value)
}

function parseHighWater(
  value: unknown,
  subject: SupabaseBackfillInspectionSubjectV1
): SupabaseBackfillLockedHighWaterCaptureV1['highWater'] {
  const code = 'supabase-backfill-locked-high-water-response-invalid' as const
  const source = exactRecord(value, HIGH_WATER_KEYS, code)
  const capturedHighWater = nullableCursor(ownData(source, 'capturedHighWater', code))
  const minimumCursor = nullableCursor(ownData(source, 'minimumCursor', code))
  const totalRowCount = decimalBigInt(ownData(source, 'totalRowCount', code))
  const remainingNullTargetRowCount = decimalBigInt(
    ownData(source, 'remainingNullTargetRowCount', code)
  )
  const unsafeCursorRowCount = decimalBigInt(ownData(source, 'unsafeCursorRowCount', code))
  const requiredBatchReceiptCount = decimalBigInt(
    ownData(source, 'requiredBatchReceiptCount', code)
  )
  const maximumBatchReceiptCount = decimalBigInt(ownData(source, 'maximumBatchReceiptCount', code))
  const withinReceiptCountLimit = booleanValue(
    ownData(source, 'withinReceiptCountLimit', code),
    code
  )
  const expectedBatches =
    totalRowCount === 0n
      ? 0n
      : (totalRowCount + BigInt(subject.migration.batchSize) - 1n) /
        BigInt(subject.migration.batchSize)
  if (
    unsafeCursorRowCount !== 0n ||
    (totalRowCount === 0n) !== (capturedHighWater === null) ||
    (totalRowCount === 0n) !== (minimumCursor === null) ||
    (capturedHighWater !== null &&
      (capturedHighWater < 0n || capturedHighWater > BigInt(subject.migration.cursor.maximum))) ||
    (minimumCursor !== null && minimumCursor < 0n) ||
    (minimumCursor !== null && capturedHighWater !== null && minimumCursor > capturedHighWater) ||
    (minimumCursor !== null &&
      capturedHighWater !== null &&
      totalRowCount > capturedHighWater - minimumCursor + 1n)
  ) {
    return fail('supabase-backfill-locked-high-water-unsafe-cursor')
  }
  if (
    remainingNullTargetRowCount > totalRowCount ||
    requiredBatchReceiptCount !== expectedBatches ||
    maximumBatchReceiptCount !== BigInt(subject.migration.maximumBatchReceiptCount) ||
    requiredBatchReceiptCount > maximumBatchReceiptCount ||
    !withinReceiptCountLimit
  ) {
    return fail('supabase-backfill-locked-high-water-receipt-capacity-exceeded')
  }
  return Object.freeze({
    status: 'captured' as const,
    lockedCapture: true as const,
    capturedHighWater:
      capturedHighWater === null
        ? null
        : safeNumber(capturedHighWater, 'supabase-backfill-locked-high-water-unsafe-cursor'),
    minimumCursor:
      minimumCursor === null
        ? null
        : safeNumber(minimumCursor, 'supabase-backfill-locked-high-water-unsafe-cursor'),
    totalRowCount: safeNumber(
      totalRowCount,
      'supabase-backfill-locked-high-water-receipt-capacity-exceeded'
    ),
    remainingNullTargetRowCount: safeNumber(
      remainingNullTargetRowCount,
      'supabase-backfill-locked-high-water-receipt-capacity-exceeded'
    ),
    unsafeCursorRowCount: 0 as const,
    requiredBatchReceiptCount: safeNumber(
      requiredBatchReceiptCount,
      'supabase-backfill-locked-high-water-receipt-capacity-exceeded'
    ),
    maximumBatchReceiptCount: subject.migration.maximumBatchReceiptCount,
    withinReceiptCountLimit: true as const
  })
}

interface ParsedCaptureResponse {
  readonly serverVersionNum: string
  readonly snapshotMarker: string
  readonly observedAt: string
  readonly roles: SupabaseBackfillLockedHighWaterCaptureV1['roles']
  readonly settings: SupabaseBackfillLockedHighWaterCaptureV1['settings']
  readonly address: SupabaseBackfillLockedHighWaterCaptureV1['address']
  readonly highWater: SupabaseBackfillLockedHighWaterCaptureV1['highWater']
}

function parseCaptureResponse(
  value: unknown,
  context: TrustedCaptureReviewContext,
  writeAuthority: SupabaseBackfillLockedHighWaterWriteAuthorityV1
): ParsedCaptureResponse {
  const code = 'supabase-backfill-locked-high-water-response-invalid' as const
  const source = exactRecord(value, RESPONSE_KEYS, code)
  const bindingsMatch =
    ownData(source, 'format', code) === SUPABASE_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_FORMAT &&
    ownData(source, 'version', code) === 1 &&
    ownData(source, 'subjectDigest', code) === context.envelope.review.bindings.subjectDigest &&
    ownData(source, 'sourceReviewDigest', code) ===
      context.envelope.review.bindings.sourceReviewDigest &&
    ownData(source, 'appliedSingleFlightKey', code) ===
      context.envelope.review.bindings.appliedSingleFlightKey &&
    ownData(source, 'installedVerificationDigest', code) ===
      context.envelope.review.bindings.installedVerificationDigest &&
    ownData(source, 'projectRef', code) === writeAuthority.projectRef &&
    ownData(source, 'accountId', code) === writeAuthority.accountId &&
    ownData(source, 'installGrantGeneration', code) ===
      context.envelope.review.authority.installWriteGrantGeneration &&
    ownData(source, 'queryVersion', code) === SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_VERSION &&
    ownData(source, 'accessMode', code) === 'read-write-locked-read' &&
    ownData(source, 'snapshotScope', code) === 'explicit-serializable-transaction' &&
    ownData(source, 'lockMode', code) === 'share-row-exclusive'
  if (!bindingsMatch) return fail('supabase-backfill-locked-high-water-query-binding-mismatch')
  const serverVersionNum = text(ownData(source, 'serverVersionNum', code), code)
  if (
    !SUPPORTED_SERVER_VERSION.test(serverVersionNum) ||
    serverVersionNum !== context.applied.installedEvidence.serverVersionNum
  ) {
    return fail('supabase-backfill-locked-high-water-query-binding-mismatch')
  }
  return Object.freeze({
    serverVersionNum,
    snapshotMarker: (() => {
      const marker = text(ownData(source, 'snapshotMarker', code), code)
      if (!SNAPSHOT_MARKER.test(marker)) return fail(code)
      return marker
    })(),
    observedAt: canonicalTimestamp(ownData(source, 'observedAt', code)),
    roles: parseRoles(ownData(source, 'roles', code)),
    settings: parseSettings(ownData(source, 'settings', code)),
    address: parseAddress(ownData(source, 'address', code), context.envelope.review.address),
    highWater: parseHighWater(ownData(source, 'highWater', code), context.applied.subject)
  })
}

/**
 * Capture one environment-specific high water through a genuine fixed-origin transport. The applied
 * reconciliation and review identities are consumed before any network request is made.
 */
export async function captureSupabaseBackfillLockedHighWaterV1(
  input: CaptureSupabaseBackfillLockedHighWaterOptionsV1
): Promise<SupabaseBackfillLockedHighWaterCaptureV1> {
  const options = captureOptions(input)
  const context = trustedCaptureReviewContexts.get(options.captureReview)
  if (!context || consumedCaptureReviews.has(options.captureReview)) {
    return fail('supabase-backfill-locked-high-water-proof-invalid')
  }
  requireConfirmation(context, options.stagingTargetBinding, options.confirmation)

  let transportTrusted = false
  try {
    const module = await import('../management/backfill/locked-high-water-capture-transport')
    transportTrusted = module.trustedSupabaseManagementBackfillLockedHighWaterCaptureTransportV1(
      options.transport
    )
  } catch {
    return fail('supabase-backfill-locked-high-water-input-invalid')
  }
  if (!transportTrusted || consumedCaptureReviews.has(options.captureReview)) {
    return fail('supabase-backfill-locked-high-water-proof-invalid')
  }
  const applied = consumeTrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(
    context.reconciliation,
    context.installContext
  )
  if (!applied || applied !== context.applied) {
    return fail('supabase-backfill-locked-high-water-proof-invalid')
  }
  consumedCaptureReviews.add(options.captureReview)

  if (!sameStagingTarget(options.stagingTargetBinding, applied.stagingTarget)) {
    return fail('supabase-backfill-locked-high-water-staging-target-mismatch')
  }
  const initial = await liveCaptureBinding(options)
  const expectedWriteAuthority = initial.writeAuthority
  if (
    expectedWriteAuthority.projectRef !== context.envelope.review.authority.projectRef ||
    expectedWriteAuthority.accountId !== context.envelope.review.authority.accountId ||
    expectedWriteAuthority.grantGeneration !== options.confirmation.captureGrantGeneration
  ) {
    return fail('supabase-backfill-locked-high-water-write-authority-invalid')
  }
  if (expectedWriteAuthority.grantGeneration === initial.readAuthority.grantGeneration) {
    return fail('supabase-backfill-locked-high-water-write-authority-not-separated')
  }
  requireLiveCaptureBinding(initial, context, expectedWriteAuthority, options.stagingTargetBinding)
  const beforeQuery = await liveCaptureBinding(options)
  requireLiveCaptureBinding(
    beforeQuery,
    context,
    expectedWriteAuthority,
    options.stagingTargetBinding
  )
  const request = captureRequest(context, expectedWriteAuthority)
  let response: unknown
  try {
    response = await options.transport.runLockedHighWaterCapture(request)
  } catch {
    return fail('supabase-backfill-locked-high-water-transport-failed')
  }
  const afterQuery = await liveCaptureBinding(options)
  requireLiveCaptureBinding(
    afterQuery,
    context,
    expectedWriteAuthority,
    options.stagingTargetBinding
  )
  const parsed = parseCaptureResponse(response, context, expectedWriteAuthority)
  const source = applied.sourceReview.review
  const withoutDigest = Object.freeze({
    format: SUPABASE_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    releaseReady: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    sourceLedgerBound: false as const,
    databaseLedgerBound: false as const,
    bindings: Object.freeze({
      subjectDigest: source.bindings.subjectDigest,
      sourceReviewDigest: applied.sourceReview.reviewDigest,
      captureReviewDigest: context.envelope.reviewDigest,
      appliedSingleFlightKey: applied.result.singleFlightKey,
      installedVerificationDigest: applied.installedEvidence.verificationDigest,
      installDigest: applied.context.installDigest,
      providerAuthorityDigest: source.bindings.providerAuthorityDigest,
      applicationId: applied.subject.application.id,
      applicationDigest: source.bindings.applicationDigest,
      backendPlanDigest: source.bindings.backendPlanDigest,
      adapterPlanDigest: source.bindings.adapterPlanDigest,
      manifestDigest: source.bindings.manifestDigest,
      migrationId: applied.subject.migration.id,
      migrationDigest: source.bindings.migrationDigest,
      catalogPreconditionDigest: source.bindings.catalogPreconditionDigest,
      queryDigest: context.envelope.review.query.digest
    }),
    authority: Object.freeze({
      projectRef: expectedWriteAuthority.projectRef,
      accountId: expectedWriteAuthority.accountId,
      readGrantGeneration: source.authority.grantGeneration,
      installWriteGrantGeneration: applied.writeAuthority.grantGeneration,
      captureWriteGrantGeneration: expectedWriteAuthority.grantGeneration
    }),
    query: context.envelope.review.query,
    observedAt: parsed.observedAt,
    snapshotMarker: parsed.snapshotMarker,
    serverVersionNum: parsed.serverVersionNum,
    roles: parsed.roles,
    settings: parsed.settings,
    address: parsed.address,
    highWater: parsed.highWater,
    receipt: Object.freeze({
      mayCreate: false as const,
      authorityCreated: false as const,
      databaseLedgerBound: false as const,
      futureReceiptZeroEvidenceBinding: 'captureDigest' as const
    }),
    checks: Object.freeze({
      queryBindingsMatch: true as const,
      currentAndSessionRoleMatch: true as const,
      fullTableReadAuthorityObserved: true as const,
      exactAddressMatches: true as const,
      cursorRangeSafe: true as const,
      receiptCapacityFits: true as const,
      allCaptureChecksPassed: true as const
    }),
    blockers: capturedBlockers()
  })
  const captureDigest = await digest(withoutDigest)
  const final = await liveCaptureBinding(options)
  requireLiveCaptureBinding(final, context, expectedWriteAuthority, options.stagingTargetBinding)
  const capture = Object.freeze({ ...withoutDigest, captureDigest })
  trustedCaptureProofs.set(
    capture,
    Object.freeze({
      capture,
      subject: applied.subject,
      subjectDigest: source.bindings.subjectDigest
    })
  )
  return capture
}

/** Consume the exact private SQL/credential binding once inside the fixed Management transport. */
export function consumeTrustedSupabaseBackfillLockedHighWaterCaptureRequestV1(
  value: unknown
): TrustedSupabaseBackfillLockedHighWaterCaptureRequestV1 | null {
  if (value === null || typeof value !== 'object' || consumedCaptureRequests.has(value)) return null
  const context = trustedCaptureRequests.get(value)
  if (!context) return null
  consumedCaptureRequests.add(value)
  return context
}

/** Non-authoritative identity check used by read-only Receipt V2 review. */
export function trustedSupabaseBackfillLockedHighWaterCaptureV1(
  value: unknown
): value is SupabaseBackfillLockedHighWaterCaptureV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    trustedCaptureProofs.has(value) &&
    !consumedCaptureProofs.has(value)
  )
}

/** Inspect a genuine capture without consuming the future database-ledger authority. */
export function trustedSupabaseBackfillLockedHighWaterCaptureContextV1(
  value: unknown
): TrustedSupabaseBackfillLockedHighWaterCaptureContextV1 | null {
  if (value === null || typeof value !== 'object' || consumedCaptureProofs.has(value)) return null
  return trustedCaptureProofs.get(value) ?? null
}

/** Consume a genuine capture once; reserved for the database-ledger initializer. */
export function consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(
  value: unknown
): TrustedSupabaseBackfillLockedHighWaterCaptureContextV1 | null {
  if (value === null || typeof value !== 'object' || consumedCaptureProofs.has(value)) return null
  const context = trustedCaptureProofs.get(value)
  if (!context) return null
  consumedCaptureProofs.add(value)
  return context
}
