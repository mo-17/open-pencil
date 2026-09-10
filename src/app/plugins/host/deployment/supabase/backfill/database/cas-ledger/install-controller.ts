/* oxlint-disable eslint(max-lines), eslint(complexity -- Keep the complete testing-only durable install orchestration boundary auditable in one module. */

import {
  isTestingSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1,
  issueSupabaseManagementDatabaseWriteCredentialLeaseV1,
  type SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
} from '@/app/lowcode/supabase/management-database-write-credential-lease'

import {
  deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1,
  type SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
} from './install'
import {
  trustedSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
  type SupabaseBackfillDatabaseCASLedgerInstallAppliedResultV1,
  type SupabaseBackfillDatabaseCASLedgerInstallAppliedReconciliationRequiredV1,
  type SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1,
  type SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
  type SupabaseBackfillDatabaseCASLedgerInstallDurableSettlementRecoveryResultV1,
  type SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedResultV1
} from './install-durable-authority'
import type { SupabaseBackfillDatabaseCASLedgerVerificationV1 } from './verifier'
import {
  consumeSupabaseManagementBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1,
  isTestingSupabaseManagementBackfillDatabaseCASLedgerInstallTransportBoundToV1,
  SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError,
  type SupabaseManagementBackfillDatabaseCASLedgerInstallAcceptanceV1,
  type SupabaseManagementBackfillDatabaseCASLedgerInstallTransportV1
} from '@/app/plugins/host/deployment/supabase/management/backfill/database-cas-ledger-install-transport'

export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_CONTROLLER_FORMAT =
  'openpencil.supabase-backfill-database-cas-ledger-install-controller.v1' as const

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u
const VERIFICATION_REQUIRED_CODE =
  'supabase-backfill-database-cas-ledger-install-verification-required' as const
const PRECOMMIT_RECONCILIATION_CODE =
  'supabase-backfill-database-cas-ledger-install-precommit-reconciliation-required' as const
const DISPATCH_RECONCILIATION_CODE =
  'supabase-backfill-database-cas-ledger-install-dispatch-reconciliation-required' as const
const SETTLEMENT_RECONCILIATION_CODE =
  'supabase-backfill-database-cas-ledger-install-settlement-reconciliation-required' as const
const ALREADY_USED_CODE =
  'supabase-backfill-database-cas-ledger-install-controller-already-used' as const

declare const reconciliationBrand: unique symbol

export interface SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1 {
  readonly [reconciliationBrand]: never
}

interface DispatchResultBaseV1 {
  readonly automaticRetryAllowed: false
  readonly databaseLedgerBound: false
  readonly sourceLedgerBound: false
  readonly releaseReady: false
}

export interface SupabaseBackfillDatabaseCASLedgerInstallVerificationRequiredResultV1 extends DispatchResultBaseV1 {
  readonly status: 'verification-required'
  readonly reconciliation: SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1
  readonly acceptance: SupabaseManagementBackfillDatabaseCASLedgerInstallAcceptanceV1
  readonly code: typeof VERIFICATION_REQUIRED_CODE
}

export interface SupabaseBackfillDatabaseCASLedgerInstallNotDispatchedResultV1 extends DispatchResultBaseV1 {
  readonly status: 'not-dispatched'
  readonly reconciliation: null
  readonly acceptance: null
  readonly code: string
}

export interface SupabaseBackfillDatabaseCASLedgerInstallReconciliationRequiredResultV1 extends DispatchResultBaseV1 {
  readonly status: 'reconciliation-required'
  readonly reconciliation: SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1 | null
  readonly acceptance: null
  readonly code: string
}

export type SupabaseBackfillDatabaseCASLedgerInstallControllerDispatchResultV1 =
  | SupabaseBackfillDatabaseCASLedgerInstallVerificationRequiredResultV1
  | SupabaseBackfillDatabaseCASLedgerInstallNotDispatchedResultV1
  | SupabaseBackfillDatabaseCASLedgerInstallReconciliationRequiredResultV1

export type SupabaseBackfillDatabaseCASLedgerInstallControllerReconcileResultV1 =
  | SupabaseBackfillDatabaseCASLedgerInstallAppliedResultV1
  | SupabaseBackfillDatabaseCASLedgerInstallAppliedReconciliationRequiredV1

export type SupabaseBackfillDatabaseCASLedgerInstallControllerSettlementRecoveryResultV1 =
  SupabaseBackfillDatabaseCASLedgerInstallDurableSettlementRecoveryResultV1

export interface DispatchSupabaseBackfillDatabaseCASLedgerInstallControllerOptionsV1 {
  readonly context: SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
  readonly releaseId: string
  readonly ownerId: string
}

export interface ReconcileSupabaseBackfillDatabaseCASLedgerInstallControllerOptionsV1 {
  readonly reconciliation: SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1
  readonly installedVerification: SupabaseBackfillDatabaseCASLedgerVerificationV1
}

export interface ResumeSupabaseBackfillDatabaseCASLedgerInstallControllerSettlementOptionsV1 {
  readonly reconciliation: SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1
}

export interface SupabaseBackfillDatabaseCASLedgerInstallControllerV1 {
  readonly format: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_CONTROLLER_FORMAT
  readonly version: 1
  readonly provenance: 'testing'
  dispatch(
    this: SupabaseBackfillDatabaseCASLedgerInstallControllerV1,
    options: DispatchSupabaseBackfillDatabaseCASLedgerInstallControllerOptionsV1
  ): Promise<SupabaseBackfillDatabaseCASLedgerInstallControllerDispatchResultV1>
  reconcile(
    this: SupabaseBackfillDatabaseCASLedgerInstallControllerV1,
    options: ReconcileSupabaseBackfillDatabaseCASLedgerInstallControllerOptionsV1
  ): Promise<SupabaseBackfillDatabaseCASLedgerInstallControllerReconcileResultV1>
  /** Retry one bounded durable settlement cycle. This never performs transport I/O. */
  resumeSettlement(
    this: SupabaseBackfillDatabaseCASLedgerInstallControllerV1,
    options: ResumeSupabaseBackfillDatabaseCASLedgerInstallControllerSettlementOptionsV1
  ): Promise<SupabaseBackfillDatabaseCASLedgerInstallControllerSettlementRecoveryResultV1>
}

export interface CreateSupabaseBackfillDatabaseCASLedgerInstallControllerForTestingOptionsV1 {
  readonly authority: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1
  readonly transport: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportV1
  readonly credentialIssuer: SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
  readonly now: () => string
}

export type SupabaseBackfillDatabaseCASLedgerInstallControllerErrorCode =
  | 'supabase-backfill-database-cas-ledger-install-controller-input-invalid'
  | 'supabase-backfill-database-cas-ledger-install-controller-authority-invalid'
  | 'supabase-backfill-database-cas-ledger-install-controller-clock-invalid'
  | 'supabase-backfill-database-cas-ledger-install-controller-state-invalid'
  | 'supabase-backfill-database-cas-ledger-install-controller-credential-failed'
  | 'supabase-backfill-database-cas-ledger-install-controller-verification-failed'

export class SupabaseBackfillDatabaseCASLedgerInstallControllerError extends Error {
  constructor(readonly code: SupabaseBackfillDatabaseCASLedgerInstallControllerErrorCode) {
    super(`Supabase backfill database CAS-ledger install controller failed: ${code}.`)
    this.name = 'SupabaseBackfillDatabaseCASLedgerInstallControllerError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

interface ReconciliationAuthorityV1 {
  readonly owner: SupabaseBackfillDatabaseCASLedgerInstallControllerV1
  readonly handle: SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1
  readonly attempt: SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1
  mode: 'installed-verification' | 'final-settlement'
  state: 'pending' | 'reconciling' | 'closed'
}

const FACTORY_KEYS = ['authority', 'transport', 'credentialIssuer', 'now'] as const
const DISPATCH_KEYS = ['context', 'releaseId', 'ownerId'] as const
const RECONCILE_KEYS = ['reconciliation', 'installedVerification'] as const
const RESUME_SETTLEMENT_KEYS = ['reconciliation'] as const
const testingControllers = new WeakSet<object>()
const reconciliations = new WeakMap<object, ReconciliationAuthorityV1>()

function fail(code: SupabaseBackfillDatabaseCASLedgerInstallControllerErrorCode): never {
  throw new SupabaseBackfillDatabaseCASLedgerInstallControllerError(code)
}

function exactRecord(value: unknown, keys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('supabase-backfill-database-cas-ledger-install-controller-input-invalid')
  }
  try {
    const prototype = Object.getPrototypeOf(value)
    const ownKeys = Reflect.ownKeys(value)
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail('supabase-backfill-database-cas-ledger-install-controller-input-invalid')
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return fail('supabase-backfill-database-cas-ledger-install-controller-input-invalid')
      }
    }
  } catch (cause) {
    if (cause instanceof SupabaseBackfillDatabaseCASLedgerInstallControllerError) throw cause
    return fail('supabase-backfill-database-cas-ledger-install-controller-input-invalid')
  }
  return value as UnknownRecord
}

function ownData(source: UnknownRecord, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      return fail('supabase-backfill-database-cas-ledger-install-controller-input-invalid')
    }
    return descriptor.value
  } catch (cause) {
    if (cause instanceof SupabaseBackfillDatabaseCASLedgerInstallControllerError) throw cause
    return fail('supabase-backfill-database-cas-ledger-install-controller-input-invalid')
  }
}

function stableId(value: unknown): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) {
    return fail('supabase-backfill-database-cas-ledger-install-controller-input-invalid')
  }
  return value
}

function opaqueReconciliation(): SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1 {
  return Object.freeze(
    Object.create(null)
  ) as SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1
}

function result(
  status: 'verification-required',
  reconciliation: SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1,
  acceptance: SupabaseManagementBackfillDatabaseCASLedgerInstallAcceptanceV1,
  code: typeof VERIFICATION_REQUIRED_CODE
): SupabaseBackfillDatabaseCASLedgerInstallVerificationRequiredResultV1
function result(
  status: 'not-dispatched',
  reconciliation: null,
  acceptance: null,
  code: string
): SupabaseBackfillDatabaseCASLedgerInstallNotDispatchedResultV1
function result(
  status: 'reconciliation-required',
  reconciliation: SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1 | null,
  acceptance: null,
  code: string
): SupabaseBackfillDatabaseCASLedgerInstallReconciliationRequiredResultV1
function result(
  status: SupabaseBackfillDatabaseCASLedgerInstallControllerDispatchResultV1['status'],
  reconciliation: SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1 | null,
  acceptance: SupabaseManagementBackfillDatabaseCASLedgerInstallAcceptanceV1 | null,
  code: string
): SupabaseBackfillDatabaseCASLedgerInstallControllerDispatchResultV1 {
  return Object.freeze({
    status,
    reconciliation,
    acceptance,
    automaticRetryAllowed: false as const,
    databaseLedgerBound: false as const,
    sourceLedgerBound: false as const,
    releaseReady: false as const,
    code
  }) as SupabaseBackfillDatabaseCASLedgerInstallControllerDispatchResultV1
}

function transportFailureCode(cause: unknown): string {
  return cause instanceof SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError
    ? `supabase-backfill-database-cas-ledger-install-${cause.code}`
    : DISPATCH_RECONCILIATION_CODE
}

export function createSupabaseBackfillDatabaseCASLedgerInstallControllerForTestingV1(
  options: CreateSupabaseBackfillDatabaseCASLedgerInstallControllerForTestingOptionsV1
): SupabaseBackfillDatabaseCASLedgerInstallControllerV1 {
  const source = exactRecord(options, FACTORY_KEYS)
  const authority = ownData(source, 'authority')
  const transport = ownData(source, 'transport')
  const credentialIssuer = ownData(source, 'credentialIssuer')
  const now = ownData(source, 'now')
  if (
    !trustedSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1(authority) ||
    authority.provenance !== 'testing' ||
    !isTestingSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1(credentialIssuer) ||
    !isTestingSupabaseManagementBackfillDatabaseCASLedgerInstallTransportBoundToV1(
      transport,
      authority,
      credentialIssuer
    ) ||
    typeof now !== 'function'
  ) {
    return fail('supabase-backfill-database-cas-ledger-install-controller-authority-invalid')
  }

  const trustedAuthority = authority
  const trustedTransport = transport
  const trustedIssuer = credentialIssuer
  const clock = now as () => string
  let controllerState: 'ready' | 'dispatching' | 'consumed' = 'ready'
  let latestTimestamp = Number.NEGATIVE_INFINITY

  function currentTimestamp(): string {
    let value: unknown
    try {
      value = Reflect.apply(clock, undefined, [])
    } catch {
      return fail('supabase-backfill-database-cas-ledger-install-controller-clock-invalid')
    }
    if (typeof value !== 'string') {
      return fail('supabase-backfill-database-cas-ledger-install-controller-clock-invalid')
    }
    const milliseconds = Date.parse(value)
    if (
      !Number.isFinite(milliseconds) ||
      new Date(milliseconds).toISOString() !== value ||
      milliseconds < latestTimestamp
    ) {
      return fail('supabase-backfill-database-cas-ledger-install-controller-clock-invalid')
    }
    latestTimestamp = milliseconds
    return value
  }

  function settlementTimestamp(): string {
    try {
      return currentTimestamp()
    } catch (cause) {
      if (
        cause instanceof SupabaseBackfillDatabaseCASLedgerInstallControllerError &&
        Number.isFinite(latestTimestamp)
      ) {
        return new Date(latestTimestamp).toISOString()
      }
      throw cause
    }
  }

  function reconciliationHandle(
    attempt: SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1,
    mode: ReconciliationAuthorityV1['mode'] = 'installed-verification'
  ): SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1 {
    const handle = opaqueReconciliation()
    reconciliations.set(handle, {
      owner: controller,
      handle,
      attempt,
      mode,
      state: 'pending'
    })
    return handle
  }

  function closeReconciliation(
    handle: SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1
  ): void {
    const reconciliation = reconciliations.get(handle)
    if (reconciliation) reconciliation.state = 'closed'
    reconciliations.delete(handle)
  }

  function knownSettlementResult(
    settlement: SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedResultV1,
    reconciliation: SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1
  ): SupabaseBackfillDatabaseCASLedgerInstallControllerDispatchResultV1 {
    if (settlement.status === 'not-dispatched') {
      closeReconciliation(reconciliation)
      return result('not-dispatched', null, null, settlement.code)
    }
    const state = reconciliations.get(reconciliation)
    if (state) {
      state.mode = 'final-settlement'
      state.state = 'pending'
    }
    return result('reconciliation-required', reconciliation, null, settlement.code)
  }

  const controller: SupabaseBackfillDatabaseCASLedgerInstallControllerV1 = Object.freeze({
    format: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_CONTROLLER_FORMAT,
    version: 1 as const,
    provenance: 'testing' as const,
    async dispatch(
      this: SupabaseBackfillDatabaseCASLedgerInstallControllerV1,
      value: DispatchSupabaseBackfillDatabaseCASLedgerInstallControllerOptionsV1
    ): Promise<SupabaseBackfillDatabaseCASLedgerInstallControllerDispatchResultV1> {
      if (this !== controller) {
        return fail('supabase-backfill-database-cas-ledger-install-controller-state-invalid')
      }
      const dispatchSource = exactRecord(value, DISPATCH_KEYS)
      const contextValue = ownData(dispatchSource, 'context')
      const releaseId = stableId(ownData(dispatchSource, 'releaseId'))
      const ownerId = stableId(ownData(dispatchSource, 'ownerId'))
      if (controllerState !== 'ready') {
        return result('reconciliation-required', null, null, ALREADY_USED_CODE)
      }
      const credentialBinding =
        deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(contextValue)
      if (!credentialBinding) {
        return fail('supabase-backfill-database-cas-ledger-install-controller-input-invalid')
      }
      controllerState = 'dispatching'

      let credentialLease
      try {
        credentialLease = await issueSupabaseManagementDatabaseWriteCredentialLeaseV1({
          issuer: trustedIssuer,
          binding: credentialBinding
        })
      } catch {
        controllerState = 'consumed'
        return fail('supabase-backfill-database-cas-ledger-install-controller-credential-failed')
      }

      let claim
      try {
        claim = await trustedAuthority.claim({
          context: contextValue as SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1,
          releaseId,
          ownerId,
          claimedAt: currentTimestamp()
        })
      } catch {
        controllerState = 'consumed'
        return result('reconciliation-required', null, null, SETTLEMENT_RECONCILIATION_CODE)
      }
      if (claim.status !== 'claimed' || !claim.attempt) {
        controllerState = 'consumed'
        return result(
          'reconciliation-required',
          null,
          null,
          claim.code ?? SETTLEMENT_RECONCILIATION_CODE
        )
      }
      const attempt = claim.attempt

      let prepared
      try {
        prepared = await trustedTransport.prepareMigration(
          contextValue as SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
        )
      } catch {
        controllerState = 'consumed'
        const reconciliation = reconciliationHandle(attempt, 'final-settlement')
        try {
          return knownSettlementResult(
            await trustedAuthority.settleBeforePrecommit({
              attempt,
              recordedAt: settlementTimestamp()
            }),
            reconciliation
          )
        } catch {
          return result(
            'reconciliation-required',
            reconciliation,
            null,
            SETTLEMENT_RECONCILIATION_CODE
          )
        }
      }

      let precommit
      try {
        const progressRecordedAt = currentTimestamp()
        const outcomeUnknownAt = currentTimestamp()
        precommit = await trustedAuthority.precommit({
          attempt,
          credentialIssuer: trustedIssuer,
          credentialLease,
          progressRecordedAt,
          outcomeUnknownAt
        })
      } catch {
        prepared.dispose()
        controllerState = 'consumed'
        const reconciliation = reconciliationHandle(attempt, 'final-settlement')
        try {
          return knownSettlementResult(
            await trustedAuthority.settleBeforePrecommit({
              attempt,
              recordedAt: settlementTimestamp()
            }),
            reconciliation
          )
        } catch {
          return result(
            'reconciliation-required',
            reconciliation,
            null,
            PRECOMMIT_RECONCILIATION_CODE
          )
        }
      }

      const reconciliation = reconciliationHandle(attempt)
      try {
        const acceptance = await prepared.dispatch({
          permit: precommit.permit,
          credentialLease
        })
        controllerState = 'consumed'
        return result(
          'verification-required',
          reconciliation,
          acceptance,
          VERIFICATION_REQUIRED_CODE
        )
      } catch (cause) {
        const proof =
          consumeSupabaseManagementBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1(cause)
        if (proof) {
          const reconciliationState = reconciliations.get(reconciliation)
          if (reconciliationState) reconciliationState.mode = 'final-settlement'
          controllerState = 'consumed'
          try {
            return knownSettlementResult(
              await trustedAuthority.settleKnownNotDispatched({
                attempt,
                proof,
                recordedAt: settlementTimestamp()
              }),
              reconciliation
            )
          } catch {
            return result(
              'reconciliation-required',
              reconciliation,
              null,
              SETTLEMENT_RECONCILIATION_CODE
            )
          }
        }
        controllerState = 'consumed'
        if (
          cause instanceof SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError &&
          cause.outcome === 'outcome-unknown'
        ) {
          return result(
            'reconciliation-required',
            reconciliation,
            null,
            transportFailureCode(cause)
          )
        }
        // A missing no-POST proof cannot authorize failed settlement, but it also cannot prove that
        // the durable outcome-unknown scope is safe to forget. Retain the opaque reconciliation
        // handle and require installed-state inspection; never retry the transport automatically.
        return result('reconciliation-required', reconciliation, null, transportFailureCode(cause))
      }
    },
    async reconcile(
      this: SupabaseBackfillDatabaseCASLedgerInstallControllerV1,
      value: ReconcileSupabaseBackfillDatabaseCASLedgerInstallControllerOptionsV1
    ): Promise<SupabaseBackfillDatabaseCASLedgerInstallControllerReconcileResultV1> {
      if (this !== controller) {
        return fail('supabase-backfill-database-cas-ledger-install-controller-state-invalid')
      }
      const reconcileSource = exactRecord(value, RECONCILE_KEYS)
      const handleValue = ownData(reconcileSource, 'reconciliation')
      const installedVerification = ownData(reconcileSource, 'installedVerification')
      if (handleValue === null || typeof handleValue !== 'object') {
        return fail('supabase-backfill-database-cas-ledger-install-controller-state-invalid')
      }
      const reconciliation = reconciliations.get(handleValue)
      if (
        !reconciliation ||
        reconciliation.owner !== controller ||
        reconciliation.handle !== handleValue ||
        reconciliation.mode !== 'installed-verification' ||
        reconciliation.state !== 'pending'
      ) {
        return fail('supabase-backfill-database-cas-ledger-install-controller-state-invalid')
      }
      if (installedVerification === null || typeof installedVerification !== 'object') {
        return fail('supabase-backfill-database-cas-ledger-install-controller-input-invalid')
      }
      reconciliation.state = 'reconciling'
      try {
        const reconciled = await trustedAuthority.reconcileInstalled({
          attempt: reconciliation.attempt,
          installedVerification:
            installedVerification as SupabaseBackfillDatabaseCASLedgerVerificationV1,
          recordedAt: currentTimestamp()
        })
        if (reconciled.status === 'reconciliation-required') {
          reconciliation.mode = 'final-settlement'
          reconciliation.state = 'pending'
          return reconciled
        }
        closeReconciliation(
          handleValue as SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1
        )
        return reconciled
      } catch (cause) {
        reconciliation.state = 'pending'
        if (cause instanceof SupabaseBackfillDatabaseCASLedgerInstallControllerError) throw cause
        return fail('supabase-backfill-database-cas-ledger-install-controller-verification-failed')
      }
    },
    async resumeSettlement(
      this: SupabaseBackfillDatabaseCASLedgerInstallControllerV1,
      value: ResumeSupabaseBackfillDatabaseCASLedgerInstallControllerSettlementOptionsV1
    ): Promise<SupabaseBackfillDatabaseCASLedgerInstallControllerSettlementRecoveryResultV1> {
      if (this !== controller) {
        return fail('supabase-backfill-database-cas-ledger-install-controller-state-invalid')
      }
      const source = exactRecord(value, RESUME_SETTLEMENT_KEYS)
      const handleValue = ownData(source, 'reconciliation')
      if (handleValue === null || typeof handleValue !== 'object') {
        return fail('supabase-backfill-database-cas-ledger-install-controller-state-invalid')
      }
      const reconciliation = reconciliations.get(handleValue)
      if (
        !reconciliation ||
        reconciliation.owner !== controller ||
        reconciliation.handle !== handleValue ||
        reconciliation.mode !== 'final-settlement' ||
        reconciliation.state !== 'pending'
      ) {
        return fail('supabase-backfill-database-cas-ledger-install-controller-state-invalid')
      }
      reconciliation.state = 'reconciling'
      try {
        const recovered = await trustedAuthority.recoverSettlement({
          attempt: reconciliation.attempt
        })
        if (recovered.status === 'reconciliation-required') {
          reconciliation.state = 'pending'
          return recovered
        }
        closeReconciliation(
          handleValue as SupabaseBackfillDatabaseCASLedgerInstallReconciliationHandleV1
        )
        return recovered
      } catch (cause) {
        reconciliation.state = 'pending'
        if (cause instanceof SupabaseBackfillDatabaseCASLedgerInstallControllerError) throw cause
        return fail('supabase-backfill-database-cas-ledger-install-controller-verification-failed')
      }
    }
  })
  testingControllers.add(controller)
  return controller
}

export function isTestingSupabaseBackfillDatabaseCASLedgerInstallControllerV1(
  value: unknown
): value is SupabaseBackfillDatabaseCASLedgerInstallControllerV1 {
  return value !== null && typeof value === 'object' && testingControllers.has(value)
}
