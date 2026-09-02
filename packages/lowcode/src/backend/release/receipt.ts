import type { BackendDiagnostic, BackendValidationResult } from '../types'
import { parseBackendReleaseProviderAuthority } from './authority'
import { evaluateProductionReleaseGates, parseBackendProductionGateResults } from './gates'
import { isAuthenticatedBackendReleaseState } from './state-authority'
import type {
  BackendProductionGateResultV1,
  BackendReleaseArtifactsV1,
  BackendReleaseEnvironment,
  BackendReleaseFailureV1,
  BackendReleaseReceiptMigrationOperationV1,
  BackendReleaseReceiptMigrationV1,
  BackendReleaseReceiptV1,
  BackendReleaseStateV1,
  CreateBackendReleaseReceiptInput
} from './types'
import { BACKEND_PRODUCTION_GATE_IDS, BACKEND_RELEASE_RECEIPT_VERSION } from './types'
import {
  RELEASE_MAX_LIST_ITEMS,
  exactRecord,
  nullableDigest,
  nullableTimestamp,
  parseReleaseMigrationFields,
  parseReleaseMigrationOperationFields,
  releaseCredentialRef,
  releaseDigest,
  releaseEnvironmentName,
  releaseIdentifier,
  releaseText,
  stringArray,
  stringValue
} from './validation'

const ENVIRONMENTS = new Set<BackendReleaseEnvironment>(['preview', 'staging', 'production'])
const OUTCOMES = new Set(['succeeded', 'blocked', 'failed', 'cancelled', 'outcome-unknown'])

type ReceiptOutcome = BackendReleaseReceiptV1['outcome']

function diagnostic(cause: unknown): BackendDiagnostic {
  return {
    code: 'backend-release-receipt-invalid',
    severity: 'error',
    path: '$',
    message: cause instanceof Error ? cause.message : 'Backend release receipt is invalid.'
  }
}

function artifacts(value: unknown): BackendReleaseArtifactsV1 {
  const source = exactRecord(value, '$.artifacts', [
    'staticArtifactDigest',
    'serverArtifactDigest',
    'schemaArtifactDigest'
  ])
  return {
    staticArtifactDigest: nullableDigest(
      source.staticArtifactDigest,
      '$.artifacts.staticArtifactDigest'
    ),
    serverArtifactDigest: nullableDigest(
      source.serverArtifactDigest,
      '$.artifacts.serverArtifactDigest'
    ),
    schemaArtifactDigest: nullableDigest(
      source.schemaArtifactDigest,
      '$.artifacts.schemaArtifactDigest'
    )
  }
}

function migrationOperation(
  value: unknown,
  index: number
): BackendReleaseReceiptMigrationOperationV1 {
  return parseReleaseMigrationOperationFields(value, index, [
    'operationId',
    'kind',
    'risk',
    'checksum'
  ]).value
}

function migration(value: unknown): BackendReleaseReceiptMigrationV1 {
  return parseReleaseMigrationFields(
    value,
    ['planId', 'planDigest', 'fromModelDigest', 'targetModelDigest', 'operations'],
    migrationOperation,
    RELEASE_MAX_LIST_ITEMS
  ).value
}

function failure(value: unknown): BackendReleaseFailureV1 | null {
  if (value === null) return null
  const source = exactRecord(value, '$.failure', ['code', 'outcomeUnknown'])
  if (typeof source.outcomeUnknown !== 'boolean') {
    throw new TypeError('$.failure.outcomeUnknown must be a boolean')
  }
  return {
    code: releaseIdentifier(stringValue(source.code, '$.failure.code'), '$.failure.code'),
    outcomeUnknown: source.outcomeUnknown
  }
}

function receiptGates(value: unknown, verifiedAt: string | null): BackendProductionGateResultV1[] {
  const parsed = parseBackendProductionGateResults(value)
  if (parsed.length !== BACKEND_PRODUCTION_GATE_IDS.length) {
    throw new TypeError('$.gates must contain every strict production gate exactly once')
  }
  if (new Set(parsed.map((entry) => entry.gate)).size !== BACKEND_PRODUCTION_GATE_IDS.length) {
    throw new TypeError('$.gates must not contain duplicate or missing gates')
  }
  const evaluated = evaluateProductionReleaseGates(parsed, verifiedAt)
  if (
    parsed.some(
      (entry) =>
        entry.status === 'passed' &&
        evaluated.gates.find((candidate) => candidate.gate === entry.gate)?.status !== 'passed'
    )
  ) {
    throw new TypeError('$.gates passed evidence must not be future-dated or unbound')
  }
  return evaluated.gates as BackendProductionGateResultV1[]
}

function receiptEnvironment(value: unknown): BackendReleaseEnvironment {
  if (typeof value !== 'string' || !ENVIRONMENTS.has(value as BackendReleaseEnvironment)) {
    throw new TypeError('$.environment is not supported')
  }
  return value as BackendReleaseEnvironment
}

function receiptOutcome(value: unknown): ReceiptOutcome {
  if (typeof value !== 'string' || !OUTCOMES.has(value)) {
    throw new TypeError('$.outcome is not supported')
  }
  return value as ReceiptOutcome
}

function validateFailureBinding(
  outcome: ReceiptOutcome,
  parsedFailure: BackendReleaseFailureV1 | null
): void {
  if (outcome === 'outcome-unknown' && parsedFailure?.outcomeUnknown !== true) {
    throw new TypeError('$.failure must bind an outcome-unknown result')
  }
  if (
    (outcome === 'failed' || outcome === 'cancelled') &&
    (!parsedFailure || parsedFailure.outcomeUnknown)
  ) {
    throw new TypeError('$.failure must bind the terminal failure without raw error details')
  }
  if ((outcome === 'succeeded' || outcome === 'blocked') && parsedFailure !== null) {
    throw new TypeError('$.failure must be null for verified outcomes')
  }
}

function receiptVerifiedAt(outcome: ReceiptOutcome, value: unknown): string | null {
  const verifiedAt = nullableTimestamp(value, '$.verifiedAt')
  if ((outcome === 'succeeded' || outcome === 'blocked') && !verifiedAt) {
    throw new TypeError('$.verifiedAt is required for verified outcomes')
  }
  return verifiedAt
}

function validateReceiptReleaseSemantics(
  environment: BackendReleaseEnvironment,
  outcome: ReceiptOutcome,
  gates: readonly BackendProductionGateResultV1[],
  verifiedAt: string | null,
  backendDeploymentRequired: boolean
): void {
  const gatesPassed = evaluateProductionReleaseGates(gates, verifiedAt).releaseReady
  if (!backendDeploymentRequired && (outcome !== 'succeeded' || !gatesPassed)) {
    throw new TypeError(
      '$.backendDeploymentRequired can be false only for a succeeded release with passed deployment gates'
    )
  }
  if (
    (outcome === 'blocked' || outcome === 'outcome-unknown') &&
    (gatesPassed || !backendDeploymentRequired)
  ) {
    throw new TypeError(`$.outcome ${outcome} must not present release-ready deployment evidence`)
  }
  if (
    environment === 'production' &&
    outcome === 'succeeded' &&
    (!gatesPassed || backendDeploymentRequired)
  ) {
    throw new TypeError(
      '$.outcome succeeded in production requires every release gate passed and no pending backend deployment'
    )
  }
}

function parsedReceipt(value: unknown): BackendReleaseReceiptV1 {
  const source = exactRecord(value, '$', [
    'format',
    'version',
    'receiptId',
    'releaseId',
    'planId',
    'planDigest',
    'documentDigest',
    'irDigest',
    'compilerVersion',
    'target',
    'environment',
    'backendProvider',
    'artifacts',
    'migration',
    'requiredEnvironmentNames',
    'requiredCredentialRefs',
    'remoteOperationIds',
    'verifiedAt',
    'gates',
    'outcome',
    'backendDeploymentRequired',
    'failure'
  ])
  if (source.format !== 'openpencil.backend-release-receipt') {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_RELEASE_RECEIPT_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  if (typeof source.backendDeploymentRequired !== 'boolean') {
    throw new TypeError('$.backendDeploymentRequired must be a boolean')
  }
  const environment = receiptEnvironment(source.environment)
  const outcome = receiptOutcome(source.outcome)
  const parsedFailure = failure(source.failure)
  validateFailureBinding(outcome, parsedFailure)
  const verifiedAt = receiptVerifiedAt(outcome, source.verifiedAt)
  const gates = receiptGates(source.gates, verifiedAt)
  validateReceiptReleaseSemantics(
    environment,
    outcome,
    gates,
    verifiedAt,
    source.backendDeploymentRequired
  )
  return {
    format: 'openpencil.backend-release-receipt',
    version: BACKEND_RELEASE_RECEIPT_VERSION,
    receiptId: releaseIdentifier(stringValue(source.receiptId, '$.receiptId'), '$.receiptId'),
    releaseId: releaseIdentifier(stringValue(source.releaseId, '$.releaseId'), '$.releaseId'),
    planId: releaseIdentifier(stringValue(source.planId, '$.planId'), '$.planId'),
    planDigest: releaseDigest(stringValue(source.planDigest, '$.planDigest'), '$.planDigest'),
    documentDigest: releaseDigest(
      stringValue(source.documentDigest, '$.documentDigest'),
      '$.documentDigest'
    ),
    irDigest: releaseDigest(stringValue(source.irDigest, '$.irDigest'), '$.irDigest'),
    compilerVersion: releaseText(
      stringValue(source.compilerVersion, '$.compilerVersion', 64),
      '$.compilerVersion',
      64
    ),
    target: releaseIdentifier(stringValue(source.target, '$.target'), '$.target'),
    environment,
    backendProvider: parseBackendReleaseProviderAuthority(source.backendProvider),
    artifacts: artifacts(source.artifacts),
    migration: migration(source.migration),
    requiredEnvironmentNames: stringArray(
      source.requiredEnvironmentNames,
      '$.requiredEnvironmentNames',
      releaseEnvironmentName
    ),
    requiredCredentialRefs: stringArray(
      source.requiredCredentialRefs,
      '$.requiredCredentialRefs',
      releaseCredentialRef
    ),
    remoteOperationIds: stringArray(source.remoteOperationIds, '$.remoteOperationIds'),
    verifiedAt,
    gates,
    outcome,
    backendDeploymentRequired: source.backendDeploymentRequired,
    failure: parsedFailure
  }
}

export function validateBackendReleaseReceipt(
  value: unknown
): BackendValidationResult<BackendReleaseReceiptV1> {
  try {
    return { ok: true, value: parsedReceipt(value), diagnostics: [] }
  } catch (cause) {
    return { ok: false, diagnostics: [diagnostic(cause)] }
  }
}

export function createBackendReleaseReceipt(
  state: BackendReleaseStateV1,
  input: CreateBackendReleaseReceiptInput
): BackendReleaseReceiptV1 {
  if (!isAuthenticatedBackendReleaseState(state)) {
    throw new TypeError('An authenticated live Backend Release state is required')
  }
  const plan = state.plan
  if (state.phase !== 'receipt' || state.outcome === 'pending' || !plan) {
    throw new TypeError('A terminal release plan is required before recording a receipt')
  }
  const terminalOutcome = state.outcome
  const receipt: BackendReleaseReceiptV1 = {
    format: 'openpencil.backend-release-receipt',
    version: BACKEND_RELEASE_RECEIPT_VERSION,
    receiptId: releaseIdentifier(input.receiptId, 'receiptId'),
    releaseId: releaseIdentifier(state.releaseId, 'releaseId'),
    planId: plan.planId,
    planDigest: plan.planDigest,
    documentDigest: plan.authority.documentDigest,
    irDigest: plan.authority.irDigest,
    compilerVersion: plan.authority.compilerVersion,
    target: plan.authority.target,
    environment: plan.authority.environment,
    backendProvider: plan.authority.backendProvider,
    artifacts: state.artifacts ?? {
      staticArtifactDigest: null,
      serverArtifactDigest: null,
      schemaArtifactDigest: null
    },
    migration: {
      planId: plan.migration.planId,
      planDigest: plan.migration.planDigest,
      fromModelDigest: plan.migration.fromModelDigest,
      targetModelDigest: plan.migration.targetModelDigest,
      operations: plan.migration.operations.map((operation) => ({
        operationId: operation.operationId,
        kind: operation.kind,
        risk: operation.risk,
        checksum: operation.checksum
      }))
    },
    requiredEnvironmentNames: plan.requiredEnvironmentNames,
    requiredCredentialRefs: plan.requiredCredentialRefs,
    remoteOperationIds: state.remoteOperationIds,
    verifiedAt: state.verifiedAt,
    gates: evaluateProductionReleaseGates(state.gates, state.verifiedAt).gates,
    outcome: terminalOutcome,
    backendDeploymentRequired: state.backendDeploymentRequired,
    failure:
      terminalOutcome === 'succeeded' || terminalOutcome === 'blocked'
        ? null
        : {
            code: releaseIdentifier(state.failureCode ?? terminalOutcome, 'failure.code'),
            outcomeUnknown: terminalOutcome === 'outcome-unknown'
          }
  }
  const validated = validateBackendReleaseReceipt(receipt)
  if (!validated.ok) throw new TypeError(validated.diagnostics[0]?.message ?? 'Receipt is invalid')
  return validated.value
}
