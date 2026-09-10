/* oxlint-disable eslint/max-lines, eslint/complexity -- The durable dispatch and proof-first settlement protocol is kept together for crash-gap review. */
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  claimBackendReleaseDispatch,
  settleBackendReleaseDispatch
} from '@/app/plugins/host/deployment/backend/release-controller/journal'
import {
  BACKEND_RELEASE_DISPATCH_LEASE_MS,
  BackendHostReleaseUnresolvedScopeError,
  parseBackendHostReleaseDispatchEvidenceRecord,
  parseBackendHostReleaseDispatchJournalRecord,
  trustedBackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchEvidenceRecord,
  type BackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchJournalRecord
} from '@/app/plugins/host/deployment/backend/release-journal'
import {
  SupabaseManagementBackfillWriteBarrierInstallTransportError,
  trustedSupabaseManagementBackfillWriteBarrierInstallTransportV1,
  type SupabaseManagementBackfillWriteBarrierInstallConfirmationV1,
  type SupabaseManagementBackfillWriteBarrierInstallTransportV1
} from '@/app/plugins/host/deployment/supabase/management/backfill/write-barrier-install-transport'

import type { SupabaseBackfillDispatchBindingV1 } from '../dispatch-binding'
import {
  trustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1,
  type SupabaseBackfillWriteBarrierInstallDispatchContextV1,
  type TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1
} from './install'
import {
  trustedSupabaseBackfillWriteBarrierReviewContextV1,
  type TrustedSupabaseBackfillWriteBarrierReviewContextV1
} from './review'
import {
  consumeTrustedSupabaseBackfillWriteBarrierInstalledVerificationV1,
  rotateSupabaseBackfillWriteBarrierInstalledVerificationEpochV1,
  type SupabaseBackfillWriteBarrierInstalledVerificationEpochV1,
  type SupabaseBackfillWriteBarrierVerificationV1
} from './verifier'

export const SUPABASE_BACKFILL_WRITE_BARRIER_DISPATCH_EVIDENCE_FORMAT =
  'openpencil.supabase-backfill-write-barrier-dispatch-evidence.v1' as const

const UNKNOWN_CODE = 'supabase-backfill-write-barrier-dispatch-outcome-unknown' as const
const NOT_DISPATCHED_CODE = 'supabase-backfill-write-barrier-not-dispatched' as const

export type SupabaseBackfillWriteBarrierInstallDispatchStatus =
  | 'verification-required'
  | 'outcome-unknown'
  | 'not-dispatched'
  | 'reconciliation-required'

export interface SupabaseBackfillWriteBarrierInstallDispatchResultV1 {
  readonly status: SupabaseBackfillWriteBarrierInstallDispatchStatus
  readonly automaticRetryAllowed: false
  readonly singleFlightKey: string
  readonly dispatchScopeKey: string
  readonly claim: BackendHostReleaseDispatchJournalRecord | null
  readonly confirmation: SupabaseManagementBackfillWriteBarrierInstallConfirmationV1 | null
  readonly code: string
}

export interface DispatchSupabaseBackfillWriteBarrierInstallOptionsV1 {
  readonly context: SupabaseBackfillWriteBarrierInstallDispatchContextV1
  readonly transport: SupabaseManagementBackfillWriteBarrierInstallTransportV1
  readonly journal: BackendHostReleaseDispatchJournal
  readonly releaseId: string
  readonly ownerId: string
  readonly now: () => string
}

export interface ReconcileSupabaseBackfillWriteBarrierInstallOptionsV1 {
  readonly context: SupabaseBackfillWriteBarrierInstallDispatchContextV1
  readonly installedVerification: SupabaseBackfillWriteBarrierVerificationV1
  readonly journal: BackendHostReleaseDispatchJournal
  readonly now: () => string
}

export interface SupabaseBackfillWriteBarrierInstallReconciliationResultV1 {
  readonly status: 'applied' | 'outcome-unknown'
  readonly automaticRetryAllowed: false
  readonly singleFlightKey: string
  readonly dispatchScopeKey: string
  readonly claim: BackendHostReleaseDispatchJournalRecord
  readonly constraintOid: string | null
  readonly code: string | null
}

export interface SupabaseBackfillWriteBarrierInstalledEvidenceV1 {
  readonly verificationDigest: string
  readonly constraintOid: string
  readonly snapshotMarker: string
  readonly observedAt: string
  readonly serverVersionNum: string
}

/**
 * Same-process proof that one exact applied reconciliation passed the durable journal boundary.
 * None of these fields can recreate this authority after serialization; consumers must present the
 * exact registered result and dispatch-context identities.
 */
export interface TrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1 {
  readonly context: SupabaseBackfillWriteBarrierInstallDispatchContextV1
  readonly result: SupabaseBackfillWriteBarrierInstallReconciliationResultV1
  readonly sourceReview: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1['sourceReview']
  readonly inspection: TrustedSupabaseBackfillWriteBarrierReviewContextV1['inspection']
  readonly subject: TrustedSupabaseBackfillWriteBarrierReviewContextV1['subject']
  readonly installedEvidence: SupabaseBackfillWriteBarrierInstalledEvidenceV1
  readonly writeAuthority: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1['writeAuthority']
  readonly stagingTarget: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1['stagingTarget']
}

export type SupabaseBackfillWriteBarrierInstallControllerErrorCode =
  | 'supabase-backfill-write-barrier-controller-input-invalid'
  | 'supabase-backfill-write-barrier-controller-journal-failed'
  | 'supabase-backfill-write-barrier-controller-evidence-invalid'
  | 'supabase-backfill-write-barrier-controller-installed-proof-invalid'

export class SupabaseBackfillWriteBarrierInstallControllerError extends Error {
  constructor(readonly code: SupabaseBackfillWriteBarrierInstallControllerErrorCode) {
    super(`Supabase backfill write-barrier install controller failed: ${code}.`)
    this.name = 'SupabaseBackfillWriteBarrierInstallControllerError'
  }
}

type DispatchStage =
  | 'authorized'
  | 'project-authority-confirmed'
  | 'migration-accepted-verification-required'
  | 'dispatch-outcome-unknown'
  | 'not-dispatched'
  | 'installed-proof-observed'

type JournalBinding = SupabaseBackfillDispatchBindingV1

interface ProgressEvidenceV1 {
  readonly format: typeof SUPABASE_BACKFILL_WRITE_BARRIER_DISPATCH_EVIDENCE_FORMAT
  readonly version: 1
  readonly phase: 'progress'
  readonly stage: DispatchStage
  readonly providerId: 'supabase'
  readonly projectRef: string
  readonly accountId: string
  readonly readGrantGeneration: string
  readonly writeGrantGeneration: string
  readonly reviewDigest: string
  readonly subjectDigest: string
  readonly catalogPreconditionDigest: string
  readonly absentVerificationDigest: string
  readonly installDigest: string
  readonly sqlDigest: string
  readonly migrationName: string
  readonly address: Readonly<{
    schemaOid: string
    tableOid: string
    targetSubId: number
    targetTypeOid: string
  }>
  readonly barrier: Readonly<{
    constraintName: string
    marker: string
  }>
  readonly serverVersionNum: string
  readonly sourceLedgerBound: false
  readonly automaticRetryAllowed: false
}

interface FinalEvidenceV1 extends Omit<ProgressEvidenceV1, 'phase' | 'stage'> {
  readonly phase: 'final'
  readonly stage: 'installed-proof-observed' | 'not-dispatched'
  readonly installedVerificationDigest: string | null
  readonly constraintOid: string | null
  readonly installedSnapshotMarker: string | null
  readonly installedObservedAt: string | null
}

type ControllerEvidenceV1 = ProgressEvidenceV1 | FinalEvidenceV1

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

export interface SupabaseBackfillWriteBarrierJournalPermitExpectationV1 {
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly migrationName: string
  readonly installDigest: string
}

interface TrustedJournalPermit {
  readonly journal: BackendHostReleaseDispatchJournal
  readonly binding: JournalBinding & Readonly<{ releaseId: string }>
  readonly expected: SupabaseBackfillWriteBarrierJournalPermitExpectationV1
  readonly context: SupabaseBackfillWriteBarrierInstallDispatchContextV1
  readonly trusted: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1
  readonly claimFingerprint: string
  readonly evidenceFingerprint: string
}

const DISPATCH_OPTION_KEYS = [
  'context',
  'transport',
  'journal',
  'releaseId',
  'ownerId',
  'now'
] as const
const RECONCILE_OPTION_KEYS = ['context', 'installedVerification', 'journal', 'now'] as const
const JOURNAL_PERMIT_EXPECTATION_KEYS = [
  'projectRef',
  'accountId',
  'grantGeneration',
  'migrationName',
  'installDigest'
] as const
const FINAL_EVIDENCE_KEYS = [
  'format',
  'version',
  'providerId',
  'projectRef',
  'accountId',
  'readGrantGeneration',
  'writeGrantGeneration',
  'reviewDigest',
  'subjectDigest',
  'catalogPreconditionDigest',
  'absentVerificationDigest',
  'installDigest',
  'sqlDigest',
  'migrationName',
  'address',
  'barrier',
  'serverVersionNum',
  'sourceLedgerBound',
  'automaticRetryAllowed',
  'phase',
  'stage',
  'installedVerificationDigest',
  'constraintOid',
  'installedSnapshotMarker',
  'installedObservedAt'
] as const
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const OID = /^(?:0|[1-9][0-9]{0,9})$/u
const SNAPSHOT_MARKER = /^[0-9:,]{1,512}$/u

const requiredInstalledVerificationEpochs = new WeakMap<
  object,
  SupabaseBackfillWriteBarrierInstalledVerificationEpochV1
>()
const trustedJournalPermits = new WeakMap<object, TrustedJournalPermit>()
const trustedAppliedReconciliations = new WeakMap<
  object,
  TrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1
>()
const consumedAppliedReconciliations = new WeakSet<object>()

function fail(code: SupabaseBackfillWriteBarrierInstallControllerErrorCode): never {
  throw new SupabaseBackfillWriteBarrierInstallControllerError(code)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-write-barrier-controller-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-write-barrier-controller-input-invalid')
  }
  return descriptor.value
}

function exactRecord(value: unknown, keys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('supabase-backfill-write-barrier-controller-input-invalid')
  }
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-write-barrier-controller-input-invalid')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail('supabase-backfill-write-barrier-controller-input-invalid')
  }
  for (const key of keys) ownData(value, key)
  return value as UnknownRecord
}

function stableId(value: unknown): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) {
    return fail('supabase-backfill-write-barrier-controller-input-invalid')
  }
  return value
}

function dispatchOptionsSnapshot(
  value: unknown
): DispatchSupabaseBackfillWriteBarrierInstallOptionsV1 {
  const source = exactRecord(value, DISPATCH_OPTION_KEYS)
  const context = ownData(source, 'context')
  const transport = ownData(source, 'transport')
  const journal = ownData(source, 'journal')
  const now = ownData(source, 'now')
  if (
    context === null ||
    typeof context !== 'object' ||
    !trustedSupabaseManagementBackfillWriteBarrierInstallTransportV1(transport) ||
    !trustedBackendHostReleaseDispatchJournal(journal) ||
    typeof now !== 'function'
  ) {
    return fail('supabase-backfill-write-barrier-controller-input-invalid')
  }
  return Object.freeze({
    context: context as SupabaseBackfillWriteBarrierInstallDispatchContextV1,
    transport,
    journal,
    releaseId: stableId(ownData(source, 'releaseId')),
    ownerId: stableId(ownData(source, 'ownerId')),
    now: now as () => string
  })
}

function reconcileOptionsSnapshot(
  value: unknown
): ReconcileSupabaseBackfillWriteBarrierInstallOptionsV1 {
  const source = exactRecord(value, RECONCILE_OPTION_KEYS)
  const context = ownData(source, 'context')
  const installedVerification = ownData(source, 'installedVerification')
  const journal = ownData(source, 'journal')
  const now = ownData(source, 'now')
  if (
    context === null ||
    typeof context !== 'object' ||
    installedVerification === null ||
    typeof installedVerification !== 'object' ||
    !trustedBackendHostReleaseDispatchJournal(journal) ||
    typeof now !== 'function'
  ) {
    return fail('supabase-backfill-write-barrier-controller-input-invalid')
  }
  return Object.freeze({
    context: context as SupabaseBackfillWriteBarrierInstallDispatchContextV1,
    installedVerification: installedVerification as SupabaseBackfillWriteBarrierVerificationV1,
    journal,
    now: now as () => string
  })
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') {
    return fail('supabase-backfill-write-barrier-controller-input-invalid')
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail('supabase-backfill-write-barrier-controller-input-invalid')
  }
  return value
}

function currentTimestamp(now: () => string): string {
  try {
    return canonicalTimestamp(now())
  } catch (cause) {
    if (cause instanceof SupabaseBackfillWriteBarrierInstallControllerError) throw cause
    return fail('supabase-backfill-write-barrier-controller-input-invalid')
  }
}

function encoded(parts: readonly string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(':')
}

function journalBinding(
  context: SupabaseBackfillWriteBarrierInstallDispatchContextV1,
  evidence: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1
): JournalBinding {
  return Object.freeze({
    singleFlightKey: encoded([
      'backend-release-v3',
      'supabase',
      context.projectRef,
      evidence.sourceReview.review.authority.accountId,
      'backfill-write-barrier',
      evidence.sourceReview.review.bindings.logicalScopeDigest,
      evidence.sourceReview.review.bindings.markerBindingDigest,
      context.installDigest
    ]),
    dispatchScopeKey: encoded([
      'backend-release-dispatch-scope-v1',
      'supabase',
      context.projectRef
    ]),
    planDigest: context.installDigest
  })
}

function evidenceBase(
  context: SupabaseBackfillWriteBarrierInstallDispatchContextV1,
  trusted: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1
) {
  const source = trusted.sourceReview.review
  const verification = trusted.absentVerification
  return Object.freeze({
    format: SUPABASE_BACKFILL_WRITE_BARRIER_DISPATCH_EVIDENCE_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    projectRef: context.projectRef,
    accountId: context.accountId,
    readGrantGeneration: source.authority.grantGeneration,
    writeGrantGeneration: trusted.writeAuthority.grantGeneration,
    reviewDigest: context.reviewDigest,
    subjectDigest: source.bindings.subjectDigest,
    catalogPreconditionDigest: source.bindings.catalogPreconditionDigest,
    absentVerificationDigest: context.verificationDigest,
    installDigest: context.installDigest,
    sqlDigest: trusted.installReview.review.artifact.digest,
    migrationName: context.migrationName,
    address: Object.freeze({
      schemaOid: source.address.schemaOid,
      tableOid: source.address.tableOid,
      targetSubId: source.address.targetSubId,
      targetTypeOid: source.address.targetTypeOid
    }),
    barrier: Object.freeze({
      constraintName: source.barrier.constraintName,
      marker: source.barrier.marker
    }),
    serverVersionNum: verification.serverVersionNum,
    sourceLedgerBound: false as const,
    automaticRetryAllowed: false as const
  })
}

function progressEvidence(
  context: SupabaseBackfillWriteBarrierInstallDispatchContextV1,
  trusted: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1,
  stage: Exclude<DispatchStage, 'installed-proof-observed' | 'not-dispatched'>
): ProgressEvidenceV1 {
  return Object.freeze({ ...evidenceBase(context, trusted), phase: 'progress' as const, stage })
}

function finalEvidence(
  context: SupabaseBackfillWriteBarrierInstallDispatchContextV1,
  trusted: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1,
  stage: FinalEvidenceV1['stage'],
  verification: SupabaseBackfillWriteBarrierVerificationV1 | null
): FinalEvidenceV1 {
  return Object.freeze({
    ...evidenceBase(context, trusted),
    phase: 'final' as const,
    stage,
    installedVerificationDigest: verification?.verificationDigest ?? null,
    constraintOid: verification?.barrier.constraintOid ?? null,
    installedSnapshotMarker: verification?.snapshotMarker ?? null,
    installedObservedAt: verification?.observedAt ?? null
  })
}

async function evidenceInput(
  binding: JournalBinding,
  claim: BackendHostReleaseDispatchJournalRecord,
  phase: BackendHostReleaseDispatchEvidenceRecord['phase'],
  payload: ControllerEvidenceV1,
  recordedAt: string
) {
  const serialized = JSON.stringify(payload)
  return Object.freeze({
    singleFlightKey: binding.singleFlightKey,
    dispatchScopeKey: binding.dispatchScopeKey,
    releaseId: claim.releaseId,
    planDigest: binding.planDigest,
    phase,
    payload: serialized,
    payloadDigest: await digestCanonicalManifest(payload),
    recordedAt
  })
}

async function persistEvidence(
  journal: BackendHostReleaseDispatchJournal,
  binding: JournalBinding,
  claim: BackendHostReleaseDispatchJournalRecord,
  payload: ControllerEvidenceV1,
  recordedAt: string
): Promise<BackendHostReleaseDispatchEvidenceRecord> {
  const input = await evidenceInput(binding, claim, payload.phase, payload, recordedAt)
  const persisted = parseBackendHostReleaseDispatchEvidenceRecord(
    await journal.recordEvidence(input)
  )
  if (
    persisted.singleFlightKey !== input.singleFlightKey ||
    persisted.dispatchScopeKey !== input.dispatchScopeKey ||
    persisted.releaseId !== input.releaseId ||
    persisted.planDigest !== input.planDigest ||
    persisted.phase !== input.phase ||
    persisted.payload !== input.payload ||
    persisted.payloadDigest !== input.payloadDigest ||
    persisted.recordedAt !== input.recordedAt
  ) {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  return persisted
}

function requireClaimBinding(
  value: unknown,
  binding: JournalBinding
): BackendHostReleaseDispatchJournalRecord {
  const claim = parseBackendHostReleaseDispatchJournalRecord(value)
  if (
    claim.version !== 2 ||
    claim.singleFlightKey !== binding.singleFlightKey ||
    claim.dispatchScopeKey !== binding.dispatchScopeKey ||
    claim.planDigest !== binding.planDigest
  ) {
    return fail('supabase-backfill-write-barrier-controller-journal-failed')
  }
  return claim
}

async function settle(
  journal: BackendHostReleaseDispatchJournal,
  binding: JournalBinding,
  claim: BackendHostReleaseDispatchJournalRecord,
  outcome: 'applied' | 'failed' | 'outcome-unknown',
  code: string | null,
  settledAt: string
): Promise<BackendHostReleaseDispatchJournalRecord> {
  return requireClaimBinding(
    await settleBackendReleaseDispatch(journal, {
      singleFlightKey: binding.singleFlightKey,
      releaseId: claim.releaseId,
      planDigest: binding.planDigest,
      settledAt,
      outcome,
      code,
      remoteOperationIds: []
    }),
    binding
  )
}

function dispatchResult(
  status: SupabaseBackfillWriteBarrierInstallDispatchStatus,
  binding: JournalBinding,
  claim: BackendHostReleaseDispatchJournalRecord | null,
  confirmation: SupabaseManagementBackfillWriteBarrierInstallConfirmationV1 | null,
  code: string
): SupabaseBackfillWriteBarrierInstallDispatchResultV1 {
  return Object.freeze({
    status,
    automaticRetryAllowed: false as const,
    singleFlightKey: binding.singleFlightKey,
    dispatchScopeKey: binding.dispatchScopeKey,
    claim,
    confirmation,
    code
  })
}

function trustedContext(
  context: SupabaseBackfillWriteBarrierInstallDispatchContextV1
): TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1 {
  const trusted = trustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1(context)
  if (
    !trusted ||
    context.projectRef !== trusted.writeAuthority.projectRef ||
    context.accountId !== trusted.writeAuthority.accountId ||
    context.reviewDigest !== trusted.sourceReview.reviewDigest ||
    context.verificationDigest !== trusted.absentVerification.verificationDigest ||
    context.installDigest !== trusted.installReview.review.bindings.installDigest ||
    context.migrationName !== trusted.installReview.review.migration.name
  ) {
    return fail('supabase-backfill-write-barrier-controller-input-invalid')
  }
  return trusted
}

function registerAppliedReconciliation(
  context: SupabaseBackfillWriteBarrierInstallDispatchContextV1,
  result: SupabaseBackfillWriteBarrierInstallReconciliationResultV1,
  trusted: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1,
  final: FinalEvidenceV1
): SupabaseBackfillWriteBarrierInstallReconciliationResultV1 {
  const reviewContext = trustedSupabaseBackfillWriteBarrierReviewContextV1(trusted.sourceReview)
  if (
    !reviewContext ||
    reviewContext.envelope !== trusted.sourceReview ||
    result.status !== 'applied' ||
    result.code !== null ||
    result.claim.outcome !== 'applied' ||
    final.stage !== 'installed-proof-observed' ||
    final.installedVerificationDigest === null ||
    final.constraintOid === null ||
    final.installedSnapshotMarker === null ||
    final.installedObservedAt === null ||
    result.constraintOid !== final.constraintOid
  ) {
    return fail('supabase-backfill-write-barrier-controller-installed-proof-invalid')
  }
  const installedEvidence = Object.freeze({
    verificationDigest: final.installedVerificationDigest,
    constraintOid: final.constraintOid,
    snapshotMarker: final.installedSnapshotMarker,
    observedAt: final.installedObservedAt,
    serverVersionNum: final.serverVersionNum
  }) satisfies SupabaseBackfillWriteBarrierInstalledEvidenceV1
  trustedAppliedReconciliations.set(
    result,
    Object.freeze({
      context,
      result,
      sourceReview: trusted.sourceReview,
      inspection: reviewContext.inspection,
      subject: reviewContext.subject,
      installedEvidence,
      writeAuthority: trusted.writeAuthority,
      stagingTarget: trusted.stagingTarget
    })
  )
  return result
}

/** Inspect an exact Host-created applied result without consuming its downstream authority. */
export function trustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(
  value: unknown,
  expectedContext: SupabaseBackfillWriteBarrierInstallDispatchContextV1
): TrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1 | null {
  if (value === null || typeof value !== 'object') return null
  const trusted = trustedAppliedReconciliations.get(value)
  if (!trusted || trusted.context !== expectedContext || trusted.result !== value) return null
  return trusted
}

/** Consume one exact Host-created applied result before beginning a downstream privileged flow. */
export function consumeTrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(
  value: unknown,
  expectedContext: SupabaseBackfillWriteBarrierInstallDispatchContextV1
): TrustedSupabaseBackfillWriteBarrierAppliedReconciliationV1 | null {
  if (value === null || typeof value !== 'object' || consumedAppliedReconciliations.has(value)) {
    return null
  }
  const trusted = trustedSupabaseBackfillWriteBarrierAppliedReconciliationV1(value, expectedContext)
  if (!trusted) return null
  consumedAppliedReconciliations.add(value)
  return trusted
}

function journalPermitExpectation(
  context: SupabaseBackfillWriteBarrierInstallDispatchContextV1,
  trusted: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1
): SupabaseBackfillWriteBarrierJournalPermitExpectationV1 {
  return Object.freeze({
    projectRef: context.projectRef,
    accountId: context.accountId,
    grantGeneration: trusted.writeAuthority.grantGeneration,
    migrationName: context.migrationName,
    installDigest: context.installDigest
  })
}

function sameJournalPermitExpectation(
  value: unknown,
  expected: SupabaseBackfillWriteBarrierJournalPermitExpectationV1
): boolean {
  try {
    const source = exactRecord(value, JOURNAL_PERMIT_EXPECTATION_KEYS)
    return JOURNAL_PERMIT_EXPECTATION_KEYS.every((key) => ownData(source, key) === expected[key])
  } catch {
    return false
  }
}

function grantJournalPermit(
  context: SupabaseBackfillWriteBarrierInstallDispatchContextV1,
  trusted: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1,
  journal: BackendHostReleaseDispatchJournal,
  binding: JournalBinding,
  claim: BackendHostReleaseDispatchJournalRecord,
  evidence: BackendHostReleaseDispatchEvidenceRecord
): void {
  trustedJournalPermits.set(
    context as object,
    Object.freeze({
      journal,
      binding: Object.freeze({ ...binding, releaseId: claim.releaseId }),
      expected: journalPermitExpectation(context, trusted),
      context,
      trusted,
      claimFingerprint: JSON.stringify(claim),
      evidenceFingerprint: JSON.stringify(evidence)
    })
  )
}

/**
 * Consume the controller's private one-shot permit and re-read its durable pre-POST state. This is
 * exported only so the fixed-origin transport can enforce the final network boundary; no exported
 * API can mint a permit.
 */
export async function consumeTrustedSupabaseBackfillWriteBarrierJournalPermitV1(
  context: object,
  expectedValue: SupabaseBackfillWriteBarrierJournalPermitExpectationV1
): Promise<boolean> {
  const permit = trustedJournalPermits.get(context)
  trustedJournalPermits.delete(context)
  if (!permit || !sameJournalPermitExpectation(expectedValue, permit.expected)) return false
  try {
    const [rawClaim, rawEvidence] = await Promise.all([
      permit.journal.read(permit.binding.singleFlightKey),
      permit.journal.readEvidence(permit.binding.singleFlightKey)
    ])
    if (!rawClaim || !rawEvidence) return false
    const claim = requireClaimBinding(rawClaim, permit.binding)
    const evidence = parseBackendHostReleaseDispatchEvidenceRecord(rawEvidence)
    if (
      claim.releaseId !== permit.binding.releaseId ||
      claim.outcome !== 'outcome-unknown' ||
      claim.code !== UNKNOWN_CODE ||
      claim.settledAt === null ||
      claim.remoteOperationIds.length !== 0 ||
      evidence.singleFlightKey !== permit.binding.singleFlightKey ||
      evidence.dispatchScopeKey !== permit.binding.dispatchScopeKey ||
      evidence.releaseId !== permit.binding.releaseId ||
      evidence.planDigest !== permit.binding.planDigest ||
      evidence.phase !== 'progress' ||
      Date.parse(evidence.recordedAt) > Date.parse(claim.settledAt)
    ) {
      return false
    }
    const progress = parseProgressEvidence(evidence, permit.context, permit.trusted)
    return (
      progress.stage === 'project-authority-confirmed' &&
      (await digestCanonicalManifest(progress)) === evidence.payloadDigest &&
      JSON.stringify(claim) === permit.claimFingerprint &&
      JSON.stringify(evidence) === permit.evidenceFingerprint
    )
  } catch {
    return false
  }
}

async function failKnownNotDispatched(
  options: DispatchSupabaseBackfillWriteBarrierInstallOptionsV1,
  binding: JournalBinding,
  trusted: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1,
  claim: BackendHostReleaseDispatchJournalRecord
): Promise<SupabaseBackfillWriteBarrierInstallDispatchResultV1> {
  let record = claim
  try {
    const payload = finalEvidence(options.context, trusted, 'not-dispatched', null)
    await persistEvidence(options.journal, binding, record, payload, currentTimestamp(options.now))
    record = await settle(
      options.journal,
      binding,
      record,
      'failed',
      NOT_DISPATCHED_CODE,
      currentTimestamp(options.now)
    )
  } catch {
    return dispatchResult(
      'reconciliation-required',
      binding,
      record,
      null,
      'supabase-backfill-write-barrier-journal-reconciliation-required'
    )
  }
  return dispatchResult('not-dispatched', binding, record, null, NOT_DISPATCHED_CODE)
}

async function recoverFinalNotDispatched(
  options: DispatchSupabaseBackfillWriteBarrierInstallOptionsV1,
  binding: JournalBinding,
  trusted: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1,
  claim: BackendHostReleaseDispatchJournalRecord
): Promise<SupabaseBackfillWriteBarrierInstallDispatchResultV1 | null> {
  let evidence: BackendHostReleaseDispatchEvidenceRecord
  try {
    const rawEvidence = await options.journal.readEvidence(binding.singleFlightKey)
    if (!rawEvidence) return null
    evidence = parseBackendHostReleaseDispatchEvidenceRecord(rawEvidence)
    if (
      evidence.singleFlightKey !== binding.singleFlightKey ||
      evidence.dispatchScopeKey !== binding.dispatchScopeKey ||
      evidence.releaseId !== claim.releaseId ||
      evidence.planDigest !== binding.planDigest ||
      evidence.phase !== 'final'
    ) {
      return null
    }
    const payload = await parseFinalEvidence(evidence, options.context, trusted)
    if (payload.stage !== 'not-dispatched') return null
  } catch {
    return dispatchResult(
      'reconciliation-required',
      binding,
      claim,
      null,
      'supabase-backfill-write-barrier-journal-reconciliation-required'
    )
  }
  if (claim.outcome === 'failed') {
    return dispatchResult('not-dispatched', binding, claim, null, NOT_DISPATCHED_CODE)
  }
  if (claim.outcome !== 'pending' && claim.outcome !== 'outcome-unknown') return null
  try {
    const settled = await settle(
      options.journal,
      binding,
      claim,
      'failed',
      NOT_DISPATCHED_CODE,
      currentTimestamp(options.now)
    )
    return dispatchResult('not-dispatched', binding, settled, null, NOT_DISPATCHED_CODE)
  } catch {
    return dispatchResult(
      'reconciliation-required',
      binding,
      claim,
      null,
      'supabase-backfill-write-barrier-journal-reconciliation-required'
    )
  }
}

/**
 * Persist a claim, complete progress evidence, and an outcome-unknown settlement before POST. HTTP
 * success remains verification-required and never maps directly to applied.
 */
export async function dispatchSupabaseBackfillWriteBarrierInstallV1(
  input: DispatchSupabaseBackfillWriteBarrierInstallOptionsV1
): Promise<SupabaseBackfillWriteBarrierInstallDispatchResultV1> {
  const options = dispatchOptionsSnapshot(input)
  const trusted = trustedContext(options.context)
  const binding = journalBinding(options.context, trusted)
  const claimedAt = currentTimestamp(options.now)
  let claimResult
  try {
    claimResult = await claimBackendReleaseDispatch(options.journal, {
      ...binding,
      releaseId: options.releaseId,
      ownerId: options.ownerId,
      claimedAt,
      leaseExpiresAt: new Date(
        Date.parse(claimedAt) + BACKEND_RELEASE_DISPATCH_LEASE_MS
      ).toISOString()
    })
  } catch (cause) {
    if (cause instanceof BackendHostReleaseUnresolvedScopeError) {
      return dispatchResult(
        'reconciliation-required',
        binding,
        null,
        null,
        'supabase-backfill-write-barrier-unresolved-scope'
      )
    }
    return fail('supabase-backfill-write-barrier-controller-journal-failed')
  }
  let claim = requireClaimBinding(claimResult.record, binding)
  if (!claimResult.claimed) {
    const recovered = await recoverFinalNotDispatched(options, binding, trusted, claim)
    if (recovered) return recovered
    return dispatchResult(
      'reconciliation-required',
      binding,
      claim,
      null,
      'supabase-backfill-write-barrier-existing-claim'
    )
  }
  try {
    await persistEvidence(
      options.journal,
      binding,
      claim,
      progressEvidence(options.context, trusted, 'authorized'),
      claimedAt
    )
  } catch {
    return failKnownNotDispatched(options, binding, trusted, claim)
  }

  let prepared
  try {
    prepared = await options.transport.prepareMigration(options.context)
  } catch {
    return failKnownNotDispatched(options, binding, trusted, claim)
  }
  if (
    prepared.projectAuthority.projectRef !== trusted.writeAuthority.projectRef ||
    prepared.projectAuthority.organizationId !== trusted.writeAuthority.accountId ||
    prepared.projectAuthority.grantGeneration !== trusted.writeAuthority.grantGeneration
  ) {
    return failKnownNotDispatched(options, binding, trusted, claim)
  }
  let permitEvidence: BackendHostReleaseDispatchEvidenceRecord
  try {
    permitEvidence = await persistEvidence(
      options.journal,
      binding,
      claim,
      progressEvidence(options.context, trusted, 'project-authority-confirmed'),
      currentTimestamp(options.now)
    )
    claim = await settle(
      options.journal,
      binding,
      claim,
      'outcome-unknown',
      UNKNOWN_CODE,
      currentTimestamp(options.now)
    )
  } catch {
    return failKnownNotDispatched(options, binding, trusted, claim)
  }
  grantJournalPermit(options.context, trusted, options.journal, binding, claim, permitEvidence)

  let confirmation: SupabaseManagementBackfillWriteBarrierInstallConfirmationV1
  try {
    confirmation = await prepared.dispatch()
  } catch (cause) {
    if (
      cause instanceof SupabaseManagementBackfillWriteBarrierInstallTransportError &&
      cause.outcome === 'not-dispatched'
    ) {
      return failKnownNotDispatched(options, binding, trusted, claim)
    }
    requiredInstalledVerificationEpochs.set(
      options.context as object,
      rotateSupabaseBackfillWriteBarrierInstalledVerificationEpochV1(trusted.sourceReview)
    )
    try {
      await persistEvidence(
        options.journal,
        binding,
        claim,
        progressEvidence(options.context, trusted, 'dispatch-outcome-unknown'),
        currentTimestamp(options.now)
      )
      // oxlint-disable-next-line open-pencil/no-silent-catch -- The durable outcome-unknown claim remains authoritative when evidence enrichment fails.
    } catch {
      // The durable outcome-unknown claim remains authoritative when evidence enrichment fails.
    }
    return dispatchResult('outcome-unknown', binding, claim, null, UNKNOWN_CODE)
  }
  requiredInstalledVerificationEpochs.set(
    options.context as object,
    rotateSupabaseBackfillWriteBarrierInstalledVerificationEpochV1(trusted.sourceReview)
  )
  if (
    confirmation.migrationName !== options.context.migrationName ||
    confirmation.installDigest !== options.context.installDigest
  ) {
    return dispatchResult('outcome-unknown', binding, claim, null, UNKNOWN_CODE)
  }
  try {
    await persistEvidence(
      options.journal,
      binding,
      claim,
      progressEvidence(options.context, trusted, 'migration-accepted-verification-required'),
      currentTimestamp(options.now)
    )
  } catch {
    return dispatchResult('outcome-unknown', binding, claim, confirmation, UNKNOWN_CODE)
  }
  return dispatchResult(
    'verification-required',
    binding,
    claim,
    confirmation,
    'supabase-backfill-write-barrier-installed-proof-required'
  )
}

function parseProgressEvidence(
  value: BackendHostReleaseDispatchEvidenceRecord,
  context: SupabaseBackfillWriteBarrierInstallDispatchContextV1,
  trusted: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1
): ProgressEvidenceV1 {
  if (value.phase !== 'progress') {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value.payload) as unknown
  } catch {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  const descriptor = Object.getOwnPropertyDescriptor(parsed, 'stage')
  const stage = descriptor && 'value' in descriptor ? descriptor.value : null
  if (
    stage !== 'project-authority-confirmed' &&
    stage !== 'migration-accepted-verification-required' &&
    stage !== 'dispatch-outcome-unknown'
  ) {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  const expected = progressEvidence(context, trusted, stage)
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  return expected
}

function exactEvidenceRecord(value: unknown, keys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
    }
  }
  return value as UnknownRecord
}

function evidenceText(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  return value
}

async function parseFinalEvidence(
  value: BackendHostReleaseDispatchEvidenceRecord,
  context: SupabaseBackfillWriteBarrierInstallDispatchContextV1,
  trusted: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1
): Promise<FinalEvidenceV1> {
  if (value.phase !== 'final') {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value.payload) as unknown
  } catch {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  const source = exactEvidenceRecord(parsed, FINAL_EVIDENCE_KEYS)
  const stage = source.stage
  if (stage !== 'installed-proof-observed' && stage !== 'not-dispatched') {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  let installedVerificationDigest: string | null = null
  let constraintOid: string | null = null
  let installedSnapshotMarker: string | null = null
  let installedObservedAt: string | null = null
  if (stage === 'installed-proof-observed') {
    installedVerificationDigest = evidenceText(source.installedVerificationDigest, DIGEST)
    constraintOid = evidenceText(source.constraintOid, OID)
    installedSnapshotMarker = evidenceText(source.installedSnapshotMarker, SNAPSHOT_MARKER)
    if (
      typeof source.installedObservedAt !== 'string' ||
      !Number.isFinite(Date.parse(source.installedObservedAt)) ||
      new Date(source.installedObservedAt).toISOString() !== source.installedObservedAt
    ) {
      return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
    }
    installedObservedAt = source.installedObservedAt
  } else if (
    source.installedVerificationDigest !== null ||
    source.constraintOid !== null ||
    source.installedSnapshotMarker !== null ||
    source.installedObservedAt !== null
  ) {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  const expected = Object.freeze({
    ...evidenceBase(context, trusted),
    phase: 'final' as const,
    stage,
    installedVerificationDigest,
    constraintOid,
    installedSnapshotMarker,
    installedObservedAt
  })
  if (
    JSON.stringify(parsed) !== JSON.stringify(expected) ||
    JSON.stringify(parsed) !== value.payload ||
    (await digestCanonicalManifest(expected)) !== value.payloadDigest
  ) {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  return expected
}

function appliedReconciliationResult(
  context: SupabaseBackfillWriteBarrierInstallDispatchContextV1,
  trusted: TrustedSupabaseBackfillWriteBarrierInstallDispatchEvidenceV1,
  binding: JournalBinding,
  claim: BackendHostReleaseDispatchJournalRecord,
  final: FinalEvidenceV1
): SupabaseBackfillWriteBarrierInstallReconciliationResultV1 {
  const result = Object.freeze({
    status: 'applied' as const,
    automaticRetryAllowed: false as const,
    singleFlightKey: binding.singleFlightKey,
    dispatchScopeKey: binding.dispatchScopeKey,
    claim,
    constraintOid: final.constraintOid,
    code: null
  })
  return registerAppliedReconciliation(context, result, trusted, final)
}

/**
 * Settle a fresh installed proof, or resume only the terminal settlement represented by exact
 * immutable final evidence in a Host-created journal. Final recovery performs no network write.
 */
export async function reconcileSupabaseBackfillWriteBarrierInstallV1(
  input: ReconcileSupabaseBackfillWriteBarrierInstallOptionsV1
): Promise<SupabaseBackfillWriteBarrierInstallReconciliationResultV1> {
  const options = reconcileOptionsSnapshot(input)
  const trusted = trustedContext(options.context)
  const binding = journalBinding(options.context, trusted)
  let claim: BackendHostReleaseDispatchJournalRecord
  let evidence: BackendHostReleaseDispatchEvidenceRecord
  try {
    const rawClaim = await options.journal.read(binding.singleFlightKey)
    const rawEvidence = await options.journal.readEvidence(binding.singleFlightKey)
    if (!rawClaim || !rawEvidence) {
      return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
    }
    claim = requireClaimBinding(rawClaim, binding)
    evidence = parseBackendHostReleaseDispatchEvidenceRecord(rawEvidence)
  } catch (cause) {
    if (cause instanceof SupabaseBackfillWriteBarrierInstallControllerError) throw cause
    return fail('supabase-backfill-write-barrier-controller-journal-failed')
  }
  if (
    evidence.singleFlightKey !== binding.singleFlightKey ||
    evidence.dispatchScopeKey !== binding.dispatchScopeKey ||
    evidence.releaseId !== claim.releaseId ||
    evidence.planDigest !== binding.planDigest
  ) {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }

  if (evidence.phase === 'final') {
    const final = await parseFinalEvidence(evidence, options.context, trusted)
    if (
      final.stage !== 'installed-proof-observed' ||
      final.constraintOid === null ||
      (claim.outcome !== 'outcome-unknown' && claim.outcome !== 'applied')
    ) {
      return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
    }
    if (claim.outcome === 'applied') {
      return appliedReconciliationResult(options.context, trusted, binding, claim, final)
    }
    try {
      claim = await settle(
        options.journal,
        binding,
        claim,
        'applied',
        null,
        currentTimestamp(options.now)
      )
    } catch {
      return Object.freeze({
        status: 'outcome-unknown' as const,
        automaticRetryAllowed: false as const,
        singleFlightKey: binding.singleFlightKey,
        dispatchScopeKey: binding.dispatchScopeKey,
        claim,
        constraintOid: final.constraintOid,
        code: 'supabase-backfill-write-barrier-final-settlement-failed'
      })
    }
    return appliedReconciliationResult(options.context, trusted, binding, claim, final)
  }

  if (claim.outcome !== 'outcome-unknown') {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  const progress = parseProgressEvidence(evidence, options.context, trusted)
  if ((await digestCanonicalManifest(progress)) !== evidence.payloadDigest) {
    return fail('supabase-backfill-write-barrier-controller-evidence-invalid')
  }
  const requiredEpoch = requiredInstalledVerificationEpochs.get(options.context as object)
  if (!requiredEpoch) {
    return fail('supabase-backfill-write-barrier-controller-installed-proof-invalid')
  }
  const installed = consumeTrustedSupabaseBackfillWriteBarrierInstalledVerificationV1(
    options.installedVerification,
    trusted.sourceReview,
    requiredEpoch
  )
  const source = trusted.sourceReview.review
  if (
    !installed ||
    installed.reviewDigest !== options.context.reviewDigest ||
    installed.subjectDigest !== source.bindings.subjectDigest ||
    installed.authority.projectRef !== options.context.projectRef ||
    installed.authority.accountId !== options.context.accountId ||
    installed.barrier.constraintName !== source.barrier.constraintName ||
    installed.barrier.marker !== source.barrier.marker ||
    installed.barrier.constraintOid === null ||
    installed.address.schemaOid !== source.address.schemaOid ||
    installed.address.tableOid !== source.address.tableOid ||
    installed.address.targetSubId !== source.address.targetSubId ||
    installed.address.targetTypeOid !== source.address.targetTypeOid
  ) {
    return fail('supabase-backfill-write-barrier-controller-installed-proof-invalid')
  }
  const payload = finalEvidence(options.context, trusted, 'installed-proof-observed', installed)
  try {
    await persistEvidence(options.journal, binding, claim, payload, currentTimestamp(options.now))
    claim = await settle(
      options.journal,
      binding,
      claim,
      'applied',
      null,
      currentTimestamp(options.now)
    )
  } catch {
    return Object.freeze({
      status: 'outcome-unknown' as const,
      automaticRetryAllowed: false as const,
      singleFlightKey: binding.singleFlightKey,
      dispatchScopeKey: binding.dispatchScopeKey,
      claim,
      constraintOid: installed.barrier.constraintOid,
      code: 'supabase-backfill-write-barrier-final-settlement-failed'
    })
  }
  return appliedReconciliationResult(options.context, trusted, binding, claim, payload)
}
