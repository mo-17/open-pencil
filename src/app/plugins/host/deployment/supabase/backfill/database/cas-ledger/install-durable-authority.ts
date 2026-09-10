/* oxlint-disable eslint/max-lines, eslint/complexity, open-pencil/no-duplicate-type-shapes -- Keep the CAS-ledger durable authority, opaque permit lifecycle, and proof-first settlement in one auditable module. */
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  trustedSupabaseManagementDatabaseWriteCredentialLeaseMetadataV1,
  type SupabaseManagementDatabaseWriteCredentialLeaseBindingV1,
  type SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1,
  type SupabaseManagementDatabaseWriteCredentialLeaseV1,
  type TrustedSupabaseManagementDatabaseWriteCredentialLeaseMetadataV1
} from '@/app/lowcode/supabase/management-database-write-credential-lease'
import {
  createHostDurableMutationDispatchKernelV1,
  HostDurableMutationDispatchError,
  type HostDurableMutationDispatchClaimV1,
  type HostDurableMutationDispatchControllerV1,
  type HostDurableMutationDispatchStartedV1,
  type HostDurableMutationDispatchJSONValue,
  type HostDurableMutationKnownNotDispatchedProofV1,
  type HostDurableMutationDispatchPermitConsumerV1,
  type HostDurableMutationDispatchPermitV1
} from '@/app/plugins/host/deployment/backend/release-controller/durable-mutation-dispatch'
import {
  trustedBackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchEvidenceRecord,
  type BackendHostReleaseDispatchJournal
} from '@/app/plugins/host/deployment/backend/release-journal'
import type { SupabaseBackfillDispatchBindingV1 } from '@/app/plugins/host/deployment/supabase/backfill/dispatch-binding'

import {
  deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1,
  trustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1,
  type SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1,
  type TrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1
} from './install'
import {
  consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1,
  rotateSupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1,
  type SupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationV1
} from './verifier'

export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_DURABLE_AUTHORITY_FORMAT =
  'openpencil.supabase-backfill-database-cas-ledger-install-durable-authority.v1' as const
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PERMIT_CONSUMER_FORMAT =
  'openpencil.supabase-backfill-database-cas-ledger-install-permit-consumer.v1' as const
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_APPLIED_FORMAT =
  'openpencil.supabase-backfill-database-cas-ledger-install-applied.v1' as const

const PROGRESS_FORMAT =
  'openpencil.supabase-backfill-database-cas-ledger-install-progress.v1' as const
const FINAL_FORMAT = 'openpencil.supabase-backfill-database-cas-ledger-install-final.v1' as const
const OUTCOME_UNKNOWN_CODE =
  'supabase-backfill-database-cas-ledger-install-outcome-unknown' as const
const NOT_DISPATCHED_CODE = 'supabase-backfill-database-cas-ledger-install-not-dispatched' as const

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

declare const durableAttemptBrand: unique symbol
declare const transportPermitBrand: unique symbol
declare const knownNotDispatchedProofBrand: unique symbol

export interface SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1 {
  readonly [durableAttemptBrand]: never
}

export interface SupabaseBackfillDatabaseCASLedgerInstallTransportPermitV1 {
  readonly [transportPermitBrand]: never
}

export interface SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1 {
  readonly [knownNotDispatchedProofBrand]: never
}

/** Full secret-free binding rebuilt by the transport from its own prepared snapshot. */
export interface SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1 {
  readonly providerId: 'supabase'
  readonly projectRef: string
  readonly accountId: string
  readonly readGrantGeneration: string
  readonly writeGrantGeneration: string
  readonly migrationName: string
  readonly installReviewDigest: string
  readonly sourceReviewDigest: string
  readonly verificationDigest: string
  readonly ledgerShapeDigest: string
  readonly baseSqlDigest: string
  readonly marker: string
  readonly markerBindingDigest: string
  readonly installSqlDigest: string
  readonly verificationQueryDigest: string
  readonly credentialLeaseBindingDigest: string
  readonly writeCredentialIncarnation: string
  readonly operationLeaseGeneration: string
}

interface SupabaseBackfillDatabaseCASLedgerInstallAuthorityHeaderV1<Format extends string> {
  readonly format: Format
  readonly version: 1
  readonly provenance: 'production' | 'testing'
}

export interface SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1 extends SupabaseBackfillDatabaseCASLedgerInstallAuthorityHeaderV1<
  typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PERMIT_CONSUMER_FORMAT
> {
  consume(
    this: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1,
    permit: unknown,
    transportBinding: SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1
  ): Promise<boolean>
  /** Conservatively enters outcome-unknown immediately before invoking the fixed POST fetcher. */
  markPOSTStarted(
    this: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1,
    permit: unknown
  ): boolean
  /** Attests a same-process failure that happened strictly before markPOSTStarted. */
  attestKnownNotDispatched(
    this: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1,
    permit: unknown
  ): SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1 | null
}

export interface SupabaseBackfillDatabaseCASLedgerInstallDurableClaimResultV1 {
  readonly status: 'claimed' | 'reconciliation-required'
  readonly attempt: SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1 | null
  readonly singleFlightKey: string
  readonly dispatchScopeKey: string
  readonly planDigest: string
  readonly automaticRetryAllowed: false
  readonly databaseLedgerBound: false
  readonly sourceLedgerBound: false
  readonly releaseReady: false
  readonly code: string | null
}

export interface SupabaseBackfillDatabaseCASLedgerInstallDurablePrecommitResultV1 {
  readonly permit: SupabaseBackfillDatabaseCASLedgerInstallTransportPermitV1
  readonly automaticRetryAllowed: false
  readonly databaseLedgerBound: false
  readonly sourceLedgerBound: false
  readonly releaseReady: false
}

export interface SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedResultV1 {
  readonly status: 'not-dispatched' | 'reconciliation-required'
  readonly singleFlightKey: string
  readonly dispatchScopeKey: string
  readonly automaticRetryAllowed: false
  readonly databaseLedgerBound: false
  readonly sourceLedgerBound: false
  readonly releaseReady: false
  readonly code: string
}

export interface SupabaseBackfillDatabaseCASLedgerInstallAppliedResultV1 {
  readonly format: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_APPLIED_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly provenance: 'production' | 'testing'
  readonly status: 'applied'
  readonly projectRef: string
  readonly accountId: string
  readonly singleFlightKey: string
  readonly dispatchScopeKey: string
  readonly planDigest: string
  readonly installReviewDigest: string
  readonly sourceReviewDigest: string
  readonly verificationDigest: string
  readonly installedVerificationDigest: string
  readonly ledgerShapeDigest: string
  readonly baseSqlDigest: string
  readonly marker: string
  readonly markerBindingDigest: string
  readonly installSqlDigest: string
  readonly verificationQueryDigest: string
  readonly credentialLeaseBindingDigest: string
  readonly writeCredentialIncarnation: string
  readonly operationLeaseGeneration: string
  readonly observedAt: string
  readonly snapshotMarker: string
  readonly serverVersionNum: string
  readonly automaticRetryAllowed: false
  readonly databaseLedgerBound: true
  readonly sourceLedgerBound: false
  readonly releaseReady: false
}

/** Same-process proof retained only after exact durable applied settlement. */
export interface TrustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1 {
  readonly result: SupabaseBackfillDatabaseCASLedgerInstallAppliedResultV1
  readonly provenance: 'production' | 'testing'
  readonly dispatchContext: SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
  readonly dispatchEvidence: TrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1
  readonly installedVerification: SupabaseBackfillDatabaseCASLedgerVerificationV1
  readonly credentialLease: Readonly<{
    bindingDigest: string
    writeCredentialIncarnation: string
    operationLeaseGeneration: string
  }>
}

export interface SupabaseBackfillDatabaseCASLedgerInstallAppliedReconciliationRequiredV1 {
  readonly status: 'reconciliation-required'
  readonly singleFlightKey: string
  readonly dispatchScopeKey: string
  readonly automaticRetryAllowed: false
  readonly databaseLedgerBound: false
  readonly sourceLedgerBound: false
  readonly releaseReady: false
  readonly code: string
}

export type SupabaseBackfillDatabaseCASLedgerInstallReconcileResultV1 =
  | SupabaseBackfillDatabaseCASLedgerInstallAppliedResultV1
  | SupabaseBackfillDatabaseCASLedgerInstallAppliedReconciliationRequiredV1

export interface ClaimSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1 {
  readonly context: SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
  readonly releaseId: string
  readonly ownerId: string
  readonly claimedAt: string
}

export interface PrecommitSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1 {
  readonly attempt: SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1
  readonly credentialIssuer: SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
  readonly credentialLease: SupabaseManagementDatabaseWriteCredentialLeaseV1
  readonly progressRecordedAt: string
  readonly outcomeUnknownAt: string
}

export interface SettleKnownNotDispatchedSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1 {
  readonly attempt: SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1
  readonly proof: SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1
  readonly recordedAt: string
}

export type SettleBeforePrecommitSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1 =
  Pick<
    SettleKnownNotDispatchedSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1,
    'attempt' | 'recordedAt'
  >

export interface ReconcileInstalledSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1 {
  readonly attempt: SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1
  readonly installedVerification: SupabaseBackfillDatabaseCASLedgerVerificationV1
  readonly recordedAt: string
}

export interface RecoverSupabaseBackfillDatabaseCASLedgerInstallDurableSettlementOptionsV1 {
  readonly attempt: SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1
}

export type SupabaseBackfillDatabaseCASLedgerInstallDurableSettlementRecoveryResultV1 =
  | SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedResultV1
  | SupabaseBackfillDatabaseCASLedgerInstallReconcileResultV1

export interface SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1 extends SupabaseBackfillDatabaseCASLedgerInstallAuthorityHeaderV1<
  typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_DURABLE_AUTHORITY_FORMAT
> {
  claim(
    this: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
    options: ClaimSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1
  ): Promise<SupabaseBackfillDatabaseCASLedgerInstallDurableClaimResultV1>
  precommit(
    this: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
    options: PrecommitSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1
  ): Promise<SupabaseBackfillDatabaseCASLedgerInstallDurablePrecommitResultV1>
  settleBeforePrecommit(
    this: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
    options: SettleBeforePrecommitSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1
  ): Promise<SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedResultV1>
  settleKnownNotDispatched(
    this: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
    options: SettleKnownNotDispatchedSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1
  ): Promise<SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedResultV1>
  reconcileInstalled(
    this: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
    options: ReconcileInstalledSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1
  ): Promise<SupabaseBackfillDatabaseCASLedgerInstallReconcileResultV1>
  /** Retry only the already-recorded final journal intent. This can never mint a transport permit. */
  recoverSettlement(
    this: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
    options: RecoverSupabaseBackfillDatabaseCASLedgerInstallDurableSettlementOptionsV1
  ): Promise<SupabaseBackfillDatabaseCASLedgerInstallDurableSettlementRecoveryResultV1>
}

export interface CreateSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingOptionsV1 {
  readonly journal: BackendHostReleaseDispatchJournal
}

export interface SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityBundleV1 {
  readonly authority: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1
  readonly permitConsumer: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1
}

export type SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityErrorCode =
  | 'supabase-backfill-database-cas-ledger-durable-input-invalid'
  | 'supabase-backfill-database-cas-ledger-durable-context-invalid'
  | 'supabase-backfill-database-cas-ledger-durable-journal-failed'
  | 'supabase-backfill-database-cas-ledger-durable-state-invalid'
  | 'supabase-backfill-database-cas-ledger-durable-proof-invalid'

export class SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityError extends Error {
  constructor(readonly code: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityErrorCode) {
    super(`Supabase backfill database CAS-ledger durable authority failed: ${code}.`)
    this.name = 'SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

type DurableBindingV1 = SupabaseBackfillDispatchBindingV1

type CredentialLeaseMetadataV1 = TrustedSupabaseManagementDatabaseWriteCredentialLeaseMetadataV1

type AttemptState =
  | 'claimed'
  | 'precommitting'
  | 'precommit-reconciliation-required'
  | 'precommitted'
  | 'permit-consuming'
  | 'permit-validation-failed-known-not-dispatched'
  | 'transport-consumed'
  | 'post-started'
  | 'known-not-dispatched'
  | 'settling-not-dispatched'
  | 'reconciling-installed'
  | 'not-dispatched'
  | 'applied'
  | 'reconciliation-required'
  | 'invalid'

interface AttemptAuthorityV1 {
  readonly owner: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1
  readonly attempt: SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1
  readonly context: SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
  readonly trusted: TrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1
  readonly credentialBinding: SupabaseManagementDatabaseWriteCredentialLeaseBindingV1
  readonly binding: DurableBindingV1
  readonly hostClaim: HostDurableMutationDispatchClaimV1
  state: AttemptState
  permit: SupabaseBackfillDatabaseCASLedgerInstallTransportPermitV1 | null
  credentialLease: CredentialLeaseMetadataV1 | null
  installedEpoch: SupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1 | null
  installedVerification: SupabaseBackfillDatabaseCASLedgerVerificationV1 | null
  genericDispatchStarted: HostDurableMutationDispatchStartedV1 | null
  outcomeUnknownAt: string | null
  finalOutcome: 'applied' | 'failed' | null
  finalPayload: Readonly<Record<string, HostDurableMutationDispatchJSONValue>> | null
  finalRecordedAt: string | null
}

interface PermitAuthorityV1 {
  readonly owner: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1
  readonly permit: SupabaseBackfillDatabaseCASLedgerInstallTransportPermitV1
  readonly attempt: AttemptAuthorityV1
  readonly genericPermit: HostDurableMutationDispatchPermitV1
  readonly genericConsumer: HostDurableMutationDispatchPermitConsumerV1
  readonly genericExpectation: Readonly<{
    singleFlightKey: string
    dispatchScopeKey: string
    releaseId: string
    planDigest: string
    progressPayloadDigest: string
  }>
  readonly transportBinding: SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1
}

interface KnownNotDispatchedProofAuthorityV1 {
  readonly proof: SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1
  readonly attempt: AttemptAuthorityV1
  readonly permit: SupabaseBackfillDatabaseCASLedgerInstallTransportPermitV1
  readonly genericProof: HostDurableMutationKnownNotDispatchedProofV1
}

const FACTORY_KEYS = ['journal'] as const
const CLAIM_KEYS = ['context', 'releaseId', 'ownerId', 'claimedAt'] as const
const PRECOMMIT_KEYS = [
  'attempt',
  'credentialIssuer',
  'credentialLease',
  'progressRecordedAt',
  'outcomeUnknownAt'
] as const
const SETTLE_BEFORE_PRECOMMIT_KEYS = ['attempt', 'recordedAt'] as const
const SETTLE_KEYS = ['attempt', 'proof', 'recordedAt'] as const
const RECONCILE_KEYS = ['attempt', 'installedVerification', 'recordedAt'] as const
const RECOVER_SETTLEMENT_KEYS = ['attempt'] as const
const TRANSPORT_BINDING_KEYS = [
  'providerId',
  'projectRef',
  'accountId',
  'readGrantGeneration',
  'writeGrantGeneration',
  'migrationName',
  'installReviewDigest',
  'sourceReviewDigest',
  'verificationDigest',
  'ledgerShapeDigest',
  'baseSqlDigest',
  'marker',
  'markerBindingDigest',
  'installSqlDigest',
  'verificationQueryDigest',
  'credentialLeaseBindingDigest',
  'writeCredentialIncarnation',
  'operationLeaseGeneration'
] as const
const trustedAuthorities = new WeakSet<object>()
const trustedPermitConsumers = new WeakSet<object>()
const authorityPermitConsumers = new WeakMap<
  object,
  SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1
>()
const attempts = new WeakMap<object, AttemptAuthorityV1>()
const permits = new WeakMap<object, PermitAuthorityV1>()
const knownNotDispatchedProofs = new WeakMap<object, KnownNotDispatchedProofAuthorityV1>()
const trustedAppliedResults = new WeakMap<
  object,
  TrustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1
>()

function fail(code: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityErrorCode): never {
  throw new SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityError(code)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  return descriptor.value
}

function exactRecord(value: unknown, keys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  let isArray: boolean
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  try {
    isArray = Array.isArray(value)
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  if (
    isArray ||
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  const snapshot: UnknownRecord = Object.create(null)
  for (const key of keys) snapshot[key] = ownData(value, key)
  return snapshot
}

function exactRecordOrNull(value: unknown, keys: readonly string[]): UnknownRecord | null {
  try {
    return exactRecord(value, keys)
  } catch {
    return null
  }
}

function stableId(value: unknown): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  return value
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  return value
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  return value
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  return value
}

function encoded(parts: readonly string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(':')
}

function opaqueAttempt(): SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1 {
  return Object.freeze(
    Object.create(null)
  ) as SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1
}

function opaquePermit(): SupabaseBackfillDatabaseCASLedgerInstallTransportPermitV1 {
  return Object.freeze(
    Object.create(null)
  ) as SupabaseBackfillDatabaseCASLedgerInstallTransportPermitV1
}

function opaqueKnownNotDispatchedProof(): SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1 {
  return Object.freeze(
    Object.create(null)
  ) as SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1
}

function attemptAuthority(
  value: unknown,
  owner: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1
): AttemptAuthorityV1 {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
  }
  const trusted = attempts.get(value)
  if (!trusted || trusted.attempt !== value || trusted.owner !== owner) {
    return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
  }
  return trusted
}

function trustedContext(context: unknown): Readonly<{
  context: SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
  trusted: TrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1
  credentialBinding: SupabaseManagementDatabaseWriteCredentialLeaseBindingV1
}> {
  if (context === null || typeof context !== 'object') {
    return fail('supabase-backfill-database-cas-ledger-durable-context-invalid')
  }
  const trusted = trustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1(context)
  const credentialBinding =
    deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(context)
  if (!trusted || !credentialBinding) {
    return fail('supabase-backfill-database-cas-ledger-durable-context-invalid')
  }
  const typed = context as SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
  if (
    typed.projectRef !== credentialBinding.projectRef ||
    typed.accountId !== credentialBinding.accountId ||
    typed.installReviewDigest !== credentialBinding.installReviewDigest ||
    typed.sourceReviewDigest !== credentialBinding.sourceReviewDigest ||
    typed.verificationDigest !== credentialBinding.verificationDigest ||
    typed.ledgerShapeDigest !== credentialBinding.ledgerShapeDigest ||
    typed.sqlDigest !== credentialBinding.baseSqlDigest ||
    typed.marker !== credentialBinding.marker ||
    typed.markerBindingDigest !== credentialBinding.markerBindingDigest ||
    typed.installSqlDigest !== credentialBinding.installSqlDigest ||
    typed.verificationQueryDigest !== credentialBinding.verificationQueryDigest ||
    typed.projectRef !== trusted.writeAuthority.projectRef ||
    typed.accountId !== trusted.writeAuthority.accountId ||
    credentialBinding.expectedSharedGrantGeneration !== trusted.writeAuthority.grantGeneration
  ) {
    return fail('supabase-backfill-database-cas-ledger-durable-context-invalid')
  }
  return Object.freeze({ context: typed, trusted, credentialBinding })
}

async function durableBinding(
  context: SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1,
  trusted: TrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1,
  credentialBinding: SupabaseManagementDatabaseWriteCredentialLeaseBindingV1
): Promise<DurableBindingV1> {
  const planDigest = await digestCanonicalManifest(
    Object.freeze({
      format: 'openpencil.supabase-backfill-database-cas-ledger-install-plan.v1' as const,
      version: 1 as const,
      providerId: 'supabase' as const,
      environment: 'staging' as const,
      projectRef: context.projectRef,
      accountId: context.accountId,
      readGrantGeneration: trusted.readAuthority.grantGeneration,
      writeGrantGeneration: credentialBinding.expectedSharedGrantGeneration,
      migrationName: context.migrationName,
      installReviewDigest: context.installReviewDigest,
      sourceReviewDigest: context.sourceReviewDigest,
      verificationDigest: context.verificationDigest,
      ledgerShapeDigest: context.ledgerShapeDigest,
      baseSqlDigest: context.sqlDigest,
      marker: context.marker,
      markerBindingDigest: context.markerBindingDigest,
      installSqlDigest: context.installSqlDigest,
      verificationQueryDigest: context.verificationQueryDigest
    })
  )
  return Object.freeze({
    singleFlightKey: encoded([
      'backend-release-v3',
      'supabase',
      context.projectRef,
      context.accountId,
      'backfill-database-cas-ledger-install',
      planDigest
    ]),
    dispatchScopeKey: encoded([
      'backend-release-dispatch-scope-v1',
      'supabase',
      context.projectRef
    ]),
    planDigest
  })
}

function sameTransportBinding(
  value: unknown,
  expected: SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1
): boolean {
  const source = exactRecordOrNull(value, TRANSPORT_BINDING_KEYS)
  if (!source) return false
  try {
    return TRANSPORT_BINDING_KEYS.every((key) => ownData(source, key) === expected[key])
  } catch {
    return false
  }
}

function credentialLeaseSnapshot(
  issuer: unknown,
  value: unknown,
  expected: SupabaseManagementDatabaseWriteCredentialLeaseBindingV1
): CredentialLeaseMetadataV1 {
  const metadata = trustedSupabaseManagementDatabaseWriteCredentialLeaseMetadataV1({
    issuer: issuer as SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1,
    lease: value as SupabaseManagementDatabaseWriteCredentialLeaseV1,
    expectedBinding: expected
  })
  if (!metadata) {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  return Object.freeze({
    bindingDigest: digest(metadata.bindingDigest),
    writeCredentialIncarnation: uuid(metadata.writeCredentialIncarnation),
    operationLeaseGeneration: uuid(metadata.operationLeaseGeneration)
  })
}

function transportBinding(
  state: AttemptAuthorityV1,
  lease: CredentialLeaseMetadataV1
): SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1 {
  const { context, credentialBinding, trusted } = state
  return Object.freeze({
    providerId: 'supabase' as const,
    projectRef: context.projectRef,
    accountId: context.accountId,
    readGrantGeneration: trusted.readAuthority.grantGeneration,
    writeGrantGeneration: credentialBinding.expectedSharedGrantGeneration,
    migrationName: context.migrationName,
    installReviewDigest: context.installReviewDigest,
    sourceReviewDigest: context.sourceReviewDigest,
    verificationDigest: context.verificationDigest,
    ledgerShapeDigest: context.ledgerShapeDigest,
    baseSqlDigest: context.sqlDigest,
    marker: context.marker,
    markerBindingDigest: context.markerBindingDigest,
    installSqlDigest: context.installSqlDigest,
    verificationQueryDigest: context.verificationQueryDigest,
    credentialLeaseBindingDigest: lease.bindingDigest,
    writeCredentialIncarnation: lease.writeCredentialIncarnation,
    operationLeaseGeneration: lease.operationLeaseGeneration
  })
}

function evidenceBase(state: AttemptAuthorityV1) {
  const { context, credentialBinding, trusted } = state
  return Object.freeze({
    providerId: 'supabase' as const,
    operation: 'backfill-database-cas-ledger-install' as const,
    environment: 'staging' as const,
    projectRef: context.projectRef,
    accountId: context.accountId,
    readGrantGeneration: trusted.readAuthority.grantGeneration,
    writeGrantGeneration: credentialBinding.expectedSharedGrantGeneration,
    migrationName: context.migrationName,
    installReviewDigest: context.installReviewDigest,
    sourceReviewDigest: context.sourceReviewDigest,
    verificationDigest: context.verificationDigest,
    ledgerShapeDigest: context.ledgerShapeDigest,
    baseSqlDigest: context.sqlDigest,
    marker: context.marker,
    markerBindingDigest: context.markerBindingDigest,
    installSqlDigest: context.installSqlDigest,
    verificationQueryDigest: context.verificationQueryDigest,
    automaticRetryAllowed: false as const,
    sourceLedgerBound: false as const,
    releaseReady: false as const
  })
}

function progressPayload(
  state: AttemptAuthorityV1,
  lease: CredentialLeaseMetadataV1
): Readonly<Record<string, HostDurableMutationDispatchJSONValue>> {
  return Object.freeze({
    format: PROGRESS_FORMAT,
    version: 1,
    phase: 'progress',
    stage: 'outcome-unknown-precommitted',
    ...evidenceBase(state),
    credentialLease: Object.freeze({
      bindingDigest: lease.bindingDigest,
      writeCredentialIncarnation: lease.writeCredentialIncarnation,
      operationLeaseGeneration: lease.operationLeaseGeneration
    }),
    databaseLedgerBound: false
  })
}

function finalPayload(
  state: AttemptAuthorityV1,
  verification: SupabaseBackfillDatabaseCASLedgerVerificationV1 | null
): Readonly<Record<string, HostDurableMutationDispatchJSONValue>> {
  return Object.freeze({
    format: FINAL_FORMAT,
    version: 1,
    phase: 'final',
    stage: verification ? 'installed-proof-observed' : 'known-not-dispatched',
    ...evidenceBase(state),
    credentialLease: state.credentialLease
      ? Object.freeze({
          bindingDigest: state.credentialLease.bindingDigest,
          writeCredentialIncarnation: state.credentialLease.writeCredentialIncarnation,
          operationLeaseGeneration: state.credentialLease.operationLeaseGeneration
        })
      : null,
    databaseLedgerBound: verification !== null,
    installedVerificationDigest: verification?.verificationDigest ?? null,
    installedObservedAt: verification?.observedAt ?? null,
    installedSnapshotMarker: verification?.snapshotMarker ?? null,
    installedServerVersionNum: verification?.serverVersionNum ?? null
  })
}

function claimResult(
  status: SupabaseBackfillDatabaseCASLedgerInstallDurableClaimResultV1['status'],
  binding: DurableBindingV1,
  attempt: SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1 | null,
  code: string | null
): SupabaseBackfillDatabaseCASLedgerInstallDurableClaimResultV1 {
  return Object.freeze({
    status,
    attempt,
    ...binding,
    automaticRetryAllowed: false as const,
    databaseLedgerBound: false as const,
    sourceLedgerBound: false as const,
    releaseReady: false as const,
    code
  })
}

function reconciliationRequired(
  state: AttemptAuthorityV1,
  code: string
): SupabaseBackfillDatabaseCASLedgerInstallAppliedReconciliationRequiredV1 {
  state.state = 'reconciliation-required'
  return Object.freeze({
    status: 'reconciliation-required' as const,
    singleFlightKey: state.binding.singleFlightKey,
    dispatchScopeKey: state.binding.dispatchScopeKey,
    automaticRetryAllowed: false as const,
    databaseLedgerBound: false as const,
    sourceLedgerBound: false as const,
    releaseReady: false as const,
    code
  })
}

async function validSettledEvidence(
  evidence: BackendHostReleaseDispatchEvidenceRecord,
  state: AttemptAuthorityV1,
  expectedPayload: Readonly<Record<string, HostDurableMutationDispatchJSONValue>>,
  expectedRecordedAt: string
): Promise<boolean> {
  return (
    evidence.singleFlightKey === state.binding.singleFlightKey &&
    evidence.dispatchScopeKey === state.binding.dispatchScopeKey &&
    evidence.releaseId === state.hostClaim.claim.releaseId &&
    evidence.planDigest === state.binding.planDigest &&
    evidence.phase === 'final' &&
    evidence.payload === JSON.stringify(expectedPayload) &&
    evidence.payloadDigest === (await digestCanonicalManifest(expectedPayload)) &&
    evidence.recordedAt === expectedRecordedAt
  )
}

async function recoverSettlement(
  controller: HostDurableMutationDispatchControllerV1,
  state: AttemptAuthorityV1,
  outcome: 'applied' | 'failed',
  code: string | null
) {
  if (!state.finalPayload || !state.finalRecordedAt) {
    return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
  }
  return controller.recoverFinalSettlement({
    claim: state.hostClaim,
    final: { payload: state.finalPayload, recordedAt: state.finalRecordedAt },
    outcome,
    code
  })
}

async function completeKnownNotDispatchedSettlement(
  controller: HostDurableMutationDispatchControllerV1,
  state: AttemptAuthorityV1,
  genericProof: HostDurableMutationKnownNotDispatchedProofV1
): Promise<SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedResultV1> {
  if (
    state.finalOutcome !== 'failed' ||
    !state.finalPayload ||
    !state.finalRecordedAt ||
    state.installedVerification
  ) {
    return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
  }
  state.state = 'settling-not-dispatched'
  try {
    let settled = await controller.settleKnownNotDispatched({
      claim: state.hostClaim,
      proof: genericProof,
      final: { payload: state.finalPayload, recordedAt: state.finalRecordedAt },
      code: NOT_DISPATCHED_CODE
    })
    if (settled.status === 'settlement-recovery-required') {
      settled = await recoverSettlement(controller, state, 'failed', NOT_DISPATCHED_CODE)
    }
    if (
      settled.status !== 'settled' ||
      settled.claim.outcome !== 'failed' ||
      settled.claim.code !== NOT_DISPATCHED_CODE ||
      !(await validSettledEvidence(
        settled.evidence,
        state,
        state.finalPayload,
        state.finalRecordedAt
      ))
    ) {
      return reconciliationRequired(
        state,
        'supabase-backfill-database-cas-ledger-install-final-settlement-required'
      )
    }
  } catch {
    return reconciliationRequired(
      state,
      'supabase-backfill-database-cas-ledger-install-final-settlement-required'
    )
  }
  state.state = 'not-dispatched'
  return Object.freeze({
    status: 'not-dispatched' as const,
    singleFlightKey: state.binding.singleFlightKey,
    dispatchScopeKey: state.binding.dispatchScopeKey,
    automaticRetryAllowed: false as const,
    databaseLedgerBound: false as const,
    sourceLedgerBound: false as const,
    releaseReady: false as const,
    code: NOT_DISPATCHED_CODE
  })
}

async function settleKnownState(
  controller: HostDurableMutationDispatchControllerV1,
  state: AttemptAuthorityV1,
  recordedAt: string
): Promise<SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedResultV1> {
  const lowerBound = state.outcomeUnknownAt ?? state.hostClaim.claim.claimedAt
  if (Date.parse(recordedAt) < Date.parse(lowerBound)) {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  state.finalOutcome = 'failed'
  state.finalPayload = finalPayload(state, null)
  state.finalRecordedAt = recordedAt
  let proof: HostDurableMutationKnownNotDispatchedProofV1
  try {
    proof = await controller.attestClaimKnownNotDispatched({ claim: state.hostClaim })
  } catch {
    return reconciliationRequired(
      state,
      'supabase-backfill-database-cas-ledger-install-final-settlement-required'
    )
  }
  return completeKnownNotDispatchedSettlement(controller, state, proof)
}

function appliedResult(
  state: AttemptAuthorityV1,
  verification: SupabaseBackfillDatabaseCASLedgerVerificationV1
): SupabaseBackfillDatabaseCASLedgerInstallAppliedResultV1 {
  const credentialLease = state.credentialLease
  if (!credentialLease) {
    return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
  }
  const result = Object.freeze({
    format: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_APPLIED_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    provenance: state.owner.provenance,
    status: 'applied' as const,
    projectRef: state.context.projectRef,
    accountId: state.context.accountId,
    ...state.binding,
    installReviewDigest: state.context.installReviewDigest,
    sourceReviewDigest: state.context.sourceReviewDigest,
    verificationDigest: state.context.verificationDigest,
    installedVerificationDigest: verification.verificationDigest,
    ledgerShapeDigest: state.context.ledgerShapeDigest,
    baseSqlDigest: state.context.sqlDigest,
    marker: state.context.marker,
    markerBindingDigest: state.context.markerBindingDigest,
    installSqlDigest: state.context.installSqlDigest,
    verificationQueryDigest: state.context.verificationQueryDigest,
    credentialLeaseBindingDigest: credentialLease.bindingDigest,
    writeCredentialIncarnation: credentialLease.writeCredentialIncarnation,
    operationLeaseGeneration: credentialLease.operationLeaseGeneration,
    observedAt: verification.observedAt,
    snapshotMarker: verification.snapshotMarker,
    serverVersionNum: verification.serverVersionNum,
    automaticRetryAllowed: false as const,
    databaseLedgerBound: true as const,
    sourceLedgerBound: false as const,
    releaseReady: false as const
  })
  trustedAppliedResults.set(
    result,
    Object.freeze({
      result,
      provenance: state.owner.provenance,
      dispatchContext: state.context,
      dispatchEvidence: state.trusted,
      installedVerification: verification,
      credentialLease: Object.freeze({ ...credentialLease })
    })
  )
  return result
}

async function completeInstalledSettlement(
  controller: HostDurableMutationDispatchControllerV1,
  state: AttemptAuthorityV1
): Promise<SupabaseBackfillDatabaseCASLedgerInstallReconcileResultV1> {
  if (
    state.finalOutcome !== 'applied' ||
    !state.finalPayload ||
    !state.finalRecordedAt ||
    !state.installedVerification
  ) {
    return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
  }
  state.state = 'reconciling-installed'
  let settled
  try {
    if (!state.genericDispatchStarted) {
      return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
    }
    const proof = await controller.attestApplied({
      claim: state.hostClaim,
      dispatchStarted: state.genericDispatchStarted,
      final: { payload: state.finalPayload, recordedAt: state.finalRecordedAt }
    })
    state.genericDispatchStarted = null
    settled = await controller.settleApplied({
      claim: state.hostClaim,
      proof,
      final: { payload: state.finalPayload, recordedAt: state.finalRecordedAt }
    })
    if (settled.status === 'settlement-recovery-required') {
      settled = await recoverSettlement(controller, state, 'applied', null)
    }
    if (
      settled.status !== 'settled' ||
      settled.claim.outcome !== 'applied' ||
      settled.claim.code !== null ||
      !(await validSettledEvidence(
        settled.evidence,
        state,
        state.finalPayload,
        state.finalRecordedAt
      ))
    ) {
      return reconciliationRequired(
        state,
        'supabase-backfill-database-cas-ledger-install-applied-settlement-required'
      )
    }
  } catch {
    return reconciliationRequired(
      state,
      'supabase-backfill-database-cas-ledger-install-applied-settlement-required'
    )
  }
  state.state = 'applied'
  return appliedResult(state, state.installedVerification)
}

function createBundle(
  journal: BackendHostReleaseDispatchJournal,
  provenance: 'production' | 'testing'
): SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityBundleV1 {
  if (!trustedBackendHostReleaseDispatchJournal(journal)) {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  const kernel = createHostDurableMutationDispatchKernelV1({ journal })

  const permitConsumer: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1 = Object.freeze({
    format: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PERMIT_CONSUMER_FORMAT,
    version: 1 as const,
    provenance,
    async consume(
      this: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1,
      permitValue: unknown,
      transportBindingValue: SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1
    ): Promise<boolean> {
      if (this !== permitConsumer || permitValue === null || typeof permitValue !== 'object') {
        return false
      }
      const permit = permits.get(permitValue)
      if (
        !permit ||
        permit.owner !== permitConsumer ||
        permit.permit !== permitValue ||
        permit.attempt.state !== 'precommitted'
      ) {
        return false
      }
      permit.attempt.state = 'permit-consuming'
      if (
        !sameTransportBinding(transportBindingValue, permit.transportBinding) ||
        permit.genericExpectation.planDigest !== permit.attempt.binding.planDigest ||
        permit.genericExpectation.dispatchScopeKey !== permit.attempt.binding.dispatchScopeKey
      ) {
        permit.attempt.state = 'invalid'
        return false
      }
      let consumed = false
      try {
        const consumedValue: unknown = await permit.genericConsumer.consume(
          permit.genericPermit,
          permit.genericExpectation
        )
        consumed = consumedValue === true
      } catch {
        consumed = false
      }
      permit.attempt.state = consumed
        ? 'transport-consumed'
        : 'permit-validation-failed-known-not-dispatched'
      return consumed
    },
    markPOSTStarted(
      this: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1,
      permitValue: unknown
    ): boolean {
      if (this !== permitConsumer || permitValue === null || typeof permitValue !== 'object') {
        return false
      }
      const permit = permits.get(permitValue)
      if (
        !permit ||
        permit.owner !== permitConsumer ||
        permit.attempt.state !== 'transport-consumed'
      ) {
        return false
      }
      const genericDispatchStarted = permit.genericConsumer.markDispatchStarted(
        permit.genericPermit
      )
      if (!genericDispatchStarted) {
        permits.delete(permitValue)
        permit.attempt.state = 'invalid'
        return false
      }
      permit.attempt.genericDispatchStarted = genericDispatchStarted
      try {
        permit.attempt.installedEpoch =
          rotateSupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1(
            permit.attempt.trusted.sourceReview
          )
      } catch {
        permit.attempt.state = 'permit-validation-failed-known-not-dispatched'
        return false
      }
      permits.delete(permitValue)
      permit.attempt.state = 'post-started'
      return true
    },
    attestKnownNotDispatched(
      this: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1,
      permitValue: unknown
    ): SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1 | null {
      if (this !== permitConsumer || permitValue === null || typeof permitValue !== 'object') {
        return null
      }
      const permit = permits.get(permitValue)
      if (
        !permit ||
        permit.owner !== permitConsumer ||
        (permit.attempt.state !== 'transport-consumed' &&
          permit.attempt.state !== 'permit-validation-failed-known-not-dispatched')
      ) {
        return null
      }
      const genericProof = permit.genericConsumer.attestKnownNotDispatched(permit.genericPermit)
      if (!genericProof) {
        permits.delete(permitValue)
        permit.attempt.state = 'invalid'
        return null
      }
      permits.delete(permitValue)
      permit.attempt.state = 'known-not-dispatched'
      const proof = opaqueKnownNotDispatchedProof()
      knownNotDispatchedProofs.set(
        proof,
        Object.freeze({
          proof,
          attempt: permit.attempt,
          permit: permit.permit,
          genericProof
        })
      )
      return proof
    }
  })
  trustedPermitConsumers.add(permitConsumer)

  const authority: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1 = Object.freeze({
    format: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_DURABLE_AUTHORITY_FORMAT,
    version: 1 as const,
    provenance,
    async claim(
      this: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
      value: ClaimSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1
    ): Promise<SupabaseBackfillDatabaseCASLedgerInstallDurableClaimResultV1> {
      if (this !== authority) {
        return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
      }
      const source = exactRecord(value, CLAIM_KEYS)
      const current = trustedContext(ownData(source, 'context'))
      const releaseId = stableId(ownData(source, 'releaseId'))
      const ownerId = stableId(ownData(source, 'ownerId'))
      const claimedAt = canonicalTimestamp(ownData(source, 'claimedAt'))
      const binding = await durableBinding(
        current.context,
        current.trusted,
        current.credentialBinding
      )
      const revalidated = trustedContext(current.context)
      if (
        revalidated.trusted !== current.trusted ||
        JSON.stringify(revalidated.credentialBinding) !== JSON.stringify(current.credentialBinding)
      ) {
        return fail('supabase-backfill-database-cas-ledger-durable-context-invalid')
      }
      let hostClaim: HostDurableMutationDispatchClaimV1
      try {
        hostClaim = await kernel.controller.claimProjectScope({
          ...binding,
          releaseId,
          ownerId,
          claimedAt
        })
      } catch (cause) {
        if (
          cause instanceof HostDurableMutationDispatchError &&
          cause.code === 'host-durable-mutation-scope-conflict'
        ) {
          return claimResult(
            'reconciliation-required',
            binding,
            null,
            'supabase-backfill-database-cas-ledger-install-unresolved-project-scope'
          )
        }
        return fail('supabase-backfill-database-cas-ledger-durable-journal-failed')
      }
      if (!hostClaim.created) {
        return claimResult(
          'reconciliation-required',
          binding,
          null,
          'supabase-backfill-database-cas-ledger-install-existing-claim'
        )
      }
      const attempt = opaqueAttempt()
      attempts.set(attempt, {
        owner: authority,
        attempt,
        context: current.context,
        trusted: current.trusted,
        credentialBinding: current.credentialBinding,
        binding,
        hostClaim,
        state: 'claimed',
        permit: null,
        credentialLease: null,
        installedEpoch: null,
        installedVerification: null,
        genericDispatchStarted: null,
        outcomeUnknownAt: null,
        finalOutcome: null,
        finalPayload: null,
        finalRecordedAt: null
      })
      return claimResult('claimed', binding, attempt, null)
    },
    async precommit(
      this: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
      value: PrecommitSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1
    ): Promise<SupabaseBackfillDatabaseCASLedgerInstallDurablePrecommitResultV1> {
      if (this !== authority) {
        return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
      }
      const source = exactRecord(value, PRECOMMIT_KEYS)
      const state = attemptAuthority(ownData(source, 'attempt'), authority)
      if (state.state !== 'claimed') {
        return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
      }
      const lease = credentialLeaseSnapshot(
        ownData(source, 'credentialIssuer'),
        ownData(source, 'credentialLease'),
        state.credentialBinding
      )
      const progressRecordedAt = canonicalTimestamp(ownData(source, 'progressRecordedAt'))
      const outcomeUnknownAt = canonicalTimestamp(ownData(source, 'outcomeUnknownAt'))
      if (
        Date.parse(progressRecordedAt) < Date.parse(state.hostClaim.claim.claimedAt) ||
        Date.parse(progressRecordedAt) > Date.parse(outcomeUnknownAt)
      ) {
        return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
      }
      const expectedBindingDigest = await digestCanonicalManifest(state.credentialBinding)
      // oxlint-disable-next-line typescript-eslint/no-unnecessary-condition -- A competing precommit can change shared state across the awaited digest.
      if (state.state !== 'claimed') {
        return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
      }
      if (lease.bindingDigest !== expectedBindingDigest) {
        return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
      }
      state.state = 'precommitting'
      state.credentialLease = lease
      state.outcomeUnknownAt = outcomeUnknownAt
      const payload = progressPayload(state, lease)
      let hostPrecommit
      try {
        hostPrecommit = await kernel.controller.precommitOutcomeUnknown({
          claim: state.hostClaim,
          progress: { payload, recordedAt: progressRecordedAt },
          settledAt: outcomeUnknownAt,
          outcomeUnknownCode: OUTCOME_UNKNOWN_CODE
        })
      } catch {
        // No transport permit escaped, but the journal may have committed outcome-unknown before
        // reporting failure. The generic proof issuance path is already burned, so retain only a
        // fail-closed reconciliation handle; do not infer known-not-dispatched from local control
        // flow or serialized evidence.
        state.state = 'precommit-reconciliation-required'
        return fail('supabase-backfill-database-cas-ledger-durable-journal-failed')
      }
      const permit = opaquePermit()
      const genericExpectation = Object.freeze({
        singleFlightKey: state.binding.singleFlightKey,
        dispatchScopeKey: state.binding.dispatchScopeKey,
        releaseId: state.hostClaim.claim.releaseId,
        planDigest: state.binding.planDigest,
        progressPayloadDigest: hostPrecommit.evidence.payloadDigest
      })
      state.permit = permit
      state.state = 'precommitted'
      permits.set(permit, {
        owner: permitConsumer,
        permit,
        attempt: state,
        genericPermit: hostPrecommit.permit,
        genericConsumer: kernel.permitConsumer,
        genericExpectation,
        transportBinding: transportBinding(state, lease)
      })
      return Object.freeze({
        permit,
        automaticRetryAllowed: false as const,
        databaseLedgerBound: false as const,
        sourceLedgerBound: false as const,
        releaseReady: false as const
      })
    },
    async settleBeforePrecommit(
      this: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
      value: SettleBeforePrecommitSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1
    ): Promise<SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedResultV1> {
      if (this !== authority) {
        return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
      }
      const source = exactRecord(value, SETTLE_BEFORE_PRECOMMIT_KEYS)
      const state = attemptAuthority(ownData(source, 'attempt'), authority)
      const recordedAt = canonicalTimestamp(ownData(source, 'recordedAt'))
      if (state.state !== 'claimed' && state.state !== 'precommit-reconciliation-required') {
        return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
      }
      return settleKnownState(kernel.controller, state, recordedAt)
    },
    async settleKnownNotDispatched(
      this: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
      value: SettleKnownNotDispatchedSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1
    ): Promise<SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedResultV1> {
      if (this !== authority) {
        return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
      }
      const source = exactRecord(value, SETTLE_KEYS)
      const state = attemptAuthority(ownData(source, 'attempt'), authority)
      const proofValue = ownData(source, 'proof')
      const recordedAt = canonicalTimestamp(ownData(source, 'recordedAt'))
      if (state.state !== 'known-not-dispatched') {
        return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
      }
      if (!state.outcomeUnknownAt || Date.parse(recordedAt) < Date.parse(state.outcomeUnknownAt)) {
        return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
      }
      if (proofValue === null || typeof proofValue !== 'object') {
        return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
      }
      const proof = knownNotDispatchedProofs.get(proofValue)
      if (
        !proof ||
        proof.proof !== proofValue ||
        proof.attempt !== state ||
        proof.permit !== state.permit
      ) {
        return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
      }
      knownNotDispatchedProofs.delete(proofValue)
      state.finalOutcome = 'failed'
      state.finalPayload = finalPayload(state, null)
      state.finalRecordedAt = recordedAt
      return completeKnownNotDispatchedSettlement(kernel.controller, state, proof.genericProof)
    },
    async reconcileInstalled(
      this: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
      value: ReconcileInstalledSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityOptionsV1
    ): Promise<SupabaseBackfillDatabaseCASLedgerInstallReconcileResultV1> {
      if (this !== authority) {
        return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
      }
      const source = exactRecord(value, RECONCILE_KEYS)
      const state = attemptAuthority(ownData(source, 'attempt'), authority)
      const verificationValue = ownData(source, 'installedVerification')
      const recordedAt = canonicalTimestamp(ownData(source, 'recordedAt'))
      if (
        state.state !== 'post-started' ||
        !state.installedEpoch ||
        !state.outcomeUnknownAt ||
        verificationValue === null ||
        typeof verificationValue !== 'object'
      ) {
        return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
      }
      if (Date.parse(recordedAt) < Date.parse(state.outcomeUnknownAt)) {
        return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
      }
      const verification = consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
        verificationValue,
        state.trusted.sourceReview,
        state.context.marker,
        state.installedEpoch
      )
      if (!verification) {
        return fail('supabase-backfill-database-cas-ledger-durable-proof-invalid')
      }
      state.installedVerification = verification
      state.finalOutcome = 'applied'
      state.finalPayload = finalPayload(state, verification)
      state.finalRecordedAt = recordedAt
      return completeInstalledSettlement(kernel.controller, state)
    },
    async recoverSettlement(
      this: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
      value: RecoverSupabaseBackfillDatabaseCASLedgerInstallDurableSettlementOptionsV1
    ): Promise<SupabaseBackfillDatabaseCASLedgerInstallDurableSettlementRecoveryResultV1> {
      if (this !== authority) {
        return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
      }
      const source = exactRecord(value, RECOVER_SETTLEMENT_KEYS)
      const state = attemptAuthority(ownData(source, 'attempt'), authority)
      if (state.state !== 'reconciliation-required') {
        return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
      }
      if (state.finalOutcome === 'failed' || state.finalOutcome === 'applied') {
        // The opaque proof was consumed by the failed settlement attempt and is deliberately not
        // reconstructed from persisted evidence. A fresh authoritative observation is required.
        return reconciliationRequired(
          state,
          'supabase-backfill-database-cas-ledger-install-final-settlement-required'
        )
      }
      return fail('supabase-backfill-database-cas-ledger-durable-state-invalid')
    }
  })
  trustedAuthorities.add(authority)
  authorityPermitConsumers.set(authority, permitConsumer)
  return Object.freeze({ authority, permitConsumer })
}

export function createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1(
  options: CreateSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingOptionsV1
): SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityBundleV1 {
  const source = exactRecord(options, FACTORY_KEYS)
  const journal = ownData(source, 'journal')
  if (!trustedBackendHostReleaseDispatchJournal(journal)) {
    return fail('supabase-backfill-database-cas-ledger-durable-input-invalid')
  }
  return createBundle(journal, 'testing')
}

export function trustedSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1(
  value: unknown
): value is SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1 {
  return value !== null && typeof value === 'object' && trustedAuthorities.has(value)
}

export function trustedSupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1(
  value: unknown
): value is SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1 {
  return value !== null && typeof value === 'object' && trustedPermitConsumers.has(value)
}

/** Exact identity lookup; serialized or reconstructed applied records never regain provenance. */
export function trustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1(
  value: unknown
): TrustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  return trustedAppliedResults.get(value) ?? null
}

/** Identity-only composition check; it never exposes or consumes either capability. */
export function isSupabaseBackfillDatabaseCASLedgerInstallAuthorityPermitConsumerPairV1(
  authority: unknown,
  permitConsumer: unknown
): boolean {
  return (
    authority !== null &&
    typeof authority === 'object' &&
    permitConsumer !== null &&
    typeof permitConsumer === 'object' &&
    trustedAuthorities.has(authority) &&
    trustedPermitConsumers.has(permitConsumer) &&
    authorityPermitConsumers.get(authority) === permitConsumer
  )
}
