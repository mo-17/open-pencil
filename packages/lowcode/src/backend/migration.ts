import { canonicalManifestBytes } from '@open-pencil/scene-graph'

import { digestDataModel } from './canonical'
import { BACKEND_LIMITS } from './limits'
import { parseMigrationOperation } from './migration-operation-validation'
import { assertBackendSecretFreeData } from './secret-boundary'
import {
  MIGRATION_PLAN_VERSION,
  type BackendValidationResult,
  type DataEntityIR,
  type DataFieldIR,
  type DataModelIR,
  type MigrationOperation,
  type MigrationPlan,
  type MigrationPlanOperation,
  type MigrationRiskLevel
} from './types'
import { validateDataModelIR } from './validate'
import {
  array,
  assertBoundedBackendData,
  boundedText,
  id,
  oneOf,
  record,
  uniqueBy,
  type BackendUnknownRecord,
  type BackendValidationContext
} from './validation-helpers'

const RISK_ORDER: readonly MigrationRiskLevel[] = ['low', 'medium', 'high', 'destructive']
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const LOW_RISK_OPERATIONS = new Set<MigrationOperation['kind']>([
  'create-enum',
  'add-enum-value',
  'create-entity',
  'add-index'
])
const MEDIUM_RISK_OPERATIONS = new Set<MigrationOperation['kind']>([
  'rename-entity',
  'rename-field',
  'drop-index'
])
const HIGH_RISK_OPERATIONS = new Set<MigrationOperation['kind']>([
  'add-primary-key',
  'add-foreign-key',
  'add-unique'
])

export function classifyMigrationOperationRisk(operation: MigrationOperation): MigrationRiskLevel {
  if (LOW_RISK_OPERATIONS.has(operation.kind)) return 'low'
  if (MEDIUM_RISK_OPERATIONS.has(operation.kind)) return 'medium'
  if (HIGH_RISK_OPERATIONS.has(operation.kind)) return 'high'
  if (operation.kind === 'add-field') {
    return operation.field.nullable ? 'low' : 'high'
  }
  if (operation.kind === 'alter-field') {
    return operation.change === 'drop-not-null' || operation.change === 'widen-type'
      ? 'medium'
      : 'high'
  }
  return 'destructive'
}

function operationReason(operation: MigrationOperation): string {
  switch (classifyMigrationOperationRisk(operation)) {
    case 'low':
      return 'Additive schema change with no required destructive data operation.'
    case 'medium':
      return 'Schema metadata or compatibility change requires review.'
    case 'high':
      return 'Constraint, type, or nullability change may reject existing data.'
    case 'destructive':
      return 'Operation can remove or rewrite existing data and requires a backup and explicit confirmation.'
    default:
      throw new TypeError('Unsupported migration risk level.')
  }
}

function equalCanonical(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalManifestBytes(left)
  const rightBytes = canonicalManifestBytes(right)
  if (leftBytes.byteLength !== rightBytes.byteLength) return false
  return leftBytes.every((value, index) => rightBytes[index] === value)
}

function wideningFieldType(current: DataFieldIR, target: DataFieldIR): boolean {
  return current.type === 'integer' && target.type === 'number'
}

function nextOperationId(index: number): string {
  return `op-${String(index + 1).padStart(4, '0')}`
}

type MigrationOperationInput = MigrationOperation extends infer Operation
  ? Operation extends MigrationOperation
    ? Omit<Operation, 'id'>
    : never
  : never

function emitOperation(operations: MigrationOperation[], operation: MigrationOperationInput): void {
  operations.push({ id: nextOperationId(operations.length), ...operation } as MigrationOperation)
}

function diffNamedEntries<T extends { id: string }>(
  current: readonly T[],
  target: readonly T[],
  add: (entry: T) => void,
  drop: (entry: T) => void,
  replace: (currentEntry: T, targetEntry: T) => void
): void {
  const currentById = new Map(current.map((entry) => [entry.id, entry]))
  const targetById = new Map(target.map((entry) => [entry.id, entry]))
  for (const entry of current) {
    const next = targetById.get(entry.id)
    if (!next) drop(entry)
    else if (!equalCanonical(entry, next)) replace(entry, next)
  }
  for (const entry of target) {
    if (!currentById.has(entry.id)) add(entry)
  }
}

function diffEntity(
  current: DataEntityIR,
  target: DataEntityIR,
  operations: MigrationOperation[]
): void {
  if (current.name !== target.name) {
    emitOperation(operations, {
      kind: 'rename-entity',
      entityId: current.id,
      nextName: target.name
    })
  }
  diffNamedEntries(
    current.fields,
    target.fields,
    (field) => emitOperation(operations, { kind: 'add-field', entityId: target.id, field }),
    (field) =>
      emitOperation(operations, { kind: 'drop-field', entityId: current.id, fieldId: field.id }),
    (currentField, targetField) => {
      if (currentField.name !== targetField.name) {
        emitOperation(operations, {
          kind: 'rename-field',
          entityId: target.id,
          fieldId: currentField.id,
          nextName: targetField.name
        })
      }
      if (currentField.type !== targetField.type || currentField.enumId !== targetField.enumId) {
        emitOperation(operations, {
          kind: 'alter-field',
          entityId: target.id,
          fieldId: currentField.id,
          change: wideningFieldType(currentField, targetField) ? 'widen-type' : 'narrow-type',
          nextField: targetField
        })
      }
      if (currentField.nullable !== targetField.nullable) {
        emitOperation(operations, {
          kind: 'alter-field',
          entityId: target.id,
          fieldId: currentField.id,
          change: targetField.nullable ? 'drop-not-null' : 'set-not-null',
          nextField: targetField
        })
      }
      if (!equalCanonical(currentField.default ?? null, targetField.default ?? null)) {
        emitOperation(operations, {
          kind: 'alter-field',
          entityId: target.id,
          fieldId: currentField.id,
          change: 'change-default',
          nextField: targetField
        })
      }
    }
  )
  if (!equalCanonical(current.primaryKey ?? null, target.primaryKey ?? null)) {
    if (current.primaryKey)
      emitOperation(operations, { kind: 'drop-primary-key', entityId: current.id })
    if (target.primaryKey) {
      emitOperation(operations, {
        kind: 'add-primary-key',
        entityId: target.id,
        fields: target.primaryKey.fields
      })
    }
  }
  diffNamedEntries(
    current.foreignKeys ?? [],
    target.foreignKeys ?? [],
    (foreignKey) =>
      emitOperation(operations, { kind: 'add-foreign-key', entityId: target.id, foreignKey }),
    (foreignKey) =>
      emitOperation(operations, {
        kind: 'drop-foreign-key',
        entityId: current.id,
        foreignKeyId: foreignKey.id
      }),
    (currentForeignKey, targetForeignKey) => {
      emitOperation(operations, {
        kind: 'drop-foreign-key',
        entityId: current.id,
        foreignKeyId: currentForeignKey.id
      })
      emitOperation(operations, {
        kind: 'add-foreign-key',
        entityId: target.id,
        foreignKey: targetForeignKey
      })
    }
  )
  diffNamedEntries(
    current.uniques ?? [],
    target.uniques ?? [],
    (unique) => emitOperation(operations, { kind: 'add-unique', entityId: target.id, unique }),
    (unique) =>
      emitOperation(operations, { kind: 'drop-unique', entityId: current.id, uniqueId: unique.id }),
    (currentUnique, targetUnique) => {
      emitOperation(operations, {
        kind: 'drop-unique',
        entityId: current.id,
        uniqueId: currentUnique.id
      })
      emitOperation(operations, { kind: 'add-unique', entityId: target.id, unique: targetUnique })
    }
  )
  diffNamedEntries(
    current.indexes ?? [],
    target.indexes ?? [],
    (index) => emitOperation(operations, { kind: 'add-index', entityId: target.id, index }),
    (index) =>
      emitOperation(operations, { kind: 'drop-index', entityId: current.id, indexId: index.id }),
    (currentIndex, targetIndex) => {
      emitOperation(operations, {
        kind: 'drop-index',
        entityId: current.id,
        indexId: currentIndex.id
      })
      emitOperation(operations, { kind: 'add-index', entityId: target.id, index: targetIndex })
    }
  )
}

function planOperations(current: DataModelIR, target: DataModelIR): MigrationOperation[] {
  const operations: MigrationOperation[] = []
  diffNamedEntries(
    current.enums,
    target.enums,
    (entry) => emitOperation(operations, { kind: 'create-enum', enum: entry }),
    (entry) => emitOperation(operations, { kind: 'drop-enum', enumId: entry.id }),
    (currentEnum, targetEnum) => {
      for (const value of currentEnum.values) {
        if (!targetEnum.values.includes(value)) {
          emitOperation(operations, { kind: 'drop-enum-value', enumId: currentEnum.id, value })
        }
      }
      for (const value of targetEnum.values) {
        if (!currentEnum.values.includes(value)) {
          emitOperation(operations, { kind: 'add-enum-value', enumId: targetEnum.id, value })
        }
      }
    }
  )
  const currentById = new Map(current.entities.map((entry) => [entry.id, entry]))
  const targetById = new Map(target.entities.map((entry) => [entry.id, entry]))
  for (const entity of current.entities) {
    const next = targetById.get(entity.id)
    if (entity.management === 'managed' && (!next || next.management === 'external')) {
      emitOperation(operations, { kind: 'drop-entity', entityId: entity.id })
    } else if (entity.management === 'managed' && next?.management === 'managed') {
      diffEntity(entity, next, operations)
    }
  }
  for (const entity of target.entities) {
    const previous = currentById.get(entity.id)
    if (entity.management === 'managed' && (!previous || previous.management === 'external')) {
      emitOperation(operations, { kind: 'create-entity', entity })
    }
  }
  return operations
}

function highestRisk(operations: readonly MigrationPlanOperation[]): MigrationRiskLevel {
  return operations.reduce<MigrationRiskLevel>(
    (highest, entry) =>
      RISK_ORDER.indexOf(entry.risk) > RISK_ORDER.indexOf(highest) ? entry.risk : highest,
    'low'
  )
}

export async function planBackendMigration(
  current: unknown,
  target: unknown
): Promise<MigrationPlan> {
  const parsedCurrent = validateDataModelIR(current)
  const parsedTarget = validateDataModelIR(target)
  if (!parsedCurrent.ok || !parsedTarget.ok) {
    const codes = [
      ...(parsedCurrent.ok ? [] : parsedCurrent.diagnostics.map((entry) => entry.code)),
      ...(parsedTarget.ok ? [] : parsedTarget.diagnostics.map((entry) => entry.code))
    ]
    throw new TypeError(`Cannot plan an invalid backend model: ${codes.join(', ')}`)
  }
  const fromModelDigest = await digestDataModel(parsedCurrent.value)
  const targetModelDigest = await digestDataModel(parsedTarget.value)
  const operations = planOperations(parsedCurrent.value, parsedTarget.value).map((operation) => ({
    operation,
    risk: classifyMigrationOperationRisk(operation),
    reason: operationReason(operation)
  }))
  const risk = highestRisk(operations)
  return {
    version: MIGRATION_PLAN_VERSION,
    planId: `migration:${fromModelDigest.slice(0, 16)}:${targetModelDigest.slice(0, 16)}`,
    fromModelDigest,
    targetModelDigest,
    operations,
    highestRisk: risk,
    requiresBackup: risk === 'high' || risk === 'destructive'
  }
}

function migrationDigest(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  required: boolean
): string | undefined {
  if (value === undefined && !required) return undefined
  if (typeof value === 'string' && DIGEST.test(value)) return value
  context.diagnostics.push({
    code: 'backend-migration-digest-invalid',
    severity: 'error',
    path,
    message: `${required ? 'Target' : 'Source'} model digest must be canonical SHA-256 base64url.`
  })
  return undefined
}

function parsedMigrationPlanOperation(
  entry: unknown,
  index: number,
  context: BackendValidationContext
): MigrationPlanOperation | undefined {
  const path = `$.operations[${index}]`
  const wrapper = record(entry, path, context, ['operation', 'risk', 'reason'])
  if (!wrapper) return undefined
  const operation = parseMigrationOperation(wrapper.operation, `${path}.operation`, context)
  const risk = oneOf(wrapper.risk, `${path}.risk`, context, RISK_ORDER)
  const reason = boundedText(
    wrapper.reason,
    `${path}.reason`,
    context,
    BACKEND_LIMITS.maxReasonLength
  )
  if (operation && risk && risk !== classifyMigrationOperationRisk(operation)) {
    context.diagnostics.push({
      code: 'backend-migration-risk-mismatch',
      severity: 'error',
      path: `${path}.risk`,
      message: 'Migration risk must be derived from the operation.'
    })
  }
  return operation && risk && reason ? { operation, risk, reason } : undefined
}

function validateDerivedMigrationFields(
  source: BackendUnknownRecord,
  operations: readonly MigrationPlanOperation[],
  context: BackendValidationContext
): {
  declaredHighest: MigrationRiskLevel | undefined
  derivedHighest: MigrationRiskLevel
  derivedBackup: boolean
} {
  const derivedHighest = highestRisk(operations)
  const declaredHighest = oneOf(source.highestRisk, '$.highestRisk', context, RISK_ORDER)
  const derivedBackup = derivedHighest === 'high' || derivedHighest === 'destructive'
  if (declaredHighest && declaredHighest !== derivedHighest) {
    context.diagnostics.push({
      code: 'backend-migration-highest-risk-mismatch',
      severity: 'error',
      path: '$.highestRisk',
      message: 'Highest risk must be derived from all operations.'
    })
  }
  if (source.requiresBackup !== derivedBackup) {
    context.diagnostics.push({
      code: 'backend-migration-backup-mismatch',
      severity: 'error',
      path: '$.requiresBackup',
      message: 'Backup requirement must be derived from migration risk.'
    })
  }
  return { declaredHighest, derivedHighest, derivedBackup }
}

export function validateMigrationPlan(value: unknown): BackendValidationResult<MigrationPlan> {
  const context: BackendValidationContext = { diagnostics: [] }
  if (!assertBoundedBackendData(value, context))
    return { ok: false, diagnostics: context.diagnostics }
  if (!assertBackendSecretFreeData(value, context)) {
    return { ok: false, diagnostics: context.diagnostics }
  }
  const source = record(
    value,
    '$',
    context,
    [
      'version',
      'planId',
      'fromModelDigest',
      'targetModelDigest',
      'operations',
      'highestRisk',
      'requiresBackup'
    ],
    ['version', 'planId', 'targetModelDigest', 'operations', 'highestRisk', 'requiresBackup']
  )
  if (!source) return { ok: false, diagnostics: context.diagnostics }
  if (source.version !== MIGRATION_PLAN_VERSION) {
    context.diagnostics.push({
      code: 'backend-migration-version-unsupported',
      severity: 'error',
      path: '$.version',
      message: 'Migration plan version is not supported.'
    })
  }
  const planId = id(source.planId, '$.planId', context)
  const targetModelDigest = migrationDigest(
    source.targetModelDigest,
    '$.targetModelDigest',
    context,
    true
  )
  const fromModelDigest = migrationDigest(
    source.fromModelDigest,
    '$.fromModelDigest',
    context,
    false
  )
  const rawOperations = array(
    source.operations,
    '$.operations',
    context,
    BACKEND_LIMITS.maxMigrationOperations
  )
  const operations = (rawOperations ?? [])
    .map((entry, index) => parsedMigrationPlanOperation(entry, index, context))
    .filter((entry): entry is MigrationPlanOperation => entry !== undefined)
  uniqueBy(
    operations.map((entry) => entry.operation.id),
    '$.operations',
    context,
    'operation id'
  )
  const { declaredHighest, derivedHighest, derivedBackup } = validateDerivedMigrationFields(
    source,
    operations,
    context
  )
  if (
    source.version !== MIGRATION_PLAN_VERSION ||
    !planId ||
    !targetModelDigest ||
    !rawOperations ||
    operations.length !== rawOperations.length ||
    !declaredHighest ||
    context.diagnostics.length > 0
  ) {
    return { ok: false, diagnostics: context.diagnostics }
  }
  return {
    ok: true,
    value: {
      version: MIGRATION_PLAN_VERSION,
      planId,
      ...(fromModelDigest ? { fromModelDigest } : {}),
      targetModelDigest,
      operations,
      highestRisk: derivedHighest,
      requiresBackup: derivedBackup
    },
    diagnostics: []
  }
}
