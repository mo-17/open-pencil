/* eslint-disable max-lines -- source migration history, replay, canonical Receipts, and transition invariants share one fail-closed boundary */
import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import { BACKEND_LIMITS } from './limits'
import {
  digestStagedMigrationExecutionPlan,
  digestStagedMigrationExecutionReceipt,
  validateStagedMigrationExecutionPlan,
  validateStagedMigrationExecutionReceipt,
  validateStagedMigrationExecutionTargetAuthority,
  type StagedMigrationExecutionPlanV1,
  type StagedMigrationExecutionReceiptV1,
  type StagedMigrationExecutionTargetAuthorityV1,
  type StagedMigrationEnvironment
} from './migration-execution'
import { assertBackendSecretFreeData } from './secret-boundary'
import type { BackendDiagnostic, BackendValidationResult } from './types'
import {
  array,
  assertBoundedBackendData,
  boundedText,
  id,
  oneOf,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext
} from './validation-helpers'

export const SOURCE_MIGRATION_LEDGER_FORMAT = 'openpencil.source-migration-ledger' as const
export const SOURCE_MIGRATION_LEDGER_VERSION = 1 as const
export const SOURCE_MIGRATION_DRIFT_RECEIPT_FORMAT =
  'openpencil.source-migration-drift-receipt' as const
export const SOURCE_MIGRATION_DRIFT_RECEIPT_VERSION = 1 as const
export const SOURCE_MIGRATION_RECOVERY_POINT_FORMAT =
  'openpencil.source-migration-recovery-point' as const
export const SOURCE_MIGRATION_RECOVERY_POINT_VERSION = 1 as const
export const SOURCE_MIGRATION_RECOVERY_RECEIPT_FORMAT =
  'openpencil.source-migration-recovery-receipt' as const
export const SOURCE_MIGRATION_RECOVERY_RECEIPT_VERSION = 1 as const
export const SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_FORMAT =
  'openpencil.source-migration-authority-rebind-receipt' as const
export const SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_VERSION = 1 as const

export type SourceMigrationEnvironment = StagedMigrationEnvironment
export type SourceMigrationDriftStatus = 'unknown' | 'none' | 'detected'
export type SourceMigrationApprovalScope = 'production' | 'destructive'

export interface SourceMigrationHumanApprovalV1 {
  approved: true
  approvedBy: string
  scopes: SourceMigrationApprovalScope[]
  evidenceDigest: string
  approvedAt: string
}

export interface SourceMigrationLedgerEntryV1 {
  migrationId: string
  sequence: number
  name: string
  source: {
    path: string
    digest: string
  }
  executionPlan: StagedMigrationExecutionPlanV1
  executionPlanDigest: string
  registeredAt: string
}

export interface SourceMigrationEnvironmentStateV1 {
  environment: SourceMigrationEnvironment
  targetAuthority: StagedMigrationExecutionTargetAuthorityV1 | null
  appliedMigrationIds: string[]
  schemaDigest: string | null
  lastReceiptDigest: string | null
  drift: SourceMigrationDriftStatus
}

export interface SourceMigrationPromotionRecordV1 {
  promotionId: string
  migrationId: string
  from: 'source' | 'dev' | 'staging'
  to: SourceMigrationEnvironment
  targetAuthority: StagedMigrationExecutionTargetAuthorityV1
  executionReceipt: StagedMigrationExecutionReceiptV1
  executionReceiptDigest: string
  schemaBeforeDigest: string
  schemaAfterDigest: string
  evidenceDigest: string
  approval: SourceMigrationHumanApprovalV1 | null
  promotedAt: string
}

/**
 * Canonical, secret-free provider inspection outcome for Host journaling. Failed or
 * outcome-unknown Receipts remain journal evidence and are never accepted by a drift record.
 */
export interface SourceMigrationDriftReceiptV1 {
  format: typeof SOURCE_MIGRATION_DRIFT_RECEIPT_FORMAT
  version: typeof SOURCE_MIGRATION_DRIFT_RECEIPT_VERSION
  receiptId: string
  driftId: string
  targetAuthority: StagedMigrationExecutionTargetAuthorityV1
  expectedSchemaDigest: string | null
  observedSchemaDigest: string
  status: 'none' | 'detected'
  outcome: 'succeeded' | 'failed' | 'outcome-unknown'
  checkedAt: string
  evidenceDigest: string | null
}

export interface SourceMigrationDriftRecordV1 {
  driftId: string
  environment: SourceMigrationEnvironment
  targetAuthority: StagedMigrationExecutionTargetAuthorityV1
  expectedSchemaDigest: string | null
  observedSchemaDigest: string
  status: 'none' | 'detected'
  providerReceipt: SourceMigrationDriftReceiptV1
  providerReceiptDigest: string
  evidenceDigest: string
  checkedAt: string
}

/**
 * Canonical provider backup/recovery-point evidence selected before a restore. It binds the exact
 * remote authority and source-ledger prefix that the provider claims the backup will recover.
 */
export interface SourceMigrationRecoveryPointV1 {
  format: typeof SOURCE_MIGRATION_RECOVERY_POINT_FORMAT
  version: typeof SOURCE_MIGRATION_RECOVERY_POINT_VERSION
  recoveryPointId: string
  targetAuthority: StagedMigrationExecutionTargetAuthorityV1
  appliedMigrationIds: string[]
  schemaDigest: string
  capturedAt: string
  evidenceDigest: string
}

/**
 * Canonical, secret-free provider outcome for Host journaling. Failed or outcome-unknown Receipts
 * remain journal evidence and are never accepted by `SourceMigrationRecoveryRecordV1`.
 */
export interface SourceMigrationRecoveryReceiptV1 {
  format: typeof SOURCE_MIGRATION_RECOVERY_RECEIPT_FORMAT
  version: typeof SOURCE_MIGRATION_RECOVERY_RECEIPT_VERSION
  receiptId: string
  recoveryId: string
  kind: 'rollback' | 'restore'
  targetAuthority: StagedMigrationExecutionTargetAuthorityV1
  removedMigrationIds: string[]
  resultingAppliedMigrationIds: string[]
  fromSchemaDigest: string
  toSchemaDigest: string
  recoveryPoint: SourceMigrationRecoveryPointV1 | null
  outcome: 'succeeded' | 'failed' | 'outcome-unknown'
  recordedAt: string
  evidenceDigest: string | null
}

export interface SourceMigrationRecoveryRecordV1 {
  recoveryId: string
  environment: SourceMigrationEnvironment
  targetAuthority: StagedMigrationExecutionTargetAuthorityV1
  kind: 'rollback' | 'restore'
  removedMigrationIds: string[]
  resultingAppliedMigrationIds: string[]
  fromSchemaDigest: string
  toSchemaDigest: string
  providerReceipt: SourceMigrationRecoveryReceiptV1
  providerReceiptDigest: string
  evidenceDigest: string
  approval: SourceMigrationHumanApprovalV1 | null
  recordedAt: string
}

/**
 * A successful, secret-free Provider observation made under one side of an authority rotation.
 * Both the previous and next grant must independently prove the same current schema, latest
 * no-drift Receipt, and absence of an unresolved remote mutation.
 */
export interface SourceMigrationAuthorityRebindReceiptV1 {
  format: typeof SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_FORMAT
  version: typeof SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_VERSION
  receiptId: string
  rebindId: string
  role: 'previous' | 'next'
  targetAuthority: StagedMigrationExecutionTargetAuthorityV1
  schemaDigest: string
  latestNoDriftReceiptDigest: string
  unresolvedMutation: false
  outcome: 'succeeded'
  checkedAt: string
  evidenceDigest: string
}

export interface SourceMigrationAuthorityRebindRecordV1 {
  rebindId: string
  environment: SourceMigrationEnvironment
  previousTargetAuthority: StagedMigrationExecutionTargetAuthorityV1
  nextTargetAuthority: StagedMigrationExecutionTargetAuthorityV1
  schemaDigest: string
  latestNoDriftId: string
  latestNoDriftReceiptDigest: string
  previousAuthorityReceipt: SourceMigrationAuthorityRebindReceiptV1
  previousAuthorityReceiptDigest: string
  nextAuthorityReceipt: SourceMigrationAuthorityRebindReceiptV1
  nextAuthorityReceiptDigest: string
  approval: SourceMigrationHumanApprovalV1 | null
  reboundAt: string
}

export interface SourceMigrationLedgerV1 {
  format: typeof SOURCE_MIGRATION_LEDGER_FORMAT
  version: typeof SOURCE_MIGRATION_LEDGER_VERSION
  ledgerId: string
  entries: SourceMigrationLedgerEntryV1[]
  environments: SourceMigrationEnvironmentStateV1[]
  promotions: SourceMigrationPromotionRecordV1[]
  driftRecords: SourceMigrationDriftRecordV1[]
  recoveryRecords: SourceMigrationRecoveryRecordV1[]
  authorityRebindings: SourceMigrationAuthorityRebindRecordV1[]
  createdAt: string
  updatedAt: string
}

export type SourceMigrationLedgerEventV1 =
  | { type: 'register-migration'; entry: SourceMigrationLedgerEntryV1; occurredAt: string }
  | { type: 'record-drift'; record: SourceMigrationDriftRecordV1; occurredAt: string }
  | { type: 'promote-migration'; record: SourceMigrationPromotionRecordV1; occurredAt: string }
  | { type: 'record-recovery'; record: SourceMigrationRecoveryRecordV1; occurredAt: string }
  | {
      type: 'rebind-environment-authority'
      record: SourceMigrationAuthorityRebindRecordV1
      occurredAt: string
    }

// A 32-byte SHA-256 digest has four data bits in its final unpadded base64url character.
const DIGEST = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const SAFE_SOURCE_PATH = /^[A-Za-z0-9._/@+-]+$/u
const ENVIRONMENTS: readonly SourceMigrationEnvironment[] = ['dev', 'staging', 'production']
const APPROVAL_SCOPES: readonly SourceMigrationApprovalScope[] = ['production', 'destructive']

export class SourceMigrationLedgerTransitionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SourceMigrationLedgerTransitionError'
    this.code = code
  }
}

function transitionError(code: string, message: string): never {
  throw new SourceMigrationLedgerTransitionError(code, message)
}

function fail(
  context: BackendValidationContext,
  code: string,
  path: string,
  message: string
): void {
  context.diagnostics.push({ code, severity: 'error', path, message })
}

function digest(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  nullable = false
): string | null | undefined {
  if (nullable && value === null) return null
  if (typeof value === 'string' && DIGEST.test(value)) return value
  fail(
    context,
    'backend-migration-ledger-digest-invalid',
    path,
    'Value must be a canonical SHA-256 base64url digest.'
  )
  return undefined
}

function timestamp(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string | undefined {
  if (typeof value === 'string' && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value))) {
    if (new Date(value).toISOString() === value) return value
  }
  fail(
    context,
    'backend-migration-ledger-timestamp-invalid',
    path,
    'Value must be a canonical UTC timestamp.'
  )
  return undefined
}

function nestedDiagnostics(
  diagnostics: readonly BackendDiagnostic[],
  path: string,
  context: BackendValidationContext
): void {
  for (const entry of diagnostics) {
    context.diagnostics.push({
      ...entry,
      path: entry.path === '$' ? path : `${path}${entry.path.slice(1)}`
    })
  }
}

function sourcePath(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string | undefined {
  const parsed = boundedText(value, path, context, BACKEND_LIMITS.maxTextLength)
  if (!parsed) return undefined
  const segments = parsed.split('/')
  if (
    !SAFE_SOURCE_PATH.test(parsed) ||
    parsed.startsWith('/') ||
    parsed.includes('\\') ||
    segments.some((entry) => entry === '' || entry === '.' || entry === '..')
  ) {
    fail(
      context,
      'backend-migration-ledger-source-path-invalid',
      path,
      'Source migration path must be a safe relative path.'
    )
    return undefined
  }
  return parsed
}

function parseExecutionPlan(
  value: unknown,
  path: string,
  context: BackendValidationContext
): StagedMigrationExecutionPlanV1 | undefined {
  const result = validateStagedMigrationExecutionPlan(value)
  if (!result.ok) {
    nestedDiagnostics(result.diagnostics, path, context)
    return undefined
  }
  return result.value
}

function parseExecutionReceipt(
  value: unknown,
  path: string,
  context: BackendValidationContext
): StagedMigrationExecutionReceiptV1 | undefined {
  const result = validateStagedMigrationExecutionReceipt(value)
  if (!result.ok) {
    nestedDiagnostics(result.diagnostics, path, context)
    return undefined
  }
  return result.value
}

function parseTargetAuthority(
  value: unknown,
  path: string,
  context: BackendValidationContext
): StagedMigrationExecutionTargetAuthorityV1 | undefined {
  const result = validateStagedMigrationExecutionTargetAuthority(value)
  if (!result.ok) {
    nestedDiagnostics(result.diagnostics, path, context)
    return undefined
  }
  return result.value
}

function parseSource(
  value: unknown,
  path: string,
  context: BackendValidationContext
): SourceMigrationLedgerEntryV1['source'] | undefined {
  const source = record(value, path, context, ['path', 'digest'])
  if (!source) return undefined
  const parsedPath = sourcePath(source.path, `${path}.path`, context)
  const parsedDigest = digest(source.digest, `${path}.digest`, context)
  return parsedPath && parsedDigest ? { path: parsedPath, digest: parsedDigest } : undefined
}

// oxlint-disable-next-line complexity -- Entry parsing validates the coupled plan, source SQL, source-plan, sequence, and timestamp authority in one strict boundary.
function parseEntry(
  value: unknown,
  path: string,
  context: BackendValidationContext
): SourceMigrationLedgerEntryV1 | undefined {
  const source = record(value, path, context, [
    'migrationId',
    'sequence',
    'name',
    'source',
    'executionPlan',
    'executionPlanDigest',
    'registeredAt'
  ])
  if (!source) return undefined
  const migrationId = id(source.migrationId, `${path}.migrationId`, context)
  let sequence: number | undefined
  if (
    typeof source.sequence === 'number' &&
    Number.isSafeInteger(source.sequence) &&
    source.sequence > 0
  ) {
    sequence = source.sequence
  } else {
    fail(
      context,
      'backend-migration-ledger-sequence-invalid',
      `${path}.sequence`,
      'Migration sequence must be a positive safe integer.'
    )
  }
  const name = boundedText(source.name, `${path}.name`, context, BACKEND_LIMITS.maxReasonLength)
  const parsedSource = parseSource(source.source, `${path}.source`, context)
  const executionPlan = parseExecutionPlan(source.executionPlan, `${path}.executionPlan`, context)
  const executionPlanDigest = digest(
    source.executionPlanDigest,
    `${path}.executionPlanDigest`,
    context
  )
  const registeredAt = timestamp(source.registeredAt, `${path}.registeredAt`, context)
  const reviewedSQLAuthority = executionPlan?.operations.find(
    (entry) => entry.operation.kind === 'apply-reviewed-migration'
  )?.operation
  if (
    reviewedSQLAuthority?.kind === 'apply-reviewed-migration' &&
    parsedSource &&
    reviewedSQLAuthority.sqlDigest !== parsedSource.digest
  ) {
    fail(
      context,
      'backend-migration-ledger-reviewed-sql-digest-mismatch',
      `${path}.executionPlan.operations[0].operation.sqlDigest`,
      'Reviewed SQL authority must bind the exact source migration file digest.'
    )
  }
  if (
    reviewedSQLAuthority?.kind === 'apply-reviewed-migration' &&
    reviewedSQLAuthority.migrationPlanDigest !== executionPlan?.sourceMigrationPlan.planDigest
  ) {
    fail(
      context,
      'backend-migration-ledger-reviewed-plan-digest-mismatch',
      `${path}.executionPlan.operations[0].operation.migrationPlanDigest`,
      'Reviewed SQL authority must bind the execution source migration plan digest.'
    )
  }
  return migrationId &&
    sequence &&
    name &&
    parsedSource &&
    executionPlan &&
    executionPlanDigest &&
    registeredAt
    ? {
        migrationId,
        sequence,
        name,
        source: parsedSource,
        executionPlan,
        executionPlanDigest,
        registeredAt
      }
    : undefined
}

function stringIds(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string[] | undefined {
  const values = array(value, path, context, BACKEND_LIMITS.maxMigrationOperations)
  if (!values) return undefined
  const parsed = values
    .map((entry, index) => id(entry, `${path}[${index}]`, context))
    .filter((entry): entry is string => entry !== undefined)
  uniqueBy(parsed, path, context, 'migration id')
  return parsed.length === values.length ? parsed : undefined
}

// oxlint-disable-next-line complexity -- Environment parsing validates the coupled authority, prefix, schema, receipt, and drift summary.
function parseEnvironmentState(
  value: unknown,
  path: string,
  context: BackendValidationContext
): SourceMigrationEnvironmentStateV1 | undefined {
  const source = record(value, path, context, [
    'environment',
    'targetAuthority',
    'appliedMigrationIds',
    'schemaDigest',
    'lastReceiptDigest',
    'drift'
  ])
  if (!source) return undefined
  const environment = oneOf(source.environment, `${path}.environment`, context, ENVIRONMENTS)
  const targetAuthority =
    source.targetAuthority === null
      ? null
      : parseTargetAuthority(source.targetAuthority, `${path}.targetAuthority`, context)
  const appliedMigrationIds = stringIds(
    source.appliedMigrationIds,
    `${path}.appliedMigrationIds`,
    context
  )
  const schemaDigest = digest(source.schemaDigest, `${path}.schemaDigest`, context, true)
  const lastReceiptDigest = digest(
    source.lastReceiptDigest,
    `${path}.lastReceiptDigest`,
    context,
    true
  )
  const drift = oneOf(source.drift, `${path}.drift`, context, ['unknown', 'none', 'detected'])
  if (appliedMigrationIds?.length && (schemaDigest === null || lastReceiptDigest === null)) {
    fail(
      context,
      'backend-migration-ledger-environment-proof-required',
      path,
      'Applied migrations require schema and receipt digests.'
    )
  }
  if (appliedMigrationIds?.length && targetAuthority === null) {
    fail(
      context,
      'backend-migration-ledger-environment-authority-required',
      `${path}.targetAuthority`,
      'Applied migrations require bound provider and remote project authority.'
    )
  }
  if (environment && targetAuthority && targetAuthority.environment !== environment) {
    fail(
      context,
      'backend-migration-ledger-environment-authority-mismatch',
      `${path}.targetAuthority.environment`,
      'Target authority environment must match its ledger environment.'
    )
  }
  if (
    !appliedMigrationIds?.length &&
    lastReceiptDigest !== null &&
    lastReceiptDigest !== undefined
  ) {
    fail(
      context,
      'backend-migration-ledger-receipt-unexpected',
      `${path}.lastReceiptDigest`,
      'An empty environment cannot have a last migration receipt.'
    )
  }
  return environment &&
    targetAuthority !== undefined &&
    appliedMigrationIds &&
    schemaDigest !== undefined &&
    lastReceiptDigest !== undefined &&
    drift
    ? { environment, targetAuthority, appliedMigrationIds, schemaDigest, lastReceiptDigest, drift }
    : undefined
}

function parseApproval(
  value: unknown,
  path: string,
  context: BackendValidationContext
): SourceMigrationHumanApprovalV1 | null | undefined {
  if (value === null) return null
  const source = record(value, path, context, [
    'approved',
    'approvedBy',
    'scopes',
    'evidenceDigest',
    'approvedAt'
  ])
  if (!source) return undefined
  if (source.approved !== true)
    fail(
      context,
      'backend-migration-ledger-approval-invalid',
      `${path}.approved`,
      'Human approval must be an explicit true value.'
    )
  const approvedBy = id(source.approvedBy, `${path}.approvedBy`, context)
  const rawScopes = array(source.scopes, `${path}.scopes`, context, APPROVAL_SCOPES.length)
  const scopes = (rawScopes ?? [])
    .map((entry, index) => oneOf(entry, `${path}.scopes[${index}]`, context, APPROVAL_SCOPES))
    .filter((entry): entry is SourceMigrationApprovalScope => entry !== undefined)
  uniqueBy(scopes, `${path}.scopes`, context, 'approval scope')
  if (scopes.length === 0)
    fail(
      context,
      'backend-migration-ledger-approval-scope-required',
      `${path}.scopes`,
      'Approval must name at least one protected scope.'
    )
  const evidenceDigest = digest(source.evidenceDigest, `${path}.evidenceDigest`, context)
  const approvedAt = timestamp(source.approvedAt, `${path}.approvedAt`, context)
  return source.approved === true &&
    approvedBy &&
    rawScopes?.length === scopes.length &&
    scopes.length > 0 &&
    evidenceDigest &&
    approvedAt
    ? {
        approved: true,
        approvedBy,
        scopes: sorted(scopes, (entry) => String(APPROVAL_SCOPES.indexOf(entry))),
        evidenceDigest,
        approvedAt
      }
    : undefined
}

function parsePromotion(
  value: unknown,
  path: string,
  context: BackendValidationContext
): SourceMigrationPromotionRecordV1 | undefined {
  const source = record(value, path, context, [
    'promotionId',
    'migrationId',
    'from',
    'to',
    'targetAuthority',
    'executionReceipt',
    'executionReceiptDigest',
    'schemaBeforeDigest',
    'schemaAfterDigest',
    'evidenceDigest',
    'approval',
    'promotedAt'
  ])
  if (!source) return undefined
  const promotionId = id(source.promotionId, `${path}.promotionId`, context)
  const migrationId = id(source.migrationId, `${path}.migrationId`, context)
  const from = oneOf(source.from, `${path}.from`, context, ['source', 'dev', 'staging'])
  const to = oneOf(source.to, `${path}.to`, context, ENVIRONMENTS)
  const targetAuthority = parseTargetAuthority(
    source.targetAuthority,
    `${path}.targetAuthority`,
    context
  )
  const executionReceipt = parseExecutionReceipt(
    source.executionReceipt,
    `${path}.executionReceipt`,
    context
  )
  const executionReceiptDigest = digest(
    source.executionReceiptDigest,
    `${path}.executionReceiptDigest`,
    context
  )
  const schemaBeforeDigest = digest(
    source.schemaBeforeDigest,
    `${path}.schemaBeforeDigest`,
    context
  )
  const schemaAfterDigest = digest(source.schemaAfterDigest, `${path}.schemaAfterDigest`, context)
  const evidenceDigest = digest(source.evidenceDigest, `${path}.evidenceDigest`, context)
  const approval = parseApproval(source.approval, `${path}.approval`, context)
  const promotedAt = timestamp(source.promotedAt, `${path}.promotedAt`, context)
  if (from && to && !isPromotionStep(from, to)) {
    fail(
      context,
      'backend-migration-ledger-promotion-step-invalid',
      path,
      'Promotion must follow source to dev to staging to production.'
    )
  }
  if (to && targetAuthority && targetAuthority.environment !== to) {
    fail(
      context,
      'backend-migration-ledger-promotion-authority-mismatch',
      `${path}.targetAuthority.environment`,
      'Promotion authority environment must match its target environment.'
    )
  }
  return promotionId &&
    migrationId &&
    from &&
    to &&
    targetAuthority &&
    executionReceipt &&
    executionReceiptDigest &&
    schemaBeforeDigest &&
    schemaAfterDigest &&
    evidenceDigest &&
    approval !== undefined &&
    promotedAt
    ? {
        promotionId,
        migrationId,
        from,
        to,
        targetAuthority,
        executionReceipt,
        executionReceiptDigest,
        schemaBeforeDigest,
        schemaAfterDigest,
        evidenceDigest,
        approval,
        promotedAt
      }
    : undefined
}

// oxlint-disable-next-line complexity -- Drift Receipt parsing validates the complete provider observation and terminal outcome at one strict boundary.
function parseDriftReceipt(
  value: unknown,
  path: string,
  context: BackendValidationContext
): SourceMigrationDriftReceiptV1 | undefined {
  const source = record(value, path, context, [
    'format',
    'version',
    'receiptId',
    'driftId',
    'targetAuthority',
    'expectedSchemaDigest',
    'observedSchemaDigest',
    'status',
    'outcome',
    'checkedAt',
    'evidenceDigest'
  ])
  if (!source) return undefined
  if (source.format !== SOURCE_MIGRATION_DRIFT_RECEIPT_FORMAT) {
    fail(
      context,
      'backend-migration-ledger-drift-receipt-format-unsupported',
      `${path}.format`,
      'Drift Receipt format is not supported.'
    )
  }
  if (source.version !== SOURCE_MIGRATION_DRIFT_RECEIPT_VERSION) {
    fail(
      context,
      'backend-migration-ledger-drift-receipt-version-unsupported',
      `${path}.version`,
      'Drift Receipt version is not supported.'
    )
  }
  const receiptId = id(source.receiptId, `${path}.receiptId`, context)
  const driftId = id(source.driftId, `${path}.driftId`, context)
  const targetAuthority = parseTargetAuthority(
    source.targetAuthority,
    `${path}.targetAuthority`,
    context
  )
  const expectedSchemaDigest = digest(
    source.expectedSchemaDigest,
    `${path}.expectedSchemaDigest`,
    context,
    true
  )
  const observedSchemaDigest = digest(
    source.observedSchemaDigest,
    `${path}.observedSchemaDigest`,
    context
  )
  const status = oneOf(source.status, `${path}.status`, context, ['none', 'detected'])
  const outcome = oneOf(source.outcome, `${path}.outcome`, context, [
    'succeeded',
    'failed',
    'outcome-unknown'
  ])
  const checkedAt = timestamp(source.checkedAt, `${path}.checkedAt`, context)
  const evidenceDigest = digest(source.evidenceDigest, `${path}.evidenceDigest`, context, true)
  if (expectedSchemaDigest !== undefined && observedSchemaDigest && status) {
    const derived =
      expectedSchemaDigest === null || expectedSchemaDigest === observedSchemaDigest
        ? 'none'
        : 'detected'
    if (status !== derived) {
      fail(
        context,
        'backend-migration-ledger-drift-receipt-status-mismatch',
        `${path}.status`,
        'Drift Receipt status must be derived from expected and observed schema digests.'
      )
    }
  }
  if (outcome === 'succeeded' && evidenceDigest === null) {
    fail(
      context,
      'backend-migration-ledger-drift-receipt-evidence-required',
      `${path}.evidenceDigest`,
      'Successful drift inspection requires provider evidence.'
    )
  }
  if (outcome && outcome !== 'succeeded' && evidenceDigest !== null) {
    fail(
      context,
      'backend-migration-ledger-drift-receipt-evidence-unexpected',
      `${path}.evidenceDigest`,
      'Failed or unknown drift inspection cannot claim success evidence.'
    )
  }
  return source.format === SOURCE_MIGRATION_DRIFT_RECEIPT_FORMAT &&
    source.version === SOURCE_MIGRATION_DRIFT_RECEIPT_VERSION &&
    receiptId &&
    driftId &&
    targetAuthority &&
    expectedSchemaDigest !== undefined &&
    observedSchemaDigest &&
    status &&
    outcome &&
    checkedAt &&
    evidenceDigest !== undefined
    ? {
        format: SOURCE_MIGRATION_DRIFT_RECEIPT_FORMAT,
        version: SOURCE_MIGRATION_DRIFT_RECEIPT_VERSION,
        receiptId,
        driftId,
        targetAuthority,
        expectedSchemaDigest,
        observedSchemaDigest,
        status,
        outcome,
        checkedAt,
        evidenceDigest
      }
    : undefined
}

export function validateSourceMigrationDriftReceipt(
  value: unknown
): BackendValidationResult<SourceMigrationDriftReceiptV1> {
  const context: BackendValidationContext = { diagnostics: [] }
  if (!assertBoundedBackendData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  if (!assertBackendSecretFreeData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  const parsed = parseDriftReceipt(value, '$', context)
  return parsed && context.diagnostics.length === 0
    ? { ok: true, value: parsed, diagnostics: [] }
    : { ok: false, diagnostics: context.diagnostics }
}

function requireDriftReceipt(value: unknown): SourceMigrationDriftReceiptV1 {
  const parsed = validateSourceMigrationDriftReceipt(value)
  if (!parsed.ok) {
    throw new TypeError(
      `Source migration drift Receipt validation failed: ${parsed.diagnostics.map((entry) => entry.code).join(', ')}`
    )
  }
  return parsed.value
}

// oxlint-disable-next-line open-pencil/no-useless-pass-through-wrappers -- Public normalization is an intentional throwing API alongside result-based validation.
export function normalizeSourceMigrationDriftReceipt(
  value: unknown
): SourceMigrationDriftReceiptV1 {
  return requireDriftReceipt(value)
}

export function canonicalSourceMigrationDriftReceiptBytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(requireDriftReceipt(value))
}

export async function digestSourceMigrationDriftReceipt(value: unknown): Promise<string> {
  return digestCanonicalManifest(requireDriftReceipt(value))
}

// oxlint-disable-next-line complexity -- Drift record parsing binds every provider Receipt field to the immutable history record.
function parseDriftRecord(
  value: unknown,
  path: string,
  context: BackendValidationContext
): SourceMigrationDriftRecordV1 | undefined {
  const source = record(value, path, context, [
    'driftId',
    'environment',
    'targetAuthority',
    'expectedSchemaDigest',
    'observedSchemaDigest',
    'status',
    'providerReceipt',
    'providerReceiptDigest',
    'evidenceDigest',
    'checkedAt'
  ])
  if (!source) return undefined
  const driftId = id(source.driftId, `${path}.driftId`, context)
  const environment = oneOf(source.environment, `${path}.environment`, context, ENVIRONMENTS)
  const targetAuthority = parseTargetAuthority(
    source.targetAuthority,
    `${path}.targetAuthority`,
    context
  )
  const expectedSchemaDigest = digest(
    source.expectedSchemaDigest,
    `${path}.expectedSchemaDigest`,
    context,
    true
  )
  const observedSchemaDigest = digest(
    source.observedSchemaDigest,
    `${path}.observedSchemaDigest`,
    context
  )
  const status = oneOf(source.status, `${path}.status`, context, ['none', 'detected'])
  const providerReceipt = parseDriftReceipt(
    source.providerReceipt,
    `${path}.providerReceipt`,
    context
  )
  const providerReceiptDigest = digest(
    source.providerReceiptDigest,
    `${path}.providerReceiptDigest`,
    context
  )
  const evidenceDigest = digest(source.evidenceDigest, `${path}.evidenceDigest`, context)
  const checkedAt = timestamp(source.checkedAt, `${path}.checkedAt`, context)
  if (expectedSchemaDigest !== undefined && observedSchemaDigest && status) {
    const derived =
      expectedSchemaDigest === null || expectedSchemaDigest === observedSchemaDigest
        ? 'none'
        : 'detected'
    if (status !== derived)
      fail(
        context,
        'backend-migration-ledger-drift-status-mismatch',
        `${path}.status`,
        'Drift status must be derived from expected and observed schema digests.'
      )
  }
  if (environment && targetAuthority && targetAuthority.environment !== environment) {
    fail(
      context,
      'backend-migration-ledger-drift-authority-mismatch',
      `${path}.targetAuthority.environment`,
      'Drift authority environment must match the checked ledger environment.'
    )
  }
  if (
    driftId &&
    targetAuthority &&
    expectedSchemaDigest !== undefined &&
    observedSchemaDigest &&
    status &&
    providerReceipt &&
    evidenceDigest &&
    checkedAt &&
    (providerReceipt.driftId !== driftId ||
      !sameTargetAuthority(providerReceipt.targetAuthority, targetAuthority) ||
      providerReceipt.expectedSchemaDigest !== expectedSchemaDigest ||
      providerReceipt.observedSchemaDigest !== observedSchemaDigest ||
      providerReceipt.status !== status ||
      providerReceipt.checkedAt !== checkedAt ||
      providerReceipt.evidenceDigest !== evidenceDigest)
  ) {
    fail(
      context,
      'backend-migration-ledger-drift-receipt-mismatch',
      `${path}.providerReceipt`,
      'Drift Receipt must exactly bind the authority, schema observation, status, evidence, and timestamp.'
    )
  }
  if (providerReceipt && providerReceipt.outcome !== 'succeeded') {
    fail(
      context,
      'backend-migration-ledger-drift-receipt-not-succeeded',
      `${path}.providerReceipt.outcome`,
      'Only a successful provider drift Receipt may enter the source ledger.'
    )
  }
  return driftId &&
    environment &&
    targetAuthority &&
    expectedSchemaDigest !== undefined &&
    observedSchemaDigest &&
    status &&
    providerReceipt &&
    providerReceiptDigest &&
    evidenceDigest &&
    checkedAt
    ? {
        driftId,
        environment,
        targetAuthority,
        expectedSchemaDigest,
        observedSchemaDigest,
        status,
        providerReceipt,
        providerReceiptDigest,
        evidenceDigest,
        checkedAt
      }
    : undefined
}

function parseRecoveryPoint(
  value: unknown,
  path: string,
  context: BackendValidationContext
): SourceMigrationRecoveryPointV1 | undefined {
  const source = record(value, path, context, [
    'format',
    'version',
    'recoveryPointId',
    'targetAuthority',
    'appliedMigrationIds',
    'schemaDigest',
    'capturedAt',
    'evidenceDigest'
  ])
  if (!source) return undefined
  if (source.format !== SOURCE_MIGRATION_RECOVERY_POINT_FORMAT) {
    fail(
      context,
      'backend-migration-ledger-recovery-point-format-unsupported',
      `${path}.format`,
      'Recovery point format is not supported.'
    )
  }
  if (source.version !== SOURCE_MIGRATION_RECOVERY_POINT_VERSION) {
    fail(
      context,
      'backend-migration-ledger-recovery-point-version-unsupported',
      `${path}.version`,
      'Recovery point version is not supported.'
    )
  }
  const recoveryPointId = id(source.recoveryPointId, `${path}.recoveryPointId`, context)
  const targetAuthority = parseTargetAuthority(
    source.targetAuthority,
    `${path}.targetAuthority`,
    context
  )
  const appliedMigrationIds = stringIds(
    source.appliedMigrationIds,
    `${path}.appliedMigrationIds`,
    context
  )
  const schemaDigest = digest(source.schemaDigest, `${path}.schemaDigest`, context)
  const capturedAt = timestamp(source.capturedAt, `${path}.capturedAt`, context)
  const evidenceDigest = digest(source.evidenceDigest, `${path}.evidenceDigest`, context)
  return source.format === SOURCE_MIGRATION_RECOVERY_POINT_FORMAT &&
    source.version === SOURCE_MIGRATION_RECOVERY_POINT_VERSION &&
    recoveryPointId &&
    targetAuthority &&
    appliedMigrationIds &&
    schemaDigest &&
    capturedAt &&
    evidenceDigest
    ? {
        format: SOURCE_MIGRATION_RECOVERY_POINT_FORMAT,
        version: SOURCE_MIGRATION_RECOVERY_POINT_VERSION,
        recoveryPointId,
        targetAuthority,
        appliedMigrationIds,
        schemaDigest,
        capturedAt,
        evidenceDigest
      }
    : undefined
}

export function validateSourceMigrationRecoveryPoint(
  value: unknown
): BackendValidationResult<SourceMigrationRecoveryPointV1> {
  const context: BackendValidationContext = { diagnostics: [] }
  if (!assertBoundedBackendData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  if (!assertBackendSecretFreeData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  const parsed = parseRecoveryPoint(value, '$', context)
  return parsed && context.diagnostics.length === 0
    ? { ok: true, value: parsed, diagnostics: [] }
    : { ok: false, diagnostics: context.diagnostics }
}

function requireRecoveryPoint(value: unknown): SourceMigrationRecoveryPointV1 {
  const parsed = validateSourceMigrationRecoveryPoint(value)
  if (!parsed.ok) {
    throw new TypeError(
      `Source migration recovery point validation failed: ${parsed.diagnostics.map((entry) => entry.code).join(', ')}`
    )
  }
  return parsed.value
}

// oxlint-disable-next-line open-pencil/no-useless-pass-through-wrappers -- Public normalization is an intentional throwing API alongside result-based validation.
export function normalizeSourceMigrationRecoveryPoint(
  value: unknown
): SourceMigrationRecoveryPointV1 {
  return requireRecoveryPoint(value)
}

export function canonicalSourceMigrationRecoveryPointBytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(requireRecoveryPoint(value))
}

export async function digestSourceMigrationRecoveryPoint(value: unknown): Promise<string> {
  return digestCanonicalManifest(requireRecoveryPoint(value))
}

// oxlint-disable-next-line complexity -- Recovery Receipt parsing binds every provider outcome and state-transition field in one strict boundary.
function parseRecoveryReceipt(
  value: unknown,
  path: string,
  context: BackendValidationContext
): SourceMigrationRecoveryReceiptV1 | undefined {
  const source = record(value, path, context, [
    'format',
    'version',
    'receiptId',
    'recoveryId',
    'kind',
    'targetAuthority',
    'removedMigrationIds',
    'resultingAppliedMigrationIds',
    'fromSchemaDigest',
    'toSchemaDigest',
    'recoveryPoint',
    'outcome',
    'recordedAt',
    'evidenceDigest'
  ])
  if (!source) return undefined
  if (source.format !== SOURCE_MIGRATION_RECOVERY_RECEIPT_FORMAT) {
    fail(
      context,
      'backend-migration-ledger-recovery-receipt-format-unsupported',
      `${path}.format`,
      'Recovery Receipt format is not supported.'
    )
  }
  if (source.version !== SOURCE_MIGRATION_RECOVERY_RECEIPT_VERSION) {
    fail(
      context,
      'backend-migration-ledger-recovery-receipt-version-unsupported',
      `${path}.version`,
      'Recovery Receipt version is not supported.'
    )
  }
  const receiptId = id(source.receiptId, `${path}.receiptId`, context)
  const recoveryId = id(source.recoveryId, `${path}.recoveryId`, context)
  const kind = oneOf(source.kind, `${path}.kind`, context, ['rollback', 'restore'])
  const targetAuthority = parseTargetAuthority(
    source.targetAuthority,
    `${path}.targetAuthority`,
    context
  )
  const removedMigrationIds = stringIds(
    source.removedMigrationIds,
    `${path}.removedMigrationIds`,
    context
  )
  const resultingAppliedMigrationIds = stringIds(
    source.resultingAppliedMigrationIds,
    `${path}.resultingAppliedMigrationIds`,
    context
  )
  const fromSchemaDigest = digest(source.fromSchemaDigest, `${path}.fromSchemaDigest`, context)
  const toSchemaDigest = digest(source.toSchemaDigest, `${path}.toSchemaDigest`, context)
  const recoveryPoint =
    source.recoveryPoint === null
      ? null
      : parseRecoveryPoint(source.recoveryPoint, `${path}.recoveryPoint`, context)
  const outcome = oneOf(source.outcome, `${path}.outcome`, context, [
    'succeeded',
    'failed',
    'outcome-unknown'
  ])
  const recordedAt = timestamp(source.recordedAt, `${path}.recordedAt`, context)
  const evidenceDigest = digest(source.evidenceDigest, `${path}.evidenceDigest`, context, true)
  if (outcome === 'succeeded' && evidenceDigest === null) {
    fail(
      context,
      'backend-migration-ledger-recovery-receipt-evidence-required',
      `${path}.evidenceDigest`,
      'Successful recovery requires provider evidence.'
    )
  }
  if (outcome && outcome !== 'succeeded' && evidenceDigest !== null) {
    fail(
      context,
      'backend-migration-ledger-recovery-receipt-evidence-unexpected',
      `${path}.evidenceDigest`,
      'Failed or unknown recovery cannot claim success evidence.'
    )
  }
  if (kind === 'rollback' && recoveryPoint !== null && recoveryPoint !== undefined) {
    fail(
      context,
      'backend-migration-ledger-recovery-point-unexpected',
      `${path}.recoveryPoint`,
      'Rollback must not claim a provider recovery point.'
    )
  }
  if (kind === 'restore' && recoveryPoint === null) {
    fail(
      context,
      'backend-migration-ledger-recovery-point-required',
      `${path}.recoveryPoint`,
      'Restore requires a canonical provider backup or recovery point.'
    )
  }
  if (
    recoveryPoint &&
    targetAuthority &&
    resultingAppliedMigrationIds &&
    toSchemaDigest &&
    (!sameTargetAuthority(recoveryPoint.targetAuthority, targetAuthority) ||
      !sameStrings(recoveryPoint.appliedMigrationIds, resultingAppliedMigrationIds) ||
      recoveryPoint.schemaDigest !== toSchemaDigest)
  ) {
    fail(
      context,
      'backend-migration-ledger-recovery-point-target-mismatch',
      `${path}.recoveryPoint`,
      'Recovery point must exactly bind the restore authority, resulting source prefix, and target schema.'
    )
  }
  if (recoveryPoint && recordedAt && recoveryPoint.capturedAt.localeCompare(recordedAt, 'en') > 0) {
    fail(
      context,
      'backend-migration-ledger-recovery-point-future',
      `${path}.recoveryPoint.capturedAt`,
      'Recovery point must be captured no later than the restore action.'
    )
  }
  return source.format === SOURCE_MIGRATION_RECOVERY_RECEIPT_FORMAT &&
    source.version === SOURCE_MIGRATION_RECOVERY_RECEIPT_VERSION &&
    receiptId &&
    recoveryId &&
    kind &&
    targetAuthority &&
    removedMigrationIds &&
    resultingAppliedMigrationIds &&
    fromSchemaDigest &&
    toSchemaDigest &&
    recoveryPoint !== undefined &&
    outcome &&
    recordedAt &&
    evidenceDigest !== undefined
    ? {
        format: SOURCE_MIGRATION_RECOVERY_RECEIPT_FORMAT,
        version: SOURCE_MIGRATION_RECOVERY_RECEIPT_VERSION,
        receiptId,
        recoveryId,
        kind,
        targetAuthority,
        removedMigrationIds,
        resultingAppliedMigrationIds,
        fromSchemaDigest,
        toSchemaDigest,
        recoveryPoint,
        outcome,
        recordedAt,
        evidenceDigest
      }
    : undefined
}

export function validateSourceMigrationRecoveryReceipt(
  value: unknown
): BackendValidationResult<SourceMigrationRecoveryReceiptV1> {
  const context: BackendValidationContext = { diagnostics: [] }
  if (!assertBoundedBackendData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  if (!assertBackendSecretFreeData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  const parsed = parseRecoveryReceipt(value, '$', context)
  return parsed && context.diagnostics.length === 0
    ? { ok: true, value: parsed, diagnostics: [] }
    : { ok: false, diagnostics: context.diagnostics }
}

function requireRecoveryReceipt(value: unknown): SourceMigrationRecoveryReceiptV1 {
  const parsed = validateSourceMigrationRecoveryReceipt(value)
  if (!parsed.ok) {
    throw new TypeError(
      `Source migration recovery Receipt validation failed: ${parsed.diagnostics.map((entry) => entry.code).join(', ')}`
    )
  }
  return parsed.value
}

// oxlint-disable-next-line open-pencil/no-useless-pass-through-wrappers -- Public normalization is an intentional throwing API alongside result-based validation.
export function normalizeSourceMigrationRecoveryReceipt(
  value: unknown
): SourceMigrationRecoveryReceiptV1 {
  return requireRecoveryReceipt(value)
}

export function canonicalSourceMigrationRecoveryReceiptBytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(requireRecoveryReceipt(value))
}

export async function digestSourceMigrationRecoveryReceipt(value: unknown): Promise<string> {
  return digestCanonicalManifest(requireRecoveryReceipt(value))
}

function parseAuthorityRebindReceipt(
  value: unknown,
  path: string,
  context: BackendValidationContext
): SourceMigrationAuthorityRebindReceiptV1 | undefined {
  const source = record(value, path, context, [
    'format',
    'version',
    'receiptId',
    'rebindId',
    'role',
    'targetAuthority',
    'schemaDigest',
    'latestNoDriftReceiptDigest',
    'unresolvedMutation',
    'outcome',
    'checkedAt',
    'evidenceDigest'
  ])
  if (!source) return undefined
  if (source.format !== SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_FORMAT) {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-receipt-format-unsupported',
      `${path}.format`,
      'Authority rebind Receipt format is not supported.'
    )
  }
  if (source.version !== SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_VERSION) {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-receipt-version-unsupported',
      `${path}.version`,
      'Authority rebind Receipt version is not supported.'
    )
  }
  const receiptId = id(source.receiptId, `${path}.receiptId`, context)
  const rebindId = id(source.rebindId, `${path}.rebindId`, context)
  const role = oneOf(source.role, `${path}.role`, context, ['previous', 'next'])
  const targetAuthority = parseTargetAuthority(
    source.targetAuthority,
    `${path}.targetAuthority`,
    context
  )
  const schemaDigest = digest(source.schemaDigest, `${path}.schemaDigest`, context)
  const latestNoDriftReceiptDigest = digest(
    source.latestNoDriftReceiptDigest,
    `${path}.latestNoDriftReceiptDigest`,
    context
  )
  if (source.unresolvedMutation !== false) {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-unresolved-mutation',
      `${path}.unresolvedMutation`,
      'Authority rebind proof must explicitly prove that no remote mutation is unresolved.'
    )
  }
  if (source.outcome !== 'succeeded') {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-receipt-not-succeeded',
      `${path}.outcome`,
      'Only a successful Provider authority proof can authorize a rebind.'
    )
  }
  const checkedAt = timestamp(source.checkedAt, `${path}.checkedAt`, context)
  const evidenceDigest = digest(source.evidenceDigest, `${path}.evidenceDigest`, context)
  return source.format === SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_FORMAT &&
    source.version === SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_VERSION &&
    receiptId &&
    rebindId &&
    role &&
    targetAuthority &&
    schemaDigest &&
    latestNoDriftReceiptDigest &&
    source.unresolvedMutation === false &&
    source.outcome === 'succeeded' &&
    checkedAt &&
    evidenceDigest
    ? {
        format: SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_FORMAT,
        version: SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_VERSION,
        receiptId,
        rebindId,
        role,
        targetAuthority,
        schemaDigest,
        latestNoDriftReceiptDigest,
        unresolvedMutation: false,
        outcome: 'succeeded',
        checkedAt,
        evidenceDigest
      }
    : undefined
}

export function validateSourceMigrationAuthorityRebindReceipt(
  value: unknown
): BackendValidationResult<SourceMigrationAuthorityRebindReceiptV1> {
  const context: BackendValidationContext = { diagnostics: [] }
  if (!assertBoundedBackendData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  if (!assertBackendSecretFreeData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  const parsed = parseAuthorityRebindReceipt(value, '$', context)
  return parsed && context.diagnostics.length === 0
    ? { ok: true, value: parsed, diagnostics: [] }
    : { ok: false, diagnostics: context.diagnostics }
}

function requireAuthorityRebindReceipt(value: unknown): SourceMigrationAuthorityRebindReceiptV1 {
  const parsed = validateSourceMigrationAuthorityRebindReceipt(value)
  if (!parsed.ok) {
    throw new TypeError(
      `Source migration authority rebind Receipt validation failed: ${parsed.diagnostics.map((entry) => entry.code).join(', ')}`
    )
  }
  return parsed.value
}

// oxlint-disable-next-line open-pencil/no-useless-pass-through-wrappers -- Public normalization is an intentional throwing API alongside result-based validation.
export function normalizeSourceMigrationAuthorityRebindReceipt(
  value: unknown
): SourceMigrationAuthorityRebindReceiptV1 {
  return requireAuthorityRebindReceipt(value)
}

export function canonicalSourceMigrationAuthorityRebindReceiptBytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(requireAuthorityRebindReceipt(value))
}

export async function digestSourceMigrationAuthorityRebindReceipt(value: unknown): Promise<string> {
  return digestCanonicalManifest(requireAuthorityRebindReceipt(value))
}

// oxlint-disable-next-line complexity -- Recovery record parsing binds the immutable record to every canonical provider Receipt field at one fail-closed boundary.
function parseRecovery(
  value: unknown,
  path: string,
  context: BackendValidationContext
): SourceMigrationRecoveryRecordV1 | undefined {
  const source = record(value, path, context, [
    'recoveryId',
    'environment',
    'targetAuthority',
    'kind',
    'removedMigrationIds',
    'resultingAppliedMigrationIds',
    'fromSchemaDigest',
    'toSchemaDigest',
    'providerReceipt',
    'providerReceiptDigest',
    'evidenceDigest',
    'approval',
    'recordedAt'
  ])
  if (!source) return undefined
  const recoveryId = id(source.recoveryId, `${path}.recoveryId`, context)
  const environment = oneOf(source.environment, `${path}.environment`, context, ENVIRONMENTS)
  const targetAuthority = parseTargetAuthority(
    source.targetAuthority,
    `${path}.targetAuthority`,
    context
  )
  const kind = oneOf(source.kind, `${path}.kind`, context, ['rollback', 'restore'])
  const removedMigrationIds = stringIds(
    source.removedMigrationIds,
    `${path}.removedMigrationIds`,
    context
  )
  const resultingAppliedMigrationIds = stringIds(
    source.resultingAppliedMigrationIds,
    `${path}.resultingAppliedMigrationIds`,
    context
  )
  const fromSchemaDigest = digest(source.fromSchemaDigest, `${path}.fromSchemaDigest`, context)
  const toSchemaDigest = digest(source.toSchemaDigest, `${path}.toSchemaDigest`, context)
  const providerReceipt = parseRecoveryReceipt(
    source.providerReceipt,
    `${path}.providerReceipt`,
    context
  )
  const providerReceiptDigest = digest(
    source.providerReceiptDigest,
    `${path}.providerReceiptDigest`,
    context
  )
  const evidenceDigest = digest(source.evidenceDigest, `${path}.evidenceDigest`, context)
  const approval = parseApproval(source.approval, `${path}.approval`, context)
  const recordedAt = timestamp(source.recordedAt, `${path}.recordedAt`, context)
  if (kind === 'rollback' && removedMigrationIds?.length !== 1) {
    fail(
      context,
      'backend-migration-ledger-rollback-count-invalid',
      `${path}.removedMigrationIds`,
      'Rollback must remove exactly the latest migration.'
    )
  }
  if (environment && targetAuthority && targetAuthority.environment !== environment) {
    fail(
      context,
      'backend-migration-ledger-recovery-authority-mismatch',
      `${path}.targetAuthority.environment`,
      'Recovery authority environment must match the recovered ledger environment.'
    )
  }
  if (
    recoveryId &&
    environment &&
    targetAuthority &&
    kind &&
    removedMigrationIds &&
    resultingAppliedMigrationIds &&
    fromSchemaDigest &&
    toSchemaDigest &&
    providerReceipt &&
    evidenceDigest &&
    (providerReceipt.recoveryId !== recoveryId ||
      providerReceipt.kind !== kind ||
      !sameTargetAuthority(providerReceipt.targetAuthority, targetAuthority) ||
      !sameStrings(providerReceipt.removedMigrationIds, removedMigrationIds) ||
      !sameStrings(providerReceipt.resultingAppliedMigrationIds, resultingAppliedMigrationIds) ||
      providerReceipt.fromSchemaDigest !== fromSchemaDigest ||
      providerReceipt.toSchemaDigest !== toSchemaDigest ||
      providerReceipt.evidenceDigest !== evidenceDigest ||
      providerReceipt.recordedAt !== recordedAt)
  ) {
    fail(
      context,
      'backend-migration-ledger-recovery-receipt-mismatch',
      `${path}.providerReceipt`,
      'Recovery Receipt must exactly bind the recovery action, target authority, schema transition, evidence, and timestamp.'
    )
  }
  if (providerReceipt && providerReceipt.outcome !== 'succeeded') {
    fail(
      context,
      'backend-migration-ledger-recovery-receipt-not-succeeded',
      `${path}.providerReceipt.outcome`,
      'Only a successful provider recovery Receipt may enter the source ledger.'
    )
  }
  return recoveryId &&
    environment &&
    targetAuthority &&
    kind &&
    removedMigrationIds &&
    resultingAppliedMigrationIds &&
    fromSchemaDigest &&
    toSchemaDigest &&
    providerReceipt &&
    providerReceiptDigest &&
    evidenceDigest &&
    approval !== undefined &&
    recordedAt
    ? {
        recoveryId,
        environment,
        targetAuthority,
        kind,
        removedMigrationIds,
        resultingAppliedMigrationIds,
        fromSchemaDigest,
        toSchemaDigest,
        providerReceipt,
        providerReceiptDigest,
        evidenceDigest,
        approval,
        recordedAt
      }
    : undefined
}

// oxlint-disable-next-line complexity -- Rebinding is a strict dual-Receipt boundary for identity, drift, mutation, timing, and approval claims.
function parseAuthorityRebind(
  value: unknown,
  path: string,
  context: BackendValidationContext
): SourceMigrationAuthorityRebindRecordV1 | undefined {
  const source = record(value, path, context, [
    'rebindId',
    'environment',
    'previousTargetAuthority',
    'nextTargetAuthority',
    'schemaDigest',
    'latestNoDriftId',
    'latestNoDriftReceiptDigest',
    'previousAuthorityReceipt',
    'previousAuthorityReceiptDigest',
    'nextAuthorityReceipt',
    'nextAuthorityReceiptDigest',
    'approval',
    'reboundAt'
  ])
  if (!source) return undefined
  const rebindId = id(source.rebindId, `${path}.rebindId`, context)
  const environment = oneOf(source.environment, `${path}.environment`, context, ENVIRONMENTS)
  const previousTargetAuthority = parseTargetAuthority(
    source.previousTargetAuthority,
    `${path}.previousTargetAuthority`,
    context
  )
  const nextTargetAuthority = parseTargetAuthority(
    source.nextTargetAuthority,
    `${path}.nextTargetAuthority`,
    context
  )
  const schemaDigest = digest(source.schemaDigest, `${path}.schemaDigest`, context)
  const latestNoDriftId = id(source.latestNoDriftId, `${path}.latestNoDriftId`, context)
  const latestNoDriftReceiptDigest = digest(
    source.latestNoDriftReceiptDigest,
    `${path}.latestNoDriftReceiptDigest`,
    context
  )
  const previousAuthorityReceipt = parseAuthorityRebindReceipt(
    source.previousAuthorityReceipt,
    `${path}.previousAuthorityReceipt`,
    context
  )
  const previousAuthorityReceiptDigest = digest(
    source.previousAuthorityReceiptDigest,
    `${path}.previousAuthorityReceiptDigest`,
    context
  )
  const nextAuthorityReceipt = parseAuthorityRebindReceipt(
    source.nextAuthorityReceipt,
    `${path}.nextAuthorityReceipt`,
    context
  )
  const nextAuthorityReceiptDigest = digest(
    source.nextAuthorityReceiptDigest,
    `${path}.nextAuthorityReceiptDigest`,
    context
  )
  const approval = parseApproval(source.approval, `${path}.approval`, context)
  const reboundAt = timestamp(source.reboundAt, `${path}.reboundAt`, context)
  if (
    environment &&
    previousTargetAuthority &&
    nextTargetAuthority &&
    (previousTargetAuthority.environment !== environment ||
      nextTargetAuthority.environment !== environment)
  ) {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-environment-mismatch',
      path,
      'Both authority proofs must target the rebound ledger environment.'
    )
  }
  if (
    previousTargetAuthority &&
    nextTargetAuthority &&
    (!sameTargetAuthorityExceptGrantGeneration(previousTargetAuthority, nextTargetAuthority) ||
      previousTargetAuthority.grantGeneration === nextTargetAuthority.grantGeneration)
  ) {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-scope-mismatch',
      `${path}.nextTargetAuthority`,
      'Authority rebind may change only grantGeneration, and the generation must change.'
    )
  }
  if (
    rebindId &&
    previousTargetAuthority &&
    nextTargetAuthority &&
    schemaDigest &&
    latestNoDriftReceiptDigest &&
    previousAuthorityReceipt &&
    nextAuthorityReceipt &&
    (previousAuthorityReceipt.rebindId !== rebindId ||
      previousAuthorityReceipt.role !== 'previous' ||
      !sameTargetAuthority(previousAuthorityReceipt.targetAuthority, previousTargetAuthority) ||
      previousAuthorityReceipt.schemaDigest !== schemaDigest ||
      previousAuthorityReceipt.latestNoDriftReceiptDigest !== latestNoDriftReceiptDigest ||
      nextAuthorityReceipt.rebindId !== rebindId ||
      nextAuthorityReceipt.role !== 'next' ||
      !sameTargetAuthority(nextAuthorityReceipt.targetAuthority, nextTargetAuthority) ||
      nextAuthorityReceipt.schemaDigest !== schemaDigest ||
      nextAuthorityReceipt.latestNoDriftReceiptDigest !== latestNoDriftReceiptDigest)
  ) {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-receipt-mismatch',
      path,
      'Previous and next Provider Receipts must exactly bind the rebind, authorities, schema, and latest no-drift evidence.'
    )
  }
  const previousEvidenceDigest = previousAuthorityReceipt?.evidenceDigest
  const nextEvidenceDigest = nextAuthorityReceipt?.evidenceDigest
  if (previousEvidenceDigest !== undefined && previousEvidenceDigest === nextEvidenceDigest) {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-evidence-reused',
      path,
      'Previous and next authority checks require distinct Provider evidence.'
    )
  }
  const previousCheckedAt = previousAuthorityReceipt?.checkedAt
  const nextCheckedAt = nextAuthorityReceipt?.checkedAt
  if (
    previousCheckedAt !== undefined &&
    nextCheckedAt !== undefined &&
    previousCheckedAt.localeCompare(nextCheckedAt, 'en') >= 0
  ) {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-proof-order-invalid',
      path,
      'Previous authority proof must precede the next authority proof.'
    )
  }
  if (
    nextAuthorityReceipt &&
    reboundAt &&
    nextAuthorityReceipt.checkedAt.localeCompare(reboundAt, 'en') > 0
  ) {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-proof-future',
      `${path}.nextAuthorityReceipt.checkedAt`,
      'Authority proofs must be recorded no later than the rebind.'
    )
  }
  return rebindId &&
    environment &&
    previousTargetAuthority &&
    nextTargetAuthority &&
    schemaDigest &&
    latestNoDriftId &&
    latestNoDriftReceiptDigest &&
    previousAuthorityReceipt &&
    previousAuthorityReceiptDigest &&
    nextAuthorityReceipt &&
    nextAuthorityReceiptDigest &&
    approval !== undefined &&
    reboundAt
    ? {
        rebindId,
        environment,
        previousTargetAuthority,
        nextTargetAuthority,
        schemaDigest,
        latestNoDriftId,
        latestNoDriftReceiptDigest,
        previousAuthorityReceipt,
        previousAuthorityReceiptDigest,
        nextAuthorityReceipt,
        nextAuthorityReceiptDigest,
        approval,
        reboundAt
      }
    : undefined
}

function chronological<T>(
  values: T[],
  timestampOf: (value: T) => string,
  idOf: (value: T) => string
): T[] {
  return values.sort((left, right) => {
    const time = timestampOf(left).localeCompare(timestampOf(right), 'en')
    return time || idOf(left).localeCompare(idOf(right), 'en')
  })
}

function isPrefix(candidate: readonly string[], full: readonly string[]): boolean {
  return candidate.length <= full.length && candidate.every((entry, index) => full[index] === entry)
}

function recoveryLeavesDownstreamAhead(
  environment: SourceMigrationEnvironment,
  resultingAppliedMigrationIds: readonly string[],
  appliedMigrationIdsFor: (environment: SourceMigrationEnvironment) => readonly string[]
): boolean {
  const downstream = ENVIRONMENTS.slice(ENVIRONMENTS.indexOf(environment) + 1)
  return downstream.some(
    (candidate) => !isPrefix(appliedMigrationIdsFor(candidate), resultingAppliedMigrationIds)
  )
}

function requiredApprovalScopes(
  environment: SourceMigrationEnvironment,
  entries: readonly SourceMigrationLedgerEntryV1[]
): SourceMigrationApprovalScope[] {
  const scopes: SourceMigrationApprovalScope[] = []
  if (environment === 'production') scopes.push('production')
  if (entries.some((entry) => entry.executionPlan.highestRisk === 'destructive'))
    scopes.push('destructive')
  return scopes
}

function requiredRecoveryApprovalScopes(
  environment: SourceMigrationEnvironment
): SourceMigrationApprovalScope[] {
  return environment === 'production' ? ['production', 'destructive'] : ['destructive']
}

function requiredAuthorityRebindApprovalScopes(
  environment: SourceMigrationEnvironment
): SourceMigrationApprovalScope[] {
  return environment === 'production' ? ['production'] : []
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

function sameTargetAuthority(
  left: StagedMigrationExecutionTargetAuthorityV1,
  right: StagedMigrationExecutionTargetAuthorityV1
): boolean {
  return (
    left.providerId === right.providerId &&
    left.providerAuthorityDigest === right.providerAuthorityDigest &&
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.grantGeneration === right.grantGeneration &&
    left.environment === right.environment
  )
}

function sameTargetAuthorityExceptGrantGeneration(
  left: StagedMigrationExecutionTargetAuthorityV1,
  right: StagedMigrationExecutionTargetAuthorityV1
): boolean {
  return (
    left.providerId === right.providerId &&
    left.providerAuthorityDigest === right.providerAuthorityDigest &&
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.environment === right.environment
  )
}

function sameNullableTargetAuthority(
  left: StagedMigrationExecutionTargetAuthorityV1 | null,
  right: StagedMigrationExecutionTargetAuthorityV1 | null
): boolean {
  return left === null || right === null ? left === right : sameTargetAuthority(left, right)
}

interface ReplayedEnvironmentState {
  targetAuthority: StagedMigrationExecutionTargetAuthorityV1 | null
  appliedMigrationIds: string[]
  schemaDigest: string | null
  observedSchemaDigest: string | null
  lastReceiptDigest: string | null
  drift: SourceMigrationDriftStatus
  lastEnvironmentEvent: {
    kind: 'drift' | 'promotion' | 'recovery' | 'authority-rebind'
    id: string
    at: string
    driftReceiptDigest: string | null
    driftRecord: SourceMigrationDriftRecordV1 | null
  } | null
}

type EnvironmentHistoryEvent =
  | { kind: 'drift'; at: string; id: string; record: SourceMigrationDriftRecordV1 }
  | { kind: 'promotion'; at: string; id: string; record: SourceMigrationPromotionRecordV1 }
  | { kind: 'recovery'; at: string; id: string; record: SourceMigrationRecoveryRecordV1 }
  | {
      kind: 'authority-rebind'
      at: string
      id: string
      record: SourceMigrationAuthorityRebindRecordV1
    }

function replayLastReceipt(
  promotions: readonly SourceMigrationPromotionRecordV1[],
  environment: SourceMigrationEnvironment,
  appliedMigrationIds: readonly string[]
): string | null {
  const migrationId = appliedMigrationIds.at(-1)
  if (!migrationId) return null
  return (
    [...promotions]
      .reverse()
      .find((entry) => entry.to === environment && entry.migrationId === migrationId)
      ?.executionReceiptDigest ?? null
  )
}

function expectedRecoveryTargetSchemaDigest(
  appliedMigrationIds: readonly string[],
  schemaDigest: string | null,
  promotions: readonly SourceMigrationPromotionRecordV1[],
  environment: SourceMigrationEnvironment,
  resultingAppliedMigrationIds: readonly string[]
): string | null {
  if (sameStrings(appliedMigrationIds, resultingAppliedMigrationIds)) return schemaDigest
  const firstRemovedMigrationId = appliedMigrationIds[resultingAppliedMigrationIds.length]
  if (!firstRemovedMigrationId) return null
  return (
    [...promotions]
      .reverse()
      .find((entry) => entry.to === environment && entry.migrationId === firstRemovedMigrationId)
      ?.schemaBeforeDigest ?? null
  )
}

function validateHistoryTimeline(
  state: SourceMigrationLedgerV1,
  context: BackendValidationContext
): void {
  const history = [
    ...state.entries.map((entry) => ({ at: entry.registeredAt, path: '$.entries' })),
    ...state.promotions.map((entry) => ({ at: entry.promotedAt, path: '$.promotions' })),
    ...state.driftRecords.map((entry) => ({ at: entry.checkedAt, path: '$.driftRecords' })),
    ...state.recoveryRecords.map((entry) => ({ at: entry.recordedAt, path: '$.recoveryRecords' })),
    ...state.authorityRebindings.map((entry) => ({
      at: entry.reboundAt,
      path: '$.authorityRebindings'
    }))
  ].sort((left, right) => left.at.localeCompare(right.at, 'en'))
  for (const [index, entry] of history.entries()) {
    if (entry.at.localeCompare(state.createdAt, 'en') <= 0) {
      fail(
        context,
        'backend-migration-ledger-history-predates-creation',
        entry.path,
        'Immutable history must be recorded after ledger creation.'
      )
    }
    if (index > 0 && history[index - 1]?.at === entry.at) {
      fail(
        context,
        'backend-migration-ledger-history-time-collision',
        entry.path,
        'Immutable history records require distinct canonical timestamps.'
      )
    }
  }
  state.entries.forEach((entry, index) => {
    const previous = index > 0 ? state.entries.at(index - 1) : undefined
    if (previous && entry.registeredAt.localeCompare(previous.registeredAt, 'en') <= 0) {
      fail(
        context,
        'backend-migration-ledger-registration-order-invalid',
        `$.entries[${index}].registeredAt`,
        'Migration registration timestamps must follow source sequence order.'
      )
    }
  })
}

function replayDriftRecord(
  replay: ReplayedEnvironmentState,
  recordValue: SourceMigrationDriftRecordV1,
  path: string,
  context: BackendValidationContext
): void {
  if (
    replay.targetAuthority &&
    !sameTargetAuthority(replay.targetAuthority, recordValue.targetAuthority)
  ) {
    fail(
      context,
      'backend-migration-ledger-drift-authority-stale',
      `${path}.targetAuthority`,
      'Drift evidence authority does not match the environment history.'
    )
  }
  if (recordValue.expectedSchemaDigest !== replay.schemaDigest) {
    fail(
      context,
      'backend-migration-ledger-drift-baseline-stale',
      `${path}.expectedSchemaDigest`,
      'Drift evidence baseline does not match the environment history.'
    )
  }
  replay.targetAuthority ??= recordValue.targetAuthority
  replay.schemaDigest ??= recordValue.observedSchemaDigest
  replay.observedSchemaDigest = recordValue.observedSchemaDigest
  replay.drift = recordValue.status
  replay.lastEnvironmentEvent = {
    kind: 'drift',
    id: recordValue.driftId,
    at: recordValue.checkedAt,
    driftReceiptDigest: recordValue.providerReceiptDigest,
    driftRecord: recordValue
  }
}

// oxlint-disable-next-line complexity -- Full history replay must report every independent promotion invariant instead of failing at the first mismatch.
function replayPromotionRecord(
  replayByEnvironment: Map<SourceMigrationEnvironment, ReplayedEnvironmentState>,
  seenPromotions: SourceMigrationPromotionRecordV1[],
  entryById: ReadonlyMap<string, SourceMigrationLedgerEntryV1>,
  promotion: SourceMigrationPromotionRecordV1,
  path: string,
  context: BackendValidationContext
): void {
  const target = replayByEnvironment.get(promotion.to)
  const entry = entryById.get(promotion.migrationId)
  if (!target || !entry) return
  if (entry.registeredAt.localeCompare(promotion.promotedAt, 'en') >= 0) {
    fail(
      context,
      'backend-migration-ledger-promotion-predates-source',
      `${path}.promotedAt`,
      'Promotion must follow registration of its immutable source migration.'
    )
  }
  if (!target.targetAuthority) {
    fail(
      context,
      'backend-migration-ledger-environment-authority-missing',
      `${path}.targetAuthority`,
      'Promotion requires a previously inspected target environment authority.'
    )
  } else if (!sameTargetAuthority(target.targetAuthority, promotion.targetAuthority)) {
    fail(
      context,
      'backend-migration-ledger-execution-receipt-authority-mismatch',
      `${path}.targetAuthority`,
      'Promotion authority does not match the environment history.'
    )
  }
  if (target.drift !== 'none') {
    fail(
      context,
      'backend-migration-ledger-drift-blocked',
      path,
      'Promotion history requires current no-drift evidence for its target environment.'
    )
  }
  const nextEntry = [...entryById.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .at(target.appliedMigrationIds.length)
  if (!nextEntry || nextEntry.migrationId !== entry.migrationId) {
    fail(
      context,
      'backend-migration-ledger-promotion-order-invalid',
      `${path}.migrationId`,
      'Promotion history must apply the next source-ledger migration.'
    )
  }
  if (promotion.from !== 'source') {
    const source = replayByEnvironment.get(promotion.from)
    if (!source?.appliedMigrationIds.includes(entry.migrationId)) {
      fail(
        context,
        'backend-migration-ledger-source-environment-behind',
        `${path}.from`,
        'Promotion source environment had not applied this migration.'
      )
    }
    if (source?.drift !== 'none') {
      fail(
        context,
        'backend-migration-ledger-source-drift-blocked',
        `${path}.from`,
        'Promotion source environment must have current no-drift evidence.'
      )
    }
    const sourcePromotion = [...seenPromotions]
      .reverse()
      .find(
        (candidate) =>
          candidate.to === promotion.from && candidate.migrationId === promotion.migrationId
      )
    if (
      sourcePromotion?.executionReceipt.outcome !== 'succeeded' ||
      sourcePromotion.schemaAfterDigest !== promotion.schemaAfterDigest
    ) {
      fail(
        context,
        'backend-migration-ledger-source-schema-mismatch',
        `${path}.schemaAfterDigest`,
        'Promotion result must equal the successful schema result proven for this migration in its source environment.'
      )
    }
  }
  if (promotion.schemaBeforeDigest !== target.schemaDigest) {
    fail(
      context,
      'backend-migration-ledger-schema-before-mismatch',
      `${path}.schemaBeforeDigest`,
      'Promotion schema-before digest does not match the environment history.'
    )
  }
  if (entry.executionPlan.predecessor) {
    const previousMigrationId = target.appliedMigrationIds.at(-1)
    const previousPromotion = [...seenPromotions]
      .reverse()
      .find(
        (candidate) =>
          candidate.to === promotion.to && candidate.migrationId === previousMigrationId
      )
    if (
      previousPromotion?.executionReceipt.outcome !== 'succeeded' ||
      previousPromotion.executionReceipt.executionPlanDigest !==
        entry.executionPlan.predecessor.executionPlanDigest ||
      target.lastReceiptDigest !== previousPromotion.executionReceiptDigest
    ) {
      fail(
        context,
        'backend-migration-ledger-predecessor-receipt-required',
        `${path}.executionReceipt`,
        'Promotion history lacks the required successful predecessor receipt.'
      )
    }
  }
  target.appliedMigrationIds.push(entry.migrationId)
  target.schemaDigest = promotion.schemaAfterDigest
  target.observedSchemaDigest = promotion.schemaAfterDigest
  target.lastReceiptDigest = promotion.executionReceiptDigest
  target.drift = 'none'
  target.lastEnvironmentEvent = {
    kind: 'promotion',
    id: promotion.promotionId,
    at: promotion.promotedAt,
    driftReceiptDigest: null,
    driftRecord: null
  }
  seenPromotions.push(promotion)
}

function replayRecoveryRecord(
  replayByEnvironment: Map<SourceMigrationEnvironment, ReplayedEnvironmentState>,
  seenPromotions: readonly SourceMigrationPromotionRecordV1[],
  entryById: ReadonlyMap<string, SourceMigrationLedgerEntryV1>,
  recovery: SourceMigrationRecoveryRecordV1,
  path: string,
  context: BackendValidationContext
): void {
  const current = replayByEnvironment.get(recovery.environment)
  if (!current) return
  if (
    !current.targetAuthority ||
    !sameTargetAuthority(current.targetAuthority, recovery.targetAuthority)
  ) {
    fail(
      context,
      'backend-migration-ledger-recovery-authority-mismatch',
      `${path}.targetAuthority`,
      'Recovery authority does not match the environment history.'
    )
  }
  const recoverySourceSchemaDigest =
    current.drift === 'detected' ? current.observedSchemaDigest : current.schemaDigest
  if (recoverySourceSchemaDigest !== recovery.fromSchemaDigest) {
    fail(
      context,
      'backend-migration-ledger-recovery-schema-stale',
      `${path}.fromSchemaDigest`,
      'Recovery from-schema digest does not match the environment history.'
    )
  }
  if (!isPrefix(recovery.resultingAppliedMigrationIds, current.appliedMigrationIds)) {
    fail(
      context,
      'backend-migration-ledger-recovery-prefix-invalid',
      `${path}.resultingAppliedMigrationIds`,
      'Recovery result must rewind or preserve the environment history prefix.'
    )
  }
  const removed = current.appliedMigrationIds.slice(recovery.resultingAppliedMigrationIds.length)
  if (!sameStrings(removed, recovery.removedMigrationIds)) {
    fail(
      context,
      'backend-migration-ledger-recovery-removed-mismatch',
      `${path}.removedMigrationIds`,
      'Recovery removed migrations do not match the environment history suffix.'
    )
  }
  if (
    recoveryLeavesDownstreamAhead(
      recovery.environment,
      recovery.resultingAppliedMigrationIds,
      (environment) => replayByEnvironment.get(environment)?.appliedMigrationIds ?? []
    )
  ) {
    fail(
      context,
      'backend-migration-ledger-recovery-downstream-ahead',
      `${path}.resultingAppliedMigrationIds`,
      'Recovery must first rewind every downstream environment to preserve production as a prefix of staging and staging as a prefix of dev.'
    )
  }
  if (recovery.kind === 'rollback' && removed.length !== 1) {
    fail(
      context,
      'backend-migration-ledger-rollback-count-invalid',
      `${path}.removedMigrationIds`,
      'Rollback history must remove exactly the latest migration.'
    )
  }
  if (recovery.kind === 'restore' && current.drift !== 'detected') {
    fail(
      context,
      'backend-migration-ledger-restore-unnecessary',
      path,
      'Restore history must repair detected drift; a healthy environment must use one-step rollback.'
    )
  }
  const expectedTargetSchemaDigest = expectedRecoveryTargetSchemaDigest(
    current.appliedMigrationIds,
    current.schemaDigest,
    seenPromotions,
    recovery.environment,
    recovery.resultingAppliedMigrationIds
  )
  if (recovery.toSchemaDigest !== expectedTargetSchemaDigest) {
    fail(
      context,
      'backend-migration-ledger-recovery-target-schema-mismatch',
      `${path}.toSchemaDigest`,
      'Recovery target schema must equal the previously proven schema for its resulting source prefix.'
    )
  }
  for (const migrationId of recovery.removedMigrationIds) {
    const entry = entryById.get(migrationId)
    if (entry && entry.registeredAt.localeCompare(recovery.recordedAt, 'en') >= 0) {
      fail(
        context,
        'backend-migration-ledger-recovery-predates-source',
        `${path}.recordedAt`,
        'Recovery cannot reference a migration that was not yet registered.'
      )
    }
  }
  current.appliedMigrationIds = [...recovery.resultingAppliedMigrationIds]
  current.schemaDigest = recovery.toSchemaDigest
  current.observedSchemaDigest = recovery.toSchemaDigest
  current.lastReceiptDigest = replayLastReceipt(
    seenPromotions,
    recovery.environment,
    recovery.resultingAppliedMigrationIds
  )
  current.drift = 'none'
  current.lastEnvironmentEvent = {
    kind: 'recovery',
    id: recovery.recoveryId,
    at: recovery.recordedAt,
    driftReceiptDigest: null,
    driftRecord: null
  }
}

function replayAuthorityRebindRecord(
  replay: ReplayedEnvironmentState,
  rebind: SourceMigrationAuthorityRebindRecordV1,
  path: string,
  context: BackendValidationContext
): void {
  if (
    !replay.targetAuthority ||
    !sameTargetAuthority(replay.targetAuthority, rebind.previousTargetAuthority)
  ) {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-previous-stale',
      `${path}.previousTargetAuthority`,
      'Rebind previous authority must equal the authority derived from earlier history.'
    )
  }
  if (replay.schemaDigest !== rebind.schemaDigest) {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-schema-stale',
      `${path}.schemaDigest`,
      'Authority rebind schema must equal the current ledger schema.'
    )
  }
  if (
    !replay.lastEnvironmentEvent?.driftRecord ||
    replay.lastEnvironmentEvent.driftRecord.status !== 'none' ||
    replay.lastEnvironmentEvent.driftRecord.expectedSchemaDigest !== replay.schemaDigest ||
    replay.lastEnvironmentEvent.driftRecord.observedSchemaDigest !== replay.schemaDigest ||
    !sameTargetAuthority(
      replay.lastEnvironmentEvent.driftRecord.targetAuthority,
      rebind.previousTargetAuthority
    ) ||
    replay.drift !== 'none' ||
    replay.lastEnvironmentEvent.kind !== 'drift' ||
    replay.lastEnvironmentEvent.id !== rebind.latestNoDriftId ||
    replay.lastEnvironmentEvent.driftReceiptDigest !== rebind.latestNoDriftReceiptDigest
  ) {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-no-drift-stale',
      `${path}.latestNoDriftId`,
      'Authority rebind requires the latest environment event to be its exact successful no-drift observation.'
    )
  }
  if (
    replay.lastEnvironmentEvent &&
    rebind.previousAuthorityReceipt.checkedAt.localeCompare(replay.lastEnvironmentEvent.at, 'en') <
      0
  ) {
    fail(
      context,
      'backend-migration-ledger-authority-rebind-proof-stale',
      `${path}.previousAuthorityReceipt.checkedAt`,
      'Both Provider authority proofs must follow the latest no-drift observation.'
    )
  }
  replay.targetAuthority = rebind.nextTargetAuthority
  replay.observedSchemaDigest = rebind.schemaDigest
  replay.drift = 'none'
  replay.lastEnvironmentEvent = {
    kind: 'authority-rebind',
    id: rebind.rebindId,
    at: rebind.reboundAt,
    driftReceiptDigest: null,
    driftRecord: null
  }
}

function validateReplayedEnvironmentState(
  state: SourceMigrationLedgerV1,
  context: BackendValidationContext
): void {
  const replayByEnvironment = new Map<SourceMigrationEnvironment, ReplayedEnvironmentState>(
    ENVIRONMENTS.map((environment) => [
      environment,
      {
        targetAuthority: null,
        appliedMigrationIds: [],
        schemaDigest: null,
        observedSchemaDigest: null,
        lastReceiptDigest: null,
        drift: 'unknown',
        lastEnvironmentEvent: null
      }
    ])
  )
  const entryById = new Map(state.entries.map((entry) => [entry.migrationId, entry]))
  const history: EnvironmentHistoryEvent[] = [
    ...state.driftRecords.map(
      (record): EnvironmentHistoryEvent => ({
        kind: 'drift',
        at: record.checkedAt,
        id: record.driftId,
        record
      })
    ),
    ...state.promotions.map(
      (record): EnvironmentHistoryEvent => ({
        kind: 'promotion',
        at: record.promotedAt,
        id: record.promotionId,
        record
      })
    ),
    ...state.recoveryRecords.map(
      (record): EnvironmentHistoryEvent => ({
        kind: 'recovery',
        at: record.recordedAt,
        id: record.recoveryId,
        record
      })
    ),
    ...state.authorityRebindings.map(
      (record): EnvironmentHistoryEvent => ({
        kind: 'authority-rebind',
        at: record.reboundAt,
        id: record.rebindId,
        record
      })
    )
  ].sort(
    (left, right) => left.at.localeCompare(right.at, 'en') || left.id.localeCompare(right.id, 'en')
  )
  const seenPromotions: SourceMigrationPromotionRecordV1[] = []
  for (const [index, event] of history.entries()) {
    const path = `$.history[${index}]`
    if (event.kind === 'drift') {
      const replay = replayByEnvironment.get(event.record.environment)
      if (replay) replayDriftRecord(replay, event.record, path, context)
    } else if (event.kind === 'promotion') {
      replayPromotionRecord(
        replayByEnvironment,
        seenPromotions,
        entryById,
        event.record,
        path,
        context
      )
    } else if (event.kind === 'recovery') {
      replayRecoveryRecord(
        replayByEnvironment,
        seenPromotions,
        entryById,
        event.record,
        path,
        context
      )
    } else {
      const replay = replayByEnvironment.get(event.record.environment)
      if (replay) replayAuthorityRebindRecord(replay, event.record, path, context)
    }
  }
  state.environments.forEach((actual, index) => {
    const replayed = replayByEnvironment.get(actual.environment)
    if (
      !replayed ||
      !sameNullableTargetAuthority(actual.targetAuthority, replayed.targetAuthority) ||
      !sameStrings(actual.appliedMigrationIds, replayed.appliedMigrationIds) ||
      actual.schemaDigest !== replayed.schemaDigest ||
      actual.lastReceiptDigest !== replayed.lastReceiptDigest ||
      actual.drift !== replayed.drift
    ) {
      fail(
        context,
        'backend-migration-ledger-environment-state-mismatch',
        `$.environments[${index}]`,
        'Environment state must be exactly derived from immutable drift, promotion, and recovery history.'
      )
    }
  })
}

function validateApprovalClaim(
  approval: SourceMigrationHumanApprovalV1 | null,
  required: readonly SourceMigrationApprovalScope[],
  path: string,
  context: BackendValidationContext,
  actionAt?: string
): void {
  if (required.length === 0 && approval !== null) {
    fail(
      context,
      'backend-migration-ledger-approval-unexpected',
      path,
      'Approval is allowed only for a protected production or destructive action.'
    )
    return
  }
  if (required.length > 0 && approval === null) {
    fail(
      context,
      'backend-migration-ledger-approval-required',
      path,
      'Protected production or destructive actions require explicit human approval evidence.'
    )
    return
  }
  if (approval && !sameStrings(approval.scopes, required)) {
    fail(
      context,
      'backend-migration-ledger-approval-scope-mismatch',
      `${path}.scopes`,
      'Approval scopes must exactly match the protected action.'
    )
  }
  if (approval && actionAt && approval.approvedAt.localeCompare(actionAt, 'en') > 0) {
    fail(
      context,
      'backend-migration-ledger-approval-future',
      `${path}.approvedAt`,
      'Human approval must be recorded no later than the protected action.'
    )
  }
}

function validateStateInvariants(
  state: SourceMigrationLedgerV1,
  context: BackendValidationContext
): void {
  validateHistoryTimeline(state, context)
  const entryIds = state.entries.map((entry) => entry.migrationId)
  uniqueBy(entryIds, '$.entries', context, 'migration id')
  uniqueBy(
    state.entries.map((entry) => entry.source.path),
    '$.entries',
    context,
    'source migration path'
  )
  uniqueBy(
    state.entries.map((entry) => String(entry.sequence)),
    '$.entries',
    context,
    'migration sequence'
  )
  uniqueBy(
    state.promotions.map((entry) => entry.executionReceipt.receiptId),
    '$.promotions',
    context,
    'execution receipt id'
  )
  uniqueBy(
    state.promotions.map((entry) => entry.executionReceiptDigest),
    '$.promotions',
    context,
    'execution receipt digest'
  )
  uniqueBy(
    state.driftRecords.map((entry) => entry.providerReceipt.receiptId),
    '$.driftRecords',
    context,
    'provider drift receipt id'
  )
  uniqueBy(
    state.driftRecords.map((entry) => entry.providerReceiptDigest),
    '$.driftRecords',
    context,
    'provider drift receipt digest'
  )
  uniqueBy(
    state.recoveryRecords.map((entry) => entry.providerReceiptDigest),
    '$.recoveryRecords',
    context,
    'provider recovery receipt digest'
  )
  uniqueBy(
    state.recoveryRecords.map((entry) => entry.providerReceipt.receiptId),
    '$.recoveryRecords',
    context,
    'provider recovery receipt id'
  )
  uniqueBy(
    state.authorityRebindings.map((entry) => entry.rebindId),
    '$.authorityRebindings',
    context,
    'authority rebind id'
  )
  uniqueBy(
    state.authorityRebindings.flatMap((entry) => [
      entry.previousAuthorityReceipt.receiptId,
      entry.nextAuthorityReceipt.receiptId
    ]),
    '$.authorityRebindings',
    context,
    'authority rebind receipt id'
  )
  uniqueBy(
    state.authorityRebindings.flatMap((entry) => [
      entry.previousAuthorityReceiptDigest,
      entry.nextAuthorityReceiptDigest
    ]),
    '$.authorityRebindings',
    context,
    'authority rebind receipt digest'
  )
  uniqueBy(
    state.authorityRebindings.flatMap((entry) => [
      entry.previousAuthorityReceipt.evidenceDigest,
      entry.nextAuthorityReceipt.evidenceDigest
    ]),
    '$.authorityRebindings',
    context,
    'authority rebind Provider evidence digest'
  )
  uniqueBy(
    [...state.promotions, ...state.recoveryRecords, ...state.authorityRebindings]
      .map((entry) => entry.approval?.evidenceDigest)
      .filter((entry): entry is string => entry !== undefined),
    '$.history',
    context,
    'human approval evidence digest'
  )
  state.entries.forEach((entry, index) => {
    if (entry.sequence !== index + 1)
      fail(
        context,
        'backend-migration-ledger-sequence-gap',
        `$.entries[${index}].sequence`,
        'Migration sequences must be contiguous from one.'
      )
    const previous = index > 0 ? state.entries.at(index - 1) : undefined
    if (entry.executionPlan.phase === 'expand' && entry.executionPlan.predecessor !== null) {
      fail(
        context,
        'backend-migration-ledger-phase-chain-invalid',
        `$.entries[${index}].executionPlan.predecessor`,
        'Expand cannot have a predecessor.'
      )
    }
    if (entry.executionPlan.phase !== 'expand') {
      const requiredPhase = entry.executionPlan.phase === 'backfill' ? 'expand' : 'backfill'
      if (
        !previous ||
        previous.executionPlan.changeId !== entry.executionPlan.changeId ||
        previous.executionPlan.phase !== requiredPhase ||
        entry.executionPlan.predecessor?.executionPlanDigest !== previous.executionPlanDigest
      ) {
        fail(
          context,
          'backend-migration-ledger-phase-chain-invalid',
          `$.entries[${index}].executionPlan.predecessor`,
          'Backfill and contract must immediately follow the matching predecessor plan digest.'
        )
      }
    }
  })
  for (const [index, environment] of state.environments.entries()) {
    if (!isPrefix(environment.appliedMigrationIds, entryIds)) {
      fail(
        context,
        'backend-migration-ledger-applied-prefix-invalid',
        `$.environments[${index}].appliedMigrationIds`,
        'Applied migrations must be a contiguous source-ledger prefix.'
      )
    }
    const latestMigrationId = environment.appliedMigrationIds.at(-1)
    const expectedReceiptDigest = latestMigrationId
      ? [...state.promotions]
          .reverse()
          .find(
            (promotion) =>
              promotion.to === environment.environment &&
              promotion.migrationId === latestMigrationId
          )?.executionReceiptDigest
      : null
    if ((expectedReceiptDigest ?? null) !== environment.lastReceiptDigest) {
      fail(
        context,
        'backend-migration-ledger-last-receipt-mismatch',
        `$.environments[${index}].lastReceiptDigest`,
        'Last receipt must identify the latest applied source migration in this environment.'
      )
    }
  }
  const entryById = new Map(state.entries.map((entry) => [entry.migrationId, entry]))
  state.promotions.forEach((promotion, index) => {
    const entry = entryById.get(promotion.migrationId)
    const receipt = promotion.executionReceipt
    if (receipt.outcome !== 'succeeded') {
      fail(
        context,
        'backend-migration-ledger-execution-receipt-not-succeeded',
        `$.promotions[${index}].executionReceipt.outcome`,
        'Only a successful execution Receipt may enter promotion history.'
      )
    }
    if (receipt.evidenceDigest !== promotion.evidenceDigest) {
      fail(
        context,
        'backend-migration-ledger-execution-receipt-evidence-mismatch',
        `$.promotions[${index}].evidenceDigest`,
        'Promotion evidence must equal the evidence bound into its execution Receipt.'
      )
    }
    if (
      receipt.promotionFrom !== promotion.from ||
      receipt.targetAuthority.environment !== promotion.to ||
      !sameTargetAuthority(receipt.targetAuthority, promotion.targetAuthority) ||
      receipt.schemaBeforeDigest !== promotion.schemaBeforeDigest ||
      receipt.schemaAfterDigest !== promotion.schemaAfterDigest
    ) {
      fail(
        context,
        'backend-migration-ledger-execution-receipt-target-mismatch',
        `$.promotions[${index}].executionReceipt`,
        'Execution receipt must exactly bind the promotion source, target, and schema transition.'
      )
    }
    if (receipt.recordedAt !== promotion.promotedAt) {
      fail(
        context,
        'backend-migration-ledger-execution-receipt-time-mismatch',
        `$.promotions[${index}].executionReceipt.recordedAt`,
        'Execution receipt timestamp must equal the immutable promotion timestamp.'
      )
    }
    if (!entry)
      fail(
        context,
        'backend-migration-ledger-entry-missing',
        `$.promotions[${index}].migrationId`,
        'Promotion must reference a source migration entry.'
      )
    if (entry)
      validateApprovalClaim(
        promotion.approval,
        requiredApprovalScopes(promotion.to, [entry]),
        `$.promotions[${index}].approval`,
        context,
        promotion.promotedAt
      )
  })
  state.recoveryRecords.forEach((recovery, index) => {
    const removed = recovery.removedMigrationIds
      .map((migrationId) => entryById.get(migrationId))
      .filter((entry): entry is SourceMigrationLedgerEntryV1 => entry !== undefined)
    if (removed.length !== recovery.removedMigrationIds.length)
      fail(
        context,
        'backend-migration-ledger-entry-missing',
        `$.recoveryRecords[${index}].removedMigrationIds`,
        'Recovery must reference source migration entries.'
      )
    validateApprovalClaim(
      recovery.approval,
      requiredRecoveryApprovalScopes(recovery.environment),
      `$.recoveryRecords[${index}].approval`,
      context,
      recovery.recordedAt
    )
  })
  state.authorityRebindings.forEach((rebind, index) => {
    validateApprovalClaim(
      rebind.approval,
      requiredAuthorityRebindApprovalScopes(rebind.environment),
      `$.authorityRebindings[${index}].approval`,
      context,
      rebind.reboundAt
    )
  })
  validateReplayedEnvironmentState(state, context)
  const latestRecordAt = [
    state.createdAt,
    ...state.entries.map((entry) => entry.registeredAt),
    ...state.promotions.map((entry) => entry.promotedAt),
    ...state.driftRecords.map((entry) => entry.checkedAt),
    ...state.recoveryRecords.map((entry) => entry.recordedAt),
    ...state.authorityRebindings.map((entry) => entry.reboundAt)
  ]
    .sort((left, right) => left.localeCompare(right, 'en'))
    .at(-1)
  if (latestRecordAt !== state.updatedAt) {
    fail(
      context,
      'backend-migration-ledger-updated-at-mismatch',
      '$.updatedAt',
      'Ledger updatedAt must equal its latest immutable source, promotion, drift, recovery, or authority rebind record.'
    )
  }
}

// oxlint-disable-next-line complexity -- Ledger parsing normalizes every bounded immutable history collection before invariant replay.
function parseLedger(
  value: unknown,
  context: BackendValidationContext
): SourceMigrationLedgerV1 | undefined {
  const ledgerFields = [
    'format',
    'version',
    'ledgerId',
    'entries',
    'environments',
    'promotions',
    'driftRecords',
    'recoveryRecords',
    'authorityRebindings',
    'createdAt',
    'updatedAt'
  ] as const
  const source = record(value, '$', context, ledgerFields, [
    'format',
    'version',
    'ledgerId',
    'entries',
    'environments',
    'promotions',
    'driftRecords',
    'recoveryRecords',
    'createdAt',
    'updatedAt'
  ])
  if (!source) return undefined
  if (source.format !== SOURCE_MIGRATION_LEDGER_FORMAT)
    fail(
      context,
      'backend-migration-ledger-format-unsupported',
      '$.format',
      'Source migration ledger format is not supported.'
    )
  if (source.version !== SOURCE_MIGRATION_LEDGER_VERSION)
    fail(
      context,
      'backend-migration-ledger-version-unsupported',
      '$.version',
      'Source migration ledger version is not supported.'
    )
  const ledgerId = id(source.ledgerId, '$.ledgerId', context)
  const createdAt = timestamp(source.createdAt, '$.createdAt', context)
  const updatedAt = timestamp(source.updatedAt, '$.updatedAt', context)
  const rawEntries = array(
    source.entries,
    '$.entries',
    context,
    BACKEND_LIMITS.maxMigrationOperations
  )
  const entries = (rawEntries ?? [])
    .map((entry, index) => parseEntry(entry, `$.entries[${index}]`, context))
    .filter((entry): entry is SourceMigrationLedgerEntryV1 => entry !== undefined)
  const normalizedEntries = entries.sort(
    (left, right) =>
      left.sequence - right.sequence || left.migrationId.localeCompare(right.migrationId, 'en')
  )
  const rawEnvironments = array(source.environments, '$.environments', context, ENVIRONMENTS.length)
  const environments = (rawEnvironments ?? [])
    .map((entry, index) => parseEnvironmentState(entry, `$.environments[${index}]`, context))
    .filter((entry): entry is SourceMigrationEnvironmentStateV1 => entry !== undefined)
  uniqueBy(
    environments.map((entry) => entry.environment),
    '$.environments',
    context,
    'environment state'
  )
  if (
    environments.length !== ENVIRONMENTS.length ||
    !ENVIRONMENTS.every((entry) =>
      environments.some((environment) => environment.environment === entry)
    )
  ) {
    fail(
      context,
      'backend-migration-ledger-environments-incomplete',
      '$.environments',
      'Ledger must contain exactly dev, staging, and production states.'
    )
  }
  const normalizedEnvironments = environments.sort(
    (left, right) =>
      ENVIRONMENTS.indexOf(left.environment) - ENVIRONMENTS.indexOf(right.environment)
  )
  const rawPromotions = array(
    source.promotions,
    '$.promotions',
    context,
    BACKEND_LIMITS.maxMigrationOperations
  )
  const promotions = (rawPromotions ?? [])
    .map((entry, index) => parsePromotion(entry, `$.promotions[${index}]`, context))
    .filter((entry): entry is SourceMigrationPromotionRecordV1 => entry !== undefined)
  uniqueBy(
    promotions.map((entry) => entry.promotionId),
    '$.promotions',
    context,
    'promotion id'
  )
  const rawDrifts = array(
    source.driftRecords,
    '$.driftRecords',
    context,
    BACKEND_LIMITS.maxMigrationOperations
  )
  const driftRecords = (rawDrifts ?? [])
    .map((entry, index) => parseDriftRecord(entry, `$.driftRecords[${index}]`, context))
    .filter((entry): entry is SourceMigrationDriftRecordV1 => entry !== undefined)
  uniqueBy(
    driftRecords.map((entry) => entry.driftId),
    '$.driftRecords',
    context,
    'drift record id'
  )
  const rawRecoveries = array(
    source.recoveryRecords,
    '$.recoveryRecords',
    context,
    BACKEND_LIMITS.maxMigrationOperations
  )
  const recoveryRecords = (rawRecoveries ?? [])
    .map((entry, index) => parseRecovery(entry, `$.recoveryRecords[${index}]`, context))
    .filter((entry): entry is SourceMigrationRecoveryRecordV1 => entry !== undefined)
  uniqueBy(
    recoveryRecords.map((entry) => entry.recoveryId),
    '$.recoveryRecords',
    context,
    'recovery record id'
  )
  const rawAuthorityRebindings =
    source.authorityRebindings === undefined
      ? []
      : array(
          source.authorityRebindings,
          '$.authorityRebindings',
          context,
          BACKEND_LIMITS.maxMigrationOperations
        )
  const authorityRebindings = (rawAuthorityRebindings ?? [])
    .map((entry, index) => parseAuthorityRebind(entry, `$.authorityRebindings[${index}]`, context))
    .filter((entry): entry is SourceMigrationAuthorityRebindRecordV1 => entry !== undefined)
  uniqueBy(
    authorityRebindings.map((entry) => entry.rebindId),
    '$.authorityRebindings',
    context,
    'authority rebind id'
  )
  if (
    source.format !== SOURCE_MIGRATION_LEDGER_FORMAT ||
    source.version !== SOURCE_MIGRATION_LEDGER_VERSION ||
    !ledgerId ||
    !createdAt ||
    !updatedAt ||
    !rawEntries ||
    entries.length !== rawEntries.length ||
    !rawEnvironments ||
    environments.length !== rawEnvironments.length ||
    !rawPromotions ||
    promotions.length !== rawPromotions.length ||
    !rawDrifts ||
    driftRecords.length !== rawDrifts.length ||
    !rawRecoveries ||
    recoveryRecords.length !== rawRecoveries.length ||
    !rawAuthorityRebindings ||
    authorityRebindings.length !== rawAuthorityRebindings.length
  )
    return undefined
  const parsed: SourceMigrationLedgerV1 = {
    format: SOURCE_MIGRATION_LEDGER_FORMAT,
    version: SOURCE_MIGRATION_LEDGER_VERSION,
    ledgerId,
    entries: normalizedEntries,
    environments: normalizedEnvironments,
    promotions: chronological(
      promotions,
      (entry) => entry.promotedAt,
      (entry) => entry.promotionId
    ),
    driftRecords: chronological(
      driftRecords,
      (entry) => entry.checkedAt,
      (entry) => entry.driftId
    ),
    recoveryRecords: chronological(
      recoveryRecords,
      (entry) => entry.recordedAt,
      (entry) => entry.recoveryId
    ),
    authorityRebindings: chronological(
      authorityRebindings,
      (entry) => entry.reboundAt,
      (entry) => entry.rebindId
    ),
    createdAt,
    updatedAt
  }
  validateStateInvariants(parsed, context)
  return context.diagnostics.length === 0 ? parsed : undefined
}

export function validateSourceMigrationLedger(
  value: unknown
): BackendValidationResult<SourceMigrationLedgerV1> {
  const context: BackendValidationContext = { diagnostics: [] }
  if (!assertBoundedBackendData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  if (!assertBackendSecretFreeData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  const parsed = parseLedger(value, context)
  return parsed && context.diagnostics.length === 0
    ? { ok: true, value: parsed, diagnostics: [] }
    : { ok: false, diagnostics: context.diagnostics }
}

function requireLedger(value: unknown): SourceMigrationLedgerV1 {
  const parsed = validateSourceMigrationLedger(value)
  if (!parsed.ok)
    throw new TypeError(
      `Source migration ledger validation failed: ${parsed.diagnostics.map((entry) => entry.code).join(', ')}`
    )
  return parsed.value
}

// oxlint-disable-next-line open-pencil/no-useless-pass-through-wrappers -- Public normalization is an intentional throwing API alongside result-based validation.
export function normalizeSourceMigrationLedger(value: unknown): SourceMigrationLedgerV1 {
  return requireLedger(value)
}

export function canonicalSourceMigrationLedgerBytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(requireLedger(value))
}

// oxlint-disable-next-line complexity -- Integrity verification reports every independent embedded plan and Receipt digest mismatch.
export async function verifySourceMigrationLedgerIntegrity(
  value: unknown
): Promise<BackendValidationResult<SourceMigrationLedgerV1>> {
  const parsed = validateSourceMigrationLedger(value)
  if (!parsed.ok) return parsed
  const diagnostics: BackendDiagnostic[] = []
  for (const [index, entry] of parsed.value.entries.entries()) {
    const actual = await digestStagedMigrationExecutionPlan(entry.executionPlan)
    if (actual !== entry.executionPlanDigest) {
      diagnostics.push({
        code: 'backend-migration-ledger-plan-digest-mismatch',
        severity: 'error',
        path: `$.entries[${index}].executionPlanDigest`,
        message: 'Execution plan digest does not match the embedded canonical plan.'
      })
    }
  }
  for (const [index, drift] of parsed.value.driftRecords.entries()) {
    const actual = await digestSourceMigrationDriftReceipt(drift.providerReceipt)
    if (actual !== drift.providerReceiptDigest) {
      diagnostics.push({
        code: 'backend-migration-ledger-drift-receipt-digest-mismatch',
        severity: 'error',
        path: `$.driftRecords[${index}].providerReceiptDigest`,
        message: 'Drift Receipt digest does not match the embedded canonical Receipt.'
      })
    }
  }
  for (const [index, promotion] of parsed.value.promotions.entries()) {
    const actual = await digestStagedMigrationExecutionReceipt(promotion.executionReceipt)
    if (actual !== promotion.executionReceiptDigest) {
      diagnostics.push({
        code: 'backend-migration-ledger-receipt-digest-mismatch',
        severity: 'error',
        path: `$.promotions[${index}].executionReceiptDigest`,
        message: 'Execution receipt digest does not match the embedded canonical receipt.'
      })
    }
    const entry = parsed.value.entries.find(
      (candidate) => candidate.migrationId === promotion.migrationId
    )
    if (
      entry &&
      (promotion.executionReceipt.executionId !== entry.executionPlan.executionId ||
        promotion.executionReceipt.executionPlanDigest !== entry.executionPlanDigest ||
        promotion.executionReceipt.phase !== entry.executionPlan.phase ||
        promotion.executionReceipt.outcome !== 'succeeded')
    ) {
      diagnostics.push({
        code: 'backend-migration-ledger-execution-receipt-mismatch',
        severity: 'error',
        path: `$.promotions[${index}].executionReceipt`,
        message: 'Promotion receipt must prove successful execution of its exact source plan.'
      })
    }
    if (entry?.executionPlan.predecessor) {
      const predecessorReceipt = parsed.value.promotions
        .slice(0, index)
        .reverse()
        .find(
          (candidate) =>
            candidate.to === promotion.to &&
            candidate.executionReceipt.outcome === 'succeeded' &&
            candidate.executionReceipt.executionPlanDigest ===
              entry.executionPlan.predecessor?.executionPlanDigest
        )
      if (!predecessorReceipt) {
        diagnostics.push({
          code: 'backend-migration-ledger-predecessor-receipt-required',
          severity: 'error',
          path: `$.promotions[${index}].executionReceipt`,
          message:
            'Promotion history lacks the successful predecessor receipt required by this phase.'
        })
      }
    }
  }
  for (const [index, recovery] of parsed.value.recoveryRecords.entries()) {
    const actual = await digestSourceMigrationRecoveryReceipt(recovery.providerReceipt)
    if (actual !== recovery.providerReceiptDigest) {
      diagnostics.push({
        code: 'backend-migration-ledger-recovery-receipt-digest-mismatch',
        severity: 'error',
        path: `$.recoveryRecords[${index}].providerReceiptDigest`,
        message: 'Recovery Receipt digest does not match the embedded canonical Receipt.'
      })
    }
  }
  for (const [index, rebind] of parsed.value.authorityRebindings.entries()) {
    const [previousDigest, nextDigest] = await Promise.all([
      digestSourceMigrationAuthorityRebindReceipt(rebind.previousAuthorityReceipt),
      digestSourceMigrationAuthorityRebindReceipt(rebind.nextAuthorityReceipt)
    ])
    if (previousDigest !== rebind.previousAuthorityReceiptDigest) {
      diagnostics.push({
        code: 'backend-migration-ledger-authority-rebind-receipt-digest-mismatch',
        severity: 'error',
        path: `$.authorityRebindings[${index}].previousAuthorityReceiptDigest`,
        message: 'Previous authority Receipt digest does not match its canonical Receipt.'
      })
    }
    if (nextDigest !== rebind.nextAuthorityReceiptDigest) {
      diagnostics.push({
        code: 'backend-migration-ledger-authority-rebind-receipt-digest-mismatch',
        severity: 'error',
        path: `$.authorityRebindings[${index}].nextAuthorityReceiptDigest`,
        message: 'Next authority Receipt digest does not match its canonical Receipt.'
      })
    }
  }
  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : { ok: true, value: parsed.value, diagnostics: [] }
}

export async function digestSourceMigrationLedger(value: unknown): Promise<string> {
  const verified = await verifySourceMigrationLedgerIntegrity(value)
  if (!verified.ok)
    throw new TypeError(
      `Source migration ledger integrity failed: ${verified.diagnostics.map((entry) => entry.code).join(', ')}`
    )
  return digestCanonicalManifest(verified.value)
}

export function createSourceMigrationLedger(input: {
  ledgerId: string
  createdAt: string
}): SourceMigrationLedgerV1 {
  const empty: SourceMigrationLedgerV1 = {
    format: SOURCE_MIGRATION_LEDGER_FORMAT,
    version: SOURCE_MIGRATION_LEDGER_VERSION,
    ledgerId: input.ledgerId,
    entries: [],
    environments: ENVIRONMENTS.map((environment) => ({
      environment,
      targetAuthority: null,
      appliedMigrationIds: [],
      schemaDigest: null,
      lastReceiptDigest: null,
      drift: 'unknown'
    })),
    promotions: [],
    driftRecords: [],
    recoveryRecords: [],
    authorityRebindings: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  }
  return requireLedger(empty)
}

function isPromotionStep(
  from: SourceMigrationPromotionRecordV1['from'],
  to: SourceMigrationEnvironment
): boolean {
  return (
    (from === 'source' && to === 'dev') ||
    (from === 'dev' && to === 'staging') ||
    (from === 'staging' && to === 'production')
  )
}

function environmentState(
  state: SourceMigrationLedgerV1,
  environment: SourceMigrationEnvironment
): SourceMigrationEnvironmentStateV1 {
  const found = state.environments.find((entry) => entry.environment === environment)
  if (!found)
    transitionError(
      'backend-migration-ledger-environment-missing',
      `Environment ${environment} is missing.`
    )
  return found
}

function replaceEnvironment(
  state: SourceMigrationLedgerV1,
  replacement: SourceMigrationEnvironmentStateV1
): SourceMigrationEnvironmentStateV1[] {
  return state.environments.map((entry) =>
    entry.environment === replacement.environment ? replacement : entry
  )
}

function assertTimestampMatch(eventAt: string, recordAt: string): void {
  if (eventAt !== recordAt)
    transitionError(
      'backend-migration-ledger-event-time-mismatch',
      'Event timestamp must match its immutable record timestamp.'
    )
}

function parseLedgerEvent(
  value: unknown,
  context: BackendValidationContext
): SourceMigrationLedgerEventV1 | undefined {
  const header = record(
    value,
    '$.event',
    context,
    ['type', 'entry', 'record', 'occurredAt'],
    ['type', 'occurredAt']
  )
  if (!header) return undefined
  const type = oneOf(header.type, '$.event.type', context, [
    'register-migration',
    'record-drift',
    'promote-migration',
    'record-recovery',
    'rebind-environment-authority'
  ])
  const occurredAt = timestamp(header.occurredAt, '$.event.occurredAt', context)
  if (!type || !occurredAt) return undefined
  const payload = type === 'register-migration' ? 'entry' : 'record'
  const exact = record(value, '$.event', context, ['type', payload, 'occurredAt'])
  if (!exact || !(payload in exact)) return undefined
  return value as SourceMigrationLedgerEventV1
}

function assertApproval(
  approval: SourceMigrationHumanApprovalV1 | null,
  required: readonly SourceMigrationApprovalScope[],
  actionAt: string
): void {
  if (required.length === 0) {
    if (approval !== null)
      transitionError(
        'backend-migration-ledger-approval-unexpected',
        'Unprotected action cannot carry a privileged approval claim.'
      )
    return
  }
  if (!approval)
    transitionError(
      'backend-migration-ledger-approval-required',
      'Production and destructive actions require explicit human approval evidence.'
    )
  if (!sameStrings(approval.scopes, required))
    transitionError(
      'backend-migration-ledger-approval-scope-mismatch',
      'Approval scopes do not exactly match the protected action.'
    )
  if (approval.approvedAt.localeCompare(actionAt, 'en') > 0)
    transitionError(
      'backend-migration-ledger-approval-future',
      'Human approval must be recorded no later than the protected action.'
    )
}

async function registerMigration(
  state: SourceMigrationLedgerV1,
  event: Extract<SourceMigrationLedgerEventV1, { type: 'register-migration' }>
): Promise<SourceMigrationLedgerV1> {
  assertTimestampMatch(event.occurredAt, event.entry.registeredAt)
  const entryContext: BackendValidationContext = { diagnostics: [] }
  const entry = parseEntry(event.entry, '$.entry', entryContext)
  if (!entry || entryContext.diagnostics.length)
    transitionError(
      'backend-migration-ledger-entry-invalid',
      'Migration entry failed strict validation.'
    )
  if (entry.sequence !== state.entries.length + 1)
    transitionError(
      'backend-migration-ledger-sequence-invalid',
      'Migration entry must append the next contiguous sequence.'
    )
  if (state.entries.some((existing) => existing.migrationId === entry.migrationId))
    transitionError(
      'backend-migration-ledger-entry-duplicate',
      'Migration id is already registered.'
    )
  if (state.entries.some((existing) => existing.source.path === entry.source.path))
    transitionError(
      'backend-migration-ledger-source-path-duplicate',
      'Source migration path is already registered.'
    )
  const actualDigest = await digestStagedMigrationExecutionPlan(entry.executionPlan)
  if (actualDigest !== entry.executionPlanDigest)
    transitionError(
      'backend-migration-ledger-plan-digest-mismatch',
      'Execution plan digest does not match its canonical plan.'
    )
  if (entry.executionPlan.phase !== 'expand') {
    const previous = state.entries.at(-1)
    const requiredPhase = entry.executionPlan.phase === 'backfill' ? 'expand' : 'backfill'
    if (
      !previous ||
      previous.executionPlan.changeId !== entry.executionPlan.changeId ||
      previous.executionPlan.phase !== requiredPhase ||
      entry.executionPlan.predecessor?.executionPlanDigest !== previous.executionPlanDigest
    ) {
      transitionError(
        'backend-migration-ledger-phase-chain-invalid',
        'Backfill and contract entries require the immediately preceding change receipt plan.'
      )
    }
  }
  return requireLedger({
    ...state,
    entries: [...state.entries, entry],
    updatedAt: event.occurredAt
  })
}

async function recordDrift(
  state: SourceMigrationLedgerV1,
  event: Extract<SourceMigrationLedgerEventV1, { type: 'record-drift' }>
): Promise<SourceMigrationLedgerV1> {
  assertTimestampMatch(event.occurredAt, event.record.checkedAt)
  const context: BackendValidationContext = { diagnostics: [] }
  const recordValue = parseDriftRecord(event.record, '$.record', context)
  if (!recordValue || context.diagnostics.length)
    transitionError(
      'backend-migration-ledger-drift-record-invalid',
      'Drift record failed strict validation.'
    )
  const actualReceiptDigest = await digestSourceMigrationDriftReceipt(recordValue.providerReceipt)
  if (actualReceiptDigest !== recordValue.providerReceiptDigest)
    transitionError(
      'backend-migration-ledger-drift-receipt-digest-mismatch',
      'Drift Receipt digest does not match its canonical Receipt.'
    )
  if (state.driftRecords.some((entry) => entry.driftId === recordValue.driftId))
    transitionError(
      'backend-migration-ledger-drift-record-duplicate',
      'Drift record id is already present.'
    )
  if (
    state.driftRecords.some(
      (entry) =>
        entry.providerReceipt.receiptId === recordValue.providerReceipt.receiptId ||
        entry.providerReceiptDigest === recordValue.providerReceiptDigest
    )
  )
    transitionError(
      'backend-migration-ledger-drift-receipt-reused',
      'A provider drift Receipt cannot authorize more than one drift record.'
    )
  const current = environmentState(state, recordValue.environment)
  if (recordValue.expectedSchemaDigest !== current.schemaDigest)
    transitionError(
      'backend-migration-ledger-drift-baseline-stale',
      'Drift check expected digest does not match ledger state.'
    )
  if (
    current.targetAuthority &&
    !sameTargetAuthority(current.targetAuthority, recordValue.targetAuthority)
  )
    transitionError(
      'backend-migration-ledger-drift-authority-stale',
      'Drift evidence authority does not match the environment binding.'
    )
  const schemaDigest = current.schemaDigest ?? recordValue.observedSchemaDigest
  const nextEnvironment: SourceMigrationEnvironmentStateV1 = {
    ...current,
    targetAuthority: current.targetAuthority ?? recordValue.targetAuthority,
    schemaDigest,
    drift: recordValue.status
  }
  return requireLedger({
    ...state,
    environments: replaceEnvironment(state, nextEnvironment),
    driftRecords: [...state.driftRecords, recordValue],
    updatedAt: event.occurredAt
  })
}

function latestEnvironmentHistoryEvent(
  state: SourceMigrationLedgerV1,
  environment: SourceMigrationEnvironment
): EnvironmentHistoryEvent | undefined {
  const events: EnvironmentHistoryEvent[] = [
    ...state.driftRecords
      .filter((record) => record.environment === environment)
      .map(
        (record): EnvironmentHistoryEvent => ({
          kind: 'drift',
          at: record.checkedAt,
          id: record.driftId,
          record
        })
      ),
    ...state.promotions
      .filter((record) => record.to === environment)
      .map(
        (record): EnvironmentHistoryEvent => ({
          kind: 'promotion',
          at: record.promotedAt,
          id: record.promotionId,
          record
        })
      ),
    ...state.recoveryRecords
      .filter((record) => record.environment === environment)
      .map(
        (record): EnvironmentHistoryEvent => ({
          kind: 'recovery',
          at: record.recordedAt,
          id: record.recoveryId,
          record
        })
      ),
    ...state.authorityRebindings
      .filter((record) => record.environment === environment)
      .map(
        (record): EnvironmentHistoryEvent => ({
          kind: 'authority-rebind',
          at: record.reboundAt,
          id: record.rebindId,
          record
        })
      )
  ]
  return events
    .sort(
      (left, right) =>
        left.at.localeCompare(right.at, 'en') || left.id.localeCompare(right.id, 'en')
    )
    .at(-1)
}

// oxlint-disable-next-line complexity -- Rotation must validate the full prior state plus two independent canonical Provider proofs before one append-only rebind.
async function rebindEnvironmentAuthority(
  state: SourceMigrationLedgerV1,
  event: Extract<SourceMigrationLedgerEventV1, { type: 'rebind-environment-authority' }>
): Promise<SourceMigrationLedgerV1> {
  assertTimestampMatch(event.occurredAt, event.record.reboundAt)
  const context: BackendValidationContext = { diagnostics: [] }
  const rebind = parseAuthorityRebind(event.record, '$.record', context)
  if (!rebind || context.diagnostics.length)
    transitionError(
      'backend-migration-ledger-authority-rebind-record-invalid',
      'Authority rebind record failed strict validation.'
    )
  if (state.authorityRebindings.some((entry) => entry.rebindId === rebind.rebindId))
    transitionError(
      'backend-migration-ledger-authority-rebind-duplicate',
      'Authority rebind id is already present.'
    )
  const existingReceiptIds = new Set(
    state.authorityRebindings.flatMap((entry) => [
      entry.previousAuthorityReceipt.receiptId,
      entry.nextAuthorityReceipt.receiptId
    ])
  )
  const existingReceiptDigests = new Set(
    state.authorityRebindings.flatMap((entry) => [
      entry.previousAuthorityReceiptDigest,
      entry.nextAuthorityReceiptDigest
    ])
  )
  const existingEvidenceDigests = new Set(
    state.authorityRebindings.flatMap((entry) => [
      entry.previousAuthorityReceipt.evidenceDigest,
      entry.nextAuthorityReceipt.evidenceDigest
    ])
  )
  if (
    existingReceiptIds.has(rebind.previousAuthorityReceipt.receiptId) ||
    existingReceiptIds.has(rebind.nextAuthorityReceipt.receiptId) ||
    existingReceiptDigests.has(rebind.previousAuthorityReceiptDigest) ||
    existingReceiptDigests.has(rebind.nextAuthorityReceiptDigest) ||
    existingEvidenceDigests.has(rebind.previousAuthorityReceipt.evidenceDigest) ||
    existingEvidenceDigests.has(rebind.nextAuthorityReceipt.evidenceDigest)
  ) {
    transitionError(
      'backend-migration-ledger-authority-rebind-receipt-reused',
      'Provider authority proof Receipts cannot authorize more than one rebind.'
    )
  }
  const [previousReceiptDigest, nextReceiptDigest] = await Promise.all([
    digestSourceMigrationAuthorityRebindReceipt(rebind.previousAuthorityReceipt),
    digestSourceMigrationAuthorityRebindReceipt(rebind.nextAuthorityReceipt)
  ])
  if (
    previousReceiptDigest !== rebind.previousAuthorityReceiptDigest ||
    nextReceiptDigest !== rebind.nextAuthorityReceiptDigest
  ) {
    transitionError(
      'backend-migration-ledger-authority-rebind-receipt-digest-mismatch',
      'Provider authority proof digest does not match its canonical Receipt.'
    )
  }
  const current = environmentState(state, rebind.environment)
  if (
    !current.targetAuthority ||
    !sameTargetAuthority(current.targetAuthority, rebind.previousTargetAuthority)
  ) {
    transitionError(
      'backend-migration-ledger-authority-rebind-previous-stale',
      'Rebind previous authority does not match the environment binding.'
    )
  }
  if (
    !sameTargetAuthorityExceptGrantGeneration(
      rebind.previousTargetAuthority,
      rebind.nextTargetAuthority
    ) ||
    rebind.previousTargetAuthority.grantGeneration === rebind.nextTargetAuthority.grantGeneration
  ) {
    transitionError(
      'backend-migration-ledger-authority-rebind-scope-mismatch',
      'Authority rebind may change only grantGeneration, and the generation must change.'
    )
  }
  if (!current.schemaDigest || current.schemaDigest !== rebind.schemaDigest) {
    transitionError(
      'backend-migration-ledger-authority-rebind-schema-stale',
      'Authority rebind schema does not match the current ledger state.'
    )
  }
  const latest = latestEnvironmentHistoryEvent(state, rebind.environment)
  if (
    current.drift !== 'none' ||
    latest?.kind !== 'drift' ||
    latest.record.status !== 'none' ||
    latest.record.driftId !== rebind.latestNoDriftId ||
    latest.record.providerReceiptDigest !== rebind.latestNoDriftReceiptDigest ||
    latest.record.expectedSchemaDigest !== current.schemaDigest ||
    latest.record.observedSchemaDigest !== current.schemaDigest ||
    !sameTargetAuthority(latest.record.targetAuthority, rebind.previousTargetAuthority)
  ) {
    transitionError(
      'backend-migration-ledger-authority-rebind-no-drift-stale',
      'Authority rebind requires the latest environment event to be an exact current no-drift Provider observation.'
    )
  }
  if (rebind.previousAuthorityReceipt.checkedAt.localeCompare(latest.at, 'en') < 0) {
    transitionError(
      'backend-migration-ledger-authority-rebind-proof-stale',
      'Both Provider authority proofs must follow the latest no-drift observation.'
    )
  }
  assertApproval(
    rebind.approval,
    requiredAuthorityRebindApprovalScopes(rebind.environment),
    rebind.reboundAt
  )
  const nextEnvironment: SourceMigrationEnvironmentStateV1 = {
    ...current,
    targetAuthority: rebind.nextTargetAuthority
  }
  return requireLedger({
    ...state,
    environments: replaceEnvironment(state, nextEnvironment),
    authorityRebindings: [...state.authorityRebindings, rebind],
    updatedAt: event.occurredAt
  })
}

// oxlint-disable-next-line complexity -- Promotion is one fail-closed authority funnel for order, drift, Receipt, schema, predecessor, and approval checks.
async function promoteMigration(
  state: SourceMigrationLedgerV1,
  event: Extract<SourceMigrationLedgerEventV1, { type: 'promote-migration' }>
): Promise<SourceMigrationLedgerV1> {
  assertTimestampMatch(event.occurredAt, event.record.promotedAt)
  const context: BackendValidationContext = { diagnostics: [] }
  const promotion = parsePromotion(event.record, '$.record', context)
  if (!promotion || context.diagnostics.length)
    transitionError(
      'backend-migration-ledger-promotion-record-invalid',
      'Promotion record failed strict validation.'
    )
  if (state.promotions.some((entry) => entry.promotionId === promotion.promotionId))
    transitionError(
      'backend-migration-ledger-promotion-duplicate',
      'Promotion id is already present.'
    )
  if (
    state.promotions.some(
      (entry) =>
        entry.executionReceiptDigest === promotion.executionReceiptDigest ||
        entry.executionReceipt.receiptId === promotion.executionReceipt.receiptId
    )
  )
    transitionError(
      'backend-migration-ledger-execution-receipt-reused',
      'An execution receipt cannot authorize more than one promotion.'
    )
  if (!isPromotionStep(promotion.from, promotion.to))
    transitionError(
      'backend-migration-ledger-promotion-step-invalid',
      'Promotion must follow source to dev to staging to production.'
    )
  const entry = state.entries.find((candidate) => candidate.migrationId === promotion.migrationId)
  if (!entry)
    transitionError(
      'backend-migration-ledger-entry-missing',
      'Promotion migration is not present in source control ledger.'
    )
  const target = environmentState(state, promotion.to)
  if (!target.targetAuthority)
    transitionError(
      'backend-migration-ledger-environment-authority-missing',
      'Promotion requires drift evidence bound to the exact provider and remote project authority.'
    )
  if (target.drift !== 'none')
    transitionError(
      'backend-migration-ledger-drift-blocked',
      'Promotion requires a current no-drift record for the target environment.'
    )
  const nextEntry = state.entries.at(target.appliedMigrationIds.length)
  if (!nextEntry || nextEntry.migrationId !== entry.migrationId)
    transitionError(
      'backend-migration-ledger-promotion-order-invalid',
      'Promotion must apply the next source-ledger migration.'
    )
  if (promotion.from !== 'source') {
    const sourceEnvironment = environmentState(state, promotion.from)
    if (!sourceEnvironment.appliedMigrationIds.includes(entry.migrationId))
      transitionError(
        'backend-migration-ledger-source-environment-behind',
        'Source environment has not applied this migration.'
      )
    if (sourceEnvironment.drift !== 'none')
      transitionError(
        'backend-migration-ledger-source-drift-blocked',
        'Promotion requires current no-drift evidence for its source environment.'
      )
  }
  if (promotion.schemaBeforeDigest !== target.schemaDigest)
    transitionError(
      'backend-migration-ledger-schema-before-mismatch',
      'Promotion schema-before digest is stale.'
    )
  const receipt = promotion.executionReceipt
  if (
    receipt.promotionFrom !== promotion.from ||
    receipt.targetAuthority.environment !== promotion.to ||
    !sameTargetAuthority(receipt.targetAuthority, promotion.targetAuthority) ||
    !sameTargetAuthority(promotion.targetAuthority, target.targetAuthority) ||
    receipt.schemaBeforeDigest !== promotion.schemaBeforeDigest ||
    receipt.schemaAfterDigest !== promotion.schemaAfterDigest
  )
    transitionError(
      'backend-migration-ledger-execution-receipt-target-mismatch',
      'Execution receipt does not match the promotion source, target authority, or schema transition.'
    )
  if (receipt.recordedAt !== promotion.promotedAt)
    transitionError(
      'backend-migration-ledger-execution-receipt-time-mismatch',
      'Execution receipt timestamp must equal the immutable promotion timestamp.'
    )
  const actualPlanDigest = await digestStagedMigrationExecutionPlan(entry.executionPlan)
  const actualReceiptDigest = await digestStagedMigrationExecutionReceipt(receipt)
  if (
    entry.executionPlanDigest !== actualPlanDigest ||
    receipt.executionPlanDigest !== actualPlanDigest ||
    receipt.executionId !== entry.executionPlan.executionId ||
    receipt.phase !== entry.executionPlan.phase ||
    receipt.outcome !== 'succeeded'
  ) {
    transitionError(
      'backend-migration-ledger-execution-receipt-mismatch',
      'Successful receipt must bind exactly to the source execution plan.'
    )
  }
  if (receipt.evidenceDigest !== promotion.evidenceDigest)
    transitionError(
      'backend-migration-ledger-execution-receipt-evidence-mismatch',
      'Promotion evidence does not match the canonical execution receipt.'
    )
  if (promotion.executionReceiptDigest !== actualReceiptDigest)
    transitionError(
      'backend-migration-ledger-receipt-digest-mismatch',
      'Execution receipt digest does not match the canonical receipt.'
    )
  if (promotion.from !== 'source') {
    const sourcePromotion = [...state.promotions]
      .reverse()
      .find(
        (candidate) =>
          candidate.to === promotion.from && candidate.migrationId === promotion.migrationId
      )
    if (
      sourcePromotion?.executionReceipt.outcome !== 'succeeded' ||
      sourcePromotion.schemaAfterDigest !== promotion.schemaAfterDigest
    )
      transitionError(
        'backend-migration-ledger-source-schema-mismatch',
        'Promotion result must equal the successful schema result proven for this migration in its source environment.'
      )
  }
  if (entry.executionPlan.predecessor) {
    const previousMigrationId = target.appliedMigrationIds.at(-1)
    const previousPromotion = [...state.promotions]
      .reverse()
      .find(
        (candidate) =>
          candidate.to === promotion.to && candidate.migrationId === previousMigrationId
      )
    if (
      previousPromotion?.executionReceipt.outcome !== 'succeeded' ||
      previousPromotion.executionReceipt.executionPlanDigest !==
        entry.executionPlan.predecessor.executionPlanDigest ||
      target.lastReceiptDigest !== previousPromotion.executionReceiptDigest
    ) {
      transitionError(
        'backend-migration-ledger-predecessor-receipt-required',
        'Target environment lacks the successful predecessor receipt required by this phase.'
      )
    }
  }
  assertApproval(
    promotion.approval,
    requiredApprovalScopes(promotion.to, [entry]),
    promotion.promotedAt
  )
  const nextEnvironment: SourceMigrationEnvironmentStateV1 = {
    ...target,
    appliedMigrationIds: [...target.appliedMigrationIds, entry.migrationId],
    schemaDigest: promotion.schemaAfterDigest,
    lastReceiptDigest: promotion.executionReceiptDigest,
    drift: 'none'
  }
  return requireLedger({
    ...state,
    environments: replaceEnvironment(state, nextEnvironment),
    promotions: [...state.promotions, promotion],
    updatedAt: event.occurredAt
  })
}

function lastReceiptForPrefix(
  state: SourceMigrationLedgerV1,
  environment: SourceMigrationEnvironment,
  appliedMigrationIds: readonly string[]
): string | null {
  const migrationId = appliedMigrationIds.at(-1)
  if (!migrationId) return null
  return (
    [...state.promotions]
      .reverse()
      .find((entry) => entry.to === environment && entry.migrationId === migrationId)
      ?.executionReceiptDigest ?? null
  )
}

function recoverySourceSchemaDigest(
  state: SourceMigrationLedgerV1,
  current: SourceMigrationEnvironmentStateV1
): string | null {
  if (current.drift !== 'detected') return current.schemaDigest
  const latestDrift = [...state.driftRecords]
    .reverse()
    .find((entry) => entry.environment === current.environment)
  return latestDrift?.status === 'detected' ? latestDrift.observedSchemaDigest : null
}

async function recordRecovery(
  state: SourceMigrationLedgerV1,
  event: Extract<SourceMigrationLedgerEventV1, { type: 'record-recovery' }>
): Promise<SourceMigrationLedgerV1> {
  assertTimestampMatch(event.occurredAt, event.record.recordedAt)
  const context: BackendValidationContext = { diagnostics: [] }
  const recovery = parseRecovery(event.record, '$.record', context)
  if (!recovery || context.diagnostics.length)
    transitionError(
      'backend-migration-ledger-recovery-record-invalid',
      'Recovery record failed strict validation.'
    )
  const actualReceiptDigest = await digestSourceMigrationRecoveryReceipt(recovery.providerReceipt)
  if (actualReceiptDigest !== recovery.providerReceiptDigest)
    transitionError(
      'backend-migration-ledger-recovery-receipt-digest-mismatch',
      'Recovery Receipt digest does not match its canonical Receipt.'
    )
  if (state.recoveryRecords.some((entry) => entry.recoveryId === recovery.recoveryId))
    transitionError(
      'backend-migration-ledger-recovery-duplicate',
      'Recovery id is already present.'
    )
  if (
    state.recoveryRecords.some(
      (entry) =>
        entry.providerReceipt.receiptId === recovery.providerReceipt.receiptId ||
        entry.providerReceiptDigest === recovery.providerReceiptDigest
    )
  )
    transitionError(
      'backend-migration-ledger-recovery-receipt-reused',
      'A provider recovery receipt cannot authorize more than one recovery record.'
    )
  const current = environmentState(state, recovery.environment)
  if (
    !current.targetAuthority ||
    !sameTargetAuthority(current.targetAuthority, recovery.targetAuthority)
  )
    transitionError(
      'backend-migration-ledger-recovery-authority-mismatch',
      'Recovery provider receipt authority does not match the environment binding.'
    )
  if (recoverySourceSchemaDigest(state, current) !== recovery.fromSchemaDigest)
    transitionError(
      'backend-migration-ledger-recovery-schema-stale',
      'Recovery from-schema digest does not match the latest observed provider state.'
    )
  if (!isPrefix(recovery.resultingAppliedMigrationIds, current.appliedMigrationIds))
    transitionError(
      'backend-migration-ledger-recovery-prefix-invalid',
      'Recovery result must rewind or preserve the current applied prefix.'
    )
  const removed = current.appliedMigrationIds.slice(recovery.resultingAppliedMigrationIds.length)
  if (!sameStrings(removed, recovery.removedMigrationIds))
    transitionError(
      'backend-migration-ledger-recovery-removed-mismatch',
      'Removed migrations must exactly describe the rewound suffix.'
    )
  if (
    recoveryLeavesDownstreamAhead(
      recovery.environment,
      recovery.resultingAppliedMigrationIds,
      (environment) => environmentState(state, environment).appliedMigrationIds
    )
  )
    transitionError(
      'backend-migration-ledger-recovery-downstream-ahead',
      'Recovery must first rewind every downstream environment to preserve production as a prefix of staging and staging as a prefix of dev.'
    )
  if (recovery.kind === 'rollback' && removed.length !== 1)
    transitionError(
      'backend-migration-ledger-rollback-count-invalid',
      'Rollback must remove exactly the latest migration.'
    )
  if (recovery.kind === 'restore' && current.drift !== 'detected')
    transitionError(
      'backend-migration-ledger-restore-unnecessary',
      'Restore is allowed only to repair detected drift; a healthy environment must use one-step rollback.'
    )
  const expectedTargetSchemaDigest = expectedRecoveryTargetSchemaDigest(
    current.appliedMigrationIds,
    current.schemaDigest,
    state.promotions,
    recovery.environment,
    recovery.resultingAppliedMigrationIds
  )
  if (recovery.toSchemaDigest !== expectedTargetSchemaDigest)
    transitionError(
      'backend-migration-ledger-recovery-target-schema-mismatch',
      'Recovery target schema does not match the previously proven source-prefix schema.'
    )
  assertApproval(
    recovery.approval,
    requiredRecoveryApprovalScopes(recovery.environment),
    recovery.recordedAt
  )
  const nextEnvironment: SourceMigrationEnvironmentStateV1 = {
    ...current,
    appliedMigrationIds: [...recovery.resultingAppliedMigrationIds],
    schemaDigest: recovery.toSchemaDigest,
    lastReceiptDigest: lastReceiptForPrefix(
      state,
      recovery.environment,
      recovery.resultingAppliedMigrationIds
    ),
    drift: 'none'
  }
  return requireLedger({
    ...state,
    environments: replaceEnvironment(state, nextEnvironment),
    recoveryRecords: [...state.recoveryRecords, recovery],
    updatedAt: event.occurredAt
  })
}

export async function transitionSourceMigrationLedger(
  value: unknown,
  event: unknown
): Promise<SourceMigrationLedgerV1> {
  const verified = await verifySourceMigrationLedgerIntegrity(value)
  if (!verified.ok)
    transitionError(
      'backend-migration-ledger-state-invalid',
      `Ledger state is invalid: ${verified.diagnostics.map((entry) => entry.code).join(', ')}`
    )
  const eventContext: BackendValidationContext = { diagnostics: [] }
  if (
    !assertBoundedBackendData(event, eventContext) ||
    !assertBackendSecretFreeData(event, eventContext)
  ) {
    transitionError(
      'backend-migration-ledger-event-invalid',
      'Ledger event must be bounded secret-free plain data.'
    )
  }
  const parsedEvent = parseLedgerEvent(event, eventContext)
  if (!parsedEvent || eventContext.diagnostics.length)
    transitionError('backend-migration-ledger-event-invalid', 'Ledger event envelope is invalid.')
  if (parsedEvent.occurredAt.localeCompare(verified.value.updatedAt, 'en') <= 0) {
    transitionError(
      'backend-migration-ledger-event-stale',
      'Ledger events must follow the latest immutable record with a distinct timestamp.'
    )
  }
  switch (parsedEvent.type) {
    case 'register-migration':
      return registerMigration(verified.value, parsedEvent)
    case 'record-drift':
      return recordDrift(verified.value, parsedEvent)
    case 'promote-migration':
      return promoteMigration(verified.value, parsedEvent)
    case 'record-recovery':
      return recordRecovery(verified.value, parsedEvent)
    case 'rebind-environment-authority':
      return rebindEnvironmentAuthority(verified.value, parsedEvent)
    default:
      return transitionError(
        'backend-migration-ledger-event-unsupported',
        'Ledger event type is not supported.'
      )
  }
}
