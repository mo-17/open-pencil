/* oxlint-disable eslint/max-lines, eslint/complexity -- The testing-only runner keeps lease, CAS, permit, dispatch, settlement, and DLQ ordering in one auditable boundary. */
import {
  BACKEND_AUTOMATION_EXECUTION_INPUT_FORMAT,
  BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
  BACKEND_AUTOMATION_WORKER_RECORD_FORMAT,
  createBackendAutomationIdempotencyCASProposal,
  createBackendAutomationOutboxCASProposal,
  createBackendAutomationWorkerCASProposal,
  digestBackendAutomationIdempotencyCASProposal,
  digestBackendAutomationIdempotencyRecord,
  digestBackendAutomationOutboxCASProposal,
  digestBackendAutomationOutboxRecord,
  digestBackendAutomationQueueMessageEnvelope,
  digestBackendAutomationWorkerRecord,
  parseBackendAutomationIdempotencyRecord,
  parseBackendAutomationOutboxRecord,
  parseBackendAutomationQueueMessageEnvelope,
  parseBackendAutomationWorkerRecord,
  planBackendAutomationExecutionDisposition,
  planBackendAutomationQueueMutation,
  verifyBackendAutomationQueueLeaseObservation,
  type BackendAutomationExecutionDispositionV1,
  type BackendAutomationExecutionRetryPolicyV1,
  type BackendAutomationIdempotencyCASCandidateV1,
  type BackendAutomationIdempotencyRecordV1,
  type BackendAutomationOutboxCASCandidateV1,
  type BackendAutomationOutboxRecordV1,
  type BackendAutomationQueueLeaseBindingV1,
  type BackendAutomationQueueMessageEnvelopeV1,
  type BackendAutomationQueueMutationKind,
  type BackendAutomationQueueMutationProposalV1,
  type BackendAutomationWorkerCASCandidateV1,
  type BackendAutomationWorkerRecordV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

export const HOST_AUTOMATION_QUEUE_INJECTED_ADAPTERS_TESTING_FORMAT =
  'openpencil.host-automation-queue-injected-adapters.testing.v1' as const
export const HOST_AUTOMATION_QUEUE_RUNNER_TESTING_FORMAT =
  'openpencil.host-automation-queue-runner.testing.v1' as const
export const HOST_AUTOMATION_QUEUE_RUN_RESULT_TESTING_FORMAT =
  'openpencil.host-automation-queue-run-result.testing.v1' as const

export const HOST_AUTOMATION_QUEUE_RUNNER_REMAINING_PRODUCTION_BLOCKERS = Object.freeze([
  'production-runner-constructor-unavailable',
  'production-queue-adapter-unavailable',
  'production-policy-authority-unavailable',
  'production-idempotency-store-unavailable',
  'production-worker-store-unavailable',
  'production-dispatch-authority-unavailable',
  'production-atomic-lease-dispatch-fence-unavailable',
  'production-outbox-authority-unavailable',
  'production-network-authority-unavailable',
  'production-credential-authority-unavailable',
  'production-database-authority-unavailable',
  'host-deduplication-terminal-composition-unavailable',
  'production-deduplication-verified-store-unavailable',
  'visibility-extension-rebind-unavailable',
  'full-jitter-entropy-authority-unavailable',
  'production-independent-reconciliation-authority-unavailable',
  'outcome-reconciliation-runner-unavailable',
  'release-authority-unavailable'
] as const)

const VERSION = 1 as const
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const NANOSECOND_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.)(\d{9})Z$/u
const MAX_TRACE_STEPS = 32

type MaybePromise<Value> = Value | Promise<Value>
type UnknownRecord = Record<PropertyKey, unknown>
/** A testing classification only; neither value proves persistence or grants external authority. */
type AdapterKind = 'fake' | 'durable-test-double'

export interface HostAutomationQueueDeliveryForTestingV1 {
  readonly message: unknown
  readonly lease: unknown
}

export interface HostAutomationQueuePolicyForTestingV1 {
  readonly idempotencyRetentionHours: number
  readonly retryPolicy: BackendAutomationExecutionRetryPolicyV1
}

export interface HostAutomationQueueCASCommitForTestingV1 {
  readonly committed: boolean
  readonly verificationEvidenceDigest: string | null
}

export type HostAutomationQueueDispatchOutcomeForTestingV1 =
  | Readonly<{ kind: 'succeeded'; evidenceDigest: string }>
  | Readonly<{
      kind: 'retryable-failure' | 'permanent-failure'
      stableCode: string
      evidenceDigest: string
      injectedTestingReconciliationEvidenceDigest: string
    }>
  | Readonly<{ kind: 'outcome-unknown'; stableCode: string; evidenceDigest: string }>

export interface HostAutomationQueueDispatchInvocationForTestingV1 {
  readonly format: 'openpencil.host-automation-queue-dispatch-invocation.testing.v1'
  readonly version: 1
  readonly testingOnly: true
  readonly processLocalOnly: true
  readonly messageEnvelopeDigest: string
  readonly leaseObservationDigest: string
  readonly workerFenceRecordDigest: string
  readonly idempotencyDispatchStartedRecordDigest: string
  readonly payloadIncluded: false
  readonly oneShotPermitConsumed: true
  readonly callbackSideEffectsAuthenticated: false
  readonly injectedReconciliationEvidenceAuthenticated: false
  readonly productionNetworkAuthorityCreated: false
  readonly credentialAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly releaseAuthorityCreated: false
}

export interface HostAutomationQueueDeadLetterHeadForTestingV1 {
  readonly message: unknown
  readonly outbox: unknown
}

export type HostAutomationQueueDeadLetterPublishOutcomeForTestingV1 =
  | Readonly<{ kind: 'published'; evidenceDigest: string }>
  | Readonly<{ kind: 'outcome-unknown'; evidenceDigest: string }>

export interface HostAutomationQueueDeadLetterPublishInvocationForTestingV1 {
  readonly format: 'openpencil.host-automation-dead-letter-publish-invocation.testing.v1'
  readonly version: 1
  readonly testingOnly: true
  readonly processLocalOnly: true
  readonly sourceMessageEnvelopeDigest: string
  readonly targetMessageEnvelopeDigest: string
  readonly targetPrePublishRecordDigest: string
  readonly payloadIncluded: false
  readonly oneShotPermitConsumed: true
  readonly callbackSideEffectsAuthenticated: false
  readonly injectedReconciliationEvidenceAuthenticated: false
  readonly productionNetworkAuthorityCreated: false
  readonly credentialAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly releaseAuthorityCreated: false
}

export interface CreateHostAutomationQueueInjectedAdaptersForTestingOptionsV1 {
  readonly adapterKind: AdapterKind
  readonly now: () => MaybePromise<unknown>
  readonly receiveOne: () => MaybePromise<unknown>
  readonly isLeaseLive: (
    binding: BackendAutomationQueueLeaseBindingV1,
    observedAt: string
  ) => MaybePromise<unknown>
  readonly loadPolicy: (binding: BackendAutomationQueueLeaseBindingV1) => MaybePromise<unknown>
  readonly readIdempotencyHead: (
    binding: BackendAutomationQueueLeaseBindingV1
  ) => MaybePromise<unknown>
  readonly compareAndSwapIdempotency: (
    candidate: BackendAutomationIdempotencyCASCandidateV1
  ) => MaybePromise<unknown>
  readonly readWorkerHead: (binding: BackendAutomationQueueLeaseBindingV1) => MaybePromise<unknown>
  readonly compareAndSwapWorker: (
    candidate: BackendAutomationWorkerCASCandidateV1
  ) => MaybePromise<unknown>
  readonly dispatch: (
    invocation: HostAutomationQueueDispatchInvocationForTestingV1
  ) => MaybePromise<unknown>
  readonly applySourceQueueMutation: (
    proposal: BackendAutomationQueueMutationProposalV1
  ) => MaybePromise<unknown>
  readonly readDeadLetterOutboxHead: (
    source: BackendAutomationQueueLeaseBindingV1,
    disposition: BackendAutomationExecutionDispositionV1
  ) => MaybePromise<unknown>
  readonly compareAndSwapDeadLetterOutbox: (
    candidate: BackendAutomationOutboxCASCandidateV1
  ) => MaybePromise<unknown>
  readonly publishDeadLetter: (
    invocation: HostAutomationQueueDeadLetterPublishInvocationForTestingV1
  ) => MaybePromise<unknown>
}

export interface HostAutomationQueueInjectedAdaptersForTestingV1 {
  readonly format: typeof HOST_AUTOMATION_QUEUE_INJECTED_ADAPTERS_TESTING_FORMAT
  readonly version: 1
  readonly testingOnly: true
  readonly processLocalOnly: true
  readonly adapterKind: AdapterKind
  readonly defaultImplementationsCreated: false
  readonly callbackSideEffectsAuthenticated: false
  readonly injectedReconciliationEvidenceAuthenticated: false
  readonly productionQueueAuthorityCreated: false
  readonly productionNetworkAuthorityCreated: false
  readonly credentialAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly releaseAuthorityCreated: false
}

export type HostAutomationQueueRunnerBlockerV1 =
  | 'already-succeeded-duplicate-ack-unavailable'
  | 'visibility-extension-rebind-unavailable'
  | 'outcome-reconciliation-required'
  | 'fresh-attempt-unavailable'
  | 'durable-settlement-reconciliation-required'
  | 'dead-letter-publication-reconciliation-required'
  | 'source-mutation-reconciliation-required'

export type HostAutomationQueueRunStatusForTestingV1 =
  | 'empty'
  | 'blocked'
  | 'succeeded'
  | 'retry-scheduled'
  | 'failed-archived'
  | 'dead-lettered'
  | 'outcome-unknown'

export interface HostAutomationQueueRunResultForTestingV1 {
  readonly format: typeof HOST_AUTOMATION_QUEUE_RUN_RESULT_TESTING_FORMAT
  readonly version: 1
  readonly testingOnly: true
  readonly processLocalOnly: true
  readonly status: HostAutomationQueueRunStatusForTestingV1
  readonly blocker: HostAutomationQueueRunnerBlockerV1 | null
  readonly messageId: string | null
  readonly messagesDequeued: 0 | 1
  readonly messagesDispatched: 0 | 1
  readonly sourceMutationKind: BackendAutomationQueueMutationKind | null
  readonly sourceQueueMutationCallbackReportedCommitted: boolean
  readonly sourceQueueMutationReadbackVerified: false
  readonly sourceQueueMutationCallbackReportAuthenticated: false
  readonly deadLetterPublishCASCommitted: boolean
  readonly oneShotDispatchPermitConsumed: boolean
  readonly preDispatchOutcomeUnknownFencePersisted: boolean
  readonly trace: readonly string[]
  readonly remainingProductionBlockers: typeof HOST_AUTOMATION_QUEUE_RUNNER_REMAINING_PRODUCTION_BLOCKERS
  readonly callbackSideEffectsAuthenticated: false
  readonly injectedReconciliationEvidenceAuthenticated: false
  readonly productionQueueAuthorityCreated: false
  readonly productionNetworkAuthorityCreated: false
  readonly credentialAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly releaseAuthorityCreated: false
}

export interface HostAutomationQueueRunnerKernelForTestingV1 {
  readonly format: typeof HOST_AUTOMATION_QUEUE_RUNNER_TESTING_FORMAT
  readonly version: 1
  readonly testingOnly: true
  readonly processLocalOnly: true
  readonly lifetime: 'single-run'
  readonly maximumMessagesPerRun: 1
  readonly defaultImplementationsCreated: false
  readonly productionConstructorAvailable: false
  readonly injectedReconciliationEvidenceAuthenticated: false
  readonly productionQueueAuthorityCreated: false
  readonly productionNetworkAuthorityCreated: false
  readonly credentialAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  runOne(
    this: HostAutomationQueueRunnerKernelForTestingV1
  ): Promise<HostAutomationQueueRunResultForTestingV1>
}

export type HostAutomationQueueRunnerTestingErrorCode =
  | 'host-automation-queue-runner-input-invalid'
  | 'host-automation-queue-runner-adapters-untrusted'
  | 'host-automation-queue-runner-consumed'
  | 'host-automation-queue-runner-delivery-invalid'
  | 'host-automation-queue-runner-policy-invalid'
  | 'host-automation-queue-runner-lease-invalid'
  | 'host-automation-queue-runner-cas-failed'
  | 'host-automation-queue-runner-dispatch-result-invalid'
  | 'host-automation-queue-runner-dead-letter-invalid'

export class HostAutomationQueueRunnerTestingError extends Error {
  constructor(readonly code: HostAutomationQueueRunnerTestingErrorCode) {
    super(`Host Automation queue testing runner failed: ${code}.`)
    this.name = 'HostAutomationQueueRunnerTestingError'
  }
}

interface AdapterContext extends CreateHostAutomationQueueInjectedAdaptersForTestingOptionsV1 {
  readonly handle: HostAutomationQueueInjectedAdaptersForTestingV1
}

interface RunnerContext {
  readonly adapters: AdapterContext
  consumed: boolean
  lastHostTimestamp: string | null
}

interface TerminalPersistence {
  readonly idempotency: BackendAutomationIdempotencyCASCandidateV1
  readonly worker: BackendAutomationWorkerCASCandidateV1
  readonly terminalCASVerificationEvidenceDigest: string
}

const ADAPTER_OPTION_KEYS = Object.freeze([
  'adapterKind',
  'now',
  'receiveOne',
  'isLeaseLive',
  'loadPolicy',
  'readIdempotencyHead',
  'compareAndSwapIdempotency',
  'readWorkerHead',
  'compareAndSwapWorker',
  'dispatch',
  'applySourceQueueMutation',
  'readDeadLetterOutboxHead',
  'compareAndSwapDeadLetterOutbox',
  'publishDeadLetter'
] as const)
const DELIVERY_KEYS = Object.freeze(['message', 'lease'] as const)
const POLICY_KEYS = Object.freeze(['idempotencyRetentionHours', 'retryPolicy'] as const)
const COMMIT_KEYS = Object.freeze(['committed', 'verificationEvidenceDigest'] as const)
const DEAD_LETTER_HEAD_KEYS = Object.freeze(['message', 'outbox'] as const)
const DISPATCH_SUCCEEDED_KEYS = Object.freeze(['kind', 'evidenceDigest'] as const)
const DISPATCH_OUTCOME_UNKNOWN_KEYS = Object.freeze([
  'kind',
  'stableCode',
  'evidenceDigest'
] as const)
const DISPATCH_FAILURE_KEYS = Object.freeze([
  'kind',
  'stableCode',
  'evidenceDigest',
  'injectedTestingReconciliationEvidenceDigest'
] as const)

const trustedAdapters = new WeakMap<object, AdapterContext>()
const trustedRunners = new WeakMap<object, RunnerContext>()
const dispatchPermits = new WeakSet<object>()
const deadLetterPermits = new WeakSet<object>()

function fail(code: HostAutomationQueueRunnerTestingErrorCode): never {
  throw new HostAutomationQueueRunnerTestingError(code)
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  code: HostAutomationQueueRunnerTestingErrorCode
): UnknownRecord {
  const snapshot = snapshotDataRecord(value, code)
  exactDataRecordShape(snapshot, keys, code)
  return snapshot
}

function exactDataRecordShape(
  snapshot: UnknownRecord,
  keys: readonly string[],
  code: HostAutomationQueueRunnerTestingErrorCode
): void {
  const ownKeys = Reflect.ownKeys(snapshot)
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail(code)
  }
}

function snapshotDataRecord(
  value: unknown,
  code: HostAutomationQueueRunnerTestingErrorCode
): UnknownRecord {
  try {
    if (value === null || typeof value !== 'object') return fail(code)
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return fail(code)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const ownKeys = Reflect.ownKeys(descriptors)
    if (ownKeys.some((key) => typeof key !== 'string')) return fail(code)
    const snapshot = Object.create(null) as UnknownRecord
    for (const key of ownKeys as string[]) {
      const descriptor = descriptors[key]
      if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        return fail(code)
      }
      Object.defineProperty(snapshot, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false
      })
    }
    return Object.freeze(snapshot)
  } catch (cause) {
    if (cause instanceof HostAutomationQueueRunnerTestingError) throw cause
    return fail(code)
  }
}

function ownValue(
  record: UnknownRecord,
  key: string,
  code: HostAutomationQueueRunnerTestingErrorCode = 'host-automation-queue-runner-input-invalid'
): unknown {
  if (!Object.hasOwn(record, key)) {
    return fail(code)
  }
  return record[key]
}

function callback(
  record: UnknownRecord,
  key: string
): (...arguments_: readonly unknown[]) => MaybePromise<unknown> {
  const value = ownValue(record, key)
  if (typeof value !== 'function') return fail('host-automation-queue-runner-input-invalid')
  return value as (...arguments_: readonly unknown[]) => MaybePromise<unknown>
}

async function call<Arguments extends readonly unknown[], Result>(
  operation: (...arguments_: Arguments) => MaybePromise<Result>,
  arguments_: Arguments
): Promise<Result> {
  return Reflect.apply(operation, undefined, arguments_)
}

function digest(value: unknown, code: HostAutomationQueueRunnerTestingErrorCode): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) return fail(code)
  return value
}

function canonicalNanosecondTimestamp(value: unknown): string {
  const match = typeof value === 'string' ? NANOSECOND_TIMESTAMP.exec(value) : null
  const millisecondValue = match ? `${match[1]}${match[2].slice(0, 3)}Z` : null
  const milliseconds = millisecondValue === null ? Number.NaN : Date.parse(millisecondValue)
  if (
    typeof value !== 'string' ||
    !match ||
    millisecondValue === null ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== millisecondValue
  ) {
    return fail('host-automation-queue-runner-input-invalid')
  }
  return value
}

function millisecondTimestamp(value: string): string {
  const match = NANOSECOND_TIMESTAMP.exec(value)
  if (!match) return fail('host-automation-queue-runner-input-invalid')
  return `${match[1]}${match[2].slice(0, 3)}Z`
}

function addHours(value: string, hours: number): string {
  const milliseconds = Date.parse(value) + hours * 60 * 60 * 1_000
  if (!Number.isSafeInteger(hours) || hours < 1 || !Number.isFinite(milliseconds)) {
    return fail('host-automation-queue-runner-policy-invalid')
  }
  try {
    return new Date(milliseconds).toISOString()
  } catch {
    return fail('host-automation-queue-runner-policy-invalid')
  }
}

function addMilliseconds(value: string, delay: number): string {
  const match = NANOSECOND_TIMESTAMP.exec(value)
  if (!match || !Number.isSafeInteger(delay) || delay < 0) {
    return fail('host-automation-queue-runner-policy-invalid')
  }
  const milliseconds = Date.parse(`${match[1]}${match[2].slice(0, 3)}Z`) + delay
  if (!Number.isFinite(milliseconds)) return fail('host-automation-queue-runner-policy-invalid')
  const prefix = new Date(milliseconds).toISOString().slice(0, -1)
  return `${prefix}${match[2].slice(3)}Z`
}

async function now(context: RunnerContext): Promise<string> {
  const current = canonicalNanosecondTimestamp(await call(context.adapters.now, []))
  if (context.lastHostTimestamp !== null && current <= context.lastHostTimestamp) {
    return fail('host-automation-queue-runner-input-invalid')
  }
  context.lastHostTimestamp = current
  return current
}

async function after(context: RunnerContext, previous: string): Promise<string> {
  const current = await now(context)
  if (current <= previous) return fail('host-automation-queue-runner-input-invalid')
  return current
}

function push(trace: string[], step: string): void {
  if (trace.length >= MAX_TRACE_STEPS) return fail('host-automation-queue-runner-input-invalid')
  trace.push(step)
}

function result(
  status: HostAutomationQueueRunStatusForTestingV1,
  trace: readonly string[],
  fields: Readonly<{
    blocker?: HostAutomationQueueRunnerBlockerV1 | null
    messageId?: string | null
    messagesDequeued?: 0 | 1
    messagesDispatched?: 0 | 1
    sourceMutationKind?: BackendAutomationQueueMutationKind | null
    sourceQueueMutationCallbackReportedCommitted?: boolean
    deadLetterPublishCASCommitted?: boolean
    oneShotDispatchPermitConsumed?: boolean
    preDispatchOutcomeUnknownFencePersisted?: boolean
  }> = {}
): HostAutomationQueueRunResultForTestingV1 {
  return Object.freeze({
    format: HOST_AUTOMATION_QUEUE_RUN_RESULT_TESTING_FORMAT,
    version: VERSION,
    testingOnly: true,
    processLocalOnly: true,
    status,
    blocker: fields.blocker ?? null,
    messageId: fields.messageId ?? null,
    messagesDequeued: fields.messagesDequeued ?? 0,
    messagesDispatched: fields.messagesDispatched ?? 0,
    sourceMutationKind: fields.sourceMutationKind ?? null,
    sourceQueueMutationCallbackReportedCommitted:
      fields.sourceQueueMutationCallbackReportedCommitted ?? false,
    sourceQueueMutationReadbackVerified: false,
    sourceQueueMutationCallbackReportAuthenticated: false,
    deadLetterPublishCASCommitted: fields.deadLetterPublishCASCommitted ?? false,
    oneShotDispatchPermitConsumed: fields.oneShotDispatchPermitConsumed ?? false,
    preDispatchOutcomeUnknownFencePersisted:
      fields.preDispatchOutcomeUnknownFencePersisted ?? false,
    trace: Object.freeze([...trace]),
    remainingProductionBlockers: HOST_AUTOMATION_QUEUE_RUNNER_REMAINING_PRODUCTION_BLOCKERS,
    callbackSideEffectsAuthenticated: false,
    injectedReconciliationEvidenceAuthenticated: false,
    productionQueueAuthorityCreated: false,
    productionNetworkAuthorityCreated: false,
    credentialAuthorityCreated: false,
    databaseAuthorityCreated: false,
    releaseAuthorityCreated: false
  })
}

function parseDelivery(value: unknown): HostAutomationQueueDeliveryForTestingV1 | null {
  if (value === null) return null
  const source = exactDataRecord(
    value,
    DELIVERY_KEYS,
    'host-automation-queue-runner-delivery-invalid'
  )
  return Object.freeze({ message: ownValue(source, 'message'), lease: ownValue(source, 'lease') })
}

async function loadPolicy(
  context: AdapterContext,
  binding: BackendAutomationQueueLeaseBindingV1
): Promise<HostAutomationQueuePolicyForTestingV1> {
  const value = await call(context.loadPolicy, [binding])
  const source = exactDataRecord(value, POLICY_KEYS, 'host-automation-queue-runner-policy-invalid')
  const retention = ownValue(source, 'idempotencyRetentionHours')
  if (!Number.isSafeInteger(retention) || (retention as number) < 1) {
    return fail('host-automation-queue-runner-policy-invalid')
  }
  const retryPolicy = ownValue(source, 'retryPolicy')
  const validated = planBackendAutomationExecutionDisposition({
    format: BACKEND_AUTOMATION_EXECUTION_INPUT_FORMAT,
    version: VERSION,
    automationId: binding.message.automationId,
    operationId: binding.message.operationId,
    attemptId: binding.lease.attemptId,
    eventId: binding.message.eventId,
    idempotencyDigest: binding.message.idempotencyKeyDigest,
    causation: {
      id: binding.message.causationId,
      hop: binding.message.causationHop,
      maxHop: binding.message.causationMaxHop
    },
    attemptNumber: binding.lease.deliveryAttempt,
    retryPolicy,
    observedOutcome: {
      kind: 'succeeded',
      stableCode: null,
      evidenceDigest: binding.lease.leaseEvidenceDigest
    },
    jitterUint32: null
  })
  if (validated.input.retryPolicy.jitter !== 'none') {
    return fail('host-automation-queue-runner-policy-invalid')
  }
  return Object.freeze({
    idempotencyRetentionHours: retention as number,
    retryPolicy: validated.input.retryPolicy
  })
}

function assertIdempotencyBinding(
  record: BackendAutomationIdempotencyRecordV1,
  binding: BackendAutomationQueueLeaseBindingV1,
  retentionHours: number
): void {
  const { message } = binding
  if (
    record.automationId !== message.automationId ||
    record.eventId !== message.eventId ||
    record.operationId !== message.operationId ||
    record.idempotencyKeyDigest !== message.idempotencyKeyDigest ||
    record.causationId !== message.causationId ||
    record.causationHop !== message.causationHop ||
    record.retentionHours !== retentionHours
  ) {
    return fail('host-automation-queue-runner-cas-failed')
  }
}

function commit(value: unknown): HostAutomationQueueCASCommitForTestingV1 {
  const source = exactDataRecord(value, COMMIT_KEYS, 'host-automation-queue-runner-cas-failed')
  const committed = ownValue(source, 'committed')
  const evidence = ownValue(source, 'verificationEvidenceDigest')
  if (typeof committed !== 'boolean') return fail('host-automation-queue-runner-cas-failed')
  if (committed) {
    return Object.freeze({
      committed: true,
      verificationEvidenceDigest: digest(evidence, 'host-automation-queue-runner-cas-failed')
    })
  }
  if (evidence !== null) return fail('host-automation-queue-runner-cas-failed')
  return Object.freeze({ committed: false, verificationEvidenceDigest: null })
}

async function commitIdempotency(
  context: AdapterContext,
  binding: BackendAutomationQueueLeaseBindingV1,
  candidate: BackendAutomationIdempotencyCASCandidateV1
): Promise<string> {
  const committed = commit(await call(context.compareAndSwapIdempotency, [candidate]))
  if (!committed.committed || committed.verificationEvidenceDigest === null) {
    return fail('host-automation-queue-runner-cas-failed')
  }
  const reread = parseBackendAutomationIdempotencyRecord(
    await call(context.readIdempotencyHead, [binding])
  )
  if ((await digestBackendAutomationIdempotencyRecord(reread)) !== candidate.recordDigest) {
    return fail('host-automation-queue-runner-cas-failed')
  }
  return committed.verificationEvidenceDigest
}

async function commitWorker(
  context: AdapterContext,
  binding: BackendAutomationQueueLeaseBindingV1,
  candidate: BackendAutomationWorkerCASCandidateV1
): Promise<string> {
  const committed = commit(await call(context.compareAndSwapWorker, [candidate]))
  if (!committed.committed || committed.verificationEvidenceDigest === null) {
    return fail('host-automation-queue-runner-cas-failed')
  }
  const reread = parseBackendAutomationWorkerRecord(await call(context.readWorkerHead, [binding]))
  if ((await digestBackendAutomationWorkerRecord(reread)) !== candidate.recordDigest) {
    return fail('host-automation-queue-runner-cas-failed')
  }
  return committed.verificationEvidenceDigest
}

function initialIdempotency(
  binding: BackendAutomationQueueLeaseBindingV1,
  policy: HostAutomationQueuePolicyForTestingV1
): BackendAutomationIdempotencyRecordV1 {
  const createdAt = millisecondTimestamp(binding.message.enqueuedAt)
  return parseBackendAutomationIdempotencyRecord({
    format: BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
    version: VERSION,
    automationId: binding.message.automationId,
    eventId: binding.message.eventId,
    operationId: binding.message.operationId,
    idempotencyKeyDigest: binding.message.idempotencyKeyDigest,
    causationId: binding.message.causationId,
    causationHop: binding.message.causationHop,
    retentionHours: policy.idempotencyRetentionHours,
    createdAt,
    expiresAt: addHours(createdAt, policy.idempotencyRetentionHours),
    recordedAt: createdAt,
    revision: 0,
    previousRecordDigest: null,
    attemptIds: [binding.lease.attemptId],
    currentAttemptId: binding.lease.attemptId,
    state: 'reserved',
    completionEvidenceDigest: null,
    knownNotDispatchedEvidenceDigest: null,
    reconciliationEvidenceDigest: null,
    hostEvidenceAuthenticated: false,
    persistenceAuthorityGranted: false,
    dispatchAuthorityGranted: false
  })
}

async function reserveFreshAttempt(
  context: RunnerContext,
  binding: BackendAutomationQueueLeaseBindingV1,
  policy: HostAutomationQueuePolicyForTestingV1,
  trace: string[]
): Promise<BackendAutomationIdempotencyRecordV1 | HostAutomationQueueRunResultForTestingV1> {
  const raw = await call(context.adapters.readIdempotencyHead, [binding])
  if (raw === null) {
    const candidate = await createBackendAutomationIdempotencyCASProposal(
      null,
      initialIdempotency(binding, policy)
    )
    await commitIdempotency(context.adapters, binding, candidate)
    push(trace, 'idempotency-reserved-cas')
    return candidate.record
  }
  const current = parseBackendAutomationIdempotencyRecord(raw)
  assertIdempotencyBinding(current, binding, policy.idempotencyRetentionHours)
  if (current.state === 'succeeded') {
    return result('blocked', trace, {
      blocker: 'already-succeeded-duplicate-ack-unavailable',
      messageId: binding.message.messageId,
      messagesDequeued: 1
    })
  }
  if (current.state === 'dispatch-started' || current.state === 'outcome-unknown') {
    return result('blocked', trace, {
      blocker: 'outcome-reconciliation-required',
      messageId: binding.message.messageId,
      messagesDequeued: 1,
      preDispatchOutcomeUnknownFencePersisted: true
    })
  }
  if (current.state === 'reserved') {
    if (current.currentAttemptId !== binding.lease.attemptId) {
      return result('blocked', trace, {
        blocker: 'fresh-attempt-unavailable',
        messageId: binding.message.messageId,
        messagesDequeued: 1
      })
    }
    return current
  }
  if (current.attemptIds.includes(binding.lease.attemptId)) {
    return result('blocked', trace, {
      blocker: 'fresh-attempt-unavailable',
      messageId: binding.message.messageId,
      messagesDequeued: 1
    })
  }
  const recordedAt = millisecondTimestamp(await now(context))
  const next = parseBackendAutomationIdempotencyRecord({
    ...current,
    revision: current.revision + 1,
    previousRecordDigest: await digestBackendAutomationIdempotencyRecord(current),
    recordedAt,
    attemptIds: [...current.attemptIds, binding.lease.attemptId],
    currentAttemptId: binding.lease.attemptId,
    state: 'reserved',
    completionEvidenceDigest: null,
    knownNotDispatchedEvidenceDigest: null,
    reconciliationEvidenceDigest: null
  })
  const candidate = await createBackendAutomationIdempotencyCASProposal(current, next)
  await commitIdempotency(context.adapters, binding, candidate)
  push(trace, 'idempotency-reserved-cas')
  return candidate.record
}

async function receivedWorker(
  binding: BackendAutomationQueueLeaseBindingV1
): Promise<BackendAutomationWorkerRecordV1> {
  return parseBackendAutomationWorkerRecord({
    format: BACKEND_AUTOMATION_WORKER_RECORD_FORMAT,
    version: VERSION,
    messageEnvelopeDigest: binding.messageEnvelopeDigest,
    leaseObservationDigest: binding.leaseObservationDigest,
    queueId: binding.message.queueId,
    messageId: binding.message.messageId,
    leaseId: binding.lease.leaseId,
    deliveryId: binding.lease.deliveryId,
    deliveryAttempt: binding.lease.deliveryAttempt,
    automationId: binding.message.automationId,
    eventId: binding.message.eventId,
    operationId: binding.message.operationId,
    idempotencyKeyDigest: binding.message.idempotencyKeyDigest,
    causationId: binding.message.causationId,
    causationHop: binding.message.causationHop,
    causationMaxHop: binding.message.causationMaxHop,
    attemptId: binding.lease.attemptId,
    state: 'received',
    revision: 0,
    previousRecordDigest: null,
    recordedAt: binding.lease.observedAt,
    transitionEvidenceDigest: binding.lease.leaseEvidenceDigest,
    idempotencyCASDigest: null,
    idempotencyRecordDigest: null,
    idempotencyState: null,
    reconciliationEvidenceDigest: null,
    hostEvidenceAuthenticated: false,
    persistenceAuthorityGranted: false,
    dispatchAuthorityGranted: false,
    ackAuthorityGranted: false,
    releaseAuthorityGranted: false
  })
}

async function nextWorker(
  previous: BackendAutomationWorkerRecordV1,
  recordedAt: string,
  transitionEvidenceDigest: string,
  idempotency: BackendAutomationIdempotencyCASCandidateV1,
  state: 'pre-dispatch-outcome-unknown' | 'succeeded' | 'known-not-dispatched' | 'outcome-unknown',
  reconciliationEvidenceDigest: string | null
): Promise<BackendAutomationWorkerRecordV1> {
  return parseBackendAutomationWorkerRecord({
    ...previous,
    revision: previous.revision + 1,
    previousRecordDigest: await digestBackendAutomationWorkerRecord(previous),
    recordedAt,
    transitionEvidenceDigest,
    idempotencyCASDigest: await digestBackendAutomationIdempotencyCASProposal(idempotency.proposal),
    idempotencyRecordDigest: idempotency.recordDigest,
    idempotencyState: idempotency.record.state,
    state,
    reconciliationEvidenceDigest
  })
}

async function dispatchStartedRecord(
  current: BackendAutomationIdempotencyRecordV1,
  recordedAt: string
): Promise<BackendAutomationIdempotencyRecordV1> {
  return parseBackendAutomationIdempotencyRecord({
    ...current,
    revision: current.revision + 1,
    previousRecordDigest: await digestBackendAutomationIdempotencyRecord(current),
    recordedAt: millisecondTimestamp(recordedAt),
    state: 'dispatch-started',
    completionEvidenceDigest: null,
    knownNotDispatchedEvidenceDigest: null,
    reconciliationEvidenceDigest: null
  })
}

async function prepareDispatchFence(
  context: RunnerContext,
  binding: BackendAutomationQueueLeaseBindingV1,
  reserved: BackendAutomationIdempotencyRecordV1,
  trace: string[]
): Promise<
  Readonly<{
    idempotency: BackendAutomationIdempotencyCASCandidateV1
    worker: BackendAutomationWorkerCASCandidateV1
  }>
> {
  const currentWorker = await call(context.adapters.readWorkerHead, [binding])
  if (currentWorker !== null) return fail('host-automation-queue-runner-cas-failed')
  const received = await receivedWorker(binding)
  const receivedCandidate = await createBackendAutomationWorkerCASProposal(
    binding.message,
    binding.lease,
    null,
    received
  )
  await commitWorker(context.adapters, binding, receivedCandidate)
  push(trace, 'worker-received-cas')

  const predispatchAt = await after(context, received.recordedAt)
  const started = await dispatchStartedRecord(reserved, predispatchAt)
  const idempotency = await createBackendAutomationIdempotencyCASProposal(reserved, started)
  await commitIdempotency(context.adapters, binding, idempotency)
  push(trace, 'idempotency-dispatch-started-cas')

  const fenceEvidenceDigest = await digestCanonicalManifest({
    format: 'openpencil.host-automation-queue-predispatch-fence.testing.v1',
    messageEnvelopeDigest: binding.messageEnvelopeDigest,
    leaseObservationDigest: binding.leaseObservationDigest,
    idempotencyCASDigest: await digestBackendAutomationIdempotencyCASProposal(idempotency.proposal),
    idempotencyRecordDigest: idempotency.recordDigest,
    recordedAt: predispatchAt
  })
  const fencedWorker = await nextWorker(
    receivedCandidate.record,
    predispatchAt,
    fenceEvidenceDigest,
    idempotency,
    'pre-dispatch-outcome-unknown',
    null
  )
  const worker = await createBackendAutomationWorkerCASProposal(
    binding.message,
    binding.lease,
    receivedCandidate.record,
    fencedWorker
  )
  await commitWorker(context.adapters, binding, worker)
  push(trace, 'worker-predispatch-outcome-unknown-cas')
  return Object.freeze({ idempotency, worker })
}

function dispatchOutcome(value: unknown): HostAutomationQueueDispatchOutcomeForTestingV1 {
  const source = snapshotDataRecord(value, 'host-automation-queue-runner-dispatch-result-invalid')
  const kindValue = ownValue(source, 'kind', 'host-automation-queue-runner-dispatch-result-invalid')
  if (kindValue === 'succeeded') {
    exactDataRecordShape(
      source,
      DISPATCH_SUCCEEDED_KEYS,
      'host-automation-queue-runner-dispatch-result-invalid'
    )
    return Object.freeze({
      kind: 'succeeded',
      evidenceDigest: digest(
        ownValue(source, 'evidenceDigest'),
        'host-automation-queue-runner-dispatch-result-invalid'
      )
    })
  }
  if (kindValue === 'outcome-unknown') {
    exactDataRecordShape(
      source,
      DISPATCH_OUTCOME_UNKNOWN_KEYS,
      'host-automation-queue-runner-dispatch-result-invalid'
    )
    const stableCode = ownValue(source, 'stableCode')
    if (typeof stableCode !== 'string') {
      return fail('host-automation-queue-runner-dispatch-result-invalid')
    }
    return Object.freeze({
      kind: 'outcome-unknown',
      stableCode,
      evidenceDigest: digest(
        ownValue(source, 'evidenceDigest'),
        'host-automation-queue-runner-dispatch-result-invalid'
      )
    })
  }
  if (kindValue !== 'retryable-failure' && kindValue !== 'permanent-failure') {
    return fail('host-automation-queue-runner-dispatch-result-invalid')
  }
  exactDataRecordShape(
    source,
    DISPATCH_FAILURE_KEYS,
    'host-automation-queue-runner-dispatch-result-invalid'
  )
  const stableCode = ownValue(source, 'stableCode')
  if (typeof stableCode !== 'string') {
    return fail('host-automation-queue-runner-dispatch-result-invalid')
  }
  const evidenceDigest = digest(
    ownValue(source, 'evidenceDigest'),
    'host-automation-queue-runner-dispatch-result-invalid'
  )
  const injectedTestingReconciliationEvidenceDigest = digest(
    ownValue(source, 'injectedTestingReconciliationEvidenceDigest'),
    'host-automation-queue-runner-dispatch-result-invalid'
  )
  if (evidenceDigest === injectedTestingReconciliationEvidenceDigest) {
    return fail('host-automation-queue-runner-dispatch-result-invalid')
  }
  return Object.freeze({
    kind: kindValue,
    stableCode,
    evidenceDigest,
    injectedTestingReconciliationEvidenceDigest
  })
}

async function unknownDispatchOutcome(
  binding: BackendAutomationQueueLeaseBindingV1,
  fence: BackendAutomationWorkerCASCandidateV1
): Promise<HostAutomationQueueDispatchOutcomeForTestingV1> {
  return Object.freeze({
    kind: 'outcome-unknown',
    stableCode: 'injected-dispatch-outcome-unknown',
    evidenceDigest: await digestCanonicalManifest({
      format: 'openpencil.host-automation-queue-dispatch-outcome-unknown.testing.v1',
      messageEnvelopeDigest: binding.messageEnvelopeDigest,
      leaseObservationDigest: binding.leaseObservationDigest,
      workerFenceRecordDigest: fence.recordDigest
    })
  })
}

async function invokeDispatch(
  context: AdapterContext,
  binding: BackendAutomationQueueLeaseBindingV1,
  fence: Readonly<{
    idempotency: BackendAutomationIdempotencyCASCandidateV1
    worker: BackendAutomationWorkerCASCandidateV1
  }>,
  trace: string[]
): Promise<HostAutomationQueueDispatchOutcomeForTestingV1> {
  const permit = Object.freeze({})
  dispatchPermits.add(permit)
  push(trace, 'dispatch-permit-issued')
  if (!dispatchPermits.delete(permit)) return fail('host-automation-queue-runner-cas-failed')
  push(trace, 'dispatch-permit-consumed')
  const invocation: HostAutomationQueueDispatchInvocationForTestingV1 = Object.freeze({
    format: 'openpencil.host-automation-queue-dispatch-invocation.testing.v1',
    version: VERSION,
    testingOnly: true,
    processLocalOnly: true,
    messageEnvelopeDigest: binding.messageEnvelopeDigest,
    leaseObservationDigest: binding.leaseObservationDigest,
    workerFenceRecordDigest: fence.worker.recordDigest,
    idempotencyDispatchStartedRecordDigest: fence.idempotency.recordDigest,
    payloadIncluded: false,
    oneShotPermitConsumed: true,
    callbackSideEffectsAuthenticated: false,
    injectedReconciliationEvidenceAuthenticated: false,
    productionNetworkAuthorityCreated: false,
    credentialAuthorityCreated: false,
    databaseAuthorityCreated: false,
    releaseAuthorityCreated: false
  })
  push(trace, 'dispatch-entered')
  try {
    const outcome = dispatchOutcome(await call(context.dispatch, [invocation]))
    if (outcome.kind === 'retryable-failure' || outcome.kind === 'permanent-failure') {
      push(trace, 'injected-testing-reconciliation-evidence-untrusted')
    }
    return outcome
  } catch {
    return unknownDispatchOutcome(binding, fence.worker)
  }
}

async function persistTerminal(
  context: RunnerContext,
  binding: BackendAutomationQueueLeaseBindingV1,
  fence: Readonly<{
    idempotency: BackendAutomationIdempotencyCASCandidateV1
    worker: BackendAutomationWorkerCASCandidateV1
  }>,
  outcome: HostAutomationQueueDispatchOutcomeForTestingV1,
  trace: string[]
): Promise<TerminalPersistence> {
  const recordedAt = await after(context, fence.worker.record.recordedAt)
  let state: 'succeeded' | 'known-not-dispatched' | 'outcome-unknown' = 'known-not-dispatched'
  if (outcome.kind === 'succeeded') state = 'succeeded'
  if (outcome.kind === 'outcome-unknown') state = 'outcome-unknown'
  const idempotencyRecord = parseBackendAutomationIdempotencyRecord({
    ...fence.idempotency.record,
    revision: fence.idempotency.record.revision + 1,
    previousRecordDigest: await digestBackendAutomationIdempotencyRecord(fence.idempotency.record),
    recordedAt: millisecondTimestamp(recordedAt),
    state,
    completionEvidenceDigest: outcome.kind === 'succeeded' ? outcome.evidenceDigest : null,
    knownNotDispatchedEvidenceDigest:
      outcome.kind === 'retryable-failure' || outcome.kind === 'permanent-failure'
        ? outcome.evidenceDigest
        : null,
    reconciliationEvidenceDigest:
      outcome.kind === 'retryable-failure' || outcome.kind === 'permanent-failure'
        ? outcome.injectedTestingReconciliationEvidenceDigest
        : null
  })
  const idempotency = await createBackendAutomationIdempotencyCASProposal(
    fence.idempotency.record,
    idempotencyRecord
  )
  const terminalCASVerificationEvidenceDigest = await commitIdempotency(
    context.adapters,
    binding,
    idempotency
  )
  push(trace, 'idempotency-settlement-cas')
  const workerRecord = await nextWorker(
    fence.worker.record,
    recordedAt,
    outcome.evidenceDigest,
    idempotency,
    state,
    outcome.kind === 'retryable-failure' || outcome.kind === 'permanent-failure'
      ? outcome.injectedTestingReconciliationEvidenceDigest
      : null
  )
  const worker = await createBackendAutomationWorkerCASProposal(
    binding.message,
    binding.lease,
    fence.worker.record,
    workerRecord
  )
  await commitWorker(context.adapters, binding, worker)
  push(trace, 'worker-settlement-cas')
  return Object.freeze({ idempotency, worker, terminalCASVerificationEvidenceDigest })
}

function executionDisposition(
  binding: BackendAutomationQueueLeaseBindingV1,
  policy: HostAutomationQueuePolicyForTestingV1,
  outcome: Exclude<HostAutomationQueueDispatchOutcomeForTestingV1, { kind: 'succeeded' }>,
  worker: BackendAutomationWorkerRecordV1
): BackendAutomationExecutionDispositionV1 {
  return planBackendAutomationExecutionDisposition({
    format: BACKEND_AUTOMATION_EXECUTION_INPUT_FORMAT,
    version: VERSION,
    automationId: binding.message.automationId,
    operationId: binding.message.operationId,
    attemptId: binding.lease.attemptId,
    eventId: binding.message.eventId,
    idempotencyDigest: binding.message.idempotencyKeyDigest,
    causation: {
      id: binding.message.causationId,
      hop: binding.message.causationHop,
      maxHop: binding.message.causationMaxHop
    },
    attemptNumber: binding.lease.deliveryAttempt,
    retryPolicy: policy.retryPolicy,
    observedOutcome: {
      kind: outcome.kind,
      stableCode: outcome.stableCode,
      evidenceDigest: worker.transitionEvidenceDigest
    },
    jitterUint32: null
  })
}

function sourceMutationRequest(
  kind: 'ack' | 'retry' | 'archive',
  proposedAt: string,
  terminal: TerminalPersistence,
  disposition: BackendAutomationExecutionDispositionV1 | null,
  nextVisibilityDeadline: string | null,
  deadLetter: Readonly<{
    messageEnvelopeDigest: string
    publishedRecordDigest: string
    casDigest: string
    verificationEvidenceDigest: string
  }> | null
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    kind,
    proposedAt,
    nextVisibilityDeadline,
    terminalCASVerificationEvidenceDigest: terminal.terminalCASVerificationEvidenceDigest,
    executionDisposition: disposition,
    deadLetterState: deadLetter === null ? null : 'published',
    deadLetterMessageEnvelopeDigest: deadLetter?.messageEnvelopeDigest ?? null,
    deadLetterPublishedRecordDigest: deadLetter?.publishedRecordDigest ?? null,
    deadLetterCASDigest: deadLetter?.casDigest ?? null,
    deadLetterPublishVerificationEvidenceDigest: deadLetter?.verificationEvidenceDigest ?? null
  })
}

async function applySourceMutation(
  context: AdapterContext,
  binding: BackendAutomationQueueLeaseBindingV1,
  terminal: TerminalPersistence,
  request: Readonly<Record<string, unknown>>,
  trace: string[]
): Promise<BackendAutomationQueueMutationProposalV1> {
  const proposal = await planBackendAutomationQueueMutation(
    binding.message,
    binding.lease,
    terminal.worker.record,
    request
  )
  const committed = commit(await call(context.applySourceQueueMutation, [proposal]))
  if (!committed.committed) return fail('host-automation-queue-runner-cas-failed')
  push(trace, `source-${proposal.kind}-callback-reported-committed`)
  return proposal
}

function assertDeadLetterMessageBinding(
  source: BackendAutomationQueueMessageEnvelopeV1,
  target: BackendAutomationQueueMessageEnvelopeV1,
  expectedQueueId: string
): void {
  const stableKeys = [
    'automationId',
    'eventId',
    'operationId',
    'idempotencyKeyDigest',
    'causationId',
    'causationHop',
    'causationMaxHop',
    'payloadDigest',
    'payloadByteLength',
    'maxPayloadBytes'
  ] as const
  if (
    target.queueId !== expectedQueueId ||
    target.queueId === source.queueId ||
    stableKeys.some((key) => target[key] !== source[key])
  ) {
    return fail('host-automation-queue-runner-dead-letter-invalid')
  }
}

function nextOutbox(
  current: BackendAutomationOutboxRecordV1,
  fields: Readonly<{
    state: 'pre-publish-outcome-unknown' | 'published' | 'outcome-unknown'
    recordedAt: string
    transitionEvidenceDigest: string
    publishConfirmationEvidenceDigest: string | null
  }>
): Promise<BackendAutomationOutboxRecordV1> {
  return digestBackendAutomationOutboxRecord(current).then((previousRecordDigest) =>
    parseBackendAutomationOutboxRecord({
      ...current,
      revision: current.revision + 1,
      previousRecordDigest,
      recordedAt: fields.recordedAt,
      transitionEvidenceDigest: fields.transitionEvidenceDigest,
      state: fields.state,
      publishConfirmationEvidenceDigest: fields.publishConfirmationEvidenceDigest,
      knownNotPublishedEvidenceDigest: null,
      deliveryEvidenceDigest: null,
      reconciliationEvidenceDigest: null
    })
  )
}

async function parseDeadLetterHead(
  value: unknown,
  source: BackendAutomationQueueLeaseBindingV1,
  disposition: BackendAutomationExecutionDispositionV1,
  requireInitialPending: boolean
): Promise<
  Readonly<{
    message: BackendAutomationQueueMessageEnvelopeV1
    outbox: BackendAutomationOutboxRecordV1
  }>
> {
  const record = exactDataRecord(
    value,
    DEAD_LETTER_HEAD_KEYS,
    'host-automation-queue-runner-dead-letter-invalid'
  )
  const message = parseBackendAutomationQueueMessageEnvelope(ownValue(record, 'message'))
  const outbox = parseBackendAutomationOutboxRecord(ownValue(record, 'outbox'))
  const queueId = disposition.decision.deadLetterQueueId
  if (queueId === null) return fail('host-automation-queue-runner-dead-letter-invalid')
  assertDeadLetterMessageBinding(source.message, message, queueId)
  if (requireInitialPending) {
    const initial = await createBackendAutomationOutboxCASProposal(message, null, outbox)
    if (initial.recordDigest !== (await digestBackendAutomationOutboxRecord(outbox))) {
      return fail('host-automation-queue-runner-dead-letter-invalid')
    }
  }
  return Object.freeze({ message, outbox })
}

async function readDeadLetterHead(
  context: AdapterContext,
  source: BackendAutomationQueueLeaseBindingV1,
  disposition: BackendAutomationExecutionDispositionV1,
  requireInitialPending: boolean
): Promise<
  Readonly<{
    message: BackendAutomationQueueMessageEnvelopeV1
    outbox: BackendAutomationOutboxRecordV1
  }>
> {
  return parseDeadLetterHead(
    await call(context.readDeadLetterOutboxHead, [source, disposition]),
    source,
    disposition,
    requireInitialPending
  )
}

async function commitDeadLetterOutbox(
  context: AdapterContext,
  source: BackendAutomationQueueLeaseBindingV1,
  disposition: BackendAutomationExecutionDispositionV1,
  targetMessageDigest: string,
  candidate: BackendAutomationOutboxCASCandidateV1
): Promise<string> {
  const committed = commit(await call(context.compareAndSwapDeadLetterOutbox, [candidate]))
  if (!committed.committed || committed.verificationEvidenceDigest === null) {
    return fail('host-automation-queue-runner-cas-failed')
  }
  const reread = await readDeadLetterHead(context, source, disposition, false)
  if (
    (await digestBackendAutomationQueueMessageEnvelope(reread.message)) !== targetMessageDigest ||
    (await digestBackendAutomationOutboxRecord(reread.outbox)) !== candidate.recordDigest
  ) {
    return fail('host-automation-queue-runner-cas-failed')
  }
  return committed.verificationEvidenceDigest
}

async function publishDeadLetter(
  context: RunnerContext,
  source: BackendAutomationQueueLeaseBindingV1,
  disposition: BackendAutomationExecutionDispositionV1,
  trace: string[]
): Promise<Readonly<{
  messageEnvelopeDigest: string
  publishedRecordDigest: string
  casDigest: string
  verificationEvidenceDigest: string
}> | null> {
  const target = await readDeadLetterHead(context.adapters, source, disposition, true)
  const messageEnvelopeDigest = await digestBackendAutomationQueueMessageEnvelope(target.message)
  const prePublishAt = await after(context, target.outbox.recordedAt)
  const prePublishEvidenceDigest = await digestCanonicalManifest({
    format: 'openpencil.host-automation-dead-letter-prepublish.testing.v1',
    sourceMessageEnvelopeDigest: source.messageEnvelopeDigest,
    targetMessageEnvelopeDigest: messageEnvelopeDigest,
    previousOutboxRecordDigest: await digestBackendAutomationOutboxRecord(target.outbox),
    recordedAt: prePublishAt
  })
  const prePublishRecord = await nextOutbox(target.outbox, {
    state: 'pre-publish-outcome-unknown',
    recordedAt: prePublishAt,
    transitionEvidenceDigest: prePublishEvidenceDigest,
    publishConfirmationEvidenceDigest: null
  })
  const prePublish = await createBackendAutomationOutboxCASProposal(
    target.message,
    target.outbox,
    prePublishRecord
  )
  await commitDeadLetterOutbox(
    context.adapters,
    source,
    disposition,
    messageEnvelopeDigest,
    prePublish
  )
  push(trace, 'dead-letter-prepublish-cas')

  const permit = Object.freeze({})
  deadLetterPermits.add(permit)
  push(trace, 'dead-letter-publish-permit-issued')
  if (!deadLetterPermits.delete(permit)) return fail('host-automation-queue-runner-cas-failed')
  push(trace, 'dead-letter-publish-permit-consumed')
  const invocation: HostAutomationQueueDeadLetterPublishInvocationForTestingV1 = Object.freeze({
    format: 'openpencil.host-automation-dead-letter-publish-invocation.testing.v1',
    version: VERSION,
    testingOnly: true,
    processLocalOnly: true,
    sourceMessageEnvelopeDigest: source.messageEnvelopeDigest,
    targetMessageEnvelopeDigest: messageEnvelopeDigest,
    targetPrePublishRecordDigest: prePublish.recordDigest,
    payloadIncluded: false,
    oneShotPermitConsumed: true,
    callbackSideEffectsAuthenticated: false,
    injectedReconciliationEvidenceAuthenticated: false,
    productionNetworkAuthorityCreated: false,
    credentialAuthorityCreated: false,
    databaseAuthorityCreated: false,
    releaseAuthorityCreated: false
  })
  push(trace, 'dead-letter-publish-entered')
  let publishValue: unknown
  try {
    publishValue = await call(context.adapters.publishDeadLetter, [invocation])
  } catch {
    publishValue = {
      kind: 'outcome-unknown',
      evidenceDigest: await digestCanonicalManifest({
        format: 'openpencil.host-automation-dead-letter-outcome-unknown.testing.v1',
        targetPrePublishRecordDigest: prePublish.recordDigest
      })
    }
  }
  const publishRecord = exactDataRecord(
    publishValue,
    ['kind', 'evidenceDigest'],
    'host-automation-queue-runner-dead-letter-invalid'
  )
  const publishKind = ownValue(publishRecord, 'kind')
  if (publishKind !== 'published' && publishKind !== 'outcome-unknown') {
    return fail('host-automation-queue-runner-dead-letter-invalid')
  }
  const publishEvidenceDigest = digest(
    ownValue(publishRecord, 'evidenceDigest'),
    'host-automation-queue-runner-dead-letter-invalid'
  )
  const settlementAt = await after(context, prePublish.record.recordedAt)
  const transitionEvidenceDigest = await digestCanonicalManifest({
    format: 'openpencil.host-automation-dead-letter-publish-settlement.testing.v1',
    publishKind,
    publishEvidenceDigest,
    targetPrePublishRecordDigest: prePublish.recordDigest,
    recordedAt: settlementAt
  })
  const settledRecord = await nextOutbox(prePublish.record, {
    state: publishKind === 'published' ? 'published' : 'outcome-unknown',
    recordedAt: settlementAt,
    transitionEvidenceDigest,
    publishConfirmationEvidenceDigest: publishKind === 'published' ? publishEvidenceDigest : null
  })
  const settled = await createBackendAutomationOutboxCASProposal(
    target.message,
    prePublish.record,
    settledRecord
  )
  const verificationEvidenceDigest = await commitDeadLetterOutbox(
    context.adapters,
    source,
    disposition,
    messageEnvelopeDigest,
    settled
  )
  if (publishKind === 'outcome-unknown') {
    push(trace, 'dead-letter-outcome-unknown-cas')
    return null
  }
  push(trace, 'dead-letter-published-cas')
  return Object.freeze({
    messageEnvelopeDigest,
    publishedRecordDigest: settled.recordDigest,
    casDigest: await digestBackendAutomationOutboxCASProposal(settled.proposal),
    verificationEvidenceDigest
  })
}

async function runOne(context: RunnerContext): Promise<HostAutomationQueueRunResultForTestingV1> {
  const trace: string[] = []
  const delivery = parseDelivery(await call(context.adapters.receiveOne, []))
  if (delivery === null) return result('empty', trace)
  const binding = await verifyBackendAutomationQueueLeaseObservation(
    delivery.message,
    delivery.lease
  )
  if (binding.lease.extensionCount !== 0) {
    return result('blocked', trace, {
      blocker: 'visibility-extension-rebind-unavailable',
      messageId: binding.message.messageId,
      messagesDequeued: 1
    })
  }
  const leaseCheckedAt = await now(context)
  if (
    leaseCheckedAt < binding.lease.observedAt ||
    leaseCheckedAt >= binding.lease.visibilityDeadline ||
    (await call(context.adapters.isLeaseLive, [binding, leaseCheckedAt])) !== true
  ) {
    return fail('host-automation-queue-runner-lease-invalid')
  }
  const leaseConfirmedAt = await after(context, leaseCheckedAt)
  if (leaseConfirmedAt >= binding.lease.visibilityDeadline) {
    return fail('host-automation-queue-runner-lease-invalid')
  }
  push(trace, 'live-lease-confirmed')
  const policy = await loadPolicy(context.adapters, binding)
  const reserved = await reserveFreshAttempt(context, binding, policy, trace)
  if ('format' in reserved && reserved.format === HOST_AUTOMATION_QUEUE_RUN_RESULT_TESTING_FORMAT) {
    return reserved
  }
  const fence = await prepareDispatchFence(context, binding, reserved, trace)
  const preDispatchAt = await now(context)
  if (
    preDispatchAt >= binding.lease.visibilityDeadline ||
    (await call(context.adapters.isLeaseLive, [binding, preDispatchAt])) !== true
  ) {
    return result('blocked', trace, {
      blocker: 'durable-settlement-reconciliation-required',
      messageId: binding.message.messageId,
      messagesDequeued: 1,
      preDispatchOutcomeUnknownFencePersisted: true
    })
  }
  const permitCheckedAt = await after(context, preDispatchAt)
  if (
    permitCheckedAt >= binding.lease.visibilityDeadline ||
    (await call(context.adapters.isLeaseLive, [binding, permitCheckedAt])) !== true
  ) {
    return result('blocked', trace, {
      blocker: 'durable-settlement-reconciliation-required',
      messageId: binding.message.messageId,
      messagesDequeued: 1,
      preDispatchOutcomeUnknownFencePersisted: true
    })
  }
  // Keep this synchronous through callback entry. Production still requires the explicit atomic
  // lease/dispatch authority named in remainingProductionBlockers.
  push(trace, 'dispatch-lease-reconfirmed')
  const outcome = await invokeDispatch(context.adapters, binding, fence, trace)
  let terminal: TerminalPersistence
  try {
    terminal = await persistTerminal(context, binding, fence, outcome, trace)
  } catch {
    return result('blocked', trace, {
      blocker: 'durable-settlement-reconciliation-required',
      messageId: binding.message.messageId,
      messagesDequeued: 1,
      messagesDispatched: 1,
      oneShotDispatchPermitConsumed: true,
      preDispatchOutcomeUnknownFencePersisted: true
    })
  }
  if (outcome.kind === 'outcome-unknown') {
    return result('outcome-unknown', trace, {
      messageId: binding.message.messageId,
      messagesDequeued: 1,
      messagesDispatched: 1,
      oneShotDispatchPermitConsumed: true,
      preDispatchOutcomeUnknownFencePersisted: true
    })
  }
  const proposedAt = await after(context, terminal.worker.record.recordedAt)
  if (outcome.kind === 'succeeded') {
    try {
      const proposal = await applySourceMutation(
        context.adapters,
        binding,
        terminal,
        sourceMutationRequest('ack', proposedAt, terminal, null, null, null),
        trace
      )
      return result('succeeded', trace, {
        messageId: binding.message.messageId,
        messagesDequeued: 1,
        messagesDispatched: 1,
        sourceMutationKind: proposal.kind,
        sourceQueueMutationCallbackReportedCommitted: true,
        oneShotDispatchPermitConsumed: true,
        preDispatchOutcomeUnknownFencePersisted: true
      })
    } catch {
      return result('blocked', trace, {
        blocker: 'source-mutation-reconciliation-required',
        messageId: binding.message.messageId,
        messagesDequeued: 1,
        messagesDispatched: 1,
        oneShotDispatchPermitConsumed: true,
        preDispatchOutcomeUnknownFencePersisted: true
      })
    }
  }

  const disposition = executionDisposition(binding, policy, outcome, terminal.worker.record)
  if (disposition.decision.kind === 'retry') {
    const delay = disposition.decision.retryDelayMs
    if (delay === null) return fail('host-automation-queue-runner-policy-invalid')
    try {
      const proposal = await applySourceMutation(
        context.adapters,
        binding,
        terminal,
        sourceMutationRequest(
          'retry',
          proposedAt,
          terminal,
          disposition,
          addMilliseconds(proposedAt, delay),
          null
        ),
        trace
      )
      return result('retry-scheduled', trace, {
        messageId: binding.message.messageId,
        messagesDequeued: 1,
        messagesDispatched: 1,
        sourceMutationKind: proposal.kind,
        sourceQueueMutationCallbackReportedCommitted: true,
        oneShotDispatchPermitConsumed: true,
        preDispatchOutcomeUnknownFencePersisted: true
      })
    } catch {
      return result('blocked', trace, {
        blocker: 'source-mutation-reconciliation-required',
        messageId: binding.message.messageId,
        messagesDequeued: 1,
        messagesDispatched: 1,
        oneShotDispatchPermitConsumed: true,
        preDispatchOutcomeUnknownFencePersisted: true
      })
    }
  }

  if (disposition.decision.kind === 'dead-letter') {
    let deadLetter: Awaited<ReturnType<typeof publishDeadLetter>>
    try {
      deadLetter = await publishDeadLetter(context, binding, disposition, trace)
    } catch {
      deadLetter = null
    }
    if (deadLetter === null) {
      return result('blocked', trace, {
        blocker: 'dead-letter-publication-reconciliation-required',
        messageId: binding.message.messageId,
        messagesDequeued: 1,
        messagesDispatched: 1,
        oneShotDispatchPermitConsumed: true,
        preDispatchOutcomeUnknownFencePersisted: true
      })
    }
    try {
      const archiveAt = await after(context, proposedAt)
      const proposal = await applySourceMutation(
        context.adapters,
        binding,
        terminal,
        sourceMutationRequest('archive', archiveAt, terminal, disposition, null, deadLetter),
        trace
      )
      return result('dead-lettered', trace, {
        messageId: binding.message.messageId,
        messagesDequeued: 1,
        messagesDispatched: 1,
        sourceMutationKind: proposal.kind,
        sourceQueueMutationCallbackReportedCommitted: true,
        deadLetterPublishCASCommitted: true,
        oneShotDispatchPermitConsumed: true,
        preDispatchOutcomeUnknownFencePersisted: true
      })
    } catch {
      return result('blocked', trace, {
        blocker: 'source-mutation-reconciliation-required',
        messageId: binding.message.messageId,
        messagesDequeued: 1,
        messagesDispatched: 1,
        deadLetterPublishCASCommitted: true,
        oneShotDispatchPermitConsumed: true,
        preDispatchOutcomeUnknownFencePersisted: true
      })
    }
  }

  try {
    const proposal = await applySourceMutation(
      context.adapters,
      binding,
      terminal,
      sourceMutationRequest('archive', proposedAt, terminal, disposition, null, null),
      trace
    )
    return result('failed-archived', trace, {
      messageId: binding.message.messageId,
      messagesDequeued: 1,
      messagesDispatched: 1,
      sourceMutationKind: proposal.kind,
      sourceQueueMutationCallbackReportedCommitted: true,
      oneShotDispatchPermitConsumed: true,
      preDispatchOutcomeUnknownFencePersisted: true
    })
  } catch {
    return result('blocked', trace, {
      blocker: 'source-mutation-reconciliation-required',
      messageId: binding.message.messageId,
      messagesDequeued: 1,
      messagesDispatched: 1,
      oneShotDispatchPermitConsumed: true,
      preDispatchOutcomeUnknownFencePersisted: true
    })
  }
}

export function createHostAutomationQueueInjectedAdaptersForTestingV1(
  input: CreateHostAutomationQueueInjectedAdaptersForTestingOptionsV1
): HostAutomationQueueInjectedAdaptersForTestingV1 {
  const source = exactDataRecord(
    input,
    ADAPTER_OPTION_KEYS,
    'host-automation-queue-runner-input-invalid'
  )
  const adapterKind = ownValue(source, 'adapterKind')
  if (adapterKind !== 'fake' && adapterKind !== 'durable-test-double') {
    return fail('host-automation-queue-runner-input-invalid')
  }
  const handle = Object.freeze({
    format: HOST_AUTOMATION_QUEUE_INJECTED_ADAPTERS_TESTING_FORMAT,
    version: VERSION,
    testingOnly: true,
    processLocalOnly: true,
    adapterKind,
    defaultImplementationsCreated: false,
    callbackSideEffectsAuthenticated: false,
    injectedReconciliationEvidenceAuthenticated: false,
    productionQueueAuthorityCreated: false,
    productionNetworkAuthorityCreated: false,
    credentialAuthorityCreated: false,
    databaseAuthorityCreated: false,
    releaseAuthorityCreated: false
  }) satisfies HostAutomationQueueInjectedAdaptersForTestingV1
  const context: AdapterContext = Object.freeze({
    handle,
    adapterKind,
    now: callback(source, 'now'),
    receiveOne: callback(source, 'receiveOne'),
    isLeaseLive: callback(source, 'isLeaseLive'),
    loadPolicy: callback(source, 'loadPolicy'),
    readIdempotencyHead: callback(source, 'readIdempotencyHead'),
    compareAndSwapIdempotency: callback(source, 'compareAndSwapIdempotency'),
    readWorkerHead: callback(source, 'readWorkerHead'),
    compareAndSwapWorker: callback(source, 'compareAndSwapWorker'),
    dispatch: callback(source, 'dispatch'),
    applySourceQueueMutation: callback(source, 'applySourceQueueMutation'),
    readDeadLetterOutboxHead: callback(source, 'readDeadLetterOutboxHead'),
    compareAndSwapDeadLetterOutbox: callback(source, 'compareAndSwapDeadLetterOutbox'),
    publishDeadLetter: callback(source, 'publishDeadLetter')
  })
  trustedAdapters.set(handle, context)
  return handle
}

export function createHostAutomationQueueRunnerKernelForTestingV1(
  input: Readonly<{ adapters: HostAutomationQueueInjectedAdaptersForTestingV1 }>
): HostAutomationQueueRunnerKernelForTestingV1 {
  const source = exactDataRecord(input, ['adapters'], 'host-automation-queue-runner-input-invalid')
  const value = ownValue(source, 'adapters')
  const adapters = value !== null && typeof value === 'object' ? trustedAdapters.get(value) : null
  if (!adapters || adapters.handle !== value) {
    return fail('host-automation-queue-runner-adapters-untrusted')
  }
  const context: RunnerContext = { adapters, consumed: false, lastHostTimestamp: null }
  const runner: HostAutomationQueueRunnerKernelForTestingV1 = Object.freeze({
    format: HOST_AUTOMATION_QUEUE_RUNNER_TESTING_FORMAT,
    version: VERSION,
    testingOnly: true,
    processLocalOnly: true,
    lifetime: 'single-run',
    maximumMessagesPerRun: 1,
    defaultImplementationsCreated: false,
    productionConstructorAvailable: false,
    injectedReconciliationEvidenceAuthenticated: false,
    productionQueueAuthorityCreated: false,
    productionNetworkAuthorityCreated: false,
    credentialAuthorityCreated: false,
    databaseAuthorityCreated: false,
    releaseAuthorityCreated: false,
    async runOne(this: HostAutomationQueueRunnerKernelForTestingV1) {
      if (this !== runner || context.consumed) {
        return fail('host-automation-queue-runner-consumed')
      }
      context.consumed = true
      return runOne(context)
    }
  })
  trustedRunners.set(runner, context)
  return runner
}
