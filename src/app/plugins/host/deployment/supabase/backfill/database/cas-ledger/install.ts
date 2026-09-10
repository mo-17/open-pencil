/* oxlint-disable eslint(max-lines) -- Keep the complete CAS-ledger install-preparation boundary together for auditability. */

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { SupabaseManagementDatabaseWriteCredentialLeaseBindingV1 } from '@/app/lowcode/supabase/management-database-write-credential-lease'
import {
  parseSupabaseStagingTargetBinding,
  type SupabaseStagingTargetBindingV1
} from '@/app/lowcode/supabase/staging-target'

import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_ARTIFACT_PATH,
  trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1,
  type SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1,
  type TrustedSupabaseBackfillDatabaseCASLedgerReviewContextV1
} from './review'
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX,
  trustedSupabaseBackfillDatabaseCASLedgerVerificationV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationV1
} from './verifier'
import type { SupabaseBackfillLiveCatalogAuthorityV1 } from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'

export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_REVIEW_FORMAT =
  'openpencil.supabase-backfill-database-cas-ledger-install-review.v1' as const
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_DISPATCH_CONTEXT_FORMAT =
  'openpencil.supabase-backfill-database-cas-ledger-install-dispatch-context.v1' as const
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MIGRATION_NAME =
  'install_openpencil_backfill_database_cas_ledger_v1' as const

const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const INSTALL_MARKER =
  /^openpencil-install:v1:supabase-backfill-database-cas-ledger:[A-Za-z0-9_-]{43}$/u
const BASE_SQL_COMMIT_SUFFIX = 'COMMIT;\n'
const CREATE_KEYS = ['review', 'absentVerification'] as const
const AUTHORIZE_KEYS = [
  'installReview',
  'stagingTargetBinding',
  'confirmation',
  'readCurrentReadAuthority',
  'readCurrentWriteAuthority',
  'readCurrentStagingTargetBinding'
] as const
const CONFIRMATION_KEYS = [
  'installReviewDigest',
  'sourceReviewDigest',
  'verificationDigest',
  'ledgerShapeDigest',
  'sqlDigest',
  'marker',
  'markerBindingDigest',
  'installSqlDigest',
  'verificationQueryDigest',
  'projectRefConfirmation',
  'accountIdConfirmation',
  'readGrantGeneration',
  'writeGrantGeneration',
  'confirmedIndependentStaging',
  'confirmedMigrationApply'
] as const
const WRITE_AUTHORITY_KEYS = [
  'projectRef',
  'accountId',
  'grantGeneration',
  'scope',
  'permission',
  'operation',
  'lifetime'
] as const

export interface SupabaseBackfillDatabaseCASLedgerInstallWriteAuthorityV1 {
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly scope: 'database:write'
  readonly permission: 'database_migrations_write'
  readonly operation: 'backfill-database-cas-ledger-install'
  readonly lifetime: 'single-operation'
}

export interface SupabaseBackfillDatabaseCASLedgerInstallReviewV1 {
  readonly format: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_REVIEW_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly databaseLedgerBound: false
  readonly sourceLedgerBound: false
  readonly releaseReady: false
  readonly installAuthorityCreated: false
  readonly installedVerificationCreated: false
  readonly bindings: Readonly<{
    sourceReviewDigest: string
    receiptReviewDigest: string
    verificationDigest: string
    scopeDraftDigest: string
    captureDigest: string
    providerAuthorityDigest: string
    applicationDigest: string
    migrationDigest: string
    ledgerShapeDigest: string
    sqlDigest: string
    markerBindingDigest: string
    installSqlDigest: string
    verificationQueryDigest: string
  }>
  readonly installationMarker: Readonly<{
    constraintName: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT
    operationNonce: string
    marker: string
  }>
  readonly authority: Readonly<{
    projectRef: string
    accountId: string
    readGrantGeneration: string
    previousInstallWriteGrantGeneration: string
    captureWriteGrantGeneration: string
  }>
  readonly migration: Readonly<{
    name: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MIGRATION_NAME
    endpointKind: 'management-api-migration'
    sqlSource: 'exact-reviewed-base-sql-plus-operation-marker'
    verificationRequiredAfterAcceptance: true
  }>
  readonly artifact: Readonly<{
    path: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_ARTIFACT_PATH
    kind: 'database-cas-ledger-install-review'
    mediaType: 'application/sql; charset=utf-8'
    byteLength: number
    digest: string
    statementCount: 20
    schemaMutationStatementCount: 14
    containsManagedDataRead: false
    containsDml: false
    performsSchemaChange: true
    exactReviewedBaseSqlPlusOperationMarker: true
    mutationDispatched: false
    hostDispatchAvailable: false
  }>
  readonly blockers: readonly string[]
}

export interface SupabaseBackfillDatabaseCASLedgerInstallReviewEnvelopeV1 {
  readonly review: SupabaseBackfillDatabaseCASLedgerInstallReviewV1
  readonly installReviewDigest: string
  readonly installSql: string
}

export interface SupabaseBackfillDatabaseCASLedgerInstallConfirmationV1 {
  readonly installReviewDigest: string
  readonly sourceReviewDigest: string
  readonly verificationDigest: string
  readonly ledgerShapeDigest: string
  readonly sqlDigest: string
  readonly marker: string
  readonly markerBindingDigest: string
  readonly installSqlDigest: string
  readonly verificationQueryDigest: string
  readonly projectRefConfirmation: string
  readonly accountIdConfirmation: string
  readonly readGrantGeneration: string
  readonly writeGrantGeneration: string
  readonly confirmedIndependentStaging: true
  readonly confirmedMigrationApply: true
}

export interface SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1 {
  readonly format: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_DISPATCH_CONTEXT_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly projectRef: string
  readonly accountId: string
  readonly installReviewDigest: string
  readonly sourceReviewDigest: string
  readonly verificationDigest: string
  readonly ledgerShapeDigest: string
  readonly sqlDigest: string
  readonly marker: string
  readonly markerBindingDigest: string
  readonly installSqlDigest: string
  readonly verificationQueryDigest: string
  readonly migrationName: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MIGRATION_NAME
  readonly databaseLedgerBound: false
  readonly sourceLedgerBound: false
  readonly verificationRequired: true
  readonly releaseReady: false
}

export interface CreateSupabaseBackfillDatabaseCASLedgerInstallReviewOptionsV1 {
  readonly review: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1
  readonly absentVerification: SupabaseBackfillDatabaseCASLedgerVerificationV1
}

type MaybePromise<T> = T | Promise<T>

export interface AuthorizeSupabaseBackfillDatabaseCASLedgerInstallOptionsV1 {
  readonly installReview: SupabaseBackfillDatabaseCASLedgerInstallReviewEnvelopeV1
  readonly stagingTargetBinding: SupabaseStagingTargetBindingV1
  readonly confirmation: SupabaseBackfillDatabaseCASLedgerInstallConfirmationV1
  readonly readCurrentReadAuthority: () => MaybePromise<SupabaseBackfillLiveCatalogAuthorityV1>
  readonly readCurrentWriteAuthority: () => MaybePromise<SupabaseBackfillDatabaseCASLedgerInstallWriteAuthorityV1>
  readonly readCurrentStagingTargetBinding: () => MaybePromise<SupabaseStagingTargetBindingV1 | null>
}

export type SupabaseBackfillDatabaseCASLedgerInstallErrorCode =
  | 'supabase-backfill-database-cas-ledger-install-input-invalid'
  | 'supabase-backfill-database-cas-ledger-install-proof-invalid'
  | 'supabase-backfill-database-cas-ledger-install-absent-proof-required'
  | 'supabase-backfill-database-cas-ledger-install-confirmation-mismatch'
  | 'supabase-backfill-database-cas-ledger-install-staging-target-mismatch'
  | 'supabase-backfill-database-cas-ledger-install-read-authority-invalid'
  | 'supabase-backfill-database-cas-ledger-install-write-authority-invalid'
  | 'supabase-backfill-database-cas-ledger-install-write-authority-not-separated'
  | 'supabase-backfill-database-cas-ledger-install-input-changed'
  | 'supabase-backfill-database-cas-ledger-install-operation-marker-failed'
  | 'supabase-backfill-database-cas-ledger-install-digest-failed'

export class SupabaseBackfillDatabaseCASLedgerInstallError extends Error {
  constructor(readonly code: SupabaseBackfillDatabaseCASLedgerInstallErrorCode) {
    super(`Supabase backfill database CAS ledger install preparation failed: ${code}.`)
    this.name = 'SupabaseBackfillDatabaseCASLedgerInstallError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

interface TrustedInstallReviewContextV1 {
  readonly envelope: SupabaseBackfillDatabaseCASLedgerInstallReviewEnvelopeV1
  readonly sourceReview: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1
  readonly reviewContext: TrustedSupabaseBackfillDatabaseCASLedgerReviewContextV1
  readonly absentVerification: SupabaseBackfillDatabaseCASLedgerVerificationV1
  readonly installSql: string
}

export interface TrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchV1 {
  readonly projectRef: string
  readonly accountId: string
  readonly readGrantGeneration: string
  readonly writeGrantGeneration: string
  readonly migrationName: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MIGRATION_NAME
  readonly installSql: string
  readonly installReviewDigest: string
  readonly sourceReviewDigest: string
  readonly verificationDigest: string
  readonly ledgerShapeDigest: string
  readonly baseSqlDigest: string
  readonly marker: string
  readonly markerBindingDigest: string
  readonly installSqlDigest: string
  readonly verificationQueryDigest: string
}

/**
 * Host-only same-process provenance retained for the future durable install controller. The review
 * envelopes contain SQL and therefore must never be serialized, logged, or exposed as public
 * dispatch evidence. Exact WeakMap identity is the only lookup authority; this object itself does
 * not mint mutation, credential, Receipt, or release authority.
 */
export interface TrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1 {
  readonly installReview: SupabaseBackfillDatabaseCASLedgerInstallReviewEnvelopeV1
  readonly sourceReview: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1
  readonly absentVerification: SupabaseBackfillDatabaseCASLedgerVerificationV1
  readonly readAuthority: SupabaseBackfillLiveCatalogAuthorityV1
  readonly writeAuthority: SupabaseBackfillDatabaseCASLedgerInstallWriteAuthorityV1
  readonly stagingTarget: SupabaseStagingTargetBindingV1
}

interface LiveBindingV1 {
  readonly readAuthority: SupabaseBackfillLiveCatalogAuthorityV1
  readonly writeAuthority: SupabaseBackfillDatabaseCASLedgerInstallWriteAuthorityV1
  readonly stagingTarget: SupabaseStagingTargetBindingV1
}

const trustedInstallReviews = new WeakMap<object, TrustedInstallReviewContextV1>()
const consumedInstallReviews = new WeakSet<object>()
const consumedAbsentVerifications = new WeakSet<object>()
const trustedDispatchContexts = new WeakMap<
  object,
  TrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchV1
>()
const trustedDispatchEvidenceContexts = new WeakMap<
  object,
  TrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1
>()
const consumedDispatchContexts = new WeakSet<object>()

function fail(code: SupabaseBackfillDatabaseCASLedgerInstallErrorCode): never {
  throw new SupabaseBackfillDatabaseCASLedgerInstallError(code)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-database-cas-ledger-install-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-database-cas-ledger-install-input-invalid')
  }
  return descriptor.value
}

function exactRecord(value: unknown, keys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('supabase-backfill-database-cas-ledger-install-input-invalid')
  }
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-database-cas-ledger-install-input-invalid')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-input-invalid')
  }
  for (const key of keys) ownData(value, key)
  return value as UnknownRecord
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    return fail('supabase-backfill-database-cas-ledger-install-input-invalid')
  }
  return value
}

function digestText(value: unknown): string {
  const parsed = text(value)
  if (!DIGEST.test(parsed)) {
    return fail('supabase-backfill-database-cas-ledger-install-input-invalid')
  }
  return parsed
}

function markerText(value: unknown): string {
  const parsed = text(value)
  if (!INSTALL_MARKER.test(parsed)) {
    return fail('supabase-backfill-database-cas-ledger-install-input-invalid')
  }
  return parsed
}

function stableId(value: unknown): string {
  const parsed = text(value)
  if (!STABLE_ID.test(parsed)) {
    return fail('supabase-backfill-database-cas-ledger-install-input-invalid')
  }
  return parsed
}

function credentialGeneration(
  value: unknown,
  code:
    | 'supabase-backfill-database-cas-ledger-install-read-authority-invalid'
    | 'supabase-backfill-database-cas-ledger-install-write-authority-invalid'
): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail(code)
  return value
}

function projectRef(value: unknown): string {
  const parsed = text(value)
  if (!PROJECT_REF.test(parsed)) {
    return fail('supabase-backfill-database-cas-ledger-install-input-invalid')
  }
  return parsed
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
    return fail('supabase-backfill-database-cas-ledger-install-digest-failed')
  }
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-database-cas-ledger-install-digest-failed')
  }
}

function operationNonce(): string {
  let nonce: string
  try {
    nonce = crypto.randomUUID()
  } catch {
    return fail('supabase-backfill-database-cas-ledger-install-operation-marker-failed')
  }
  if (!UUID_V4.test(nonce)) {
    return fail('supabase-backfill-database-cas-ledger-install-operation-marker-failed')
  }
  return nonce
}

function installSqlFromBase(baseSql: string, marker: string): string {
  if (
    !INSTALL_MARKER.test(marker) ||
    !baseSql.endsWith(BASE_SQL_COMMIT_SUFFIX) ||
    baseSql.indexOf(BASE_SQL_COMMIT_SUFFIX) !== baseSql.length - BASE_SQL_COMMIT_SUFFIX.length
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-input-changed')
  }
  const prefix = baseSql.slice(0, -BASE_SQL_COMMIT_SUFFIX.length)
  return [
    prefix,
    `COMMENT ON CONSTRAINT "${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT}" ON "openpencil_release"."backfill_executions_v1"`,
    `  IS '${marker}';`,
    BASE_SQL_COMMIT_SUFFIX
  ].join('\n')
}

function markerBindingInput(
  nonce: string,
  review: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1,
  verification: SupabaseBackfillDatabaseCASLedgerVerificationV1,
  projectRef: string,
  accountId: string
) {
  return Object.freeze({
    format: 'openpencil.supabase-backfill-database-cas-ledger-install-marker-binding.v1' as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    operationNonce: nonce,
    projectRef,
    accountId,
    sourceReviewDigest: review.reviewDigest,
    verificationDigest: verification.verificationDigest,
    ledgerShapeDigest: review.review.bindings.ledgerShapeDigest,
    baseSqlDigest: review.review.bindings.sqlDigest
  })
}

function createOptions(
  value: unknown
): CreateSupabaseBackfillDatabaseCASLedgerInstallReviewOptionsV1 {
  const source = exactRecord(value, CREATE_KEYS)
  const review = ownData(source, 'review')
  const absentVerification = ownData(source, 'absentVerification')
  if (
    review === null ||
    typeof review !== 'object' ||
    absentVerification === null ||
    typeof absentVerification !== 'object'
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-input-invalid')
  }
  return Object.freeze({
    review: review as SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1,
    absentVerification: absentVerification as SupabaseBackfillDatabaseCASLedgerVerificationV1
  })
}

function absentProofReady(verification: SupabaseBackfillDatabaseCASLedgerVerificationV1): boolean {
  return (
    verification.state === 'absent' &&
    !verification.verifiedInstalled &&
    verification.checks.queryBindingsExact &&
    verification.checks.absentStateExact &&
    verification.checks.allVerificationChecksPassed
  )
}

async function requireSourceProof(
  review: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1,
  verification: SupabaseBackfillDatabaseCASLedgerVerificationV1
): Promise<TrustedSupabaseBackfillDatabaseCASLedgerReviewContextV1> {
  const context = trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(review)
  if (
    !context ||
    trustedSupabaseBackfillDatabaseCASLedgerVerificationV1(verification, review) !== verification
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-proof-invalid')
  }
  if (!absentProofReady(verification)) {
    return fail('supabase-backfill-database-cas-ledger-install-absent-proof-required')
  }
  const { verificationDigest: _verificationDigest, ...verificationWithoutDigest } = verification
  const [reviewDigest, sqlDigest, recomputedVerificationDigest] = await Promise.all([
    digest(review.review),
    digestSql(review.previewSql),
    digest(verificationWithoutDigest)
  ])
  const receiptAuthority = context.receiptReview.review.authority
  if (
    reviewDigest !== review.reviewDigest ||
    sqlDigest !== review.review.bindings.sqlDigest ||
    review.review.artifact.digest !== sqlDigest ||
    review.review.artifact.byteLength !== new TextEncoder().encode(review.previewSql).byteLength ||
    recomputedVerificationDigest !== verification.verificationDigest ||
    verification.reviewDigest !== review.reviewDigest ||
    verification.authority.projectRef !== receiptAuthority.projectRef ||
    verification.authority.accountId !== receiptAuthority.accountId ||
    verification.authority.grantGeneration !== receiptAuthority.readGrantGeneration
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-input-changed')
  }
  return context
}

/** Build a secret-free, exact-SQL install review without creating mutation authority. */
export async function createSupabaseBackfillDatabaseCASLedgerInstallReviewV1(
  input: CreateSupabaseBackfillDatabaseCASLedgerInstallReviewOptionsV1
): Promise<SupabaseBackfillDatabaseCASLedgerInstallReviewEnvelopeV1> {
  const options = createOptions(input)
  const context = await requireSourceProof(options.review, options.absentVerification)
  const source = options.review.review
  const receipt = context.receiptReview.review
  const verification = options.absentVerification
  const nonce = operationNonce()
  const markerBindingDigest = await digest(
    markerBindingInput(
      nonce,
      options.review,
      verification,
      receipt.authority.projectRef,
      receipt.authority.accountId
    )
  )
  const marker = `${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX}${markerBindingDigest}`
  const installSql = installSqlFromBase(options.review.previewSql, marker)
  const installSqlDigest = await digestSql(installSql)
  const review = Object.freeze({
    format: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_REVIEW_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    reviewOnly: true as const,
    applyAvailable: false as const,
    databaseLedgerBound: false as const,
    sourceLedgerBound: false as const,
    releaseReady: false as const,
    installAuthorityCreated: false as const,
    installedVerificationCreated: false as const,
    bindings: Object.freeze({
      sourceReviewDigest: options.review.reviewDigest,
      receiptReviewDigest: source.bindings.receiptReviewDigest,
      verificationDigest: verification.verificationDigest,
      scopeDraftDigest: source.bindings.scopeDraftDigest,
      captureDigest: source.bindings.captureDigest,
      providerAuthorityDigest: source.bindings.providerAuthorityDigest,
      applicationDigest: source.bindings.applicationDigest,
      migrationDigest: source.bindings.migrationDigest,
      ledgerShapeDigest: source.bindings.ledgerShapeDigest,
      sqlDigest: source.bindings.sqlDigest,
      markerBindingDigest,
      installSqlDigest,
      verificationQueryDigest: verification.query.digest
    }),
    installationMarker: Object.freeze({
      constraintName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT,
      operationNonce: nonce,
      marker
    }),
    authority: Object.freeze({
      projectRef: receipt.authority.projectRef,
      accountId: receipt.authority.accountId,
      readGrantGeneration: receipt.authority.readGrantGeneration,
      previousInstallWriteGrantGeneration: receipt.authority.installWriteGrantGeneration,
      captureWriteGrantGeneration: receipt.authority.captureWriteGrantGeneration
    }),
    migration: Object.freeze({
      name: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MIGRATION_NAME,
      endpointKind: 'management-api-migration' as const,
      sqlSource: 'exact-reviewed-base-sql-plus-operation-marker' as const,
      verificationRequiredAfterAcceptance: true as const
    }),
    artifact: Object.freeze({
      path: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_ARTIFACT_PATH,
      kind: 'database-cas-ledger-install-review' as const,
      mediaType: 'application/sql; charset=utf-8' as const,
      byteLength: new TextEncoder().encode(installSql).byteLength,
      digest: installSqlDigest,
      statementCount: 20 as const,
      schemaMutationStatementCount: 14 as const,
      containsManagedDataRead: false as const,
      containsDml: false as const,
      performsSchemaChange: true as const,
      exactReviewedBaseSqlPlusOperationMarker: true as const,
      mutationDispatched: false as const,
      hostDispatchAvailable: false as const
    }),
    blockers: Object.freeze([
      'staging-target-not-confirmed',
      'operation-scoped-database-write-authority-not-bound',
      'dispatch-not-journaled',
      'database-ledger-installed-proof-not-observed',
      'source-migration-ledger-not-bound',
      'capture-receipt-not-persisted',
      'bounded-runner-unavailable'
    ])
  }) satisfies SupabaseBackfillDatabaseCASLedgerInstallReviewV1
  const envelope = Object.freeze({
    review,
    installReviewDigest: await digest(review),
    installSql
  })
  trustedInstallReviews.set(
    envelope,
    Object.freeze({
      envelope,
      sourceReview: options.review,
      reviewContext: context,
      absentVerification: verification,
      installSql
    })
  )
  return envelope
}

function confirmationSnapshot(
  value: unknown
): SupabaseBackfillDatabaseCASLedgerInstallConfirmationV1 {
  const source = exactRecord(value, CONFIRMATION_KEYS)
  const confirmation = Object.freeze({
    installReviewDigest: digestText(ownData(source, 'installReviewDigest')),
    sourceReviewDigest: digestText(ownData(source, 'sourceReviewDigest')),
    verificationDigest: digestText(ownData(source, 'verificationDigest')),
    ledgerShapeDigest: digestText(ownData(source, 'ledgerShapeDigest')),
    sqlDigest: digestText(ownData(source, 'sqlDigest')),
    marker: markerText(ownData(source, 'marker')),
    markerBindingDigest: digestText(ownData(source, 'markerBindingDigest')),
    installSqlDigest: digestText(ownData(source, 'installSqlDigest')),
    verificationQueryDigest: digestText(ownData(source, 'verificationQueryDigest')),
    projectRefConfirmation: projectRef(ownData(source, 'projectRefConfirmation')),
    accountIdConfirmation: stableId(ownData(source, 'accountIdConfirmation')),
    readGrantGeneration: stableId(ownData(source, 'readGrantGeneration')),
    writeGrantGeneration: stableId(ownData(source, 'writeGrantGeneration')),
    confirmedIndependentStaging: ownData(source, 'confirmedIndependentStaging'),
    confirmedMigrationApply: ownData(source, 'confirmedMigrationApply')
  })
  if (
    confirmation.confirmedIndependentStaging !== true ||
    confirmation.confirmedMigrationApply !== true
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-confirmation-mismatch')
  }
  return confirmation as SupabaseBackfillDatabaseCASLedgerInstallConfirmationV1
}

function readAuthoritySnapshot(value: unknown): SupabaseBackfillLiveCatalogAuthorityV1 {
  const source = exactRecord(value, ['projectRef', 'accountId', 'grantGeneration'])
  return Object.freeze({
    projectRef: projectRef(ownData(source, 'projectRef')),
    accountId: stableId(ownData(source, 'accountId')),
    grantGeneration: credentialGeneration(
      ownData(source, 'grantGeneration'),
      'supabase-backfill-database-cas-ledger-install-read-authority-invalid'
    )
  })
}

function writeAuthoritySnapshot(
  value: unknown
): SupabaseBackfillDatabaseCASLedgerInstallWriteAuthorityV1 {
  const source = exactRecord(value, WRITE_AUTHORITY_KEYS)
  const authority = Object.freeze({
    projectRef: projectRef(ownData(source, 'projectRef')),
    accountId: stableId(ownData(source, 'accountId')),
    grantGeneration: credentialGeneration(
      ownData(source, 'grantGeneration'),
      'supabase-backfill-database-cas-ledger-install-write-authority-invalid'
    ),
    scope: ownData(source, 'scope'),
    permission: ownData(source, 'permission'),
    operation: ownData(source, 'operation'),
    lifetime: ownData(source, 'lifetime')
  })
  if (
    authority.scope !== 'database:write' ||
    authority.permission !== 'database_migrations_write' ||
    authority.operation !== 'backfill-database-cas-ledger-install' ||
    authority.lifetime !== 'single-operation'
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-write-authority-invalid')
  }
  return authority as SupabaseBackfillDatabaseCASLedgerInstallWriteAuthorityV1
}

function authorizeOptions(value: unknown): {
  readonly installReview: SupabaseBackfillDatabaseCASLedgerInstallReviewEnvelopeV1
  readonly stagingTargetBinding: SupabaseStagingTargetBindingV1
  readonly confirmation: SupabaseBackfillDatabaseCASLedgerInstallConfirmationV1
  readonly readCurrentReadAuthority: () => MaybePromise<SupabaseBackfillLiveCatalogAuthorityV1>
  readonly readCurrentWriteAuthority: () => MaybePromise<SupabaseBackfillDatabaseCASLedgerInstallWriteAuthorityV1>
  readonly readCurrentStagingTargetBinding: () => MaybePromise<SupabaseStagingTargetBindingV1 | null>
} {
  const source = exactRecord(value, AUTHORIZE_KEYS)
  const installReview = ownData(source, 'installReview')
  const readCurrentReadAuthority = ownData(source, 'readCurrentReadAuthority')
  const readCurrentWriteAuthority = ownData(source, 'readCurrentWriteAuthority')
  const readCurrentStagingTargetBinding = ownData(source, 'readCurrentStagingTargetBinding')
  if (
    installReview === null ||
    typeof installReview !== 'object' ||
    typeof readCurrentReadAuthority !== 'function' ||
    typeof readCurrentWriteAuthority !== 'function' ||
    typeof readCurrentStagingTargetBinding !== 'function'
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-input-invalid')
  }
  let stagingTargetBinding: SupabaseStagingTargetBindingV1
  try {
    stagingTargetBinding = parseSupabaseStagingTargetBinding(
      ownData(source, 'stagingTargetBinding')
    )
  } catch {
    return fail('supabase-backfill-database-cas-ledger-install-staging-target-mismatch')
  }
  return Object.freeze({
    installReview: installReview as SupabaseBackfillDatabaseCASLedgerInstallReviewEnvelopeV1,
    stagingTargetBinding,
    confirmation: confirmationSnapshot(ownData(source, 'confirmation')),
    readCurrentReadAuthority:
      readCurrentReadAuthority as () => MaybePromise<SupabaseBackfillLiveCatalogAuthorityV1>,
    readCurrentWriteAuthority:
      readCurrentWriteAuthority as () => MaybePromise<SupabaseBackfillDatabaseCASLedgerInstallWriteAuthorityV1>,
    readCurrentStagingTargetBinding:
      readCurrentStagingTargetBinding as () => MaybePromise<SupabaseStagingTargetBindingV1 | null>
  })
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
  left: SupabaseBackfillDatabaseCASLedgerInstallWriteAuthorityV1,
  right: SupabaseBackfillDatabaseCASLedgerInstallWriteAuthorityV1
): boolean {
  return (
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.grantGeneration === right.grantGeneration
  )
}

function requireConfirmation(
  context: TrustedInstallReviewContextV1,
  stagingTarget: SupabaseStagingTargetBindingV1,
  confirmation: SupabaseBackfillDatabaseCASLedgerInstallConfirmationV1
): void {
  const install = context.envelope
  const source = context.sourceReview
  const verification = context.absentVerification
  const authority = install.review.authority
  if (
    confirmation.installReviewDigest !== install.installReviewDigest ||
    confirmation.sourceReviewDigest !== source.reviewDigest ||
    confirmation.verificationDigest !== verification.verificationDigest ||
    confirmation.ledgerShapeDigest !== source.review.bindings.ledgerShapeDigest ||
    confirmation.sqlDigest !== source.review.bindings.sqlDigest ||
    confirmation.marker !== install.review.installationMarker.marker ||
    confirmation.markerBindingDigest !== install.review.bindings.markerBindingDigest ||
    confirmation.installSqlDigest !== install.review.bindings.installSqlDigest ||
    confirmation.verificationQueryDigest !== verification.query.digest ||
    confirmation.projectRefConfirmation !== authority.projectRef ||
    confirmation.accountIdConfirmation !== authority.accountId ||
    confirmation.readGrantGeneration !== authority.readGrantGeneration ||
    stagingTarget.projectRef !== authority.projectRef ||
    stagingTarget.accountId !== authority.accountId
  ) {
    fail('supabase-backfill-database-cas-ledger-install-confirmation-mismatch')
  }
}

async function liveBinding(options: ReturnType<typeof authorizeOptions>): Promise<LiveBindingV1> {
  try {
    const [readValue, writeValue, stagingValue] = await Promise.all([
      options.readCurrentReadAuthority(),
      options.readCurrentWriteAuthority(),
      options.readCurrentStagingTargetBinding()
    ])
    if (stagingValue === null) {
      return fail('supabase-backfill-database-cas-ledger-install-staging-target-mismatch')
    }
    return Object.freeze({
      readAuthority: readAuthoritySnapshot(readValue),
      writeAuthority: writeAuthoritySnapshot(writeValue),
      stagingTarget: parseSupabaseStagingTargetBinding(stagingValue)
    })
  } catch (cause) {
    if (cause instanceof SupabaseBackfillDatabaseCASLedgerInstallError) throw cause
    return fail('supabase-backfill-database-cas-ledger-install-input-invalid')
  }
}

function requireLiveBinding(
  live: LiveBindingV1,
  expectedRead: SupabaseBackfillLiveCatalogAuthorityV1,
  expectedWrite: SupabaseBackfillDatabaseCASLedgerInstallWriteAuthorityV1,
  expectedStaging: SupabaseStagingTargetBindingV1
): void {
  if (
    !sameReadAuthority(live.readAuthority, expectedRead) ||
    !sameWriteAuthority(live.writeAuthority, expectedWrite) ||
    !sameStagingTarget(live.stagingTarget, expectedStaging)
  ) {
    fail('supabase-backfill-database-cas-ledger-install-input-changed')
  }
}

function requireCurrentProof(context: TrustedInstallReviewContextV1): void {
  if (
    trustedInstallReviews.get(context.envelope) !== context ||
    trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(context.sourceReview) !==
      context.reviewContext ||
    trustedSupabaseBackfillDatabaseCASLedgerVerificationV1(
      context.absentVerification,
      context.sourceReview
    ) !== context.absentVerification ||
    !absentProofReady(context.absentVerification)
  ) {
    fail('supabase-backfill-database-cas-ledger-install-input-changed')
  }
}

/** Mint one single-use dispatch capability after exact review, staging, and grant checks. */
export async function authorizeSupabaseBackfillDatabaseCASLedgerInstallV1(
  input: AuthorizeSupabaseBackfillDatabaseCASLedgerInstallOptionsV1
): Promise<SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1> {
  const options = authorizeOptions(input)
  const context = trustedInstallReviews.get(options.installReview)
  if (
    !context ||
    consumedInstallReviews.has(options.installReview) ||
    consumedAbsentVerifications.has(context.absentVerification)
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-proof-invalid')
  }
  requireCurrentProof(context)
  requireConfirmation(context, options.stagingTargetBinding, options.confirmation)
  consumedInstallReviews.add(options.installReview)
  consumedAbsentVerifications.add(context.absentVerification)

  const initial = await liveBinding(options)
  const expectedRead = readAuthoritySnapshot(initial.readAuthority)
  const expectedWrite = writeAuthoritySnapshot(initial.writeAuthority)
  const authority = context.envelope.review.authority
  if (
    !sameReadAuthority(expectedRead, {
      projectRef: authority.projectRef,
      accountId: authority.accountId,
      grantGeneration: authority.readGrantGeneration
    })
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-read-authority-invalid')
  }
  if (
    expectedWrite.projectRef !== authority.projectRef ||
    expectedWrite.accountId !== authority.accountId ||
    expectedWrite.grantGeneration !== options.confirmation.writeGrantGeneration
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-write-authority-invalid')
  }
  if (
    [
      authority.readGrantGeneration,
      authority.previousInstallWriteGrantGeneration,
      authority.captureWriteGrantGeneration
    ].includes(expectedWrite.grantGeneration)
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-write-authority-not-separated')
  }
  requireLiveBinding(initial, expectedRead, expectedWrite, options.stagingTargetBinding)
  requireCurrentProof(context)
  const [installReviewDigest, installSqlDigest, markerBindingDigest] = await Promise.all([
    digest(context.envelope.review),
    digestSql(context.installSql),
    digest(
      markerBindingInput(
        context.envelope.review.installationMarker.operationNonce,
        context.sourceReview,
        context.absentVerification,
        authority.projectRef,
        authority.accountId
      )
    )
  ])
  if (
    installReviewDigest !== context.envelope.installReviewDigest ||
    installSqlDigest !== context.envelope.review.bindings.installSqlDigest ||
    markerBindingDigest !== context.envelope.review.bindings.markerBindingDigest ||
    context.envelope.review.installationMarker.marker !==
      `${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX}${markerBindingDigest}` ||
    context.installSql !==
      installSqlFromBase(
        context.sourceReview.previewSql,
        context.envelope.review.installationMarker.marker
      )
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-input-changed')
  }
  // No asynchronous boundary may follow the final live/provenance re-read: upstream capture and
  // credential authority can be consumed or rotated while the digest promises are pending.
  const final = await liveBinding(options)
  requireLiveBinding(final, expectedRead, expectedWrite, options.stagingTargetBinding)
  requireCurrentProof(context)

  const publicContext = Object.freeze({
    format: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_DISPATCH_CONTEXT_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    projectRef: authority.projectRef,
    accountId: authority.accountId,
    installReviewDigest: context.envelope.installReviewDigest,
    sourceReviewDigest: context.sourceReview.reviewDigest,
    verificationDigest: context.absentVerification.verificationDigest,
    ledgerShapeDigest: context.sourceReview.review.bindings.ledgerShapeDigest,
    sqlDigest: context.sourceReview.review.bindings.sqlDigest,
    marker: context.envelope.review.installationMarker.marker,
    markerBindingDigest: context.envelope.review.bindings.markerBindingDigest,
    installSqlDigest: context.envelope.review.bindings.installSqlDigest,
    verificationQueryDigest: context.absentVerification.query.digest,
    migrationName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MIGRATION_NAME,
    databaseLedgerBound: false as const,
    sourceLedgerBound: false as const,
    verificationRequired: true as const,
    releaseReady: false as const
  }) satisfies SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
  trustedDispatchContexts.set(
    publicContext,
    Object.freeze({
      projectRef: authority.projectRef,
      accountId: authority.accountId,
      readGrantGeneration: expectedRead.grantGeneration,
      writeGrantGeneration: expectedWrite.grantGeneration,
      migrationName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MIGRATION_NAME,
      installSql: context.installSql,
      installReviewDigest: context.envelope.installReviewDigest,
      sourceReviewDigest: context.sourceReview.reviewDigest,
      verificationDigest: context.absentVerification.verificationDigest,
      ledgerShapeDigest: context.sourceReview.review.bindings.ledgerShapeDigest,
      baseSqlDigest: context.sourceReview.review.bindings.sqlDigest,
      marker: context.envelope.review.installationMarker.marker,
      markerBindingDigest: context.envelope.review.bindings.markerBindingDigest,
      installSqlDigest: context.envelope.review.bindings.installSqlDigest,
      verificationQueryDigest: context.absentVerification.query.digest
    })
  )
  trustedDispatchEvidenceContexts.set(
    publicContext,
    Object.freeze({
      installReview: context.envelope,
      sourceReview: context.sourceReview,
      absentVerification: context.absentVerification,
      readAuthority: expectedRead,
      writeAuthority: expectedWrite,
      stagingTarget: options.stagingTargetBinding
    })
  )
  return publicContext
}

/** Return genuine same-process install-review provenance without minting mutation authority. */
export function trustedSupabaseBackfillDatabaseCASLedgerInstallReviewContextV1(
  value: unknown
): SupabaseBackfillDatabaseCASLedgerInstallReviewEnvelopeV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedInstallReviews.get(value)
  if (!context) return null
  try {
    requireCurrentProof(context)
  } catch {
    return null
  }
  return context.envelope
}

function trustedDispatchReviewContext(
  dispatch: TrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchV1,
  evidence: TrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1
): TrustedInstallReviewContextV1 | null {
  const reviewContext = trustedInstallReviews.get(evidence.installReview)
  const identitiesExact = [
    reviewContext?.envelope === evidence.installReview,
    reviewContext?.sourceReview === evidence.sourceReview,
    reviewContext?.absentVerification === evidence.absentVerification
  ].every(Boolean)
  const bindingsExact = [
    [dispatch.projectRef, evidence.readAuthority.projectRef],
    [dispatch.projectRef, evidence.writeAuthority.projectRef],
    [dispatch.projectRef, evidence.stagingTarget.projectRef],
    [dispatch.accountId, evidence.readAuthority.accountId],
    [dispatch.accountId, evidence.writeAuthority.accountId],
    [dispatch.accountId, evidence.stagingTarget.accountId],
    [dispatch.readGrantGeneration, evidence.readAuthority.grantGeneration],
    [dispatch.writeGrantGeneration, evidence.writeAuthority.grantGeneration],
    [dispatch.installReviewDigest, evidence.installReview.installReviewDigest],
    [dispatch.sourceReviewDigest, evidence.sourceReview.reviewDigest],
    [dispatch.verificationDigest, evidence.absentVerification.verificationDigest],
    [dispatch.ledgerShapeDigest, evidence.sourceReview.review.bindings.ledgerShapeDigest],
    [dispatch.baseSqlDigest, evidence.sourceReview.review.bindings.sqlDigest],
    [dispatch.marker, evidence.installReview.review.installationMarker.marker],
    [dispatch.markerBindingDigest, evidence.installReview.review.bindings.markerBindingDigest],
    [dispatch.installSqlDigest, evidence.installReview.review.bindings.installSqlDigest],
    [dispatch.verificationQueryDigest, evidence.absentVerification.query.digest]
  ].every(([left, right]) => left === right)
  return identitiesExact && bindingsExact && reviewContext ? reviewContext : null
}

/**
 * Derive the exact secret-free database-write credential binding from a genuine, unconsumed
 * same-process dispatch identity. Public fields, clones, proxies, and consumed contexts cannot
 * reproduce this lookup, and no credential is read or consumed here.
 */
export function deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(
  value: unknown
): SupabaseManagementDatabaseWriteCredentialLeaseBindingV1 | null {
  if (value === null || typeof value !== 'object' || consumedDispatchContexts.has(value)) {
    return null
  }
  const dispatch = trustedDispatchContexts.get(value)
  const evidence = trustedDispatchEvidenceContexts.get(value)
  if (!dispatch || !evidence) return null
  const reviewContext = trustedDispatchReviewContext(dispatch, evidence)
  if (!reviewContext) return null
  try {
    requireCurrentProof(reviewContext)
  } catch {
    return null
  }
  return Object.freeze({
    purpose: 'backfill-database-cas-ledger-install' as const,
    projectRef: dispatch.projectRef,
    accountId: dispatch.accountId,
    installReviewDigest: dispatch.installReviewDigest,
    sourceReviewDigest: dispatch.sourceReviewDigest,
    verificationDigest: dispatch.verificationDigest,
    ledgerShapeDigest: dispatch.ledgerShapeDigest,
    baseSqlDigest: dispatch.baseSqlDigest,
    marker: dispatch.marker,
    markerBindingDigest: dispatch.markerBindingDigest,
    installSqlDigest: dispatch.installSqlDigest,
    verificationQueryDigest: dispatch.verificationQueryDigest,
    expectedSharedGrantGeneration: dispatch.writeGrantGeneration
  })
}

/**
 * Host-only, non-consuming identity lookup for the future durable install controller. The returned
 * provenance includes reviewed SQL through its envelopes; never serialize, log, or expose it.
 */
export function trustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1(
  value: unknown
): TrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1 | null {
  if (value === null || typeof value !== 'object') return null
  const dispatch = trustedDispatchContexts.get(value)
  const evidence = trustedDispatchEvidenceContexts.get(value)
  if (!dispatch || !evidence) return null
  const reviewContext = trustedDispatchReviewContext(dispatch, evidence)
  if (!reviewContext) return null
  try {
    requireCurrentProof(reviewContext)
  } catch {
    return null
  }
  return evidence
}

/** Consume the exact reviewed SQL and credential generation once inside the fixed transport. */
export function consumeTrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1(
  value: unknown
): TrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchV1 | null {
  if (value === null || typeof value !== 'object' || consumedDispatchContexts.has(value)) {
    return null
  }
  consumedDispatchContexts.add(value)
  const context = trustedDispatchContexts.get(value)
  const evidence = trustedDispatchEvidenceContexts.get(value)
  if (!context || !evidence) return null
  const reviewContext = trustedDispatchReviewContext(context, evidence)
  if (!reviewContext) return null
  try {
    requireCurrentProof(reviewContext)
  } catch {
    return null
  }
  return context
}
