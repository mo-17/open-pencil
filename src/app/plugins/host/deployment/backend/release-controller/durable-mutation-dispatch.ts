/* oxlint-disable eslint/max-lines, eslint/complexity -- Durable claim, evidence, settlement, recovery, and one-shot permit invariants stay together for authority auditing. */
import { containsBackendSecretLikeMaterial } from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  BACKEND_RELEASE_DISPATCH_LEASE_MS,
  BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT,
  BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION,
  BackendHostReleaseUnresolvedScopeError,
  parseBackendHostReleaseDispatchEvidenceRecord,
  parseBackendHostReleaseDispatchJournalRecord,
  trustedBackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchClaimInput,
  type BackendHostReleaseDispatchEvidenceRecord,
  type BackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchJournalRecord
} from '../release-journal'
import { claimBackendReleaseDispatch, settleBackendReleaseDispatch } from './journal'

export const HOST_DURABLE_MUTATION_DISPATCH_CLAIM_FORMAT =
  'openpencil.host-durable-mutation-dispatch-claim.v1' as const
export const HOST_DURABLE_MUTATION_DISPATCH_PERMIT_FORMAT =
  'openpencil.host-durable-mutation-dispatch-permit.v1' as const
export const HOST_DURABLE_MUTATION_KNOWN_NOT_DISPATCHED_PROOF_FORMAT =
  'openpencil.host-durable-mutation-known-not-dispatched-proof.v1' as const
export const HOST_DURABLE_MUTATION_DISPATCH_STARTED_FORMAT =
  'openpencil.host-durable-mutation-dispatch-started.v1' as const
export const HOST_DURABLE_MUTATION_APPLIED_PROOF_FORMAT =
  'openpencil.host-durable-mutation-applied-proof.v1' as const

const VERSION = 1 as const
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const SETTLEMENT_CODE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u
const MAX_EVIDENCE_BYTES = 1024 * 1024

type JSONPrimitive = string | number | boolean | null
export type HostDurableMutationDispatchJSONValue =
  | JSONPrimitive
  | readonly HostDurableMutationDispatchJSONValue[]
  | Readonly<{ [key: string]: HostDurableMutationDispatchJSONValue }>
export type HostDurableMutationDispatchJSONObject = Readonly<{
  [key: string]: HostDurableMutationDispatchJSONValue
}>

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

export interface HostDurableMutationDispatchClaimInputV1 {
  readonly singleFlightKey: string
  readonly dispatchScopeKey: string
  readonly planDigest: string
  readonly releaseId: string
  readonly ownerId: string
  readonly claimedAt: string
}

export interface HostDurableMutationDispatchClaimV1 {
  readonly format: typeof HOST_DURABLE_MUTATION_DISPATCH_CLAIM_FORMAT
  readonly version: typeof VERSION
  readonly created: boolean
  readonly claim: BackendHostReleaseDispatchJournalRecord
}

export interface HostDurableMutationDispatchEvidenceInputV1 {
  readonly payload: HostDurableMutationDispatchJSONObject
  readonly recordedAt: string
}

export interface HostDurableMutationDispatchPrecommitInputV1 {
  readonly claim: HostDurableMutationDispatchClaimV1
  readonly progress: HostDurableMutationDispatchEvidenceInputV1
  readonly settledAt: string
  readonly outcomeUnknownCode: string
}

export interface HostDurableMutationDispatchPermitV1 {
  readonly format: typeof HOST_DURABLE_MUTATION_DISPATCH_PERMIT_FORMAT
  readonly version: typeof VERSION
}

interface HostDurableMutationCapabilityHeaderV1<Format extends string> {
  readonly format: Format
  readonly version: typeof VERSION
}

export type HostDurableMutationKnownNotDispatchedProofV1 = HostDurableMutationCapabilityHeaderV1<
  typeof HOST_DURABLE_MUTATION_KNOWN_NOT_DISPATCHED_PROOF_FORMAT
>

export type HostDurableMutationDispatchStartedV1 = HostDurableMutationCapabilityHeaderV1<
  typeof HOST_DURABLE_MUTATION_DISPATCH_STARTED_FORMAT
>

export type HostDurableMutationAppliedProofV1 = HostDurableMutationCapabilityHeaderV1<
  typeof HOST_DURABLE_MUTATION_APPLIED_PROOF_FORMAT
>

export interface HostDurableMutationDispatchPrecommitResultV1 {
  readonly claim: BackendHostReleaseDispatchJournalRecord
  readonly evidence: BackendHostReleaseDispatchEvidenceRecord
  readonly permit: HostDurableMutationDispatchPermitV1
}

export interface HostDurableMutationDispatchPermitExpectationV1 {
  readonly singleFlightKey: string
  readonly dispatchScopeKey: string
  readonly releaseId: string
  readonly planDigest: string
  readonly progressPayloadDigest: string
}

export interface HostDurableMutationDispatchFinalInputV1 {
  readonly claim: HostDurableMutationDispatchClaimV1
  readonly proof: HostDurableMutationKnownNotDispatchedProofV1
  readonly final: HostDurableMutationDispatchEvidenceInputV1
  readonly code: string
}

export interface HostDurableMutationDispatchAppliedInputV1 {
  readonly claim: HostDurableMutationDispatchClaimV1
  readonly proof: HostDurableMutationAppliedProofV1
  readonly final: HostDurableMutationDispatchEvidenceInputV1
}

export interface HostDurableMutationClaimKnownNotDispatchedInputV1 {
  readonly claim: HostDurableMutationDispatchClaimV1
}

export interface HostDurableMutationAppliedAttestationInputV1 {
  readonly claim: HostDurableMutationDispatchClaimV1
  readonly dispatchStarted: HostDurableMutationDispatchStartedV1
  readonly final: HostDurableMutationDispatchEvidenceInputV1
}

export interface HostDurableMutationDispatchRecoveryInputV1 {
  readonly claim: HostDurableMutationDispatchClaimV1
  readonly final: HostDurableMutationDispatchEvidenceInputV1
  readonly outcome: 'applied' | 'failed'
  readonly code: string | null
}

export interface HostDurableMutationDispatchFinalResultV1 {
  readonly status: 'settled' | 'settlement-recovery-required'
  readonly claim: BackendHostReleaseDispatchJournalRecord
  readonly evidence: BackendHostReleaseDispatchEvidenceRecord
}

export type HostDurableMutationDispatchErrorCode =
  | 'host-durable-mutation-input-invalid'
  | 'host-durable-mutation-journal-invalid'
  | 'host-durable-mutation-journal-failed'
  | 'host-durable-mutation-scope-conflict'
  | 'host-durable-mutation-claim-invalid'
  | 'host-durable-mutation-evidence-invalid'
  | 'host-durable-mutation-state-invalid'

export class HostDurableMutationDispatchError extends Error {
  constructor(readonly code: HostDurableMutationDispatchErrorCode) {
    super(`Host durable mutation dispatch failed: ${code}.`)
    this.name = 'HostDurableMutationDispatchError'
  }
}

export interface HostDurableMutationDispatchControllerV1 {
  claimProjectScope(
    this: HostDurableMutationDispatchControllerV1,
    input: HostDurableMutationDispatchClaimInputV1
  ): Promise<HostDurableMutationDispatchClaimV1>
  precommitOutcomeUnknown(
    this: HostDurableMutationDispatchControllerV1,
    input: HostDurableMutationDispatchPrecommitInputV1
  ): Promise<HostDurableMutationDispatchPrecommitResultV1>
  attestClaimKnownNotDispatched(
    this: HostDurableMutationDispatchControllerV1,
    input: HostDurableMutationClaimKnownNotDispatchedInputV1
  ): Promise<HostDurableMutationKnownNotDispatchedProofV1>
  attestApplied(
    this: HostDurableMutationDispatchControllerV1,
    input: HostDurableMutationAppliedAttestationInputV1
  ): Promise<HostDurableMutationAppliedProofV1>
  settleKnownNotDispatched(
    this: HostDurableMutationDispatchControllerV1,
    input: HostDurableMutationDispatchFinalInputV1
  ): Promise<HostDurableMutationDispatchFinalResultV1>
  settleApplied(
    this: HostDurableMutationDispatchControllerV1,
    input: HostDurableMutationDispatchAppliedInputV1
  ): Promise<HostDurableMutationDispatchFinalResultV1>
  recoverFinalSettlement(
    this: HostDurableMutationDispatchControllerV1,
    input: HostDurableMutationDispatchRecoveryInputV1
  ): Promise<HostDurableMutationDispatchFinalResultV1>
}

export interface HostDurableMutationDispatchPermitConsumerV1 {
  consume(
    this: HostDurableMutationDispatchPermitConsumerV1,
    permit: HostDurableMutationDispatchPermitV1,
    expectation: HostDurableMutationDispatchPermitExpectationV1
  ): Promise<boolean>
  /** Consumes a validated attempt before any mutation API is entered. */
  attestKnownNotDispatched(
    this: HostDurableMutationDispatchPermitConsumerV1,
    permit: HostDurableMutationDispatchPermitV1
  ): HostDurableMutationKnownNotDispatchedProofV1 | null
  /** Irreversibly marks the boundary after which only positive Applied proof can terminate. */
  markDispatchStarted(
    this: HostDurableMutationDispatchPermitConsumerV1,
    permit: HostDurableMutationDispatchPermitV1
  ): HostDurableMutationDispatchStartedV1 | null
}

export interface HostDurableMutationDispatchKernelV1 {
  readonly controller: HostDurableMutationDispatchControllerV1
  readonly permitConsumer: HostDurableMutationDispatchPermitConsumerV1
}

interface ClaimAuthority {
  readonly handle: HostDurableMutationDispatchClaimV1
  readonly binding: Readonly<{
    singleFlightKey: string
    dispatchScopeKey: string
    planDigest: string
    releaseId: string
  }>
  readonly created: boolean
  precommitIssuance: 'available' | 'burned'
  claimFingerprint: string
}

interface EvidenceSnapshot {
  readonly record: BackendHostReleaseDispatchEvidenceRecord
  readonly recordFingerprint: string
  readonly payloadFingerprint: string
  readonly payloadDigest: string
}

interface PermitAuthority {
  readonly permit: HostDurableMutationDispatchPermitV1
  readonly binding: ClaimAuthority['binding']
  readonly outcomeUnknownCode: string
  readonly claimFingerprint: string
  readonly evidenceFingerprint: string
  readonly progressPayloadFingerprint: string
  readonly progressPayloadDigest: string
  readonly journal: BackendHostReleaseDispatchJournal
  readonly claimAuthority: ClaimAuthority
}

interface KnownNotDispatchedProofAuthority {
  readonly proof: HostDurableMutationKnownNotDispatchedProofV1
  readonly claimAuthority: ClaimAuthority
  readonly expectedOutcome: 'pending' | 'outcome-unknown'
}

interface DispatchStartedAuthority {
  readonly dispatchStarted: HostDurableMutationDispatchStartedV1
  readonly claimAuthority: ClaimAuthority
}

interface AppliedProofAuthority {
  readonly proof: HostDurableMutationAppliedProofV1
  readonly claimAuthority: ClaimAuthority
  readonly payloadFingerprint: string
  readonly payloadDigest: string
  readonly recordedAt: string
}

const FACTORY_OPTION_KEYS = ['journal'] as const
const CLAIM_INPUT_KEYS = [
  'singleFlightKey',
  'dispatchScopeKey',
  'planDigest',
  'releaseId',
  'ownerId',
  'claimedAt'
] as const
const EVIDENCE_INPUT_KEYS = ['payload', 'recordedAt'] as const
const PRECOMMIT_INPUT_KEYS = ['claim', 'progress', 'settledAt', 'outcomeUnknownCode'] as const
const PROVEN_FINAL_INPUT_KEYS = ['claim', 'proof', 'final', 'code'] as const
const APPLIED_INPUT_KEYS = ['claim', 'proof', 'final'] as const
const CLAIM_ATTESTATION_INPUT_KEYS = ['claim'] as const
const APPLIED_ATTESTATION_INPUT_KEYS = ['claim', 'dispatchStarted', 'final'] as const
const RECOVERY_INPUT_KEYS = ['claim', 'final', 'outcome', 'code'] as const
const EXPECTATION_KEYS = [
  'singleFlightKey',
  'dispatchScopeKey',
  'releaseId',
  'planDigest',
  'progressPayloadDigest'
] as const

function fail(code: HostDurableMutationDispatchErrorCode): never {
  throw new HostDurableMutationDispatchError(code)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('host-durable-mutation-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('host-durable-mutation-input-invalid')
  }
  return descriptor.value
}

function exactRecord(value: unknown, keys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== 'object') {
    return fail('host-durable-mutation-input-invalid')
  }
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  let array: boolean
  try {
    array = Array.isArray(value)
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail('host-durable-mutation-input-invalid')
  }
  if (
    array ||
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail('host-durable-mutation-input-invalid')
  }
  const snapshot: UnknownRecord = Object.create(null)
  for (const key of keys) snapshot[key] = ownData(value, key)
  return snapshot
}

function stableText(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    return fail('host-durable-mutation-input-invalid')
  }
  return value
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    return fail('host-durable-mutation-input-invalid')
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || codePoint === 127) {
      return fail('host-durable-mutation-input-invalid')
    }
  }
  return value
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') return fail('host-durable-mutation-input-invalid')
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail('host-durable-mutation-input-invalid')
  }
  return value
}

function snapshotJSONValue(
  value: unknown,
  seen: Set<object>,
  depth: number
): HostDurableMutationDispatchJSONValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      return fail('host-durable-mutation-input-invalid')
    }
    return value
  }
  if (typeof value !== 'object' || depth > 64 || seen.has(value)) {
    return fail('host-durable-mutation-input-invalid')
  }
  let array: boolean
  try {
    array = Array.isArray(value)
  } catch {
    return fail('host-durable-mutation-input-invalid')
  }
  seen.add(value)
  try {
    if (array) {
      let keys: readonly PropertyKey[]
      let lengthDescriptor: PropertyDescriptor | undefined
      try {
        keys = Reflect.ownKeys(value)
        lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
      } catch {
        return fail('host-durable-mutation-input-invalid')
      }
      if (
        !lengthDescriptor ||
        !Object.hasOwn(lengthDescriptor, 'value') ||
        lengthDescriptor.enumerable ||
        lengthDescriptor.configurable ||
        typeof lengthDescriptor.value !== 'number' ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > 100_000 ||
        keys.length !== lengthDescriptor.value + 1 ||
        keys[lengthDescriptor.value] !== 'length'
      ) {
        return fail('host-durable-mutation-input-invalid')
      }
      const result: HostDurableMutationDispatchJSONValue[] = []
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const key = String(index)
        if (keys[index] !== key) return fail('host-durable-mutation-input-invalid')
        result[index] = snapshotJSONValue(ownData(value, key), seen, depth + 1)
      }
      return Object.freeze(result)
    }
    let prototype: object | null
    let keys: readonly PropertyKey[]
    try {
      prototype = Object.getPrototypeOf(value)
      keys = Reflect.ownKeys(value)
    } catch {
      return fail('host-durable-mutation-input-invalid')
    }
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      keys.some((key) => typeof key !== 'string')
    ) {
      return fail('host-durable-mutation-input-invalid')
    }
    const result: Record<string, HostDurableMutationDispatchJSONValue> = Object.create(null)
    for (const key of keys as readonly string[]) {
      result[key] = snapshotJSONValue(ownData(value, key), seen, depth + 1)
    }
    return Object.freeze(result)
  } finally {
    seen.delete(value)
  }
}

function snapshotJSONObject(value: unknown): HostDurableMutationDispatchJSONObject {
  const snapshot = snapshotJSONValue(value, new Set(), 0)
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return fail('host-durable-mutation-input-invalid')
  }
  return snapshot as HostDurableMutationDispatchJSONObject
}

function claimInputSnapshot(value: unknown): BackendHostReleaseDispatchClaimInput {
  const source = exactRecord(value, CLAIM_INPUT_KEYS)
  const claimedAt = canonicalTimestamp(ownData(source, 'claimedAt'))
  let candidate: BackendHostReleaseDispatchJournalRecord
  try {
    candidate = parseBackendHostReleaseDispatchJournalRecord({
      format: BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT,
      version: BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION,
      singleFlightKey: ownData(source, 'singleFlightKey'),
      dispatchScopeKey: ownData(source, 'dispatchScopeKey'),
      releaseId: ownData(source, 'releaseId'),
      ownerId: ownData(source, 'ownerId'),
      planDigest: ownData(source, 'planDigest'),
      claimedAt,
      leaseExpiresAt: new Date(
        Date.parse(claimedAt) + BACKEND_RELEASE_DISPATCH_LEASE_MS
      ).toISOString(),
      settledAt: null,
      outcome: 'pending',
      code: null,
      remoteOperationIds: []
    })
  } catch {
    return fail('host-durable-mutation-input-invalid')
  }
  if (candidate.version !== BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION) {
    return fail('host-durable-mutation-input-invalid')
  }
  if (
    [
      candidate.singleFlightKey,
      candidate.dispatchScopeKey,
      candidate.releaseId,
      candidate.ownerId,
      candidate.planDigest
    ].some(containsBackendSecretLikeMaterial)
  ) {
    return fail('host-durable-mutation-input-invalid')
  }
  return claimInputProjection(candidate)
}

function evidenceInputSnapshot(value: unknown): HostDurableMutationDispatchEvidenceInputV1 {
  const source = exactRecord(value, EVIDENCE_INPUT_KEYS)
  return Object.freeze({
    payload: snapshotJSONObject(ownData(source, 'payload')),
    recordedAt: canonicalTimestamp(ownData(source, 'recordedAt'))
  })
}

function settlementCode(value: unknown): string {
  return stableText(value, SETTLEMENT_CODE)
}

function requireBoundClaim(
  value: unknown,
  binding: Pick<ClaimAuthority['binding'], 'singleFlightKey' | 'dispatchScopeKey' | 'planDigest'>,
  releaseId?: string
): BackendHostReleaseDispatchJournalRecord {
  const claim = parseBackendHostReleaseDispatchJournalRecord(value)
  if (
    claim.version !== BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION ||
    claim.singleFlightKey !== binding.singleFlightKey ||
    claim.dispatchScopeKey !== binding.dispatchScopeKey ||
    claim.planDigest !== binding.planDigest ||
    (releaseId !== undefined && claim.releaseId !== releaseId)
  ) {
    return fail('host-durable-mutation-claim-invalid')
  }
  return claim
}

function exactFingerprint(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function claimInputProjection(
  claim: BackendHostReleaseDispatchJournalRecord
): BackendHostReleaseDispatchClaimInput {
  if (claim.version !== BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION) {
    return fail('host-durable-mutation-claim-invalid')
  }
  return Object.freeze({
    singleFlightKey: claim.singleFlightKey,
    dispatchScopeKey: claim.dispatchScopeKey,
    planDigest: claim.planDigest,
    releaseId: claim.releaseId,
    ownerId: claim.ownerId,
    claimedAt: claim.claimedAt,
    leaseExpiresAt: claim.leaseExpiresAt
  })
}

function evidenceMatches(
  evidence: BackendHostReleaseDispatchEvidenceRecord,
  binding: ClaimAuthority['binding'],
  phase: BackendHostReleaseDispatchEvidenceRecord['phase'],
  payloadFingerprint: string,
  payloadDigest: string,
  recordedAt: string
): boolean {
  return (
    evidence.singleFlightKey === binding.singleFlightKey &&
    evidence.dispatchScopeKey === binding.dispatchScopeKey &&
    evidence.releaseId === binding.releaseId &&
    evidence.planDigest === binding.planDigest &&
    evidence.phase === phase &&
    evidence.payload === payloadFingerprint &&
    evidence.payloadDigest === payloadDigest &&
    evidence.recordedAt === recordedAt
  )
}

async function payloadSnapshot(input: HostDurableMutationDispatchEvidenceInputV1): Promise<
  Readonly<{
    payloadFingerprint: string
    payloadDigest: string
    recordedAt: string
  }>
> {
  const payloadFingerprint = JSON.stringify(input.payload)
  if (new TextEncoder().encode(payloadFingerprint).byteLength > MAX_EVIDENCE_BYTES) {
    return fail('host-durable-mutation-input-invalid')
  }
  let payloadDigest: string
  try {
    payloadDigest = await digestCanonicalManifest(input.payload)
  } catch {
    return fail('host-durable-mutation-input-invalid')
  }
  return Object.freeze({
    payloadFingerprint,
    payloadDigest,
    recordedAt: input.recordedAt
  })
}

function opaqueKnownNotDispatchedProof(): HostDurableMutationKnownNotDispatchedProofV1 {
  return Object.freeze({
    format: HOST_DURABLE_MUTATION_KNOWN_NOT_DISPATCHED_PROOF_FORMAT,
    version: VERSION
  })
}

function opaqueDispatchStarted(): HostDurableMutationDispatchStartedV1 {
  return Object.freeze({
    format: HOST_DURABLE_MUTATION_DISPATCH_STARTED_FORMAT,
    version: VERSION
  })
}

function opaqueAppliedProof(): HostDurableMutationAppliedProofV1 {
  return Object.freeze({
    format: HOST_DURABLE_MUTATION_APPLIED_PROOF_FORMAT,
    version: VERSION
  })
}

export function createHostDurableMutationDispatchKernelV1(
  input: Readonly<{ journal: BackendHostReleaseDispatchJournal }>
): HostDurableMutationDispatchKernelV1 {
  const source = exactRecord(input, FACTORY_OPTION_KEYS)
  const journalValue = ownData(source, 'journal')
  if (!trustedBackendHostReleaseDispatchJournal(journalValue)) {
    fail('host-durable-mutation-journal-invalid')
  }
  const journal: BackendHostReleaseDispatchJournal = journalValue

  const claimAuthorities = new WeakMap<object, ClaimAuthority>()
  const permits = new WeakMap<object, PermitAuthority>()
  const dispatchAttempts = new WeakMap<object, PermitAuthority>()
  const dispatchStartedAuthorities = new WeakMap<object, DispatchStartedAuthority>()
  const knownNotDispatchedProofs = new WeakMap<object, KnownNotDispatchedProofAuthority>()
  const appliedProofs = new WeakMap<object, AppliedProofAuthority>()

  function authority(value: unknown): ClaimAuthority {
    if (value === null || typeof value !== 'object') {
      return fail('host-durable-mutation-claim-invalid')
    }
    const trusted = claimAuthorities.get(value)
    if (!trusted || trusted.handle !== value) {
      return fail('host-durable-mutation-claim-invalid')
    }
    return trusted
  }

  async function rereadClaim(
    trusted: ClaimAuthority
  ): Promise<BackendHostReleaseDispatchJournalRecord> {
    let raw: BackendHostReleaseDispatchJournalRecord | null
    try {
      raw = await journal.read(trusted.binding.singleFlightKey)
    } catch {
      return fail('host-durable-mutation-journal-failed')
    }
    if (!raw) return fail('host-durable-mutation-claim-invalid')
    const claim = requireBoundClaim(raw, trusted.binding, trusted.binding.releaseId)
    if (JSON.stringify(claim) !== trusted.claimFingerprint) {
      return fail('host-durable-mutation-state-invalid')
    }
    return claim
  }

  async function persistEvidence(
    trusted: ClaimAuthority,
    phase: BackendHostReleaseDispatchEvidenceRecord['phase'],
    evidenceInput: HostDurableMutationDispatchEvidenceInputV1
  ): Promise<EvidenceSnapshot> {
    const payload = await payloadSnapshot(evidenceInput)
    await rereadClaim(trusted)
    let written: BackendHostReleaseDispatchEvidenceRecord
    try {
      written = parseBackendHostReleaseDispatchEvidenceRecord(
        await journal.recordEvidence({
          singleFlightKey: trusted.binding.singleFlightKey,
          dispatchScopeKey: trusted.binding.dispatchScopeKey,
          releaseId: trusted.binding.releaseId,
          planDigest: trusted.binding.planDigest,
          phase,
          payload: payload.payloadFingerprint,
          payloadDigest: payload.payloadDigest,
          recordedAt: payload.recordedAt
        })
      )
    } catch {
      return fail('host-durable-mutation-journal-failed')
    }
    let rawClaim: BackendHostReleaseDispatchJournalRecord | null
    let rawEvidence: BackendHostReleaseDispatchEvidenceRecord | null
    try {
      ;[rawClaim, rawEvidence] = await Promise.all([
        journal.read(trusted.binding.singleFlightKey),
        journal.readEvidence(trusted.binding.singleFlightKey)
      ])
    } catch {
      return fail('host-durable-mutation-journal-failed')
    }
    if (!rawClaim || !rawEvidence) return fail('host-durable-mutation-evidence-invalid')
    const reread = parseBackendHostReleaseDispatchEvidenceRecord(rawEvidence)
    const rereadBoundClaim = requireBoundClaim(rawClaim, trusted.binding, trusted.binding.releaseId)
    if (
      JSON.stringify(rereadBoundClaim) !== trusted.claimFingerprint ||
      !evidenceMatches(
        written,
        trusted.binding,
        phase,
        payload.payloadFingerprint,
        payload.payloadDigest,
        payload.recordedAt
      ) ||
      !evidenceMatches(
        reread,
        trusted.binding,
        phase,
        payload.payloadFingerprint,
        payload.payloadDigest,
        payload.recordedAt
      ) ||
      !exactFingerprint(written, reread)
    ) {
      return fail('host-durable-mutation-evidence-invalid')
    }
    return Object.freeze({
      record: reread,
      recordFingerprint: JSON.stringify(reread),
      payloadFingerprint: payload.payloadFingerprint,
      payloadDigest: payload.payloadDigest
    })
  }

  async function settleExact(
    trusted: ClaimAuthority,
    outcome: 'applied' | 'failed' | 'outcome-unknown',
    code: string | null,
    settledAt: string
  ): Promise<BackendHostReleaseDispatchJournalRecord | null> {
    const before = await rereadClaim(trusted)
    let returned: BackendHostReleaseDispatchJournalRecord | null = null
    try {
      returned = await settleBackendReleaseDispatch(journal, {
        singleFlightKey: trusted.binding.singleFlightKey,
        releaseId: trusted.binding.releaseId,
        planDigest: trusted.binding.planDigest,
        settledAt,
        outcome,
        code,
        remoteOperationIds: []
      })
    } catch {
      // The journal may have committed before its storage boundary reported failure. Resolve only
      // from an exact durable reread; otherwise the caller must retain recovery-required state.
      returned = null
    }
    let raw: BackendHostReleaseDispatchJournalRecord | null
    try {
      raw = await journal.read(trusted.binding.singleFlightKey)
    } catch {
      return fail('host-durable-mutation-journal-failed')
    }
    if (!raw) return fail('host-durable-mutation-claim-invalid')
    const reread = requireBoundClaim(raw, trusted.binding, trusted.binding.releaseId)
    const exactTarget =
      reread.outcome === outcome &&
      reread.code === code &&
      reread.settledAt === settledAt &&
      reread.remoteOperationIds.length === 0
    if (exactTarget) {
      if (returned && !exactFingerprint(returned, reread)) {
        return fail('host-durable-mutation-state-invalid')
      }
      trusted.claimFingerprint = JSON.stringify(reread)
      return reread
    }
    if (returned) return fail('host-durable-mutation-state-invalid')
    if (!exactFingerprint(before, reread)) {
      return fail('host-durable-mutation-state-invalid')
    }
    return null
  }

  async function rereadEvidence(
    trusted: ClaimAuthority,
    expected: EvidenceSnapshot
  ): Promise<BackendHostReleaseDispatchEvidenceRecord> {
    let raw: BackendHostReleaseDispatchEvidenceRecord | null
    try {
      raw = await journal.readEvidence(trusted.binding.singleFlightKey)
    } catch {
      return fail('host-durable-mutation-journal-failed')
    }
    if (!raw) return fail('host-durable-mutation-evidence-invalid')
    const evidence = parseBackendHostReleaseDispatchEvidenceRecord(raw)
    if (
      JSON.stringify(evidence) !== expected.recordFingerprint ||
      evidence.payload !== expected.payloadFingerprint ||
      evidence.payloadDigest !== expected.payloadDigest
    ) {
      return fail('host-durable-mutation-evidence-invalid')
    }
    return evidence
  }

  async function finish(
    trusted: ClaimAuthority,
    inputEvidence: HostDurableMutationDispatchEvidenceInputV1,
    outcome: 'applied' | 'failed',
    code: string | null,
    recoverOnly: boolean
  ): Promise<HostDurableMutationDispatchFinalResultV1> {
    const temporalClaim = await rereadClaim(trusted)
    const evidenceNotBefore =
      temporalClaim.outcome === 'pending' ? temporalClaim.claimedAt : temporalClaim.settledAt
    if (
      evidenceNotBefore === null ||
      Date.parse(inputEvidence.recordedAt) < Date.parse(evidenceNotBefore)
    ) {
      return fail('host-durable-mutation-input-invalid')
    }
    let finalSnapshot: EvidenceSnapshot
    if (recoverOnly) {
      const expected = await payloadSnapshot(inputEvidence)
      let raw: BackendHostReleaseDispatchEvidenceRecord | null
      try {
        raw = await journal.readEvidence(trusted.binding.singleFlightKey)
      } catch {
        return fail('host-durable-mutation-journal-failed')
      }
      if (!raw) return fail('host-durable-mutation-evidence-invalid')
      const record = parseBackendHostReleaseDispatchEvidenceRecord(raw)
      if (
        !evidenceMatches(
          record,
          trusted.binding,
          'final',
          expected.payloadFingerprint,
          expected.payloadDigest,
          expected.recordedAt
        )
      ) {
        return fail('host-durable-mutation-evidence-invalid')
      }
      finalSnapshot = Object.freeze({
        record,
        recordFingerprint: JSON.stringify(record),
        payloadFingerprint: expected.payloadFingerprint,
        payloadDigest: expected.payloadDigest
      })
    } else {
      const before = await rereadClaim(trusted)
      if (
        (outcome === 'applied' && before.outcome !== 'outcome-unknown') ||
        (outcome === 'failed' &&
          before.outcome !== 'pending' &&
          before.outcome !== 'outcome-unknown')
      ) {
        return fail('host-durable-mutation-state-invalid')
      }
      finalSnapshot = await persistEvidence(trusted, 'final', inputEvidence)
    }

    const beforeSettlement = await rereadClaim(trusted)
    if (
      (outcome === 'applied' &&
        beforeSettlement.outcome !== 'outcome-unknown' &&
        beforeSettlement.outcome !== 'applied') ||
      (outcome === 'failed' &&
        beforeSettlement.outcome !== 'pending' &&
        beforeSettlement.outcome !== 'outcome-unknown' &&
        beforeSettlement.outcome !== 'failed')
    ) {
      return fail('host-durable-mutation-state-invalid')
    }
    if (beforeSettlement.outcome === outcome) {
      if (
        beforeSettlement.code !== code ||
        beforeSettlement.settledAt !== inputEvidence.recordedAt ||
        beforeSettlement.remoteOperationIds.length !== 0
      ) {
        return fail('host-durable-mutation-state-invalid')
      }
      const evidence = await rereadEvidence(trusted, finalSnapshot)
      return Object.freeze({ status: 'settled' as const, claim: beforeSettlement, evidence })
    }
    const settled = await settleExact(trusted, outcome, code, inputEvidence.recordedAt)
    const evidence = await rereadEvidence(trusted, finalSnapshot)
    if (!settled) {
      const current = await rereadClaim(trusted)
      return Object.freeze({
        status: 'settlement-recovery-required' as const,
        claim: current,
        evidence
      })
    }
    return Object.freeze({ status: 'settled' as const, claim: settled, evidence })
  }

  const controller: HostDurableMutationDispatchControllerV1 = Object.freeze({
    async claimProjectScope(
      this: HostDurableMutationDispatchControllerV1,
      value: HostDurableMutationDispatchClaimInputV1
    ) {
      if (this !== controller) return fail('host-durable-mutation-input-invalid')
      const claimInput = claimInputSnapshot(value)
      let claimed
      try {
        claimed = await claimBackendReleaseDispatch(journal, claimInput)
      } catch (cause) {
        if (cause instanceof BackendHostReleaseUnresolvedScopeError) {
          return fail('host-durable-mutation-scope-conflict')
        }
        if (cause instanceof HostDurableMutationDispatchError) throw cause
        return fail('host-durable-mutation-journal-failed')
      }
      const binding = Object.freeze({
        singleFlightKey: claimInput.singleFlightKey,
        dispatchScopeKey: claimInput.dispatchScopeKey,
        planDigest: claimInput.planDigest,
        releaseId: claimed.record.releaseId
      })
      const returned = requireBoundClaim(claimed.record, binding, binding.releaseId)
      if (claimed.claimed && !exactFingerprint(claimInputProjection(returned), claimInput)) {
        return fail('host-durable-mutation-claim-invalid')
      }
      const handle = Object.freeze({
        format: HOST_DURABLE_MUTATION_DISPATCH_CLAIM_FORMAT,
        version: VERSION,
        created: claimed.claimed,
        claim: returned
      }) satisfies HostDurableMutationDispatchClaimV1
      const trusted: ClaimAuthority = {
        handle,
        binding,
        created: claimed.claimed,
        precommitIssuance: claimed.claimed ? 'available' : 'burned',
        claimFingerprint: JSON.stringify(returned)
      }
      // Retain an opaque claim capability as soon as the trusted journal reports that the claim
      // committed. A transient mandatory readback failure must not orphan a durable claim. Every
      // precommit/final operation still starts with an exact reread, so this never mints a permit
      // from an unverified snapshot.
      claimAuthorities.set(handle, trusted)
      let raw: BackendHostReleaseDispatchJournalRecord | null
      try {
        raw = await journal.read(binding.singleFlightKey)
      } catch {
        return handle
      }
      if (!raw) {
        claimAuthorities.delete(handle)
        return fail('host-durable-mutation-claim-invalid')
      }
      const reread = requireBoundClaim(raw, binding, binding.releaseId)
      if (
        !exactFingerprint(returned, reread) ||
        (claimed.claimed && !exactFingerprint(claimInputProjection(reread), claimInput))
      ) {
        claimAuthorities.delete(handle)
        return fail('host-durable-mutation-claim-invalid')
      }
      return handle
    },

    async precommitOutcomeUnknown(
      this: HostDurableMutationDispatchControllerV1,
      value: HostDurableMutationDispatchPrecommitInputV1
    ) {
      if (this !== controller) return fail('host-durable-mutation-input-invalid')
      const source = exactRecord(value, PRECOMMIT_INPUT_KEYS)
      const trusted = authority(ownData(source, 'claim'))
      if (!trusted.created || trusted.precommitIssuance !== 'available') {
        return fail('host-durable-mutation-state-invalid')
      }
      // Burn issuance synchronously before parsing more caller data or crossing any await. A failed
      // attempt therefore cannot reopen a race that could mint another mutation permit.
      trusted.precommitIssuance = 'burned'
      const progress = evidenceInputSnapshot(ownData(source, 'progress'))
      const settledAt = canonicalTimestamp(ownData(source, 'settledAt'))
      const outcomeUnknownCode = settlementCode(ownData(source, 'outcomeUnknownCode'))
      if (Date.parse(progress.recordedAt) > Date.parse(settledAt)) {
        return fail('host-durable-mutation-input-invalid')
      }
      const current = await rereadClaim(trusted)
      if (current.outcome !== 'pending') return fail('host-durable-mutation-state-invalid')
      const evidence = await persistEvidence(trusted, 'progress', progress)
      const claim = await settleExact(trusted, 'outcome-unknown', outcomeUnknownCode, settledAt)
      if (!claim) return fail('host-durable-mutation-journal-failed')
      const reread = await rereadEvidence(trusted, evidence)
      const permit = Object.freeze({
        format: HOST_DURABLE_MUTATION_DISPATCH_PERMIT_FORMAT,
        version: VERSION
      }) satisfies HostDurableMutationDispatchPermitV1
      permits.set(
        permit,
        Object.freeze({
          permit,
          binding: trusted.binding,
          outcomeUnknownCode,
          claimFingerprint: JSON.stringify(claim),
          evidenceFingerprint: JSON.stringify(reread),
          progressPayloadFingerprint: evidence.payloadFingerprint,
          progressPayloadDigest: evidence.payloadDigest,
          journal,
          claimAuthority: trusted
        })
      )
      return Object.freeze({ claim, evidence: reread, permit })
    },

    async attestClaimKnownNotDispatched(
      this: HostDurableMutationDispatchControllerV1,
      value: HostDurableMutationClaimKnownNotDispatchedInputV1
    ) {
      if (this !== controller) return fail('host-durable-mutation-input-invalid')
      const source = exactRecord(value, CLAIM_ATTESTATION_INPUT_KEYS)
      const trusted = authority(ownData(source, 'claim'))
      if (!trusted.created || trusted.precommitIssuance !== 'available') {
        return fail('host-durable-mutation-state-invalid')
      }
      // Claim-only proof is valid only before precommit can issue mutation authority. Burn the
      // alternative synchronously so proof issuance and permit issuance cannot race.
      trusted.precommitIssuance = 'burned'
      const current = await rereadClaim(trusted)
      if (current.outcome !== 'pending') return fail('host-durable-mutation-state-invalid')
      const proof = opaqueKnownNotDispatchedProof()
      knownNotDispatchedProofs.set(
        proof,
        Object.freeze({ proof, claimAuthority: trusted, expectedOutcome: 'pending' as const })
      )
      return proof
    },

    async attestApplied(
      this: HostDurableMutationDispatchControllerV1,
      value: HostDurableMutationAppliedAttestationInputV1
    ) {
      if (this !== controller) return fail('host-durable-mutation-input-invalid')
      const source = exactRecord(value, APPLIED_ATTESTATION_INPUT_KEYS)
      const trusted = authority(ownData(source, 'claim'))
      const dispatchStartedValue = ownData(source, 'dispatchStarted')
      if (dispatchStartedValue === null || typeof dispatchStartedValue !== 'object') {
        return fail('host-durable-mutation-state-invalid')
      }
      const dispatchStarted = dispatchStartedAuthorities.get(dispatchStartedValue)
      dispatchStartedAuthorities.delete(dispatchStartedValue)
      if (!dispatchStarted || dispatchStarted.claimAuthority !== trusted) {
        return fail('host-durable-mutation-state-invalid')
      }
      const final = evidenceInputSnapshot(ownData(source, 'final'))
      const current = await rereadClaim(trusted)
      if (
        current.outcome !== 'outcome-unknown' ||
        current.settledAt === null ||
        Date.parse(final.recordedAt) < Date.parse(current.settledAt)
      ) {
        return fail('host-durable-mutation-state-invalid')
      }
      const payload = await payloadSnapshot(final)
      const proof = opaqueAppliedProof()
      appliedProofs.set(
        proof,
        Object.freeze({
          proof,
          claimAuthority: trusted,
          payloadFingerprint: payload.payloadFingerprint,
          payloadDigest: payload.payloadDigest,
          recordedAt: payload.recordedAt
        })
      )
      return proof
    },

    async settleKnownNotDispatched(
      this: HostDurableMutationDispatchControllerV1,
      value: HostDurableMutationDispatchFinalInputV1
    ) {
      if (this !== controller) return fail('host-durable-mutation-input-invalid')
      const source = exactRecord(value, PROVEN_FINAL_INPUT_KEYS)
      const trusted = authority(ownData(source, 'claim'))
      const proofValue = ownData(source, 'proof')
      if (proofValue === null || typeof proofValue !== 'object') {
        return fail('host-durable-mutation-state-invalid')
      }
      const proof = knownNotDispatchedProofs.get(proofValue)
      knownNotDispatchedProofs.delete(proofValue)
      if (!proof || proof.claimAuthority !== trusted) {
        return fail('host-durable-mutation-state-invalid')
      }
      const current = await rereadClaim(trusted)
      if (current.outcome !== proof.expectedOutcome) {
        return fail('host-durable-mutation-state-invalid')
      }
      return finish(
        trusted,
        evidenceInputSnapshot(ownData(source, 'final')),
        'failed',
        settlementCode(ownData(source, 'code')),
        false
      )
    },

    async settleApplied(
      this: HostDurableMutationDispatchControllerV1,
      value: HostDurableMutationDispatchAppliedInputV1
    ) {
      if (this !== controller) return fail('host-durable-mutation-input-invalid')
      const source = exactRecord(value, APPLIED_INPUT_KEYS)
      const trusted = authority(ownData(source, 'claim'))
      const proofValue = ownData(source, 'proof')
      if (proofValue === null || typeof proofValue !== 'object') {
        return fail('host-durable-mutation-state-invalid')
      }
      const proof = appliedProofs.get(proofValue)
      appliedProofs.delete(proofValue)
      if (!proof || proof.claimAuthority !== trusted) {
        return fail('host-durable-mutation-state-invalid')
      }
      const final = evidenceInputSnapshot(ownData(source, 'final'))
      const payload = await payloadSnapshot(final)
      if (
        proof.payloadFingerprint !== payload.payloadFingerprint ||
        proof.payloadDigest !== payload.payloadDigest ||
        proof.recordedAt !== payload.recordedAt
      ) {
        return fail('host-durable-mutation-evidence-invalid')
      }
      return finish(trusted, final, 'applied', null, false)
    },

    async recoverFinalSettlement(
      this: HostDurableMutationDispatchControllerV1,
      value: HostDurableMutationDispatchRecoveryInputV1
    ) {
      if (this !== controller) return fail('host-durable-mutation-input-invalid')
      exactRecord(value, RECOVERY_INPUT_KEYS)
      // Serialized final evidence is an audit artifact, not recovered authority. A restart must
      // obtain a fresh positive Applied observation (or leave the scope active); it can never infer
      // failed/Applied from payload bytes alone.
      return fail('host-durable-mutation-state-invalid')
    }
  })

  const permitConsumer: HostDurableMutationDispatchPermitConsumerV1 = Object.freeze({
    async consume(
      this: HostDurableMutationDispatchPermitConsumerV1,
      permit: unknown,
      expectationValue: HostDurableMutationDispatchPermitExpectationV1
    ): Promise<boolean> {
      if (this !== permitConsumer || permit === null || typeof permit !== 'object') return false
      const trusted = permits.get(permit)
      permits.delete(permit)
      if (!trusted || trusted.permit !== permit) return false
      let expectation: UnknownRecord
      try {
        expectation = exactRecord(expectationValue, EXPECTATION_KEYS)
      } catch {
        return false
      }
      let expectedSingleFlightKey: string
      let expectedDispatchScopeKey: string
      let expectedReleaseId: string
      let expectedPlanDigest: string
      let expectedPayloadDigest: string
      try {
        expectedSingleFlightKey = boundedText(ownData(expectation, 'singleFlightKey'), 2_048)
        expectedDispatchScopeKey = boundedText(ownData(expectation, 'dispatchScopeKey'), 2_048)
        expectedReleaseId = boundedText(ownData(expectation, 'releaseId'), 256)
        expectedPlanDigest = boundedText(ownData(expectation, 'planDigest'), 256)
        expectedPayloadDigest = stableText(ownData(expectation, 'progressPayloadDigest'), DIGEST)
      } catch {
        return false
      }
      if (
        expectedSingleFlightKey !== trusted.binding.singleFlightKey ||
        expectedDispatchScopeKey !== trusted.binding.dispatchScopeKey ||
        expectedReleaseId !== trusted.binding.releaseId ||
        expectedPlanDigest !== trusted.binding.planDigest ||
        expectedPayloadDigest !== trusted.progressPayloadDigest
      ) {
        return false
      }
      let rawClaim: BackendHostReleaseDispatchJournalRecord | null
      let rawEvidence: BackendHostReleaseDispatchEvidenceRecord | null
      try {
        ;[rawClaim, rawEvidence] = await Promise.all([
          trusted.journal.read(trusted.binding.singleFlightKey),
          trusted.journal.readEvidence(trusted.binding.singleFlightKey)
        ])
      } catch {
        return false
      }
      if (!rawClaim || !rawEvidence) return false
      try {
        const claim = requireBoundClaim(rawClaim, trusted.binding, trusted.binding.releaseId)
        const evidence = parseBackendHostReleaseDispatchEvidenceRecord(rawEvidence)
        const valid =
          claim.outcome === 'outcome-unknown' &&
          claim.code === trusted.outcomeUnknownCode &&
          claim.settledAt !== null &&
          claim.remoteOperationIds.length === 0 &&
          evidence.phase === 'progress' &&
          Date.parse(evidence.recordedAt) <= Date.parse(claim.settledAt) &&
          evidence.payload === trusted.progressPayloadFingerprint &&
          evidence.payloadDigest === trusted.progressPayloadDigest &&
          JSON.stringify(claim) === trusted.claimFingerprint &&
          JSON.stringify(evidence) === trusted.evidenceFingerprint
        if (valid) dispatchAttempts.set(permit, trusted)
        return valid
      } catch {
        return false
      }
    },

    attestKnownNotDispatched(
      this: HostDurableMutationDispatchPermitConsumerV1,
      permit: unknown
    ): HostDurableMutationKnownNotDispatchedProofV1 | null {
      if (this !== permitConsumer || permit === null || typeof permit !== 'object') return null
      const attempt = dispatchAttempts.get(permit)
      dispatchAttempts.delete(permit)
      if (!attempt || attempt.permit !== permit) return null
      const proof = opaqueKnownNotDispatchedProof()
      knownNotDispatchedProofs.set(
        proof,
        Object.freeze({
          proof,
          claimAuthority: attempt.claimAuthority,
          expectedOutcome: 'outcome-unknown' as const
        })
      )
      return proof
    },

    markDispatchStarted(
      this: HostDurableMutationDispatchPermitConsumerV1,
      permit: unknown
    ): HostDurableMutationDispatchStartedV1 | null {
      if (this !== permitConsumer || permit === null || typeof permit !== 'object') return null
      const attempt = dispatchAttempts.get(permit)
      dispatchAttempts.delete(permit)
      if (!attempt || attempt.permit !== permit) return null
      const dispatchStarted = opaqueDispatchStarted()
      dispatchStartedAuthorities.set(
        dispatchStarted,
        Object.freeze({ dispatchStarted, claimAuthority: attempt.claimAuthority })
      )
      return dispatchStarted
    }
  })

  return Object.freeze({ controller, permitConsumer })
}
