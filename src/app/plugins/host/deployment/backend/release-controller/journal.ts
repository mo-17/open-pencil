import type { BackendReleaseApplyErrorKind } from '@open-pencil/lowcode/backend'

import type {
  BackendHostReleaseApplyResult,
  BackendHostReleaseReconcileInput,
  BackendHostReleaseReconcileResult,
  BackendHostReleaseReconciler
} from '../release-controller'
import {
  parseBackendHostReleaseDispatchJournalRecord,
  type BackendHostReleaseDispatchClaimInput,
  type BackendHostReleaseDispatchClaimResult,
  type BackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchJournalRecordV1,
  type BackendHostReleaseDispatchSettlementInput
} from '../release-journal'

interface JournalBinding {
  readonly singleFlightKey: string
  readonly planDigest: string
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`)
  }
  const prototype = Reflect.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain data object.`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key === 'symbol')) {
    throw new TypeError(`${path} must not contain symbol keys.`)
  }
  const record: Record<string, unknown> = Object.create(null)
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${path} must contain enumerable data properties only.`)
    }
    record[key] = descriptor.value
  }
  return record
}

function exactRecord(
  value: unknown,
  path: string,
  keys: readonly string[]
): Record<string, unknown> {
  const record = plainRecord(value, path)
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new TypeError(`${path} shape is invalid.`)
  }
  return record
}

function boundRecord(
  value: unknown,
  binding: JournalBinding,
  releaseId?: string,
  claim?: BackendHostReleaseDispatchClaimInput
): BackendHostReleaseDispatchJournalRecordV1 {
  const record = parseBackendHostReleaseDispatchJournalRecord(value)
  if (
    record.singleFlightKey !== binding.singleFlightKey ||
    record.planDigest !== binding.planDigest ||
    (releaseId !== undefined && record.releaseId !== releaseId) ||
    (claim !== undefined &&
      (record.ownerId !== claim.ownerId ||
        record.claimedAt !== claim.claimedAt ||
        record.leaseExpiresAt !== claim.leaseExpiresAt))
  ) {
    throw new TypeError('Backend Release journal record authority is not bound to this release.')
  }
  return record
}

export async function claimBackendReleaseDispatch(
  journal: BackendHostReleaseDispatchJournal,
  input: BackendHostReleaseDispatchClaimInput
): Promise<BackendHostReleaseDispatchClaimResult> {
  const raw = await journal.claim(input)
  const result = exactRecord(raw, 'Backend Release journal claim result', ['claimed', 'record'])
  if (typeof result.claimed !== 'boolean') {
    throw new TypeError('Backend Release journal claim marker is invalid.')
  }
  const record = boundRecord(
    result.record,
    input,
    result.claimed ? input.releaseId : undefined,
    result.claimed ? input : undefined
  )
  if (result.claimed && record.outcome !== 'pending') {
    throw new TypeError('A new Backend Release journal claim must be pending.')
  }
  return Object.freeze({ claimed: result.claimed, record })
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export async function settleBackendReleaseDispatch(
  journal: BackendHostReleaseDispatchJournal,
  input: BackendHostReleaseDispatchSettlementInput
): Promise<BackendHostReleaseDispatchJournalRecordV1> {
  const record = boundRecord(await journal.settle(input), input, input.releaseId)
  if (
    record.outcome !== input.outcome ||
    record.settledAt !== input.settledAt ||
    record.code !== input.code ||
    !sameValues(record.remoteOperationIds, input.remoteOperationIds)
  ) {
    throw new TypeError('Backend Release journal did not persist the exact settlement.')
  }
  return record
}

function applyFailureOutcome(
  kind: BackendReleaseApplyErrorKind
): BackendHostReleaseDispatchSettlementInput['outcome'] {
  return kind === 'timeout' || kind === 'abort' || kind === 'transport'
    ? 'outcome-unknown'
    : 'failed'
}

export function settlementForApplyResult(
  claim: BackendHostReleaseDispatchJournalRecordV1,
  result: BackendHostReleaseApplyResult,
  settledAt: string
): BackendHostReleaseDispatchSettlementInput {
  return {
    singleFlightKey: claim.singleFlightKey,
    releaseId: claim.releaseId,
    planDigest: claim.planDigest,
    settledAt,
    outcome: result.ok ? 'applied' : applyFailureOutcome(result.kind),
    code: result.ok ? null : result.code,
    remoteOperationIds: result.ok ? result.remoteOperationIds : (result.remoteOperationIds ?? [])
  }
}

function normalizedReconcileResult(
  value: unknown,
  claim: BackendHostReleaseDispatchJournalRecordV1,
  settledAt: string
): BackendHostReleaseDispatchSettlementInput {
  const result = exactRecord(value, 'Backend Release reconciliation result', [
    'outcome',
    'code',
    'remoteOperationIds'
  ])
  if (
    result.outcome !== 'applied' &&
    result.outcome !== 'failed' &&
    result.outcome !== 'outcome-unknown'
  ) {
    throw new TypeError('Backend Release reconciliation outcome is invalid.')
  }
  const candidate = parseBackendHostReleaseDispatchJournalRecord({
    ...claim,
    settledAt,
    outcome: result.outcome,
    code: result.code,
    remoteOperationIds: result.remoteOperationIds
  })
  if ((candidate.outcome === 'applied') !== (candidate.code === null)) {
    throw new TypeError('Applied reconciliation alone requires a null code.')
  }
  if (candidate.outcome === 'pending') {
    throw new TypeError('Backend Release reconciliation cannot remain pending.')
  }
  return {
    singleFlightKey: candidate.singleFlightKey,
    releaseId: candidate.releaseId,
    planDigest: candidate.planDigest,
    settledAt,
    outcome: candidate.outcome,
    code: candidate.code,
    remoteOperationIds: candidate.remoteOperationIds
  }
}

export async function reconcileBackendReleaseDispatch(
  reconciler: BackendHostReleaseReconciler,
  input: BackendHostReleaseReconcileInput,
  settledAt: string
): Promise<BackendHostReleaseDispatchSettlementInput> {
  const result: BackendHostReleaseReconcileResult = await reconciler.reconcile(input)
  return normalizedReconcileResult(result, input.claim, settledAt)
}

export function unknownSettlement(
  claim: BackendHostReleaseDispatchJournalRecordV1,
  settledAt: string,
  code: string
): BackendHostReleaseDispatchSettlementInput {
  return {
    singleFlightKey: claim.singleFlightKey,
    releaseId: claim.releaseId,
    planDigest: claim.planDigest,
    settledAt,
    outcome: 'outcome-unknown',
    code,
    remoteOperationIds: claim.remoteOperationIds
  }
}
