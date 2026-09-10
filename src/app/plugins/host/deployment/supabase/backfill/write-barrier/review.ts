import {
  createSupabaseBackfillInspectionSubjectV1,
  type SupabaseBackfillInspectionSubjectEnvelopeV1,
  type SupabaseBackfillInspectionSubjectV1
} from '@open-pencil/compiler/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  inspectSupabaseBackfillLiveCatalogV1,
  type InspectSupabaseBackfillLiveCatalogOptionsV1,
  type SupabaseBackfillLiveCatalogAuthorityV1,
  type SupabaseBackfillLiveCatalogInspectionV1
} from '../live-inspector'

export const SUPABASE_BACKFILL_WRITE_BARRIER_REVIEW_FORMAT =
  'openpencil.supabase-backfill-write-barrier-review.v1' as const
export const SUPABASE_BACKFILL_WRITE_BARRIER_ARTIFACT_PATH =
  'backend/supabase-v2/backfill/write-barrier-review.sql' as const
export const SUPABASE_BACKFILL_WRITE_BARRIER_MARKER_PREFIX =
  'openpencil-transient:v1:supabase-backfill-write-barrier:' as const

const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const REVIEW_OPTION_KEYS = [
  'readCurrentCompilerInput',
  'readCurrentAuthority',
  'transport'
] as const
const REQUIRED_BLOCKERS = Object.freeze([
  'write-barrier-not-installed',
  'locked-high-water-not-captured',
  'database-batch-ledger-not-bound',
  'execution-runner-unavailable'
] as const)

export const SUPABASE_BACKFILL_WRITE_BARRIER_EXECUTION_POLICY = Object.freeze({
  transactionIsolation: 'serializable' as const,
  lockTimeoutMs: 5_000,
  statementTimeoutMs: 15_000,
  requiredLockMode: 'access-exclusive' as const,
  reinspectionUnderLockRequired: true as const,
  barrierAwareVerificationRequired: true as const,
  activeWritersMustProvideNonNullTarget: true as const
})

export interface SupabaseBackfillWriteBarrierReviewV1 {
  readonly format: typeof SUPABASE_BACKFILL_WRITE_BARRIER_REVIEW_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly environmentVerified: false
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly releaseReady: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly bindings: Readonly<{
    subjectDigest: string
    inspectionDigest: string
    authorityDigest: string
    queryDigest: string
    providerAuthorityDigest: string
    applicationDigest: string
    backendPlanDigest: string
    adapterPlanDigest: string
    manifestDigest: string
    migrationDigest: string
    logicalScopeDigest: string
    markerBindingDigest: string
    catalogPreconditionDigest: string
    sqlDigest: string
  }>
  readonly authority: SupabaseBackfillLiveCatalogAuthorityV1
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
    sequenceOid: string
  }>
  readonly barrier: Readonly<{
    kind: 'not-valid-check'
    constraintName: string
    marker: string
    predicate: 'target-is-not-null'
    installStatus: 'planned-not-installed'
    validated: false
    inherited: false
    effectsWhenInstalled: Readonly<{
      rejectsNewNull: true
      rejectsUpdatesLeavingNull: true
      omittedTargetInsertRejected: true
      validatesExistingRows: false
      deletesLegacyNullRowsAllowed: true
    }>
  }>
  readonly artifact: Readonly<{
    path: typeof SUPABASE_BACKFILL_WRITE_BARRIER_ARTIFACT_PATH
    kind: 'database-schema-review'
    mediaType: 'application/sql; charset=utf-8'
    byteLength: number
    digest: string
    statementCount: 7
    mutationStatementCount: 2
    mutationSqlEmitted: true
    mutationDispatched: false
    containsDataRead: false
    containsDml: false
    performsSchemaChange: true
    hostDispatchAvailable: false
  }>
  readonly executionPolicy: typeof SUPABASE_BACKFILL_WRITE_BARRIER_EXECUTION_POLICY
  readonly freshness: Readonly<{
    snapshotMarker: string
    observedAt: string
    requiresFreshCatalogAtApply: true
    snapshotIsApplyAuthority: false
  }>
  readonly blockers: readonly string[]
}

export interface SupabaseBackfillWriteBarrierReviewEnvelopeV1 {
  readonly review: SupabaseBackfillWriteBarrierReviewV1
  readonly reviewDigest: string
  readonly previewSql: string
}

/**
 * Operation-scoped Host evidence retained outside the serializable review artifact. The review
 * remains non-authoritative; only a separately injected mutation transport may consume this
 * identity after an exact absent-barrier verification.
 */
export interface TrustedSupabaseBackfillWriteBarrierReviewContextV1 {
  readonly envelope: SupabaseBackfillWriteBarrierReviewEnvelopeV1
  readonly inspection: SupabaseBackfillLiveCatalogInspectionV1
  readonly subject: SupabaseBackfillInspectionSubjectV1
}

export type ReviewSupabaseBackfillWriteBarrierOptionsV1 =
  InspectSupabaseBackfillLiveCatalogOptionsV1

export type SupabaseBackfillWriteBarrierReviewErrorCode =
  | 'supabase-backfill-write-barrier-input-invalid'
  | 'supabase-backfill-write-barrier-input-changed'
  | 'supabase-backfill-write-barrier-catalog-not-ready'
  | 'supabase-backfill-write-barrier-digest-failed'

export class SupabaseBackfillWriteBarrierReviewError extends Error {
  constructor(readonly code: SupabaseBackfillWriteBarrierReviewErrorCode) {
    super(`Supabase backfill write-barrier review failed: ${code}.`)
    this.name = 'SupabaseBackfillWriteBarrierReviewError'
  }
}

interface LiveBinding {
  readonly subjectEnvelope: SupabaseBackfillInspectionSubjectEnvelopeV1
  readonly authority: SupabaseBackfillLiveCatalogAuthorityV1
}

interface CatalogReadinessRuntimeView {
  readonly reviewOnly: unknown
  readonly applyAvailable: unknown
  readonly releaseReady: unknown
  readonly executionAuthorityCreated: unknown
  readonly receiptAuthorityCreated: unknown
  readonly checks: Readonly<{ allCatalogChecksPassed: unknown }>
  readonly highWater: Readonly<{
    status: unknown
    observedCandidate: unknown
    lockedCapture: unknown
  }>
  readonly receipt: Readonly<{ mayCreate: unknown; signed: unknown }>
  readonly blockers: readonly string[]
}

type UnknownRecord = Record<PropertyKey, unknown>

const trustedReviewContexts = new WeakMap<
  object,
  TrustedSupabaseBackfillWriteBarrierReviewContextV1
>()
const consumedReviewContexts = new WeakSet<object>()

function fail(code: SupabaseBackfillWriteBarrierReviewErrorCode): never {
  throw new SupabaseBackfillWriteBarrierReviewError(code)
}

function exactRecord(value: unknown, keys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('supabase-backfill-write-barrier-input-invalid')
  }
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-write-barrier-input-invalid')
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return fail('supabase-backfill-write-barrier-input-invalid')
  }
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail('supabase-backfill-write-barrier-input-invalid')
  }
  return value as UnknownRecord
}

function ownData(value: object, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-write-barrier-input-invalid')
  }
  if (!descriptor || !('value' in descriptor)) {
    return fail('supabase-backfill-write-barrier-input-invalid')
  }
  return descriptor.value
}

function optionsSnapshot(value: unknown): InspectSupabaseBackfillLiveCatalogOptionsV1 {
  const source = exactRecord(value, REVIEW_OPTION_KEYS)
  const readCurrentCompilerInput = ownData(source, 'readCurrentCompilerInput')
  const readCurrentAuthority = ownData(source, 'readCurrentAuthority')
  const transport = ownData(source, 'transport')
  if (
    typeof readCurrentCompilerInput !== 'function' ||
    typeof readCurrentAuthority !== 'function' ||
    transport === null ||
    typeof transport !== 'object'
  ) {
    return fail('supabase-backfill-write-barrier-input-invalid')
  }
  return Object.freeze({
    readCurrentCompilerInput:
      readCurrentCompilerInput as InspectSupabaseBackfillLiveCatalogOptionsV1['readCurrentCompilerInput'],
    readCurrentAuthority:
      readCurrentAuthority as InspectSupabaseBackfillLiveCatalogOptionsV1['readCurrentAuthority'],
    transport: transport as InspectSupabaseBackfillLiveCatalogOptionsV1['transport']
  })
}

function authoritySnapshot(value: unknown): SupabaseBackfillLiveCatalogAuthorityV1 {
  const source = exactRecord(value, ['projectRef', 'accountId', 'grantGeneration'])
  const projectRef = ownData(source, 'projectRef')
  const accountId = ownData(source, 'accountId')
  const grantGeneration = ownData(source, 'grantGeneration')
  if (
    typeof projectRef !== 'string' ||
    !PROJECT_REF.test(projectRef) ||
    typeof accountId !== 'string' ||
    !STABLE_ID.test(accountId) ||
    typeof grantGeneration !== 'string' ||
    !STABLE_ID.test(grantGeneration)
  ) {
    return fail('supabase-backfill-write-barrier-input-invalid')
  }
  return Object.freeze({ projectRef, accountId, grantGeneration })
}

async function liveBinding(
  options: InspectSupabaseBackfillLiveCatalogOptionsV1
): Promise<LiveBinding> {
  try {
    const input = await options.readCurrentCompilerInput()
    const authority = authoritySnapshot(await options.readCurrentAuthority())
    const subjectEnvelope = createSupabaseBackfillInspectionSubjectV1(input.registry, {
      plan: input.plan,
      selection: input.selection
    })
    if (!DIGEST.test(subjectEnvelope.subjectDigest)) {
      return fail('supabase-backfill-write-barrier-input-invalid')
    }
    return Object.freeze({ subjectEnvelope, authority })
  } catch (cause) {
    if (cause instanceof SupabaseBackfillWriteBarrierReviewError) throw cause
    return fail('supabase-backfill-write-barrier-input-invalid')
  }
}

function sameAuthority(
  left: SupabaseBackfillLiveCatalogAuthorityV1,
  right: SupabaseBackfillLiveCatalogAuthorityV1
): boolean {
  return (
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.grantGeneration === right.grantGeneration
  )
}

function requireSameBinding(
  expectedSubjectDigest: string,
  expectedAuthority: SupabaseBackfillLiveCatalogAuthorityV1,
  live: LiveBinding
): void {
  if (
    live.subjectEnvelope.subjectDigest !== expectedSubjectDigest ||
    !sameAuthority(expectedAuthority, live.authority)
  ) {
    fail('supabase-backfill-write-barrier-input-changed')
  }
}

function ensureCatalogReady(inspection: SupabaseBackfillLiveCatalogInspectionV1): void {
  // Keep this trust-boundary check at runtime even though the producer's public type uses literals.
  // A drifted or corrupted Host implementation must not gain mutation authority through those types.
  const runtimeInspection: CatalogReadinessRuntimeView = inspection
  if (
    runtimeInspection.checks.allCatalogChecksPassed !== true ||
    runtimeInspection.reviewOnly !== true ||
    runtimeInspection.applyAvailable !== false ||
    runtimeInspection.releaseReady !== false ||
    runtimeInspection.executionAuthorityCreated !== false ||
    runtimeInspection.receiptAuthorityCreated !== false ||
    runtimeInspection.highWater.status !== 'not-observed' ||
    runtimeInspection.highWater.observedCandidate !== null ||
    runtimeInspection.highWater.lockedCapture !== false ||
    runtimeInspection.receipt.mayCreate !== false ||
    runtimeInspection.receipt.signed !== false ||
    runtimeInspection.blockers.length !== REQUIRED_BLOCKERS.length ||
    !REQUIRED_BLOCKERS.every((blocker) => runtimeInspection.blockers.includes(blocker))
  ) {
    fail('supabase-backfill-write-barrier-catalog-not-ready')
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string): string {
  return `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

function safeConstraintName(logicalScopeDigest: string): string {
  const prefix = logicalScopeDigest.slice(0, 16)
  const hex = prefix
    .split('')
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
  return `op_bf_nn_${hex}`
}

function previewSql(table: string, target: string, constraint: string, marker: string): string {
  const qualifiedTable = `${quoteIdentifier('public')}.${quoteIdentifier(table)}`
  return [
    '-- OpenPencil Supabase backfill write-barrier review v1.',
    '-- Review only. This artifact creates no Apply, execution, or Receipt authority.',
    '-- DO NOT APPLY: a fresh lock-bound reinspection and explicit authority are still required.',
    'BEGIN;',
    'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '15s';",
    `ALTER TABLE ONLY ${qualifiedTable}`,
    `  ADD CONSTRAINT ${quoteIdentifier(constraint)}`,
    `  CHECK (${quoteIdentifier(target)} IS NOT NULL) NO INHERIT NOT VALID;`,
    `COMMENT ON CONSTRAINT ${quoteIdentifier(constraint)} ON ${qualifiedTable}`,
    `  IS ${quoteLiteral(marker)};`,
    'COMMIT;',
    ''
  ].join('\n')
}

function catalogPrecondition(
  subjectDigest: string,
  inspection: SupabaseBackfillLiveCatalogInspectionV1
) {
  return Object.freeze({
    format: 'openpencil.supabase-backfill-write-barrier-catalog-precondition.v1' as const,
    subjectDigest,
    query: inspection.query,
    catalog: inspection.catalog,
    hazards: inspection.hazards,
    checks: inspection.checks
  })
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-write-barrier-digest-failed')
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
    return fail('supabase-backfill-write-barrier-digest-failed')
  }
}

function logicalScope(subject: SupabaseBackfillInspectionSubjectV1) {
  return Object.freeze({
    format: 'openpencil.supabase-backfill-write-barrier-logical-scope.v1' as const,
    providerId: 'supabase' as const,
    applicationId: subject.application.id,
    migrationId: subject.migration.id,
    entityId: subject.migration.entity.id,
    targetFieldId: subject.migration.target.fieldId
  })
}

/**
 * Build a deterministic, secret-free write-barrier review from one fresh Host inspection.
 * The returned SQL is preview material only and cannot dispatch a database mutation.
 */
export async function reviewSupabaseBackfillWriteBarrierV1(
  input: ReviewSupabaseBackfillWriteBarrierOptionsV1
): Promise<SupabaseBackfillWriteBarrierReviewEnvelopeV1> {
  const options = optionsSnapshot(input)
  const inspection = await inspectSupabaseBackfillLiveCatalogV1(options)
  ensureCatalogReady(inspection)

  const current = await liveBinding(options)
  requireSameBinding(inspection.subjectDigest, inspection.authority, current)
  const { subject } = current.subjectEnvelope
  const logicalScopeDigest = await digest(logicalScope(subject))
  const constraintName = safeConstraintName(logicalScopeDigest)
  const markerBindingDigest = await digest({
    format: 'openpencil.supabase-backfill-write-barrier-marker-binding.v1',
    providerId: 'supabase',
    projectRef: inspection.authority.projectRef,
    accountId: inspection.authority.accountId,
    subjectDigest: inspection.subjectDigest,
    providerAuthorityDigest: subject.providerAuthority.digest,
    applicationId: subject.application.id,
    applicationDigest: subject.application.digest,
    migrationId: subject.migration.id,
    migrationDigest: subject.migration.digest,
    entityId: subject.migration.entity.id,
    targetFieldId: subject.migration.target.fieldId,
    catalog: inspection.catalog
  })
  const marker = `${SUPABASE_BACKFILL_WRITE_BARRIER_MARKER_PREFIX}${markerBindingDigest}`
  const sql = previewSql(
    inspection.catalog.table.name,
    inspection.catalog.target.name,
    constraintName,
    marker
  )
  const [inspectionDigest, authorityDigest, catalogPreconditionDigest, sqlDigest] =
    await Promise.all([
      digest(inspection),
      digest(inspection.authority),
      digest(catalogPrecondition(inspection.subjectDigest, inspection)),
      digestSql(sql)
    ])
  const sqlBytes = new TextEncoder().encode(sql).byteLength
  const reviewWithoutDigest = Object.freeze({
    format: SUPABASE_BACKFILL_WRITE_BARRIER_REVIEW_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    environmentVerified: false as const,
    reviewOnly: true as const,
    applyAvailable: false as const,
    releaseReady: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    bindings: Object.freeze({
      subjectDigest: inspection.subjectDigest,
      inspectionDigest,
      authorityDigest,
      queryDigest: inspection.query.digest,
      providerAuthorityDigest: subject.providerAuthority.digest,
      applicationDigest: subject.application.digest,
      backendPlanDigest: subject.plan.digest,
      adapterPlanDigest: subject.plan.adapterPlanDigest,
      manifestDigest: subject.emission.manifestDigest,
      migrationDigest: subject.migration.digest,
      logicalScopeDigest,
      markerBindingDigest,
      catalogPreconditionDigest,
      sqlDigest
    }),
    authority: Object.freeze({ ...inspection.authority }),
    address: Object.freeze({
      schemaName: 'public' as const,
      schemaOid: inspection.catalog.schema.oid,
      tableName: inspection.catalog.table.name,
      tableOid: inspection.catalog.table.oid,
      cursorField: inspection.catalog.cursor.name,
      cursorSubId: inspection.catalog.cursor.subId,
      cursorTypeOid: inspection.catalog.cursor.typeOid,
      targetField: inspection.catalog.target.name,
      targetSubId: inspection.catalog.target.subId,
      targetTypeOid: inspection.catalog.target.typeOid,
      sequenceOid: inspection.catalog.sequence.oid
    }),
    barrier: Object.freeze({
      kind: 'not-valid-check' as const,
      constraintName,
      marker,
      predicate: 'target-is-not-null' as const,
      installStatus: 'planned-not-installed' as const,
      validated: false as const,
      inherited: false as const,
      effectsWhenInstalled: Object.freeze({
        rejectsNewNull: true as const,
        rejectsUpdatesLeavingNull: true as const,
        omittedTargetInsertRejected: true as const,
        validatesExistingRows: false as const,
        deletesLegacyNullRowsAllowed: true as const
      })
    }),
    artifact: Object.freeze({
      path: SUPABASE_BACKFILL_WRITE_BARRIER_ARTIFACT_PATH,
      kind: 'database-schema-review' as const,
      mediaType: 'application/sql; charset=utf-8' as const,
      byteLength: sqlBytes,
      digest: sqlDigest,
      statementCount: 7 as const,
      mutationStatementCount: 2 as const,
      mutationSqlEmitted: true as const,
      mutationDispatched: false as const,
      containsDataRead: false as const,
      containsDml: false as const,
      performsSchemaChange: true as const,
      hostDispatchAvailable: false as const
    }),
    executionPolicy: SUPABASE_BACKFILL_WRITE_BARRIER_EXECUTION_POLICY,
    freshness: Object.freeze({
      snapshotMarker: inspection.snapshotMarker,
      observedAt: inspection.observedAt,
      requiresFreshCatalogAtApply: true as const,
      snapshotIsApplyAuthority: false as const
    }),
    blockers: Object.freeze([...inspection.blockers])
  }) satisfies SupabaseBackfillWriteBarrierReviewV1
  const reviewDigest = await digest(reviewWithoutDigest)

  const final = await liveBinding(options)
  requireSameBinding(inspection.subjectDigest, inspection.authority, final)
  const envelope = Object.freeze({ review: reviewWithoutDigest, reviewDigest, previewSql: sql })
  trustedReviewContexts.set(
    envelope,
    Object.freeze({ envelope, inspection, subject: final.subjectEnvelope.subject })
  )
  return envelope
}

/** Read-only consumers may re-check a genuine in-memory review without turning it into authority. */
export function trustedSupabaseBackfillWriteBarrierReviewContextV1(
  value: unknown
): TrustedSupabaseBackfillWriteBarrierReviewContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  return trustedReviewContexts.get(value) ?? null
}

/**
 * Consume a genuine review identity once when preparing the schema mutation. A serialized or
 * reconstructed review can still be displayed, but it cannot authorize a database write.
 */
export function consumeTrustedSupabaseBackfillWriteBarrierReviewContextV1(
  value: unknown
): TrustedSupabaseBackfillWriteBarrierReviewContextV1 | null {
  if (value === null || typeof value !== 'object' || consumedReviewContexts.has(value)) return null
  const context = trustedReviewContexts.get(value)
  if (!context) return null
  consumedReviewContexts.add(value)
  return context
}
