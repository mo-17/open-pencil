/* eslint-disable max-lines -- staged migration contracts keep their closed schemas, normalization, and canonical Receipt validation together */
import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import { BACKEND_FIELD_TYPES, parseBackendFieldDefault } from './field-default-validation'
import { BACKEND_LIMITS } from './limits'
import { assertBackendSecretFreeData } from './secret-boundary'
import type {
  BackendFieldScalarType,
  BackendLiteral,
  BackendValidationResult,
  DataFieldIR,
  DataForeignKeyIR,
  DataUniqueIR,
  MigrationRiskLevel
} from './types'
import {
  array,
  assertBoundedBackendData,
  boolean,
  id,
  identifier,
  oneOf,
  record,
  sorted,
  uniqueBy,
  type BackendUnknownRecord,
  type BackendValidationContext
} from './validation-helpers'

export const STAGED_MIGRATION_EXECUTION_FORMAT = 'openpencil.staged-migration-execution' as const
export const STAGED_MIGRATION_EXECUTION_VERSION = 1 as const
export const STAGED_MIGRATION_EXECUTION_RECEIPT_FORMAT =
  'openpencil.staged-migration-execution-receipt' as const
export const STAGED_MIGRATION_EXECUTION_RECEIPT_VERSION = 1 as const

export type StagedMigrationPhase = 'expand' | 'backfill' | 'contract'
export type StagedMigrationEnvironment = 'dev' | 'staging' | 'production'
export type StagedMigrationPromotionSource = 'source' | 'dev' | 'staging'

export interface StagedMigrationTypedLiteralV1 {
  kind: 'literal'
  fieldType: BackendFieldScalarType | 'enum'
  enumId?: string
  value: BackendLiteral
}

export type StagedMigrationOperationV1 =
  | {
      id: string
      kind: 'apply-reviewed-migration'
      sourceOperationIds: string[]
      reviewManifestDigest: string
      migrationPlanDigest: string
      sqlDigest: string
      appliesTo: 'reviewed-source-sql'
    }
  | {
      id: string
      kind: 'add-nullable-field'
      sourceOperationIds: string[]
      entityId: string
      field: DataFieldIR
    }
  | {
      id: string
      kind: 'add-foreign-key'
      sourceOperationIds: string[]
      entityId: string
      foreignKey: DataForeignKeyIR
      validation: 'deferred'
    }
  | {
      id: string
      kind: 'add-unique'
      sourceOperationIds: string[]
      entityId: string
      unique: DataUniqueIR
      validation: 'deferred'
    }
  | {
      id: string
      kind: 'set-generated-default'
      sourceOperationIds: string[]
      entityId: string
      fieldId: string
      fieldType: 'uuid' | 'integer'
      generator: 'uuid' | 'identity'
      appliesTo: 'future-writes'
    }
  | {
      id: string
      kind: 'backfill-field'
      sourceOperationIds: string[]
      entityId: string
      fieldId: string
      predicate: 'is-null'
      value: StagedMigrationTypedLiteralV1
    }
  | {
      id: string
      kind: 'validate-foreign-key'
      sourceOperationIds: string[]
      entityId: string
      foreignKeyId: string
      validation: 'existing-and-concurrent-data'
    }
  | {
      id: string
      kind: 'validate-unique'
      sourceOperationIds: string[]
      entityId: string
      uniqueId: string
      validation: 'existing-and-concurrent-data'
    }
  | {
      id: string
      kind: 'set-not-null'
      sourceOperationIds: string[]
      entityId: string
      fieldId: string
    }
  | {
      id: string
      kind: 'rename-entity'
      sourceOperationIds: string[]
      entityId: string
      fromName: string
      toName: string
      compatibility: StagedMigrationRenameCompatibilityV1
    }
  | {
      id: string
      kind: 'rename-field'
      sourceOperationIds: string[]
      entityId: string
      fieldId: string
      fromName: string
      toName: string
      compatibility: StagedMigrationRenameCompatibilityV1
    }
  | {
      id: string
      kind: 'retire-field'
      sourceOperationIds: string[]
      entityId: string
      fieldId: string
      compatibilityEvidenceDigest: string
    }
  | {
      id: string
      kind: 'retire-entity'
      sourceOperationIds: string[]
      entityId: string
      compatibilityEvidenceDigest: string
    }

export interface StagedMigrationRenameCompatibilityV1 {
  mode: 'direct' | 'expand-contract'
  applicationEvidenceDigest: string
}

export interface StagedMigrationPlanOperationV1 {
  operation: StagedMigrationOperationV1
  risk: MigrationRiskLevel
}

export interface StagedMigrationSourcePlanRefV1 {
  version: 1
  planId: string
  planDigest: string
  fromModelDigest: string | null
  targetModelDigest: string
}

export interface StagedMigrationPredecessorV1 {
  phase: 'expand' | 'backfill'
  executionPlanDigest: string
  receiptRequired: true
}

export interface StagedMigrationExecutionPlanV1 {
  format: typeof STAGED_MIGRATION_EXECUTION_FORMAT
  version: typeof STAGED_MIGRATION_EXECUTION_VERSION
  executionId: string
  changeId: string
  sourceMigrationPlan: StagedMigrationSourcePlanRefV1
  phase: StagedMigrationPhase
  predecessor: StagedMigrationPredecessorV1 | null
  operations: StagedMigrationPlanOperationV1[]
  highestRisk: MigrationRiskLevel
  requiresHumanApproval: boolean
}

/**
 * Secret-free snapshot of the exact provider and remote project authority that executed a plan.
 * `providerAuthorityDigest` is the canonical digest of the reviewed Provider authority; the
 * credential itself never crosses this contract.
 */
export interface StagedMigrationExecutionTargetAuthorityV1 {
  providerId: string
  providerAuthorityDigest: string
  projectRef: string
  accountId: string
  grantGeneration: string
  environment: StagedMigrationEnvironment
}

export interface StagedMigrationExecutionReceiptV1 {
  format: typeof STAGED_MIGRATION_EXECUTION_RECEIPT_FORMAT
  version: typeof STAGED_MIGRATION_EXECUTION_RECEIPT_VERSION
  receiptId: string
  executionId: string
  executionPlanDigest: string
  phase: StagedMigrationPhase
  promotionFrom: StagedMigrationPromotionSource
  targetAuthority: StagedMigrationExecutionTargetAuthorityV1
  schemaBeforeDigest: string
  schemaAfterDigest: string
  outcome: 'succeeded' | 'failed' | 'outcome-unknown'
  recordedAt: string
  evidenceDigest: string | null
}

// A 32-byte SHA-256 digest has four data bits in its final unpadded base64url character.
const DIGEST = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const RISK_ORDER: readonly MigrationRiskLevel[] = ['low', 'medium', 'high', 'destructive']
const PHASES: readonly StagedMigrationPhase[] = ['expand', 'backfill', 'contract']
const ENVIRONMENTS: readonly StagedMigrationEnvironment[] = ['dev', 'staging', 'production']
const PROMOTION_SOURCES: readonly StagedMigrationPromotionSource[] = ['source', 'dev', 'staging']

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
  context: BackendValidationContext
): string | undefined {
  if (typeof value === 'string' && DIGEST.test(value)) return value
  fail(
    context,
    'backend-staged-migration-digest-invalid',
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
    'backend-staged-migration-timestamp-invalid',
    path,
    'Value must be a canonical UTC timestamp.'
  )
  return undefined
}

function sourceOperationIds(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  allowEmpty = false
): string[] | undefined {
  const values = array(value, path, context, BACKEND_LIMITS.maxMigrationOperations)
  if (!values) return undefined
  if (!allowEmpty && values.length === 0) {
    fail(
      context,
      'backend-staged-migration-source-operation-required',
      path,
      'At least one source operation id is required.'
    )
    return undefined
  }
  const parsed = values
    .map((entry, index) => id(entry, `${path}[${index}]`, context))
    .filter((entry): entry is string => entry !== undefined)
  uniqueBy(parsed, path, context, 'source operation id')
  return parsed.length === values.length ? sorted(parsed, (entry) => entry) : undefined
}

function parseField(
  value: unknown,
  path: string,
  context: BackendValidationContext
): DataFieldIR | undefined {
  const source = record(
    value,
    path,
    context,
    ['id', 'name', 'type', 'enumId', 'nullable', 'default'],
    ['id', 'name', 'type', 'nullable']
  )
  if (!source) return undefined
  const fieldId = id(source.id, `${path}.id`, context)
  const name = identifier(source.name, `${path}.name`, context)
  const type = oneOf(source.type, `${path}.type`, context, BACKEND_FIELD_TYPES)
  const nullable = boolean(source.nullable, `${path}.nullable`, context)
  const enumId =
    source.enumId === undefined ? undefined : id(source.enumId, `${path}.enumId`, context)
  if (type === 'enum' && !enumId) {
    fail(
      context,
      'backend-enum-reference-required',
      `${path}.enumId`,
      'Enum fields must reference an enum.'
    )
  }
  if (type && type !== 'enum' && source.enumId !== undefined) {
    fail(
      context,
      'backend-enum-reference-unexpected',
      `${path}.enumId`,
      'Only enum fields may reference an enum.'
    )
  }
  const defaultValue =
    source.default === undefined
      ? undefined
      : parseBackendFieldDefault(source.default, `${path}.default`, context, type, nullable)
  if (
    !fieldId ||
    !name ||
    !type ||
    nullable === undefined ||
    (type === 'enum' && !enumId) ||
    (source.default !== undefined && !defaultValue)
  ) {
    return undefined
  }
  return {
    id: fieldId,
    name,
    type,
    ...(enumId ? { enumId } : {}),
    nullable,
    ...(defaultValue ? { default: defaultValue } : {})
  }
}

function fieldIds(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string[] | undefined {
  const values = array(value, path, context, BACKEND_LIMITS.maxFieldsPerEntity)
  if (!values || values.length === 0) {
    if (values)
      fail(
        context,
        'backend-staged-migration-field-reference-empty',
        path,
        'At least one field reference is required.'
      )
    return undefined
  }
  const parsed = values
    .map((entry, index) => id(entry, `${path}[${index}]`, context))
    .filter((entry): entry is string => entry !== undefined)
  uniqueBy(parsed, path, context, 'field reference')
  return parsed.length === values.length ? parsed : undefined
}

function parseForeignKey(
  value: unknown,
  path: string,
  context: BackendValidationContext
): DataForeignKeyIR | undefined {
  const source = record(value, path, context, [
    'id',
    'fields',
    'targetEntityId',
    'targetFields',
    'onDelete'
  ])
  if (!source) return undefined
  const foreignKeyId = id(source.id, `${path}.id`, context)
  const fields = fieldIds(source.fields, `${path}.fields`, context)
  const targetEntityId = id(source.targetEntityId, `${path}.targetEntityId`, context)
  const targetFields = fieldIds(source.targetFields, `${path}.targetFields`, context)
  const onDelete = oneOf(source.onDelete, `${path}.onDelete`, context, [
    'restrict',
    'cascade',
    'set-null',
    'no-action'
  ])
  if (fields && targetFields && fields.length !== targetFields.length) {
    fail(
      context,
      'backend-foreign-key-arity',
      path,
      'Foreign key field lists must have the same length.'
    )
  }
  return foreignKeyId && fields && targetEntityId && targetFields && onDelete
    ? { id: foreignKeyId, fields, targetEntityId, targetFields, onDelete }
    : undefined
}

function parseUnique(
  value: unknown,
  path: string,
  context: BackendValidationContext
): DataUniqueIR | undefined {
  const source = record(value, path, context, ['id', 'fields'])
  if (!source) return undefined
  const uniqueId = id(source.id, `${path}.id`, context)
  const fields = fieldIds(source.fields, `${path}.fields`, context)
  return uniqueId && fields ? { id: uniqueId, fields } : undefined
}

function typedLiteral(
  value: unknown,
  path: string,
  context: BackendValidationContext
): StagedMigrationTypedLiteralV1 | undefined {
  const source = record(
    value,
    path,
    context,
    ['kind', 'fieldType', 'enumId', 'value'],
    ['kind', 'fieldType', 'value']
  )
  if (!source) return undefined
  if (source.kind !== 'literal') {
    fail(
      context,
      'backend-staged-migration-literal-kind-invalid',
      `${path}.kind`,
      'Backfill values must be typed literals.'
    )
  }
  const fieldType = oneOf(source.fieldType, `${path}.fieldType`, context, BACKEND_FIELD_TYPES)
  const enumId =
    source.enumId === undefined ? undefined : id(source.enumId, `${path}.enumId`, context)
  if (fieldType === 'enum' && !enumId) {
    fail(
      context,
      'backend-enum-reference-required',
      `${path}.enumId`,
      'Enum literals must reference an enum.'
    )
  }
  if (fieldType && fieldType !== 'enum' && source.enumId !== undefined) {
    fail(
      context,
      'backend-enum-reference-unexpected',
      `${path}.enumId`,
      'Only enum literals may reference an enum.'
    )
  }
  const parsed = fieldType
    ? parseBackendFieldDefault(
        { kind: 'literal', value: source.value },
        path,
        context,
        fieldType,
        false
      )
    : undefined
  if (
    source.kind !== 'literal' ||
    !fieldType ||
    parsed?.kind !== 'literal' ||
    (fieldType === 'enum' && !enumId)
  ) {
    return undefined
  }
  return { kind: 'literal', fieldType, ...(enumId ? { enumId } : {}), value: parsed.value }
}

function renameCompatibility(
  value: unknown,
  path: string,
  context: BackendValidationContext
): StagedMigrationRenameCompatibilityV1 | undefined {
  const source = record(value, path, context, ['mode', 'applicationEvidenceDigest'])
  if (!source) return undefined
  const mode = oneOf(source.mode, `${path}.mode`, context, ['direct', 'expand-contract'])
  const applicationEvidenceDigest = digest(
    source.applicationEvidenceDigest,
    `${path}.applicationEvidenceDigest`,
    context
  )
  return mode && applicationEvidenceDigest ? { mode, applicationEvidenceDigest } : undefined
}

function operationBase(
  source: BackendUnknownRecord,
  path: string,
  context: BackendValidationContext,
  allowEmptySourceOperations = false
): { id: string; sourceOperationIds: string[] } | undefined {
  const operationId = id(source.id, `${path}.id`, context)
  const sourceIds = sourceOperationIds(
    source.sourceOperationIds,
    `${path}.sourceOperationIds`,
    context,
    allowEmptySourceOperations
  )
  return operationId && sourceIds ? { id: operationId, sourceOperationIds: sourceIds } : undefined
}

// oxlint-disable-next-line complexity -- Strict discriminated-union parsing validates every bounded operation variant in one authority funnel.
function parseOperation(
  value: unknown,
  path: string,
  context: BackendValidationContext
): StagedMigrationOperationV1 | undefined {
  const header = record(
    value,
    path,
    context,
    [
      'id',
      'kind',
      'sourceOperationIds',
      'entityId',
      'field',
      'foreignKey',
      'unique',
      'validation',
      'fieldId',
      'fieldType',
      'generator',
      'appliesTo',
      'predicate',
      'value',
      'foreignKeyId',
      'uniqueId',
      'fromName',
      'toName',
      'compatibility',
      'compatibilityEvidenceDigest',
      'reviewManifestDigest',
      'migrationPlanDigest',
      'sqlDigest'
    ],
    ['id', 'kind', 'sourceOperationIds']
  )
  if (!header) return undefined
  const kind = oneOf(header.kind, `${path}.kind`, context, [
    'apply-reviewed-migration',
    'add-nullable-field',
    'add-foreign-key',
    'add-unique',
    'set-generated-default',
    'backfill-field',
    'validate-foreign-key',
    'validate-unique',
    'set-not-null',
    'rename-entity',
    'rename-field',
    'retire-field',
    'retire-entity'
  ])
  if (!kind) return undefined
  const allowed: Record<StagedMigrationOperationV1['kind'], readonly string[]> = {
    'apply-reviewed-migration': [
      'id',
      'kind',
      'sourceOperationIds',
      'reviewManifestDigest',
      'migrationPlanDigest',
      'sqlDigest',
      'appliesTo'
    ],
    'add-nullable-field': ['id', 'kind', 'sourceOperationIds', 'entityId', 'field'],
    'add-foreign-key': ['id', 'kind', 'sourceOperationIds', 'entityId', 'foreignKey', 'validation'],
    'add-unique': ['id', 'kind', 'sourceOperationIds', 'entityId', 'unique', 'validation'],
    'set-generated-default': [
      'id',
      'kind',
      'sourceOperationIds',
      'entityId',
      'fieldId',
      'fieldType',
      'generator',
      'appliesTo'
    ],
    'backfill-field': [
      'id',
      'kind',
      'sourceOperationIds',
      'entityId',
      'fieldId',
      'predicate',
      'value'
    ],
    'validate-foreign-key': [
      'id',
      'kind',
      'sourceOperationIds',
      'entityId',
      'foreignKeyId',
      'validation'
    ],
    'validate-unique': ['id', 'kind', 'sourceOperationIds', 'entityId', 'uniqueId', 'validation'],
    'set-not-null': ['id', 'kind', 'sourceOperationIds', 'entityId', 'fieldId'],
    'rename-entity': [
      'id',
      'kind',
      'sourceOperationIds',
      'entityId',
      'fromName',
      'toName',
      'compatibility'
    ],
    'rename-field': [
      'id',
      'kind',
      'sourceOperationIds',
      'entityId',
      'fieldId',
      'fromName',
      'toName',
      'compatibility'
    ],
    'retire-field': [
      'id',
      'kind',
      'sourceOperationIds',
      'entityId',
      'fieldId',
      'compatibilityEvidenceDigest'
    ],
    'retire-entity': ['id', 'kind', 'sourceOperationIds', 'entityId', 'compatibilityEvidenceDigest']
  }
  const source = record(value, path, context, allowed[kind])
  if (!source) return undefined
  const base = operationBase(source, path, context, kind === 'apply-reviewed-migration')
  if (kind === 'apply-reviewed-migration') {
    const reviewManifestDigest = digest(
      source.reviewManifestDigest,
      `${path}.reviewManifestDigest`,
      context
    )
    const migrationPlanDigest = digest(
      source.migrationPlanDigest,
      `${path}.migrationPlanDigest`,
      context
    )
    const sqlDigest = digest(source.sqlDigest, `${path}.sqlDigest`, context)
    if (source.appliesTo !== 'reviewed-source-sql') {
      fail(
        context,
        'backend-staged-migration-reviewed-sql-scope-invalid',
        `${path}.appliesTo`,
        'Reviewed additive authority must bind only the exact source SQL.'
      )
    }
    return base &&
      reviewManifestDigest &&
      migrationPlanDigest &&
      sqlDigest &&
      source.appliesTo === 'reviewed-source-sql'
      ? {
          ...base,
          kind,
          reviewManifestDigest,
          migrationPlanDigest,
          sqlDigest,
          appliesTo: 'reviewed-source-sql'
        }
      : undefined
  }
  const entityId = id(source.entityId, `${path}.entityId`, context)
  if (!base || !entityId) return undefined
  switch (kind) {
    case 'add-nullable-field': {
      const field = parseField(source.field, `${path}.field`, context)
      if (field && !field.nullable)
        fail(
          context,
          'backend-staged-migration-field-must-be-nullable',
          `${path}.field.nullable`,
          'Expand phase fields must initially be nullable.'
        )
      return field?.nullable ? { ...base, kind, entityId, field } : undefined
    }
    case 'add-foreign-key': {
      const foreignKey = parseForeignKey(source.foreignKey, `${path}.foreignKey`, context)
      if (source.validation !== 'deferred')
        fail(
          context,
          'backend-staged-migration-validation-mode-invalid',
          `${path}.validation`,
          'New foreign keys must be staged for deferred validation.'
        )
      return foreignKey && source.validation === 'deferred'
        ? { ...base, kind, entityId, foreignKey, validation: 'deferred' }
        : undefined
    }
    case 'add-unique': {
      const unique = parseUnique(source.unique, `${path}.unique`, context)
      if (source.validation !== 'deferred')
        fail(
          context,
          'backend-staged-migration-validation-mode-invalid',
          `${path}.validation`,
          'New unique constraints must be staged for deferred validation.'
        )
      return unique && source.validation === 'deferred'
        ? { ...base, kind, entityId, unique, validation: 'deferred' }
        : undefined
    }
    case 'set-generated-default': {
      const fieldId = id(source.fieldId, `${path}.fieldId`, context)
      const fieldType = oneOf(source.fieldType, `${path}.fieldType`, context, ['uuid', 'integer'])
      const generator = oneOf(source.generator, `${path}.generator`, context, ['uuid', 'identity'])
      if ((fieldType === 'uuid') !== (generator === 'uuid')) {
        fail(
          context,
          'backend-staged-migration-generated-default-type-mismatch',
          path,
          'UUID and identity generators must match uuid and integer fields respectively.'
        )
      }
      if (source.appliesTo !== 'future-writes')
        fail(
          context,
          'backend-staged-migration-generated-default-scope-invalid',
          `${path}.appliesTo`,
          'Generated defaults may apply only to future writes.'
        )
      return fieldId &&
        fieldType &&
        generator &&
        (fieldType === 'uuid') === (generator === 'uuid') &&
        source.appliesTo === 'future-writes'
        ? { ...base, kind, entityId, fieldId, fieldType, generator, appliesTo: 'future-writes' }
        : undefined
    }
    case 'backfill-field': {
      const fieldId = id(source.fieldId, `${path}.fieldId`, context)
      const parsedValue = typedLiteral(source.value, `${path}.value`, context)
      if (source.predicate !== 'is-null')
        fail(
          context,
          'backend-staged-migration-backfill-predicate-invalid',
          `${path}.predicate`,
          'Safe backfills may update only rows where the field is null.'
        )
      return fieldId && parsedValue && source.predicate === 'is-null'
        ? { ...base, kind, entityId, fieldId, predicate: 'is-null', value: parsedValue }
        : undefined
    }
    case 'validate-foreign-key': {
      const foreignKeyId = id(source.foreignKeyId, `${path}.foreignKeyId`, context)
      if (source.validation !== 'existing-and-concurrent-data')
        fail(
          context,
          'backend-staged-migration-validation-mode-invalid',
          `${path}.validation`,
          'Validation must cover existing and concurrent data.'
        )
      return foreignKeyId && source.validation === 'existing-and-concurrent-data'
        ? { ...base, kind, entityId, foreignKeyId, validation: 'existing-and-concurrent-data' }
        : undefined
    }
    case 'validate-unique': {
      const uniqueId = id(source.uniqueId, `${path}.uniqueId`, context)
      if (source.validation !== 'existing-and-concurrent-data')
        fail(
          context,
          'backend-staged-migration-validation-mode-invalid',
          `${path}.validation`,
          'Validation must cover existing and concurrent data.'
        )
      return uniqueId && source.validation === 'existing-and-concurrent-data'
        ? { ...base, kind, entityId, uniqueId, validation: 'existing-and-concurrent-data' }
        : undefined
    }
    case 'set-not-null': {
      const fieldId = id(source.fieldId, `${path}.fieldId`, context)
      return fieldId ? { ...base, kind, entityId, fieldId } : undefined
    }
    case 'rename-entity': {
      const fromName = identifier(source.fromName, `${path}.fromName`, context)
      const toName = identifier(source.toName, `${path}.toName`, context)
      const compatibility = renameCompatibility(
        source.compatibility,
        `${path}.compatibility`,
        context
      )
      if (fromName && toName && fromName === toName)
        fail(context, 'backend-staged-migration-rename-noop', path, 'Rename endpoints must differ.')
      return fromName && toName && fromName !== toName && compatibility
        ? { ...base, kind, entityId, fromName, toName, compatibility }
        : undefined
    }
    case 'rename-field': {
      const fieldId = id(source.fieldId, `${path}.fieldId`, context)
      const fromName = identifier(source.fromName, `${path}.fromName`, context)
      const toName = identifier(source.toName, `${path}.toName`, context)
      const compatibility = renameCompatibility(
        source.compatibility,
        `${path}.compatibility`,
        context
      )
      if (fromName && toName && fromName === toName)
        fail(context, 'backend-staged-migration-rename-noop', path, 'Rename endpoints must differ.')
      return fieldId && fromName && toName && fromName !== toName && compatibility
        ? { ...base, kind, entityId, fieldId, fromName, toName, compatibility }
        : undefined
    }
    case 'retire-field': {
      const fieldId = id(source.fieldId, `${path}.fieldId`, context)
      const compatibilityEvidenceDigest = digest(
        source.compatibilityEvidenceDigest,
        `${path}.compatibilityEvidenceDigest`,
        context
      )
      return fieldId && compatibilityEvidenceDigest
        ? { ...base, kind, entityId, fieldId, compatibilityEvidenceDigest }
        : undefined
    }
    case 'retire-entity': {
      const compatibilityEvidenceDigest = digest(
        source.compatibilityEvidenceDigest,
        `${path}.compatibilityEvidenceDigest`,
        context
      )
      return compatibilityEvidenceDigest
        ? { ...base, kind, entityId, compatibilityEvidenceDigest }
        : undefined
    }
  }
  return undefined
}

function operationPhase(operation: StagedMigrationOperationV1): StagedMigrationPhase {
  switch (operation.kind) {
    case 'apply-reviewed-migration':
    case 'add-nullable-field':
    case 'add-foreign-key':
    case 'add-unique':
    case 'set-generated-default':
      return 'expand'
    case 'backfill-field':
    case 'validate-foreign-key':
    case 'validate-unique':
      return 'backfill'
    default:
      return 'contract'
  }
}

export function classifyStagedMigrationOperationRisk(
  operation: StagedMigrationOperationV1
): MigrationRiskLevel {
  switch (operation.kind) {
    case 'apply-reviewed-migration':
    case 'add-nullable-field':
      return 'low'
    case 'add-foreign-key':
    case 'add-unique':
    case 'set-generated-default':
      return operation.kind === 'set-generated-default' && operation.generator === 'uuid'
        ? 'medium'
        : 'high'
    case 'backfill-field':
    case 'validate-foreign-key':
    case 'validate-unique':
    case 'set-not-null':
      return 'high'
    case 'rename-entity':
    case 'rename-field':
      return operation.compatibility.mode === 'expand-contract' ? 'medium' : 'high'
    case 'retire-field':
    case 'retire-entity':
      return 'destructive'
  }
  throw new TypeError('Unsupported staged migration operation kind.')
}

function highestRisk(operations: readonly StagedMigrationPlanOperationV1[]): MigrationRiskLevel {
  return operations.reduce<MigrationRiskLevel>(
    (highest, entry) =>
      RISK_ORDER.indexOf(entry.risk) > RISK_ORDER.indexOf(highest) ? entry.risk : highest,
    'low'
  )
}

function sourcePlanRef(
  value: unknown,
  path: string,
  context: BackendValidationContext
): StagedMigrationSourcePlanRefV1 | undefined {
  const source = record(value, path, context, [
    'version',
    'planId',
    'planDigest',
    'fromModelDigest',
    'targetModelDigest'
  ])
  if (!source) return undefined
  if (source.version !== 1)
    fail(
      context,
      'backend-staged-migration-source-version-unsupported',
      `${path}.version`,
      'Only MigrationPlan v1 references are supported.'
    )
  const planId = id(source.planId, `${path}.planId`, context)
  const planDigest = digest(source.planDigest, `${path}.planDigest`, context)
  let fromModelDigest: string | null | undefined
  if (source.fromModelDigest === null) fromModelDigest = null
  else fromModelDigest = digest(source.fromModelDigest, `${path}.fromModelDigest`, context)
  const targetModelDigest = digest(source.targetModelDigest, `${path}.targetModelDigest`, context)
  return source.version === 1 &&
    planId &&
    planDigest &&
    fromModelDigest !== undefined &&
    targetModelDigest
    ? { version: 1, planId, planDigest, fromModelDigest, targetModelDigest }
    : undefined
}

function predecessor(
  value: unknown,
  path: string,
  context: BackendValidationContext
): StagedMigrationPredecessorV1 | null | undefined {
  if (value === null) return null
  const source = record(value, path, context, ['phase', 'executionPlanDigest', 'receiptRequired'])
  if (!source) return undefined
  const phase = oneOf(source.phase, `${path}.phase`, context, ['expand', 'backfill'])
  const executionPlanDigest = digest(
    source.executionPlanDigest,
    `${path}.executionPlanDigest`,
    context
  )
  if (source.receiptRequired !== true)
    fail(
      context,
      'backend-staged-migration-predecessor-receipt-required',
      `${path}.receiptRequired`,
      'A successful predecessor receipt is mandatory.'
    )
  return phase && executionPlanDigest && source.receiptRequired === true
    ? { phase, executionPlanDigest, receiptRequired: true }
    : undefined
}

// oxlint-disable-next-line complexity -- Plan normalization derives phase, risk, approval, and predecessor invariants together.
function parseExecutionPlan(
  value: unknown,
  context: BackendValidationContext
): StagedMigrationExecutionPlanV1 | undefined {
  const source = record(value, '$', context, [
    'format',
    'version',
    'executionId',
    'changeId',
    'sourceMigrationPlan',
    'phase',
    'predecessor',
    'operations',
    'highestRisk',
    'requiresHumanApproval'
  ])
  if (!source) return undefined
  if (source.format !== STAGED_MIGRATION_EXECUTION_FORMAT)
    fail(
      context,
      'backend-staged-migration-format-unsupported',
      '$.format',
      'Staged migration execution format is not supported.'
    )
  if (source.version !== STAGED_MIGRATION_EXECUTION_VERSION)
    fail(
      context,
      'backend-staged-migration-version-unsupported',
      '$.version',
      'Staged migration execution version is not supported.'
    )
  const executionId = id(source.executionId, '$.executionId', context)
  const changeId = id(source.changeId, '$.changeId', context)
  const planRef = sourcePlanRef(source.sourceMigrationPlan, '$.sourceMigrationPlan', context)
  const phase = oneOf(source.phase, '$.phase', context, PHASES)
  const previous = predecessor(source.predecessor, '$.predecessor', context)
  const rawOperations = array(
    source.operations,
    '$.operations',
    context,
    BACKEND_LIMITS.maxMigrationOperations
  )
  if (rawOperations?.length === 0)
    fail(
      context,
      'backend-staged-migration-operation-required',
      '$.operations',
      'A staged execution plan must contain at least one operation.'
    )
  const operations = (rawOperations ?? [])
    .map((entry, index) => {
      const path = `$.operations[${index}]`
      const wrapper = record(entry, path, context, ['operation', 'risk'])
      if (!wrapper) return undefined
      const operation = parseOperation(wrapper.operation, `${path}.operation`, context)
      const risk = oneOf(wrapper.risk, `${path}.risk`, context, RISK_ORDER)
      if (operation && risk && classifyStagedMigrationOperationRisk(operation) !== risk) {
        fail(
          context,
          'backend-staged-migration-risk-mismatch',
          `${path}.risk`,
          'Risk must be derived from the staged operation.'
        )
      }
      if (operation && phase && operationPhase(operation) !== phase) {
        fail(
          context,
          'backend-staged-migration-phase-mismatch',
          `${path}.operation.kind`,
          'Operation is not allowed in the declared release phase.'
        )
      }
      return operation && risk ? { operation, risk } : undefined
    })
    .filter((entry): entry is StagedMigrationPlanOperationV1 => entry !== undefined)
  uniqueBy(
    operations.map((entry) => entry.operation.id),
    '$.operations',
    context,
    'staged operation id'
  )
  const normalizedOperations = sorted(operations, (entry) => entry.operation.id)
  if (
    normalizedOperations.some((entry) => entry.operation.kind === 'apply-reviewed-migration') &&
    normalizedOperations.length !== 1
  ) {
    fail(
      context,
      'backend-staged-migration-reviewed-sql-authority-exclusive',
      '$.operations',
      'Reviewed source SQL authority must be the only operation in its compiler-derived plan.'
    )
  }
  const derivedHighest = highestRisk(normalizedOperations)
  const declaredHighest = oneOf(source.highestRisk, '$.highestRisk', context, RISK_ORDER)
  if (declaredHighest && declaredHighest !== derivedHighest)
    fail(
      context,
      'backend-staged-migration-highest-risk-mismatch',
      '$.highestRisk',
      'Highest risk must be derived from all staged operations.'
    )
  const derivedApproval = derivedHighest === 'destructive'
  if (source.requiresHumanApproval !== derivedApproval)
    fail(
      context,
      'backend-staged-migration-approval-mismatch',
      '$.requiresHumanApproval',
      'Human approval must be derived from destructive risk.'
    )
  if (phase === 'expand' && previous !== null)
    fail(
      context,
      'backend-staged-migration-predecessor-unexpected',
      '$.predecessor',
      'Expand is the first phase and cannot declare a predecessor.'
    )
  if (phase === 'backfill' && previous?.phase !== 'expand')
    fail(
      context,
      'backend-staged-migration-predecessor-invalid',
      '$.predecessor',
      'Backfill requires an expand predecessor receipt.'
    )
  if (phase === 'contract' && previous?.phase !== 'backfill')
    fail(
      context,
      'backend-staged-migration-predecessor-invalid',
      '$.predecessor',
      'Contract requires a backfill predecessor receipt.'
    )
  if (
    source.format !== STAGED_MIGRATION_EXECUTION_FORMAT ||
    source.version !== STAGED_MIGRATION_EXECUTION_VERSION ||
    !executionId ||
    !changeId ||
    !planRef ||
    !phase ||
    previous === undefined ||
    !rawOperations ||
    rawOperations.length === 0 ||
    operations.length !== rawOperations.length ||
    !declaredHighest ||
    context.diagnostics.length > 0
  )
    return undefined
  return {
    format: STAGED_MIGRATION_EXECUTION_FORMAT,
    version: STAGED_MIGRATION_EXECUTION_VERSION,
    executionId,
    changeId,
    sourceMigrationPlan: planRef,
    phase,
    predecessor: previous,
    operations: normalizedOperations,
    highestRisk: derivedHighest,
    requiresHumanApproval: derivedApproval
  }
}

export function validateStagedMigrationExecutionPlan(
  value: unknown
): BackendValidationResult<StagedMigrationExecutionPlanV1> {
  const context: BackendValidationContext = { diagnostics: [] }
  if (!assertBoundedBackendData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  if (!assertBackendSecretFreeData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  const parsed = parseExecutionPlan(value, context)
  return parsed && context.diagnostics.length === 0
    ? { ok: true, value: parsed, diagnostics: [] }
    : { ok: false, diagnostics: context.diagnostics }
}

function requireExecutionPlan(value: unknown): StagedMigrationExecutionPlanV1 {
  const parsed = validateStagedMigrationExecutionPlan(value)
  if (!parsed.ok)
    throw new TypeError(
      `Staged migration execution validation failed: ${parsed.diagnostics.map((entry) => entry.code).join(', ')}`
    )
  return parsed.value
}

// oxlint-disable-next-line open-pencil/no-useless-pass-through-wrappers -- Public normalization is an intentional throwing API alongside result-based validation.
export function normalizeStagedMigrationExecutionPlan(
  value: unknown
): StagedMigrationExecutionPlanV1 {
  return requireExecutionPlan(value)
}

export function canonicalStagedMigrationExecutionPlanBytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(requireExecutionPlan(value))
}

export async function digestStagedMigrationExecutionPlan(value: unknown): Promise<string> {
  return digestCanonicalManifest(requireExecutionPlan(value))
}

function isPromotionStep(
  from: StagedMigrationPromotionSource,
  to: StagedMigrationEnvironment
): boolean {
  return (
    (from === 'source' && to === 'dev') ||
    (from === 'dev' && to === 'staging') ||
    (from === 'staging' && to === 'production')
  )
}

function parseTargetAuthority(
  value: unknown,
  path: string,
  context: BackendValidationContext
): StagedMigrationExecutionTargetAuthorityV1 | undefined {
  const source = record(value, path, context, [
    'providerId',
    'providerAuthorityDigest',
    'projectRef',
    'accountId',
    'grantGeneration',
    'environment'
  ])
  if (!source) return undefined
  const providerId = id(source.providerId, `${path}.providerId`, context)
  const providerAuthorityDigest = digest(
    source.providerAuthorityDigest,
    `${path}.providerAuthorityDigest`,
    context
  )
  const projectRef = id(source.projectRef, `${path}.projectRef`, context)
  const accountId = id(source.accountId, `${path}.accountId`, context)
  const grantGeneration = id(source.grantGeneration, `${path}.grantGeneration`, context)
  const environment = oneOf(source.environment, `${path}.environment`, context, ENVIRONMENTS)
  return providerId &&
    providerAuthorityDigest &&
    projectRef &&
    accountId &&
    grantGeneration &&
    environment
    ? {
        providerId,
        providerAuthorityDigest,
        projectRef,
        accountId,
        grantGeneration,
        environment
      }
    : undefined
}

export function validateStagedMigrationExecutionTargetAuthority(
  value: unknown
): BackendValidationResult<StagedMigrationExecutionTargetAuthorityV1> {
  const context: BackendValidationContext = { diagnostics: [] }
  if (!assertBoundedBackendData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  if (!assertBackendSecretFreeData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  const parsed = parseTargetAuthority(value, '$', context)
  return parsed && context.diagnostics.length === 0
    ? { ok: true, value: parsed, diagnostics: [] }
    : { ok: false, diagnostics: context.diagnostics }
}

// oxlint-disable-next-line complexity -- Receipt parsing keeps all authority, outcome, schema, and evidence invariants in one fail-closed boundary.
function parseReceipt(
  value: unknown,
  context: BackendValidationContext
): StagedMigrationExecutionReceiptV1 | undefined {
  const source = record(value, '$', context, [
    'format',
    'version',
    'receiptId',
    'executionId',
    'executionPlanDigest',
    'phase',
    'promotionFrom',
    'targetAuthority',
    'schemaBeforeDigest',
    'schemaAfterDigest',
    'outcome',
    'recordedAt',
    'evidenceDigest'
  ])
  if (!source) return undefined
  if (source.format !== STAGED_MIGRATION_EXECUTION_RECEIPT_FORMAT)
    fail(
      context,
      'backend-staged-migration-receipt-format-unsupported',
      '$.format',
      'Staged migration receipt format is not supported.'
    )
  if (source.version !== STAGED_MIGRATION_EXECUTION_RECEIPT_VERSION)
    fail(
      context,
      'backend-staged-migration-receipt-version-unsupported',
      '$.version',
      'Staged migration receipt version is not supported.'
    )
  const receiptId = id(source.receiptId, '$.receiptId', context)
  const executionId = id(source.executionId, '$.executionId', context)
  const executionPlanDigest = digest(source.executionPlanDigest, '$.executionPlanDigest', context)
  const phase = oneOf(source.phase, '$.phase', context, PHASES)
  const promotionFrom = oneOf(source.promotionFrom, '$.promotionFrom', context, PROMOTION_SOURCES)
  const targetAuthority = parseTargetAuthority(source.targetAuthority, '$.targetAuthority', context)
  const schemaBeforeDigest = digest(source.schemaBeforeDigest, '$.schemaBeforeDigest', context)
  const schemaAfterDigest = digest(source.schemaAfterDigest, '$.schemaAfterDigest', context)
  const outcome = oneOf(source.outcome, '$.outcome', context, [
    'succeeded',
    'failed',
    'outcome-unknown'
  ])
  const recordedAt = timestamp(source.recordedAt, '$.recordedAt', context)
  let evidenceDigest: string | null | undefined
  if (source.evidenceDigest === null) evidenceDigest = null
  else evidenceDigest = digest(source.evidenceDigest, '$.evidenceDigest', context)
  if (outcome === 'succeeded' && evidenceDigest === null)
    fail(
      context,
      'backend-staged-migration-receipt-evidence-required',
      '$.evidenceDigest',
      'Successful execution requires evidence.'
    )
  if (outcome && outcome !== 'succeeded' && evidenceDigest !== null)
    fail(
      context,
      'backend-staged-migration-receipt-evidence-unexpected',
      '$.evidenceDigest',
      'Failed or unknown execution cannot claim success evidence.'
    )
  if (
    promotionFrom &&
    targetAuthority &&
    !isPromotionStep(promotionFrom, targetAuthority.environment)
  )
    fail(
      context,
      'backend-staged-migration-receipt-promotion-step-invalid',
      '$.targetAuthority.environment',
      'Receipt authority must follow source to dev to staging to production.'
    )
  if (
    source.format !== STAGED_MIGRATION_EXECUTION_RECEIPT_FORMAT ||
    source.version !== STAGED_MIGRATION_EXECUTION_RECEIPT_VERSION ||
    !receiptId ||
    !executionId ||
    !executionPlanDigest ||
    !phase ||
    !promotionFrom ||
    !targetAuthority ||
    !schemaBeforeDigest ||
    !schemaAfterDigest ||
    !outcome ||
    !recordedAt ||
    evidenceDigest === undefined ||
    context.diagnostics.length > 0
  )
    return undefined
  return {
    format: STAGED_MIGRATION_EXECUTION_RECEIPT_FORMAT,
    version: STAGED_MIGRATION_EXECUTION_RECEIPT_VERSION,
    receiptId,
    executionId,
    executionPlanDigest,
    phase,
    promotionFrom,
    targetAuthority,
    schemaBeforeDigest,
    schemaAfterDigest,
    outcome,
    recordedAt,
    evidenceDigest
  }
}

export function validateStagedMigrationExecutionReceipt(
  value: unknown
): BackendValidationResult<StagedMigrationExecutionReceiptV1> {
  const context: BackendValidationContext = { diagnostics: [] }
  if (!assertBoundedBackendData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  if (!assertBackendSecretFreeData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  const parsed = parseReceipt(value, context)
  return parsed && context.diagnostics.length === 0
    ? { ok: true, value: parsed, diagnostics: [] }
    : { ok: false, diagnostics: context.diagnostics }
}

function requireReceipt(value: unknown): StagedMigrationExecutionReceiptV1 {
  const parsed = validateStagedMigrationExecutionReceipt(value)
  if (!parsed.ok)
    throw new TypeError(
      `Staged migration receipt validation failed: ${parsed.diagnostics.map((entry) => entry.code).join(', ')}`
    )
  return parsed.value
}

// oxlint-disable-next-line open-pencil/no-useless-pass-through-wrappers -- Public normalization is an intentional throwing API alongside result-based validation.
export function normalizeStagedMigrationExecutionReceipt(
  value: unknown
): StagedMigrationExecutionReceiptV1 {
  return requireReceipt(value)
}

export function canonicalStagedMigrationExecutionReceiptBytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(requireReceipt(value))
}

export async function digestStagedMigrationExecutionReceipt(value: unknown): Promise<string> {
  return digestCanonicalManifest(requireReceipt(value))
}
