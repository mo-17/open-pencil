import type {
  BackendHostReleaseAppliedAttestationInput,
  BackendHostReleaseAppliedProofV1,
  BackendHostReleaseApplyResult,
  BackendHostReleaseReconcileInput,
  BackendHostReleaseReconcileResult,
  BackendHostReleaseReconciler
} from '../release-controller'
import {
  BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION,
  parseBackendHostReleaseDispatchJournalRecord,
  type BackendHostReleaseDispatchClaimInput,
  type BackendHostReleaseDispatchClaimResult,
  type BackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchJournalRecord,
  type BackendHostReleaseDispatchSettlementInput
} from '../release-journal'

interface JournalBinding {
  readonly singleFlightKey: string
  readonly planDigest: string
}

interface AppliedProofBinding extends JournalBinding {
  readonly releaseId: string
  readonly remoteOperationIdsFingerprint: string
  readonly invocation: object
}

const APPLIED_PROOF_FORMAT = 'openpencil.backend-release-applied-proof.v1' as const
const appliedProofs = new WeakMap<object, AppliedProofBinding>()

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
): BackendHostReleaseDispatchJournalRecord {
  const record = parseBackendHostReleaseDispatchJournalRecord(value)
  if (
    record.singleFlightKey !== binding.singleFlightKey ||
    record.planDigest !== binding.planDigest ||
    (releaseId !== undefined && record.releaseId !== releaseId) ||
    (claim !== undefined &&
      (record.version !== BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION ||
        record.dispatchScopeKey !== claim.dispatchScopeKey ||
        record.ownerId !== claim.ownerId ||
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
  const parsed = parseBackendHostReleaseDispatchJournalRecord(result.record)
  // An existing semantic claim may have been written by an earlier plan/grant generation. Its
  // historical planDigest and releaseId must remain immutable for settlement, while the stable key
  // prevents a fresh dispatch and routes the current run through reconciliation.
  const record = result.claimed
    ? boundRecord(result.record, input, input.releaseId, input)
    : boundRecord(result.record, {
        singleFlightKey: input.singleFlightKey,
        planDigest: parsed.planDigest
      })
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
): Promise<BackendHostReleaseDispatchJournalRecord> {
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

export function settlementForAppliedDispatch(
  claim: BackendHostReleaseDispatchJournalRecord,
  result: Extract<BackendHostReleaseApplyResult, { readonly ok: true }>,
  settledAt: string
): BackendHostReleaseDispatchSettlementInput {
  if (result.ok !== true) {
    throw new TypeError('Backend Release dispatch result is not an exact positive result.')
  }
  return {
    singleFlightKey: claim.singleFlightKey,
    releaseId: claim.releaseId,
    planDigest: claim.planDigest,
    settledAt,
    outcome: 'applied',
    code: null,
    remoteOperationIds: result.remoteOperationIds
  }
}

function normalizedReconcileResult(
  value: unknown,
  claim: BackendHostReleaseDispatchJournalRecord,
  settledAt: string,
  invocation: object
): BackendHostReleaseDispatchSettlementInput {
  const raw = plainRecord(value, 'Backend Release reconciliation result')
  if (raw.outcome !== 'applied' && raw.outcome !== 'outcome-unknown') {
    throw new TypeError('Backend Release reconciliation outcome is invalid.')
  }
  const result = exactRecord(
    value,
    'Backend Release reconciliation result',
    raw.outcome === 'applied'
      ? ['outcome', 'code', 'remoteOperationIds', 'proof']
      : ['outcome', 'code', 'remoteOperationIds']
  )
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
  if (candidate.outcome !== 'applied' && candidate.outcome !== 'outcome-unknown') {
    throw new TypeError('Backend Release reconciliation cannot remain pending.')
  }
  if (candidate.outcome === 'applied') {
    const proofValue = result.proof
    if (proofValue === null || typeof proofValue !== 'object') {
      throw new TypeError('Backend Release applied proof is invalid.')
    }
    const proof = appliedProofs.get(proofValue)
    // Burn the proof before checking caller-controlled result fields. A failed attempt can never
    // replay the same positive observation against a later reconciliation.
    appliedProofs.delete(proofValue)
    if (
      !proof ||
      proof.singleFlightKey !== candidate.singleFlightKey ||
      proof.releaseId !== candidate.releaseId ||
      proof.planDigest !== candidate.planDigest ||
      proof.invocation !== invocation ||
      proof.remoteOperationIdsFingerprint !== JSON.stringify(candidate.remoteOperationIds)
    ) {
      throw new TypeError('Backend Release applied proof is invalid or not bound to this claim.')
    }
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
  input: Omit<BackendHostReleaseReconcileInput, 'attestApplied'>,
  settledAt: string
): Promise<BackendHostReleaseDispatchSettlementInput> {
  const invocation = Object.freeze({})
  let issuedProof: BackendHostReleaseAppliedProofV1 | null = null
  const issuedProofs: BackendHostReleaseAppliedProofV1[] = []
  let closed = false
  const attestApplied = (
    value: BackendHostReleaseAppliedAttestationInput
  ): BackendHostReleaseAppliedProofV1 => {
    if (closed || issuedProof) {
      throw new TypeError('Backend Release applied proof was already issued for this observation.')
    }
    const attestation = exactRecord(value, 'Backend Release applied attestation', [
      'remoteOperationIds'
    ])
    const candidate = parseBackendHostReleaseDispatchJournalRecord({
      ...input.claim,
      settledAt: input.claim.claimedAt,
      outcome: 'applied',
      code: null,
      remoteOperationIds: attestation.remoteOperationIds
    })
    const proof = Object.freeze({
      format: APPLIED_PROOF_FORMAT,
      version: 1 as const
    }) satisfies BackendHostReleaseAppliedProofV1
    appliedProofs.set(
      proof,
      Object.freeze({
        singleFlightKey: candidate.singleFlightKey,
        releaseId: candidate.releaseId,
        planDigest: candidate.planDigest,
        remoteOperationIdsFingerprint: JSON.stringify(candidate.remoteOperationIds),
        invocation
      })
    )
    issuedProof = proof
    issuedProofs.push(proof)
    return proof
  }
  try {
    const result: BackendHostReleaseReconcileResult = await reconciler.reconcile({
      ...input,
      attestApplied
    })
    return normalizedReconcileResult(result, input.claim, settledAt, invocation)
  } finally {
    closed = true
    for (const proof of issuedProofs) appliedProofs.delete(proof)
  }
}

export function unknownSettlement(
  claim: BackendHostReleaseDispatchJournalRecord,
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
