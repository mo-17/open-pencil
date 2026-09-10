import { discriminatedRecord } from '../discriminated-record'
import { parseBackendFieldDefault } from '../field-default-validation'
import type {
  AuthPolicyIR,
  BackendLiteral,
  BackendWorkflowIR,
  DataEntityIR,
  DataFieldIR,
  DataModelIR
} from '../types'
import {
  boundedText,
  id,
  oneOf,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext
} from '../validation-helpers'
import {
  BACKEND_DATA_MIGRATION_IR_VERSION,
  type BackendDataMigrationDefinitionIR,
  type BackendDataMigrationIRV1,
  type BackendDataMigrationPostconditionIR,
  type BackendDataMigrationPredicateIR,
  type BackendDataMigrationTransformIR,
  type BackendTransactionIRV1
} from './types'
import {
  integerBetween,
  literal,
  referencedEntity,
  validateFieldReference
} from './validation-helpers'

const MAX_DATA_MIGRATIONS = 256
const MAX_DATA_MIGRATION_TRANSFORMS = 64
const MAX_DATA_MIGRATION_POSTCONDITIONS = 64

const PREDICATE_SHAPES = {
  'field-is-null': { allowed: ['kind', 'fieldId'], required: ['kind', 'fieldId'] }
} as const

const TRANSFORM_SHAPES = {
  'set-literal': {
    allowed: ['kind', 'fieldId', 'value'],
    required: ['kind', 'fieldId', 'value']
  },
  'copy-field': {
    allowed: ['kind', 'sourceFieldId', 'targetFieldId'],
    required: ['kind', 'sourceFieldId', 'targetFieldId']
  }
} as const

const POSTCONDITION_SHAPES = {
  'field-not-null': { allowed: ['kind', 'fieldId'], required: ['kind', 'fieldId'] },
  'matched-row-count': { allowed: ['kind', 'minimum'], required: ['kind', 'minimum'] }
} as const

function cursor(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendDataMigrationDefinitionIR['cursor'] | undefined {
  const source = record(value, path, context, ['kind', 'fieldId'])
  if (!source) return undefined
  const kind = oneOf(source.kind, `${path}.kind`, context, ['monotonic-identity-primary-key'])
  const fieldId = id(source.fieldId, `${path}.fieldId`, context)
  return kind && fieldId ? { kind, fieldId } : undefined
}

function predicate(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendDataMigrationPredicateIR | undefined {
  const parsed = discriminatedRecord(value, path, context, PREDICATE_SHAPES)
  if (!parsed) return undefined
  const fieldId = id(parsed.source.fieldId, `${path}.fieldId`, context)
  return fieldId ? { kind: parsed.kind, fieldId } : undefined
}

function transform(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendDataMigrationTransformIR | undefined {
  const parsed = discriminatedRecord(value, path, context, TRANSFORM_SHAPES)
  if (!parsed) return undefined
  if (parsed.kind === 'set-literal') {
    const fieldId = id(parsed.source.fieldId, `${path}.fieldId`, context)
    const parsedLiteral = literal(parsed.source.value, `${path}.value`, context)
    if (parsedLiteral === null) {
      context.diagnostics.push({
        code: 'backend-data-migration-null-backfill',
        severity: 'error',
        path: `${path}.value`,
        message: 'A backfill transform cannot set its target field to null.'
      })
      return undefined
    }
    return fieldId && parsedLiteral !== undefined
      ? { kind: parsed.kind, fieldId, value: parsedLiteral }
      : undefined
  }
  const sourceFieldId = id(parsed.source.sourceFieldId, `${path}.sourceFieldId`, context)
  const targetFieldId = id(parsed.source.targetFieldId, `${path}.targetFieldId`, context)
  return sourceFieldId && targetFieldId
    ? { kind: parsed.kind, sourceFieldId, targetFieldId }
    : undefined
}

function postcondition(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendDataMigrationPostconditionIR | undefined {
  const parsed = discriminatedRecord(value, path, context, POSTCONDITION_SHAPES)
  if (!parsed) return undefined
  if (parsed.kind === 'field-not-null') {
    const fieldId = id(parsed.source.fieldId, `${path}.fieldId`, context)
    return fieldId ? { kind: parsed.kind, fieldId } : undefined
  }
  const minimum = integerBetween(
    parsed.source.minimum,
    `${path}.minimum`,
    context,
    0,
    Number.MAX_SAFE_INTEGER
  )
  return minimum !== undefined ? { kind: parsed.kind, minimum } : undefined
}

function dataMigrationDefinition(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendDataMigrationDefinitionIR | undefined {
  const source = record(value, path, context, [
    'id',
    'name',
    'entityId',
    'cursor',
    'batchSize',
    'predicate',
    'transforms',
    'postconditions',
    'dryRunRequired',
    'resumePolicy'
  ])
  if (!source) return undefined
  const migrationId = id(source.id, `${path}.id`, context)
  const name = boundedText(source.name, `${path}.name`, context, 128)
  const entityId = id(source.entityId, `${path}.entityId`, context)
  const parsedCursor = cursor(source.cursor, `${path}.cursor`, context)
  const batchSize = integerBetween(source.batchSize, `${path}.batchSize`, context, 1, 1_000)
  const parsedPredicate = predicate(source.predicate, `${path}.predicate`, context)
  const transforms = parseArrayItems(
    source.transforms,
    `${path}.transforms`,
    context,
    MAX_DATA_MIGRATION_TRANSFORMS,
    transform
  )
  if (transforms?.length !== 1) {
    context.diagnostics.push({
      code: 'backend-data-migration-transform-required',
      severity: 'error',
      path: `${path}.transforms`,
      message: 'Safe backfills require exactly one bounded target transform.'
    })
  }
  const postconditions = parseArrayItems(
    source.postconditions,
    `${path}.postconditions`,
    context,
    MAX_DATA_MIGRATION_POSTCONDITIONS,
    postcondition
  )
  if (postconditions?.length === 0) {
    context.diagnostics.push({
      code: 'backend-data-migration-postcondition-required',
      severity: 'error',
      path: `${path}.postconditions`,
      message: 'Data migrations require at least one bounded postcondition.'
    })
  }
  if (source.dryRunRequired !== true) {
    context.diagnostics.push({
      code: 'backend-data-migration-dry-run-required',
      severity: 'error',
      path: `${path}.dryRunRequired`,
      message: 'Data migrations must require a dry run before Apply.'
    })
  }
  if (source.resumePolicy !== 'from-receipt') {
    context.diagnostics.push({
      code: 'backend-data-migration-resume-policy-invalid',
      severity: 'error',
      path: `${path}.resumePolicy`,
      message: 'Data migrations must resume from a verified execution receipt.'
    })
  }
  return migrationId &&
    name &&
    entityId &&
    parsedCursor &&
    batchSize !== undefined &&
    parsedPredicate &&
    transforms?.length === 1 &&
    postconditions?.length &&
    source.dryRunRequired === true &&
    source.resumePolicy === 'from-receipt'
    ? {
        id: migrationId,
        name,
        entityId,
        cursor: parsedCursor,
        batchSize,
        predicate: parsedPredicate,
        transforms,
        postconditions,
        dryRunRequired: true,
        resumePolicy: 'from-receipt'
      }
    : undefined
}

function workflowMutatesField(
  workflows: BackendWorkflowIR,
  entityId: string,
  fieldId: string
): boolean {
  const walk = (steps: BackendWorkflowIR['workflows'][number]['steps']): boolean =>
    steps.some((step) => {
      if (step.kind === 'branch') return walk(step.consequent) || walk(step.alternate)
      return (
        step.kind === 'data.mutate' &&
        step.entityId === entityId &&
        (step.operation === 'update' || step.operation === 'upsert') &&
        Boolean(step.values?.some((entry) => entry.field === fieldId))
      )
    })
  return workflows.workflows.some((workflow) => walk(workflow.steps))
}

function transactionMutatesField(
  transactions: BackendTransactionIRV1,
  entityId: string,
  fieldId: string
): boolean {
  return transactions.transactions.some((transaction) =>
    transaction.steps.some(
      (step) =>
        step.kind === 'data.mutate' &&
        step.entityId === entityId &&
        (step.operation === 'update' || step.operation === 'upsert') &&
        Boolean(
          step.values?.some((entry) => entry.field === fieldId) ||
          step.increments?.some((entry) => entry.field === fieldId)
        )
    )
  )
}

function cursorIsStable(
  migration: BackendDataMigrationDefinitionIR,
  entity: DataEntityIR,
  workflows: BackendWorkflowIR,
  transactions: BackendTransactionIRV1
): boolean {
  const fieldId = migration.cursor.fieldId
  const field = entity.fields.find((entry) => entry.id === fieldId)
  if (!field || field.nullable) return false
  if (
    workflowMutatesField(workflows, entity.id, fieldId) ||
    transactionMutatesField(transactions, entity.id, fieldId)
  ) {
    return false
  }
  const primary = entity.primaryKey?.fields.length === 1 && entity.primaryKey.fields[0] === fieldId
  const identity = field.default?.kind === 'generated' && field.default.generator === 'identity'
  return Boolean(primary && field.type === 'integer' && identity)
}

function protectedMigrationFields(
  model: DataModelIR,
  auth: AuthPolicyIR,
  entity: DataEntityIR
): ReadonlySet<string> {
  const protectedFields = new Set(entity.primaryKey?.fields)
  for (const foreignKey of entity.foreignKeys ?? []) {
    for (const field of foreignKey.fields) protectedFields.add(field)
  }
  for (const candidate of model.entities) {
    for (const foreignKey of candidate.foreignKeys ?? []) {
      if (foreignKey.targetEntityId !== entity.id) continue
      for (const field of foreignKey.targetFields) protectedFields.add(field)
    }
  }
  for (const ownership of auth.ownership) {
    if (ownership.entityId === entity.id) protectedFields.add(ownership.identityFieldId)
  }
  for (const tenant of auth.tenants) {
    if (tenant.entityId === entity.id) protectedFields.add(tenant.tenantFieldId)
    if (tenant.membershipEntityId !== entity.id) continue
    if (tenant.membershipIdentityFieldId) protectedFields.add(tenant.membershipIdentityFieldId)
    if (tenant.membershipTenantFieldId) protectedFields.add(tenant.membershipTenantFieldId)
  }
  return protectedFields
}

function validateLiteralAgainstField(
  value: BackendLiteral,
  field: DataFieldIR | undefined,
  path: string,
  model: DataModelIR,
  context: BackendValidationContext
): void {
  if (!field) return
  const before = context.diagnostics.length
  parseBackendFieldDefault({ kind: 'literal', value }, path, context, field.type, field.nullable)
  if (context.diagnostics.length !== before || field.type !== 'enum' || typeof value !== 'string') {
    return
  }
  const values = model.enums.find((entry) => entry.id === field.enumId)?.values
  if (values?.includes(value)) return
  context.diagnostics.push({
    code: 'backend-data-migration-enum-literal-invalid',
    severity: 'error',
    path,
    message: 'Data migration enum literals must be declared by the referenced enum.'
  })
}

function transformTarget(entry: BackendDataMigrationTransformIR): string {
  return entry.kind === 'set-literal' ? entry.fieldId : entry.targetFieldId
}

function validateTransforms(
  migration: BackendDataMigrationDefinitionIR,
  entity: DataEntityIR,
  model: DataModelIR,
  auth: AuthPolicyIR,
  path: string,
  context: BackendValidationContext
): void {
  const fields = new Map(entity.fields.map((field) => [field.id, field]))
  const protectedFields = protectedMigrationFields(model, auth, entity)
  for (const [index, entry] of migration.transforms.entries()) {
    const transformPath = `${path}.transforms[${index}]`
    if (entry.kind === 'set-literal') {
      const field = fields.get(entry.fieldId)
      validateFieldReference(entity, entry.fieldId, `${transformPath}.fieldId`, context)
      validateLiteralAgainstField(entry.value, field, `${transformPath}.value`, model, context)
      if (protectedFields.has(entry.fieldId)) {
        context.diagnostics.push({
          code: 'backend-data-migration-security-field-forbidden',
          severity: 'error',
          path: `${transformPath}.fieldId`,
          message:
            'Backfills cannot mutate primary, foreign-key, owner, tenant, or membership fields.'
        })
      }
      continue
    }
    const source = fields.get(entry.sourceFieldId)
    const target = fields.get(entry.targetFieldId)
    validateFieldReference(entity, entry.sourceFieldId, `${transformPath}.sourceFieldId`, context)
    validateFieldReference(entity, entry.targetFieldId, `${transformPath}.targetFieldId`, context)
    if (source && target && (source.type !== target.type || source.enumId !== target.enumId)) {
      context.diagnostics.push({
        code: 'backend-data-migration-copy-type-mismatch',
        severity: 'error',
        path: transformPath,
        message: 'copy-field requires source and target fields with matching types.'
      })
    }
    if (protectedFields.has(entry.targetFieldId)) {
      context.diagnostics.push({
        code: 'backend-data-migration-security-field-forbidden',
        severity: 'error',
        path: `${transformPath}.targetFieldId`,
        message:
          'Backfills cannot mutate primary, foreign-key, owner, tenant, or membership fields.'
      })
    }
  }
  const targets = migration.transforms.map(transformTarget)
  uniqueBy(targets, `${path}.transforms`, context, 'data migration target field')
  if (targets[0] !== migration.predicate.fieldId) {
    context.diagnostics.push({
      code: 'backend-data-migration-predicate-target-mismatch',
      severity: 'error',
      path: `${path}.predicate.fieldId`,
      message: 'Safe backfills may only write rows where the same target field is null.'
    })
  }
  if (targets.includes(migration.cursor.fieldId)) {
    context.diagnostics.push({
      code: 'backend-data-migration-cursor-mutated',
      severity: 'error',
      path: `${path}.cursor.fieldId`,
      message: 'A resumable data migration cannot mutate its stable cursor field.'
    })
  }
  const notNullPostconditions = new Set(
    migration.postconditions.flatMap((entry) =>
      entry.kind === 'field-not-null' ? [entry.fieldId] : []
    )
  )
  for (const target of targets) {
    if (notNullPostconditions.has(target)) continue
    context.diagnostics.push({
      code: 'backend-data-migration-target-postcondition-missing',
      severity: 'error',
      path: `${path}.postconditions`,
      message: 'Every backfill target requires a field-not-null postcondition.'
    })
  }
}

function validateDataMigrationReferences(
  migrations: readonly BackendDataMigrationDefinitionIR[],
  model: DataModelIR,
  auth: AuthPolicyIR,
  workflows: BackendWorkflowIR,
  transactions: BackendTransactionIRV1,
  context: BackendValidationContext
): void {
  for (const [index, migration] of migrations.entries()) {
    const path = `$.dataMigrations.migrations[${index}]`
    const entity = referencedEntity(migration.entityId, `${path}.entityId`, model, context)
    if (!entity) continue
    if (entity.management !== 'managed') {
      context.diagnostics.push({
        code: 'backend-data-migration-external-entity-forbidden',
        severity: 'error',
        path: `${path}.entityId`,
        message: 'Data migrations cannot target an external entity with an unverified schema.'
      })
    }
    validateFieldReference(entity, migration.cursor.fieldId, `${path}.cursor.fieldId`, context)
    if (!cursorIsStable(migration, entity, workflows, transactions)) {
      context.diagnostics.push({
        code: 'backend-data-migration-cursor-unstable',
        severity: 'error',
        path: `${path}.cursor`,
        message:
          'The resume cursor must be a non-null, single-field integer identity primary key that the Provider proves is immutable and append-monotonic.'
      })
    }
    validateFieldReference(
      entity,
      migration.predicate.fieldId,
      `${path}.predicate.fieldId`,
      context
    )
    validateTransforms(migration, entity, model, auth, path, context)
    for (const [conditionIndex, condition] of migration.postconditions.entries()) {
      if (condition.kind === 'field-not-null') {
        validateFieldReference(
          entity,
          condition.fieldId,
          `${path}.postconditions[${conditionIndex}].fieldId`,
          context
        )
      }
    }
  }
}

export function parseBackendDataMigrationIRV1(
  value: unknown,
  path: string,
  model: DataModelIR,
  auth: AuthPolicyIR,
  workflows: BackendWorkflowIR,
  transactions: BackendTransactionIRV1,
  context: BackendValidationContext
): BackendDataMigrationIRV1 | undefined {
  const source = record(value, path, context, ['version', 'migrations'])
  if (!source) return undefined
  if (source.version !== BACKEND_DATA_MIGRATION_IR_VERSION) {
    context.diagnostics.push({
      code: 'backend-data-migration-version-unsupported',
      severity: 'error',
      path: `${path}.version`,
      message: 'Data migration IR version is not supported.'
    })
  }
  const migrations = parseArrayItems(
    source.migrations,
    `${path}.migrations`,
    context,
    MAX_DATA_MIGRATIONS,
    dataMigrationDefinition
  )
  if (!migrations) return undefined
  uniqueBy(
    migrations.map((entry) => entry.id),
    `${path}.migrations`,
    context,
    'data migration id'
  )
  validateDataMigrationReferences(migrations, model, auth, workflows, transactions, context)
  return source.version === BACKEND_DATA_MIGRATION_IR_VERSION
    ? {
        version: BACKEND_DATA_MIGRATION_IR_VERSION,
        migrations: sorted(migrations, (entry) => entry.id)
      }
    : undefined
}
