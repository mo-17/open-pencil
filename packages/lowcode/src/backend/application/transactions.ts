/* eslint-disable max-lines -- Transaction parsing and cross-reference checks form one fail-closed boundary. */
import { discriminatedRecord } from '../discriminated-record'
import { parseBackendFieldDefault } from '../field-default-validation'
import type {
  AuthPolicyIR,
  BackendFieldScalarType,
  DataEntityIR,
  DataFieldIR,
  DataModelIR
} from '../types'
import {
  array,
  boolean,
  boundedText,
  id,
  identifier,
  oneOf,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendUnknownRecord,
  type BackendValidationContext
} from '../validation-helpers'
import {
  BACKEND_TRANSACTION_IR_VERSION,
  type BackendTransactionAssertionIR,
  type BackendTransactionConflictPolicyIR,
  type BackendTransactionDefinitionIR,
  type BackendTransactionFilterIR,
  type BackendTransactionIncrementIR,
  type BackendTransactionIRV1,
  type BackendTransactionParameterIR,
  type BackendTransactionStepIR,
  type BackendTransactionValueIR,
  type BackendTransactionValueSourceIR
} from './types'
import {
  integerBetween,
  parseAuthPrincipalIntentV2,
  principalKey,
  parseTransactionValueSource,
  referencedEntity,
  validateFieldReference,
  validatePrincipalReference
} from './validation-helpers'

const MAX_TRANSACTIONS = 256
const MAX_TRANSACTION_PARAMETERS = 128
const MAX_TRANSACTION_STEPS = 256
const MAX_TRANSACTION_FIELDS = 256
const MAX_TOTAL_TRANSACTION_STEPS = 2_048

const TRANSACTION_VALUE_TYPES: readonly BackendFieldScalarType[] = [
  'string',
  'integer',
  'number',
  'boolean',
  'date',
  'datetime',
  'uuid',
  'json',
  'bytes'
]

const TRANSACTION_STEP_SHAPES = {
  'data.read': {
    allowed: ['id', 'kind', 'entityId', 'resultName', 'fields', 'filters', 'single', 'limit'],
    required: ['id', 'kind', 'entityId', 'resultName', 'limit']
  },
  'data.mutate': {
    allowed: [
      'id',
      'kind',
      'entityId',
      'operation',
      'values',
      'increments',
      'filters',
      'resultName',
      'maxAffectedRows'
    ],
    required: ['id', 'kind', 'entityId', 'operation', 'resultName', 'maxAffectedRows']
  },
  assert: { allowed: ['id', 'kind', 'assertion'], required: ['id', 'kind', 'assertion'] }
} as const

const TRANSACTION_ASSERTION_SHAPES = {
  'result-exists': { allowed: ['kind', 'resultName'], required: ['kind', 'resultName'] },
  'result-count': {
    allowed: ['kind', 'resultName', 'operator', 'value'],
    required: ['kind', 'resultName', 'operator', 'value']
  }
} as const

const TRANSACTION_CONFLICT_SHAPES = {
  fail: { allowed: ['kind'], required: ['kind'] },
  'expected-version': {
    allowed: ['kind', 'entityId', 'fieldId', 'parameter'],
    required: ['kind', 'entityId', 'fieldId', 'parameter']
  }
} as const

interface TransactionParseState {
  stepCount: number
}

function parameter(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendTransactionParameterIR | undefined {
  const source = record(value, path, context, ['name', 'type', 'required'])
  if (!source) return undefined
  const name = identifier(source.name, `${path}.name`, context)
  const type = oneOf(source.type, `${path}.type`, context, TRANSACTION_VALUE_TYPES)
  const required = boolean(source.required, `${path}.required`, context)
  return name && type && required !== undefined ? { name, type, required } : undefined
}

function filter(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendTransactionFilterIR | undefined {
  const source = record(value, path, context, ['field', 'operator', 'value'])
  if (!source) return undefined
  const field = id(source.field, `${path}.field`, context)
  const operator = oneOf(source.operator, `${path}.operator`, context, [
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'like',
    'in'
  ])
  const parsedValue = parseTransactionValueSource(source.value, `${path}.value`, context)
  return field && operator && parsedValue ? { field, operator, value: parsedValue } : undefined
}

function dataValue(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendTransactionValueIR | undefined {
  const source = record(value, path, context, ['field', 'value'])
  if (!source) return undefined
  const field = id(source.field, `${path}.field`, context)
  const parsedValue = parseTransactionValueSource(source.value, `${path}.value`, context)
  return field && parsedValue ? { field, value: parsedValue } : undefined
}

function increment(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendTransactionIncrementIR | undefined {
  const source = record(value, path, context, ['field', 'by'])
  if (!source) return undefined
  const field = id(source.field, `${path}.field`, context)
  if (source.by !== 1) {
    context.diagnostics.push({
      code: 'backend-transaction-increment-invalid',
      severity: 'error',
      path: `${path}.by`,
      message: 'Host-controlled atomic increments are fixed to one.'
    })
  }
  return field && source.by === 1 ? { field, by: 1 } : undefined
}

function dataReadStep(
  source: BackendUnknownRecord,
  stepId: string,
  path: string,
  context: BackendValidationContext
): BackendTransactionStepIR | undefined {
  const entityId = id(source.entityId, `${path}.entityId`, context)
  const resultName = identifier(source.resultName, `${path}.resultName`, context)
  const rawFields =
    source.fields === undefined
      ? undefined
      : array(source.fields, `${path}.fields`, context, MAX_TRANSACTION_FIELDS)
  const fields = rawFields
    ?.map((entry, index) => id(entry, `${path}.fields[${index}]`, context))
    .filter((entry): entry is string => entry !== undefined)
  if (fields) uniqueBy(fields, `${path}.fields`, context, 'transaction read field')
  const filters = parseArrayItems(
    source.filters,
    `${path}.filters`,
    context,
    MAX_TRANSACTION_FIELDS,
    filter,
    true
  )
  const single =
    source.single === undefined ? undefined : boolean(source.single, `${path}.single`, context)
  const limit = integerBetween(source.limit, `${path}.limit`, context, 1, 1_000)
  if (single === true && limit !== undefined && limit !== 1) {
    context.diagnostics.push({
      code: 'backend-transaction-single-limit-invalid',
      severity: 'error',
      path: `${path}.limit`,
      message: 'A single-row read must use limit one.'
    })
  }
  if (
    !entityId ||
    !resultName ||
    limit === undefined ||
    (rawFields && fields?.length !== rawFields.length)
  ) {
    return undefined
  }
  return {
    id: stepId,
    kind: 'data.read',
    entityId,
    resultName,
    limit,
    ...(fields?.length ? { fields } : {}),
    ...(filters?.length ? { filters } : {}),
    ...(single !== undefined ? { single } : {})
  }
}

function safeMutationShape(
  operation: Extract<BackendTransactionStepIR, { kind: 'data.mutate' }>['operation'],
  values: readonly BackendTransactionValueIR[] | undefined,
  increments: readonly BackendTransactionIncrementIR[] | undefined,
  filters: readonly BackendTransactionFilterIR[] | undefined,
  path: string,
  context: BackendValidationContext
): boolean {
  const hasValues = Boolean(values?.length || increments?.length)
  const hasFilters = Boolean(filters?.length)
  let safe = hasFilters
  if (operation === 'insert' || operation === 'upsert') safe = hasValues
  if (operation === 'update') safe = hasValues && hasFilters
  if (safe) return true
  context.diagnostics.push({
    code: 'backend-transaction-mutation-unsafe',
    severity: 'error',
    path,
    message:
      'Insert and upsert require values; update requires values and filters; delete requires filters.'
  })
  return false
}

function dataMutateStep(
  source: BackendUnknownRecord,
  stepId: string,
  path: string,
  context: BackendValidationContext
): BackendTransactionStepIR | undefined {
  const entityId = id(source.entityId, `${path}.entityId`, context)
  const operation = oneOf(source.operation, `${path}.operation`, context, [
    'insert',
    'update',
    'delete',
    'upsert'
  ])
  const values = parseArrayItems(
    source.values,
    `${path}.values`,
    context,
    MAX_TRANSACTION_FIELDS,
    dataValue,
    true
  )
  if (values) {
    uniqueBy(
      values.map((entry) => entry.field),
      `${path}.values`,
      context,
      'transaction mutation field'
    )
  }
  const increments = parseArrayItems(
    source.increments,
    `${path}.increments`,
    context,
    MAX_TRANSACTION_FIELDS,
    increment,
    true
  )
  if (increments) {
    uniqueBy(
      increments.map((entry) => entry.field),
      `${path}.increments`,
      context,
      'transaction increment field'
    )
  }
  const assignedFields = new Set(values?.map((entry) => entry.field))
  for (const [index, entry] of (increments ?? []).entries()) {
    if (!assignedFields.has(entry.field)) continue
    context.diagnostics.push({
      code: 'backend-transaction-field-write-conflict',
      severity: 'error',
      path: `${path}.increments[${index}].field`,
      message: 'A mutation cannot both assign and atomically increment the same field.'
    })
  }
  const filters = parseArrayItems(
    source.filters,
    `${path}.filters`,
    context,
    MAX_TRANSACTION_FIELDS,
    filter,
    true
  )
  const resultName = identifier(source.resultName, `${path}.resultName`, context)
  const maxAffectedRows = integerBetween(
    source.maxAffectedRows,
    `${path}.maxAffectedRows`,
    context,
    1,
    1_000
  )
  if (
    !entityId ||
    !operation ||
    !resultName ||
    maxAffectedRows === undefined ||
    !safeMutationShape(operation, values, increments, filters, path, context)
  ) {
    return undefined
  }
  return {
    id: stepId,
    kind: 'data.mutate',
    entityId,
    operation,
    ...(values?.length ? { values } : {}),
    ...(increments?.length ? { increments } : {}),
    ...(filters?.length ? { filters } : {}),
    resultName,
    maxAffectedRows
  }
}

function assertion(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendTransactionAssertionIR | undefined {
  const parsed = discriminatedRecord(value, path, context, TRANSACTION_ASSERTION_SHAPES)
  if (!parsed) return undefined
  const resultName = identifier(parsed.source.resultName, `${path}.resultName`, context)
  if (parsed.kind === 'result-exists')
    return resultName ? { kind: parsed.kind, resultName } : undefined
  const operator = oneOf(parsed.source.operator, `${path}.operator`, context, ['eq', 'gte', 'lte'])
  const count = integerBetween(parsed.source.value, `${path}.value`, context, 0, 1_000_000_000)
  return resultName && operator && count !== undefined
    ? { kind: parsed.kind, resultName, operator, value: count }
    : undefined
}

function transactionStep(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  state: TransactionParseState
): BackendTransactionStepIR | undefined {
  state.stepCount++
  if (state.stepCount > MAX_TOTAL_TRANSACTION_STEPS) {
    context.diagnostics.push({
      code: 'backend-transaction-step-limit',
      severity: 'error',
      path,
      message: `Transactions may contain at most ${MAX_TOTAL_TRANSACTION_STEPS} total steps.`
    })
    return undefined
  }
  const parsed = discriminatedRecord(value, path, context, TRANSACTION_STEP_SHAPES)
  if (!parsed) return undefined
  const stepId = id(parsed.source.id, `${path}.id`, context)
  if (!stepId) return undefined
  if (parsed.kind === 'data.read') return dataReadStep(parsed.source, stepId, path, context)
  if (parsed.kind === 'data.mutate') return dataMutateStep(parsed.source, stepId, path, context)
  const parsedAssertion = assertion(parsed.source.assertion, `${path}.assertion`, context)
  return parsedAssertion ? { id: stepId, kind: 'assert', assertion: parsedAssertion } : undefined
}

function conflictPolicy(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendTransactionConflictPolicyIR | undefined {
  const parsed = discriminatedRecord(value, path, context, TRANSACTION_CONFLICT_SHAPES)
  if (!parsed) return undefined
  if (parsed.kind === 'fail') return { kind: 'fail' }
  const entityId = id(parsed.source.entityId, `${path}.entityId`, context)
  const fieldId = id(parsed.source.fieldId, `${path}.fieldId`, context)
  const parameterName = identifier(parsed.source.parameter, `${path}.parameter`, context)
  return entityId && fieldId && parameterName
    ? { kind: parsed.kind, entityId, fieldId, parameter: parameterName }
    : undefined
}

function transactionDefinition(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  state: TransactionParseState
): BackendTransactionDefinitionIR | undefined {
  const source = record(value, path, context, [
    'id',
    'name',
    'access',
    'principal',
    'isolation',
    'parameters',
    'conflictPolicy',
    'steps'
  ])
  if (!source) return undefined
  const transactionId = id(source.id, `${path}.id`, context)
  const name = boundedText(source.name, `${path}.name`, context, 128)
  const access = oneOf(source.access, `${path}.access`, context, ['authenticated'])
  const parsedPrincipal = parseAuthPrincipalIntentV2(source.principal, `${path}.principal`, context)
  if (parsedPrincipal?.kind === 'anonymous') {
    context.diagnostics.push({
      code: 'backend-transaction-principal-invalid',
      severity: 'error',
      path: `${path}.principal`,
      message: 'Atomic transactions require a non-anonymous RLS principal.'
    })
  }
  const isolation = oneOf(source.isolation, `${path}.isolation`, context, [
    'read-committed',
    'repeatable-read',
    'serializable'
  ])
  const parameters = parseArrayItems(
    source.parameters,
    `${path}.parameters`,
    context,
    MAX_TRANSACTION_PARAMETERS,
    parameter
  )
  if (parameters) {
    uniqueBy(
      parameters.map((entry) => entry.name),
      `${path}.parameters`,
      context,
      'transaction parameter'
    )
  }
  const parsedConflictPolicy = conflictPolicy(
    source.conflictPolicy,
    `${path}.conflictPolicy`,
    context
  )
  const steps = parseArrayItems(
    source.steps,
    `${path}.steps`,
    context,
    MAX_TRANSACTION_STEPS,
    (entry, entryPath, entryContext) => transactionStep(entry, entryPath, entryContext, state)
  )
  if (steps) {
    uniqueBy(
      steps.map((entry) => entry.id),
      `${path}.steps`,
      context,
      'transaction step id'
    )
    const resultNames = steps.flatMap((entry) =>
      'resultName' in entry && entry.resultName ? [entry.resultName] : []
    )
    uniqueBy(resultNames, `${path}.steps`, context, 'transaction result name')
    if (!steps.some((entry) => entry.kind === 'data.mutate')) {
      context.diagnostics.push({
        code: 'backend-transaction-mutation-required',
        severity: 'error',
        path: `${path}.steps`,
        message: 'An atomic transaction must contain at least one mutation step.'
      })
    }
  }
  return transactionId &&
    name &&
    access &&
    parsedPrincipal &&
    parsedPrincipal.kind !== 'anonymous' &&
    isolation &&
    parameters &&
    parsedConflictPolicy &&
    steps
    ? {
        id: transactionId,
        name,
        access,
        principal: parsedPrincipal,
        isolation,
        parameters: sorted(parameters, (entry) => entry.name),
        conflictPolicy: parsedConflictPolicy,
        steps
      }
    : undefined
}

function validateValueSourceReference(
  source: BackendTransactionValueSourceIR,
  path: string,
  parameters: ReadonlySet<string>,
  priorResults: ReadonlyMap<string, DataEntityIR>,
  context: BackendValidationContext
): void {
  if (source.kind === 'parameter' && !parameters.has(source.name)) {
    context.diagnostics.push({
      code: 'backend-transaction-parameter-missing',
      severity: 'error',
      path: `${path}.name`,
      message: 'Transaction value sources must reference a declared parameter.'
    })
  }
  if (source.kind !== 'result') return
  const entity = priorResults.get(source.name)
  if (!entity) {
    context.diagnostics.push({
      code: 'backend-transaction-result-missing',
      severity: 'error',
      path: `${path}.name`,
      message: 'Transaction result sources must reference a result produced by a prior step.'
    })
    return
  }
  if (source.field) validateFieldReference(entity, source.field, `${path}.field`, context)
}

function validateValueSourceType(
  source: BackendTransactionValueSourceIR,
  target: DataFieldIR | undefined,
  path: string,
  transaction: BackendTransactionDefinitionIR,
  priorResults: ReadonlyMap<string, DataEntityIR>,
  model: DataModelIR,
  context: BackendValidationContext
): void {
  if (!target) return
  if (source.kind === 'literal') {
    const before = context.diagnostics.length
    parseBackendFieldDefault(
      { kind: 'literal', value: source.value },
      path,
      context,
      target.type,
      target.nullable
    )
    if (
      context.diagnostics.length === before &&
      target.type === 'enum' &&
      typeof source.value === 'string' &&
      !model.enums.find((entry) => entry.id === target.enumId)?.values.includes(source.value)
    ) {
      context.diagnostics.push({
        code: 'backend-transaction-value-type-mismatch',
        severity: 'error',
        path,
        message: 'Transaction enum literals must be declared by the target enum.'
      })
    }
    return
  }
  let sourceType: BackendFieldScalarType | 'enum' | undefined
  let sourceEnumId: string | undefined
  if (source.kind === 'parameter') {
    sourceType = transaction.parameters.find((entry) => entry.name === source.name)?.type
  } else {
    const entity = priorResults.get(source.name)
    if (!source.field) {
      context.diagnostics.push({
        code: 'backend-transaction-result-field-required',
        severity: 'error',
        path: `${path}.field`,
        message: 'Typed transaction result sources must select an explicit field.'
      })
      return
    }
    const field = entity?.fields.find((entry) => entry.id === source.field)
    sourceType = field?.type
    sourceEnumId = field?.enumId
  }
  if (sourceType === target.type && sourceEnumId === target.enumId) return
  context.diagnostics.push({
    code: 'backend-transaction-value-type-mismatch',
    severity: 'error',
    path,
    message: 'Transaction value sources must exactly match the target field type.'
  })
}

function requiredRowOperations(
  step: Exclude<BackendTransactionStepIR, { kind: 'assert' }>
): readonly ('select' | 'insert' | 'update' | 'delete')[] {
  if (step.kind === 'data.read') return ['select']
  if (step.operation === 'upsert') return ['insert', 'update']
  return [step.operation]
}

// oxlint-disable-next-line complexity -- Typed references, RLS, and operation safety share one step boundary.
function validateStepReferences(
  step: BackendTransactionStepIR,
  index: number,
  transaction: BackendTransactionDefinitionIR,
  model: DataModelIR,
  auth: AuthPolicyIR,
  priorResults: Map<string, DataEntityIR>,
  context: BackendValidationContext
): void {
  const path = `$.transactions.transactions.${transaction.id}.steps[${index}]`
  if (step.kind === 'assert') {
    if (priorResults.has(step.assertion.resultName)) return
    context.diagnostics.push({
      code: 'backend-transaction-result-missing',
      severity: 'error',
      path: `${path}.assertion.resultName`,
      message: 'Assertions may only reference results produced by prior transaction steps.'
    })
    return
  }
  const entity = referencedEntity(step.entityId, `${path}.entityId`, model, context)
  if (entity?.management === 'external') {
    context.diagnostics.push({
      code: 'backend-transaction-external-entity-forbidden',
      severity: 'error',
      path: `${path}.entityId`,
      message: 'Atomic transactions cannot target external entities with an unverified schema.'
    })
  }
  for (const [fieldIndex, fieldId] of (step.kind === 'data.read'
    ? (step.fields ?? [])
    : []
  ).entries()) {
    validateFieldReference(entity, fieldId, `${path}.fields[${fieldIndex}]`, context)
  }
  const parameters = new Set(transaction.parameters.map((entry) => entry.name))
  for (const [filterIndex, entry] of (step.filters ?? []).entries()) {
    validateFieldReference(entity, entry.field, `${path}.filters[${filterIndex}].field`, context)
    validateValueSourceReference(
      entry.value,
      `${path}.filters[${filterIndex}].value`,
      parameters,
      priorResults,
      context
    )
    const target = entity?.fields.find((field) => field.id === entry.field)
    validateValueSourceType(
      entry.value,
      target,
      `${path}.filters[${filterIndex}].value`,
      transaction,
      priorResults,
      model,
      context
    )
    if (entry.operator === 'in') {
      context.diagnostics.push({
        code: 'backend-transaction-filter-operator-unsupported',
        severity: 'error',
        path: `${path}.filters[${filterIndex}].operator`,
        message: 'The typed transaction contract does not support untyped array membership.'
      })
    }
    if (entry.operator === 'like' && target?.type !== 'string') {
      context.diagnostics.push({
        code: 'backend-transaction-filter-type-invalid',
        severity: 'error',
        path: `${path}.filters[${filterIndex}].operator`,
        message: 'like filters require a string field.'
      })
    }
    if (
      ['gt', 'gte', 'lt', 'lte'].includes(entry.operator) &&
      target &&
      !['string', 'integer', 'number', 'date', 'datetime'].includes(target.type)
    ) {
      context.diagnostics.push({
        code: 'backend-transaction-filter-type-invalid',
        severity: 'error',
        path: `${path}.filters[${filterIndex}].operator`,
        message: 'Ordering filters require a provider-neutral ordered scalar field.'
      })
    }
  }
  if (step.kind === 'data.mutate') {
    for (const [valueIndex, entry] of (step.values ?? []).entries()) {
      validateFieldReference(entity, entry.field, `${path}.values[${valueIndex}].field`, context)
      validateValueSourceReference(
        entry.value,
        `${path}.values[${valueIndex}].value`,
        parameters,
        priorResults,
        context
      )
      validateValueSourceType(
        entry.value,
        entity?.fields.find((field) => field.id === entry.field),
        `${path}.values[${valueIndex}].value`,
        transaction,
        priorResults,
        model,
        context
      )
    }
    for (const [incrementIndex, entry] of (step.increments ?? []).entries()) {
      validateFieldReference(
        entity,
        entry.field,
        `${path}.increments[${incrementIndex}].field`,
        context
      )
      const field = entity?.fields.find((candidate) => candidate.id === entry.field)
      if (field && field.type !== 'integer') {
        context.diagnostics.push({
          code: 'backend-transaction-increment-field-invalid',
          severity: 'error',
          path: `${path}.increments[${incrementIndex}].field`,
          message: 'Atomic increment fields must use the integer scalar type.'
        })
      }
    }
    if (step.increments?.length && step.operation !== 'update') {
      context.diagnostics.push({
        code: 'backend-transaction-increment-operation-invalid',
        severity: 'error',
        path: `${path}.increments`,
        message: 'Atomic increments are supported only by bounded update steps.'
      })
    }
  }
  const operations = requiredRowOperations(step)
  const authorized = operations.every((operation) =>
    auth.rowAccess.some(
      (policy) =>
        policy.entityId === step.entityId &&
        policy.effect === 'allow' &&
        policy.operations.includes(operation) &&
        principalKey(policy.principal) === principalKey(transaction.principal)
    )
  )
  if (!authorized) {
    context.diagnostics.push({
      code: 'backend-transaction-row-policy-missing',
      severity: 'error',
      path: `${path}.entityId`,
      message: 'Every transaction data step requires a matching allow row policy for its principal.'
    })
  }
  if ('resultName' in step && step.resultName && entity) priorResults.set(step.resultName, entity)
}

function validateMutationBounds(
  transaction: BackendTransactionDefinitionIR,
  context: BackendValidationContext
): void {
  for (const [index, step] of transaction.steps.entries()) {
    if (step.kind !== 'data.mutate') continue
    const bounded = transaction.steps
      .slice(index + 1)
      .some(
        (candidate) =>
          candidate.kind === 'assert' &&
          candidate.assertion.kind === 'result-count' &&
          candidate.assertion.resultName === step.resultName &&
          ((candidate.assertion.operator === 'lte' &&
            candidate.assertion.value === step.maxAffectedRows) ||
            (candidate.assertion.operator === 'eq' &&
              candidate.assertion.value <= step.maxAffectedRows))
      )
    if (bounded) continue
    context.diagnostics.push({
      code: 'backend-transaction-affected-row-bound-missing',
      severity: 'error',
      path: `$.transactions.transactions.${transaction.id}.steps[${index}]`,
      message: 'Every mutation requires a later result-count upper-bound assertion.'
    })
  }
}

function validateConflictPolicy(
  transaction: BackendTransactionDefinitionIR,
  model: DataModelIR,
  context: BackendValidationContext
): void {
  const policy = transaction.conflictPolicy
  if (policy.kind === 'fail') return
  const path = `$.transactions.transactions.${transaction.id}.conflictPolicy`
  const entity = referencedEntity(policy.entityId, `${path}.entityId`, model, context)
  validateFieldReference(entity, policy.fieldId, `${path}.fieldId`, context)
  const field = entity?.fields.find((entry) => entry.id === policy.fieldId)
  if (field && (field.type !== 'integer' || field.nullable)) {
    context.diagnostics.push({
      code: 'backend-transaction-version-field-invalid',
      severity: 'error',
      path: `${path}.fieldId`,
      message: 'Expected-version conflict control requires a non-null integer version field.'
    })
  }
  const parameter = transaction.parameters.find((entry) => entry.name === policy.parameter)
  if (!parameter) {
    context.diagnostics.push({
      code: 'backend-transaction-parameter-missing',
      severity: 'error',
      path: `${path}.parameter`,
      message: 'Expected-version conflict control must reference a declared parameter.'
    })
  } else if (parameter.type !== 'integer' || !parameter.required) {
    context.diagnostics.push({
      code: 'backend-transaction-version-parameter-invalid',
      severity: 'error',
      path: `${path}.parameter`,
      message: 'Expected-version conflict control requires a required integer parameter.'
    })
  }
  const policyMutations = transaction.steps
    .map((step, index) => ({ step, index }))
    .filter(
      (
        entry
      ): entry is {
        step: Extract<BackendTransactionStepIR, { kind: 'data.mutate' }>
        index: number
      } => entry.step.kind === 'data.mutate' && entry.step.entityId === policy.entityId
    )
  if (policyMutations.length !== 1) {
    context.diagnostics.push({
      code: 'backend-transaction-version-mutation-count-invalid',
      severity: 'error',
      path,
      message: 'Expected-version control requires exactly one mutation of the protected entity.'
    })
    return
  }
  const { step: mutation, index: mutationIndex } = policyMutations[0]
  if (mutation.operation !== 'update' || mutation.maxAffectedRows !== 1) {
    context.diagnostics.push({
      code: 'backend-transaction-version-mutation-invalid',
      severity: 'error',
      path: `$.transactions.transactions.${transaction.id}.steps[${mutationIndex}]`,
      message: 'Expected-version control requires a single-row bounded update.'
    })
  }
  const bound = mutation.filters?.some(
    (filter) =>
      filter.field === policy.fieldId &&
      filter.operator === 'eq' &&
      filter.value.kind === 'parameter' &&
      filter.value.name === policy.parameter
  )
  if (!bound) {
    context.diagnostics.push({
      code: 'backend-transaction-version-filter-missing',
      severity: 'error',
      path,
      message:
        'Expected-version conflict control must be bound to an equality filter on a mutation step.'
    })
    return
  }
  const incrementsVersion = mutation.increments?.some(
    (increment) => increment.field === policy.fieldId
  )
  const writesVersion = mutation.values?.some((value) => value.field === policy.fieldId)
  if (!incrementsVersion || writesVersion) {
    context.diagnostics.push({
      code: 'backend-transaction-version-increment-missing',
      severity: 'error',
      path: `$.transactions.transactions.${transaction.id}.steps[${mutationIndex}]`,
      message:
        'Expected-version mutations must use the host-controlled atomic increment and cannot assign the version field.'
    })
  }
  const resultName = mutation.resultName
  const assertsSingleRow = Boolean(
    resultName &&
    transaction.steps
      .slice(mutationIndex + 1)
      .some(
        (step) =>
          step.kind === 'assert' &&
          step.assertion.kind === 'result-count' &&
          step.assertion.resultName === resultName &&
          step.assertion.operator === 'eq' &&
          step.assertion.value === 1
      )
  )
  if (assertsSingleRow) return
  context.diagnostics.push({
    code: 'backend-transaction-affected-row-assertion-missing',
    severity: 'error',
    path: `$.transactions.transactions.${transaction.id}.steps`,
    message:
      'Expected-version mutations require a later affected result-count equality assertion of one.'
  })
}

function validateTransactionReferences(
  transactions: readonly BackendTransactionDefinitionIR[],
  model: DataModelIR,
  auth: AuthPolicyIR,
  context: BackendValidationContext
): void {
  if (transactions.length > 0 && !auth.identities.some((entry) => entry.kind === 'user')) {
    context.diagnostics.push({
      code: 'backend-transaction-auth-identity-missing',
      severity: 'error',
      path: '$.auth.identities',
      message: 'Authenticated transactions require a user identity in Auth IR.'
    })
  }
  for (const transaction of transactions) {
    validatePrincipalReference(
      transaction.principal,
      `$.transactions.transactions.${transaction.id}.principal`,
      auth,
      context
    )
    const priorResults = new Map<string, DataEntityIR>()
    for (const [index, step] of transaction.steps.entries()) {
      validateStepReferences(step, index, transaction, model, auth, priorResults, context)
    }
    validateMutationBounds(transaction, context)
    validateConflictPolicy(transaction, model, context)
  }
}

export function parseBackendTransactionIRV1(
  value: unknown,
  path: string,
  model: DataModelIR,
  auth: AuthPolicyIR,
  context: BackendValidationContext
): BackendTransactionIRV1 | undefined {
  const source = record(value, path, context, ['version', 'transactions'])
  if (!source) return undefined
  if (source.version !== BACKEND_TRANSACTION_IR_VERSION) {
    context.diagnostics.push({
      code: 'backend-transaction-version-unsupported',
      severity: 'error',
      path: `${path}.version`,
      message: 'Transaction IR version is not supported.'
    })
  }
  const state: TransactionParseState = { stepCount: 0 }
  const transactions = parseArrayItems(
    source.transactions,
    `${path}.transactions`,
    context,
    MAX_TRANSACTIONS,
    (entry, entryPath, entryContext) => transactionDefinition(entry, entryPath, entryContext, state)
  )
  if (!transactions) return undefined
  uniqueBy(
    transactions.map((entry) => entry.id),
    `${path}.transactions`,
    context,
    'transaction id'
  )
  validateTransactionReferences(transactions, model, auth, context)
  return source.version === BACKEND_TRANSACTION_IR_VERSION
    ? {
        version: BACKEND_TRANSACTION_IR_VERSION,
        transactions: sorted(transactions, (entry) => entry.id)
      }
    : undefined
}
