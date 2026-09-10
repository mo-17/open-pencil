import { canonicalBackendValue, digestCanonicalBackendValue } from '#compiler/backend/canonical'
import { backendDiagnostic } from '#compiler/backend/diagnostics'
import type { BackendProviderAdapterContextV2 } from '#compiler/backend/v2/contracts'

import {
  BACKEND_BACKFILL_EXECUTION_MAX_RECEIPTS,
  type BackendApplicationSpecV2,
  type BackendCapabilityV2,
  type BackendDataMigrationDefinitionIR,
  type BackendDiagnostic,
  type BackendLiteral,
  type DataEntityIR,
  type DataFieldIR
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import {
  expectedSupabaseBackfillPostgresTypeV2,
  isBackendLiteral,
  literalMatchesSupabaseBackfillTargetV2,
  sameBackendLiteral,
  supabaseBackfillProtectedFieldsV2
} from './field'

export const SUPABASE_BACKFILL_ARTIFACT_PATHS_V2 = Object.freeze({
  migrationPlan: 'backend/supabase-v2/backfill/migration-plan.json',
  reviewManifest: 'backend/supabase-v2/backfill/review-manifest.json',
  sql: 'backend/supabase-v2/backfill/review-query-template.sql'
} as const)

export const SUPABASE_BACKFILL_ACTUAL_CAPABILITIES_V2 = Object.freeze([
  'migrations.backfill',
  'migrations.data',
  'migrations.schema'
] as const satisfies readonly BackendCapabilityV2[])

/** Receipt index 0 captures high water; the remaining checkpoints belong to data batches. */
export const SUPABASE_BACKFILL_MAX_RECEIPTS_V2 = BACKEND_BACKFILL_EXECUTION_MAX_RECEIPTS
export const SUPABASE_BACKFILL_MAX_BATCH_RECEIPTS_V2 = SUPABASE_BACKFILL_MAX_RECEIPTS_V2 - 1
export const SUPABASE_BACKFILL_MAX_SAFE_CURSOR_V2 = Number.MAX_SAFE_INTEGER
export const SUPABASE_BACKFILL_RELEASE_BLOCKERS_V2 = Object.freeze([
  'live-catalog-not-inspected',
  'p1-identity-by-default-not-upgraded-to-always',
  'identity-always-and-sequence-properties-not-proven',
  'live-cursor-immutability-and-append-monotonicity-not-proven',
  'live-table-backfill-write-hazards-not-proven-absent',
  'live-target-default-and-enum-domain-not-proven',
  'trusted-query-role-row-visibility-and-search-path-not-bound',
  'write-barrier-and-high-water-capture-lock-not-implemented',
  'runtime-sequence-and-cursor-mutation-authority-not-inspected',
  'live-schema-object-identity-and-catalog-digest-not-bound-per-batch',
  'runtime-table-policy-trigger-rule-function-and-acl-authority-not-inspected',
  'trusted-read-only-query-authority-not-bound',
  'p1-unbounded-staged-backfill-path-not-retired',
  'provider-v2-receipt-binding-not-implemented',
  'database-batch-ledger-not-implemented',
  'source-ledger-artifact-authority-binding-not-implemented',
  'trusted-live-dry-run-and-postconditions-not-executed'
] as const)

export interface ResolvedSupabaseBackfillV2 {
  readonly id: string
  readonly name: string
  readonly digest: string
  readonly entityId: string
  readonly table: string
  readonly cursor: {
    readonly fieldId: string
    readonly field: string
    readonly type: 'integer'
    readonly identityGenerationRequired: 'always'
    readonly minimum: 0
    readonly maximum: number
  }
  readonly batchSize: number
  readonly maximumReceiptCount: number
  readonly maximumBatchReceiptCount: number
  readonly maximumMatchedRowCountByReceiptCapacity: number
  readonly predicate: {
    readonly kind: 'field-is-null'
    readonly fieldId: string
    readonly field: string
  }
  readonly transform: {
    readonly kind: 'set-literal'
    readonly fieldId: string
    readonly field: string
    readonly fieldType: string
    readonly expectedPostgresType: string
    readonly value: BackendLiteral
  }
  readonly postconditions: readonly (
    | Readonly<{ kind: 'field-not-null'; fieldId: string; field: string }>
    | Readonly<{ kind: 'matched-row-count'; minimum: number }>
  )[]
  readonly dryRunRequired: true
  readonly resumePolicy: 'from-receipt'
}

function diagnostic(
  code: string,
  path: string,
  message: string,
  severity: BackendDiagnostic['severity'] = 'error'
): BackendDiagnostic {
  return backendDiagnostic(code, severity, path, message)
}

function isSafeIntegerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  )
}

function validateActualCapabilities(
  context: BackendProviderAdapterContextV2,
  diagnostics: BackendDiagnostic[]
): void {
  const actual = new Set(context.actualCapabilities)
  const allowed = new Set<BackendCapabilityV2>(SUPABASE_BACKFILL_ACTUAL_CAPABILITIES_V2)
  for (const capability of SUPABASE_BACKFILL_ACTUAL_CAPABILITIES_V2) {
    if (actual.has(capability)) continue
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-capability-required',
        `$.actualCapabilities.${capability}`,
        'The bounded Supabase backfill review requires this capability from normalized Backend V2 IR.'
      )
    )
  }
  for (const capability of context.actualCapabilities) {
    if (allowed.has(capability)) continue
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-capability-unsupported',
        `$.actualCapabilities.${capability}`,
        'The first Supabase backfill slice refuses every unrelated application capability.'
      )
    )
  }
}

// oxlint-disable-next-line complexity -- Every unrelated execution surface is rejected together.
function validateApplicationBoundary(
  context: BackendProviderAdapterContextV2,
  diagnostics: BackendDiagnostic[]
): void {
  const { application } = context
  if (context.target !== 'react' && context.target !== 'vue') {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-target-unsupported',
        '$.target',
        'Supabase backfill review artifacts currently support only React and Vue web targets.'
      )
    )
  }
  if (context.mode !== 'production') {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-production-mode-required',
        '$.mode',
        'Supabase backfill review artifacts are emitted only in production compilation mode.'
      )
    )
  }
  if (application.secrets.length > 0) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-secrets-forbidden',
        '$.application.secrets',
        'The review-only backfill adapter accepts no credential or secret declarations.'
      )
    )
  }
  const telemetry = application.automations.telemetry
  if (
    application.workflows.workflows.length > 0 ||
    application.realtime.subscriptions.length > 0 ||
    application.transactions.transactions.length > 0 ||
    application.automations.queues.length > 0 ||
    application.automations.webhookDestinations.length > 0 ||
    application.automations.automations.length > 0 ||
    telemetry.logs ||
    telemetry.metrics ||
    telemetry.traces ||
    telemetry.auditEvents ||
    application.automations.driftDetection.enabled
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-application-scope-unsupported',
        '$.application',
        'Realtime, transactions, workflows, automations, queues, webhooks, telemetry, and drift behavior are outside this backfill-only slice.'
      )
    )
  }
  if (
    application.dataModel.entities.length !== 1 ||
    application.dataModel.entities[0]?.management !== 'managed'
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-managed-entity-count-invalid',
        '$.application.dataModel.entities',
        'The first Supabase backfill slice requires exactly one source-managed entity.'
      )
    )
  }
  const entity = application.dataModel.entities.at(0)
  if (
    (entity?.indexes?.length ?? 0) > 0 ||
    (entity?.uniques?.length ?? 0) > 0 ||
    (entity?.foreignKeys?.length ?? 0) > 0
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-secondary-table-authority-unsupported',
        '$.application.dataModel.entities[0]',
        'The first backfill slice requires a table without secondary indexes, unique constraints, or foreign keys.'
      )
    )
  }
  if (application.dataModel.relations.length > 0) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-relations-unsupported',
        '$.application.dataModel.relations',
        'Relations are outside the first single-entity backfill slice.'
      )
    )
  }
  if (application.dataMigrations.migrations.length !== 1) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-migration-count-invalid',
        '$.application.dataMigrations.migrations',
        'The first Supabase backfill slice requires exactly one migration.'
      )
    )
  }
}

function validateCursor(
  entity: DataEntityIR | undefined,
  migration: BackendDataMigrationDefinitionIR | undefined,
  diagnostics: BackendDiagnostic[]
): DataFieldIR | undefined {
  const cursorField = entity?.fields.find((field) => field.id === migration?.cursor.fieldId)
  if (
    !entity ||
    !migration ||
    migration.entityId !== entity.id ||
    !cursorField ||
    cursorField.nullable ||
    cursorField.type !== 'integer' ||
    cursorField.default?.kind !== 'generated' ||
    cursorField.default.generator !== 'identity' ||
    entity.primaryKey?.fields.length !== 1 ||
    entity.primaryKey.fields[0] !== cursorField.id
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-cursor-invalid',
        '$.application.dataMigrations.migrations[0].cursor',
        'The cursor must be the managed entity non-null single-field integer identity primary key.'
      )
    )
  }
  return cursorField
}

// oxlint-disable-next-line complexity -- Target shape and every protected-field authority fail closed together.
function validateTarget(
  application: BackendApplicationSpecV2,
  entity: DataEntityIR | undefined,
  migration: BackendDataMigrationDefinitionIR | undefined,
  diagnostics: BackendDiagnostic[]
): DataFieldIR | undefined {
  const transform = migration?.transforms.at(0)
  if (migration?.transforms.length !== 1 || transform?.kind !== 'set-literal') {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-transform-invalid',
        '$.application.dataMigrations.migrations[0].transforms',
        'The first Supabase backfill slice requires exactly one set-literal transform.'
      )
    )
    return undefined
  }
  const target = entity?.fields.find((field) => field.id === transform.fieldId)
  if (
    !target ||
    target.nullable ||
    target.default?.kind !== 'literal' ||
    !isBackendLiteral(target.default.value) ||
    !isBackendLiteral(transform.value) ||
    target.default.value === null ||
    transform.value === null ||
    !sameBackendLiteral(target.default.value, transform.value)
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-target-default-invalid',
        '$.application.dataMigrations.migrations[0].transforms[0]',
        'The target must be desired non-null with the exact same non-null literal default as the set-literal transform.'
      )
    )
  }
  if (
    target?.default?.kind === 'literal' &&
    (!literalMatchesSupabaseBackfillTargetV2(application, target, target.default.value) ||
      !literalMatchesSupabaseBackfillTargetV2(application, target, transform.value))
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-target-literal-invalid',
        '$.application.dataMigrations.migrations[0].transforms[0].value',
        'The default and transform literals must match the target type, enum domain, and PostgreSQL text/JSON encoding rules.'
      )
    )
  }
  if (target?.type === 'bytes') {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-target-type-unsupported',
        '$.application.dataMigrations.migrations[0].transforms[0].fieldId',
        'Byte-literal backfills require a separate reviewed encoding contract.'
      )
    )
  }
  if (typeof transform.value === 'number' && Object.is(transform.value, -0)) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-negative-zero-forbidden',
        '$.application.dataMigrations.migrations[0].transforms[0].value',
        'Negative zero is not accepted as a canonical PostgreSQL backfill literal.'
      )
    )
  }
  if (entity && supabaseBackfillProtectedFieldsV2(application, entity).has(transform.fieldId)) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-protected-target-forbidden',
        '$.application.dataMigrations.migrations[0].transforms[0].fieldId',
        'Backfill targets cannot be cursor, primary-key, unique, foreign-key, owner, tenant, or membership fields.'
      )
    )
  }
  if (migration.predicate.fieldId !== transform.fieldId) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-predicate-invalid',
        '$.application.dataMigrations.migrations[0].predicate',
        'The backfill predicate must be field-is-null on the exact transform target.'
      )
    )
  }
  return target
}

function validatePostconditions(
  migration: BackendDataMigrationDefinitionIR | undefined,
  target: DataFieldIR | undefined,
  diagnostics: BackendDiagnostic[]
): void {
  const notNull = migration?.postconditions.filter((entry) => entry.kind === 'field-not-null') ?? []
  const rowCount =
    migration?.postconditions.filter((entry) => entry.kind === 'matched-row-count') ?? []
  if (
    !migration ||
    (migration.postconditions.length !== 1 && migration.postconditions.length !== 2) ||
    notNull.length !== 1 ||
    notNull[0]?.fieldId !== target?.id ||
    rowCount.length > 1 ||
    rowCount.some((entry) => !isSafeIntegerBetween(entry.minimum, 0, Number.MAX_SAFE_INTEGER))
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-backfill-postconditions-invalid',
        '$.application.dataMigrations.migrations[0].postconditions',
        'The backfill requires exactly one target field-not-null postcondition and allows at most one matched-row-count postcondition.'
      )
    )
  }
}

function validateExecutionBounds(
  migration: BackendDataMigrationDefinitionIR | undefined,
  diagnostics: BackendDiagnostic[]
): void {
  if (migration && isSafeIntegerBetween(migration.batchSize, 1, 1_000)) return
  diagnostics.push(
    diagnostic(
      'supabase-v2-backfill-batch-size-invalid',
      '$.application.dataMigrations.migrations[0].batchSize',
      'The backfill batch size must be a safe integer between 1 and 1000.'
    )
  )
}

function validateReceiptCapacity(
  migration: BackendDataMigrationDefinitionIR | undefined,
  diagnostics: BackendDiagnostic[]
): void {
  const matchedRows = migration?.postconditions.find((entry) => entry.kind === 'matched-row-count')
  if (
    !migration ||
    !isSafeIntegerBetween(migration.batchSize, 1, 1_000) ||
    !matchedRows ||
    !isSafeIntegerBetween(matchedRows.minimum, 0, Number.MAX_SAFE_INTEGER) ||
    matchedRows.minimum <= migration.batchSize * SUPABASE_BACKFILL_MAX_BATCH_RECEIPTS_V2
  ) {
    return
  }
  diagnostics.push(
    diagnostic(
      'supabase-v2-backfill-receipt-capacity-exceeded',
      '$.application.dataMigrations.migrations[0].postconditions',
      'The matched-row minimum cannot exceed batchSize times the available batch receipt count.'
    )
  )
}

/** Reject every application outside the deliberately small read-only review slice. */
export function validateSupabaseBackfillV2(
  context: BackendProviderAdapterContextV2
): readonly BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  validateActualCapabilities(context, diagnostics)
  validateApplicationBoundary(context, diagnostics)
  const entity = context.application.dataModel.entities.at(0)
  const migration = context.application.dataMigrations.migrations.at(0)
  validateCursor(entity, migration, diagnostics)
  const target = validateTarget(context.application, entity, migration, diagnostics)
  validatePostconditions(migration, target, diagnostics)
  validateExecutionBounds(migration, diagnostics)
  validateReceiptCapacity(migration, diagnostics)
  diagnostics.push(
    diagnostic(
      'supabase-v2-backfill-trusted-host-required',
      '$.application.dataMigrations.migrations[0]',
      'Artifacts are review-only: live catalog proof, trusted receipts, bounded execution, and Apply remain Host responsibilities.',
      'warning'
    )
  )
  return Object.freeze(diagnostics)
}

function resolvedPostconditions(
  migration: BackendDataMigrationDefinitionIR,
  target: DataFieldIR
): ResolvedSupabaseBackfillV2['postconditions'] {
  const rowCount = migration.postconditions.find((entry) => entry.kind === 'matched-row-count')
  if (migration.postconditions.length < 1 || migration.postconditions.length > 2) {
    throw new TypeError('Supabase backfill postconditions are outside the reviewed subset.')
  }
  return Object.freeze([
    Object.freeze({ kind: 'field-not-null', fieldId: target.id, field: target.name }),
    ...(rowCount
      ? [Object.freeze({ kind: 'matched-row-count' as const, minimum: rowCount.minimum })]
      : [])
  ])
}

// oxlint-disable-next-line complexity -- The internal resolver defensively repeats the narrow validated boundary.
export function resolvedSupabaseBackfillV2(
  application: BackendApplicationSpecV2
): ResolvedSupabaseBackfillV2 {
  const entity = application.dataModel.entities.at(0)
  const migration = application.dataMigrations.migrations.at(0)
  const cursor = entity?.fields.find((field) => field.id === migration?.cursor.fieldId)
  const transform = migration?.transforms.at(0)
  const target =
    transform?.kind === 'set-literal'
      ? entity?.fields.find((field) => field.id === transform.fieldId)
      : undefined
  if (
    entity?.management !== 'managed' ||
    !migration ||
    cursor?.type !== 'integer' ||
    transform?.kind !== 'set-literal' ||
    !target ||
    target.nullable ||
    target.default?.kind !== 'literal' ||
    !sameBackendLiteral(target.default.value, transform.value) ||
    !literalMatchesSupabaseBackfillTargetV2(application, target, target.default.value) ||
    !literalMatchesSupabaseBackfillTargetV2(application, target, transform.value) ||
    !isSafeIntegerBetween(migration.batchSize, 1, 1_000)
  ) {
    throw new TypeError('Supabase backfill resolution requires the validated narrow subset.')
  }
  if (target.type === 'bytes') {
    throw new TypeError('Supabase backfill resolution requires a supported target field.')
  }
  const matchedRows = migration.postconditions.find((entry) => entry.kind === 'matched-row-count')
  if (
    matchedRows &&
    (!isSafeIntegerBetween(matchedRows.minimum, 0, Number.MAX_SAFE_INTEGER) ||
      matchedRows.minimum > migration.batchSize * SUPABASE_BACKFILL_MAX_BATCH_RECEIPTS_V2)
  ) {
    throw new TypeError('Supabase backfill resolution requires a safe matched-row count.')
  }
  return Object.freeze({
    id: migration.id,
    name: migration.name,
    digest: digestCanonicalBackendValue(migration, '$.supabaseBackfill.migration'),
    entityId: entity.id,
    table: entity.name,
    cursor: Object.freeze({
      fieldId: cursor.id,
      field: cursor.name,
      type: 'integer' as const,
      identityGenerationRequired: 'always' as const,
      minimum: 0 as const,
      maximum: SUPABASE_BACKFILL_MAX_SAFE_CURSOR_V2
    }),
    batchSize: migration.batchSize,
    maximumReceiptCount: SUPABASE_BACKFILL_MAX_RECEIPTS_V2,
    maximumBatchReceiptCount: SUPABASE_BACKFILL_MAX_BATCH_RECEIPTS_V2,
    maximumMatchedRowCountByReceiptCapacity:
      migration.batchSize * SUPABASE_BACKFILL_MAX_BATCH_RECEIPTS_V2,
    predicate: Object.freeze({
      kind: 'field-is-null' as const,
      fieldId: target.id,
      field: target.name
    }),
    transform: Object.freeze({
      kind: 'set-literal' as const,
      fieldId: target.id,
      field: target.name,
      fieldType: target.type,
      expectedPostgresType: expectedSupabaseBackfillPostgresTypeV2(application, target),
      value: transform.value
    }),
    postconditions: resolvedPostconditions(migration, target),
    dryRunRequired: true as const,
    resumePolicy: 'from-receipt' as const
  })
}

export function createSupabaseBackfillPlanV2(context: BackendProviderAdapterContextV2): JSONValue {
  if (validateSupabaseBackfillV2(context).some((entry) => entry.severity === 'error')) {
    throw new TypeError('Supabase backfill plan requires the validated narrow subset.')
  }
  const migration = resolvedSupabaseBackfillV2(context.application)
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-backfill-plan.v1',
      version: 1,
      providerId: 'supabase',
      applicationId: context.application.applicationId,
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      trustedHostRequired: true,
      liveCatalogInspected: false,
      mutationSqlEmitted: false,
      execution: {
        mode: 'receipt-driven-batches',
        runnerEmitted: false,
        databaseBatchLedgerAvailable: false,
        receiptBindingAvailable: false,
        maximumReceiptCount: SUPABASE_BACKFILL_MAX_RECEIPTS_V2,
        maximumBatchReceiptCount: SUPABASE_BACKFILL_MAX_BATCH_RECEIPTS_V2,
        maximumMatchedRowCountByReceiptCapacity: migration.maximumMatchedRowCountByReceiptCapacity
      },
      migration,
      releaseBlockers: SUPABASE_BACKFILL_RELEASE_BLOCKERS_V2
    },
    '$.supabaseBackfill.plan'
  )
}
