import { COMMERCE_OPERATIONS } from '../commerce/types'
import { discriminatedRecord } from '../discriminated-record'
import { FOOD_ORDERING_OPERATIONS } from '../food-ordering/types'
import {
  boundedText,
  id,
  identifier,
  oneOf,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext,
  type BackendUnknownRecord
} from '../validation-helpers'
import { parseCommandRowPolicyAccess } from './row-policy'
import {
  commandError,
  commandFieldSet,
  commandLeaf,
  commandParameter,
  commandValue
} from './shape-values'
import type {
  BackendCommandDefinitionIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from './types'

function assignment(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendCommandValueIR | undefined {
  const source = record(value, path, context, ['field', 'value'])
  if (!source) return undefined
  const field = id(source.field, path + '.field', context)
  const parsed = commandValue(source.value, path + '.value', context)
  return field && parsed ? { field, value: parsed } : undefined
}

const STEP_SHAPES = {
  'data.read': {
    allowed: ['id', 'kind', 'entityId', 'resultName', 'fields', 'key', 'scope', 'lock'],
    required: ['id', 'kind', 'entityId', 'resultName', 'fields', 'key', 'scope', 'lock']
  },
  'data.mutate': {
    allowed: ['id', 'kind', 'entityId', 'operation', 'values', 'resultName', 'fields', 'record'],
    required: ['id', 'kind', 'entityId', 'operation', 'values', 'resultName', 'fields']
  },
  assert: {
    allowed: ['id', 'kind', 'left', 'operator', 'right', 'error'],
    required: ['id', 'kind', 'left', 'operator', 'right', 'error']
  }
} as const

function assertionStep(
  source: BackendUnknownRecord,
  stepId: string,
  path: string,
  context: BackendValidationContext
): BackendCommandStepIR | undefined {
  const left = commandValue(source.left, path + '.left', context)
  const right = commandValue(source.right, path + '.right', context)
  const operator = oneOf(source.operator, path + '.operator', context, ['eq', 'neq', 'gte', 'lte'])
  const error = oneOf(source.error, path + '.error', context, ['not-found', 'conflict'])
  return left && right && operator && error
    ? { id: stepId, kind: 'assert', left, right, operator, error }
    : undefined
}

function step(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendCommandStepIR | undefined {
  const parsed = discriminatedRecord(value, path, context, STEP_SHAPES)
  if (!parsed) return undefined
  const { kind, source } = parsed
  const stepId = id(source.id, path + '.id', context)
  if (!stepId) return undefined
  if (kind === 'assert') {
    return assertionStep(source, stepId, path, context)
  }
  const entityId = id(source.entityId, path + '.entityId', context)
  const resultName = identifier(source.resultName, path + '.resultName', context)
  const fields = commandFieldSet(source.fields, path + '.fields', context)
  if (!entityId || !resultName || !fields) return undefined
  if (kind === 'data.read') {
    const key = commandLeaf(source.key, path + '.key', context)
    const scope = oneOf(source.scope, path + '.scope', context, ['owner', 'command', 'tenant'])
    const lock = oneOf(source.lock, path + '.lock', context, ['update'])
    return key && scope && lock
      ? { id: stepId, kind, entityId, resultName, fields, key, scope, lock }
      : undefined
  }
  const operation = oneOf(source.operation, path + '.operation', context, ['insert', 'update'])
  const values = parseArrayItems(source.values, path + '.values', context, 64, assignment)
  if (!values || !operation) return undefined
  if (!values.length)
    commandError(context, path + '.values', 'Command mutations require nonempty assignments.')
  uniqueBy(
    values.map((entry) => entry.field),
    path + '.values',
    context,
    'command assignment'
  )
  const common = {
    id: stepId,
    kind,
    entityId,
    resultName,
    fields,
    values: sorted(values, (entry) => entry.field)
  }
  if (operation === 'insert') {
    if (source.record !== undefined)
      commandError(context, path + '.record', 'Insert does not accept a prior record.')
    return { ...common, operation }
  }
  const previous = identifier(source.record, path + '.record', context)
  return previous ? { ...common, operation, record: previous } : undefined
}

function access(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendCommandDefinitionIR['access'] | undefined {
  const parsed = discriminatedRecord(value, path, context, {
    authenticated: { allowed: ['kind'], required: ['kind'] },
    role: { allowed: ['kind', 'roleId'], required: ['kind', 'roleId'] },
    'row-policy': {
      allowed: ['kind', 'entityId', 'parameter', 'policyIds', 'roleId'],
      required: ['kind', 'entityId', 'parameter', 'policyIds']
    },
    'tenant-member': {
      allowed: ['kind', 'tenantId', 'parameter', 'roleId'],
      required: ['kind', 'tenantId', 'parameter']
    }
  })
  if (!parsed) return undefined
  if (parsed.kind === 'authenticated') return { kind: parsed.kind }
  if (parsed.kind === 'row-policy') return parseCommandRowPolicyAccess(parsed.source, path, context)
  if (parsed.kind === 'tenant-member') {
    const tenantId = id(parsed.source.tenantId, path + '.tenantId', context)
    const parameter = identifier(parsed.source.parameter, path + '.parameter', context)
    const roleId =
      parsed.source.roleId === undefined
        ? undefined
        : id(parsed.source.roleId, path + '.roleId', context)
    return tenantId && parameter && (parsed.source.roleId === undefined || roleId)
      ? { kind: parsed.kind, tenantId, parameter, ...(roleId ? { roleId } : {}) }
      : undefined
  }
  const roleId = id(parsed.source.roleId, path + '.roleId', context)
  return roleId ? { kind: 'role', roleId } : undefined
}

function commandRoute(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string | undefined {
  if (typeof value === 'string' && value.length <= 128 && /^(?:\/[A-Za-z0-9_-]+)+$/u.test(value))
    return value
  commandError(context, path, 'Commands require a bounded static absolute POST path.')
  return undefined
}

function validateStepBody(
  steps: BackendCommandStepIR[],
  fixed: boolean,
  path: string,
  context: BackendValidationContext
): void {
  if (fixed && steps.length)
    commandError(context, path, 'Fixed domain commands require an empty executable steps array.')
  if (!fixed && !steps.some((entry) => entry.kind === 'data.mutate'))
    commandError(context, path, 'Commands require at least one bounded mutation.')
}

function fixedOperations(
  source: BackendUnknownRecord,
  path: string,
  context: BackendValidationContext
): Pick<BackendCommandDefinitionIR, 'commerceOperation' | 'foodOrderingOperation'> {
  const commerceOperation =
    source.commerceOperation === undefined
      ? undefined
      : oneOf(source.commerceOperation, path + '.commerceOperation', context, COMMERCE_OPERATIONS)
  const foodOrderingOperation =
    source.foodOrderingOperation === undefined
      ? undefined
      : oneOf(
          source.foodOrderingOperation,
          path + '.foodOrderingOperation',
          context,
          FOOD_ORDERING_OPERATIONS
        )
  if (commerceOperation && foodOrderingOperation)
    commandError(context, path, 'A command cannot select two fixed operation domains.')
  return {
    ...(commerceOperation ? { commerceOperation } : {}),
    ...(foodOrderingOperation ? { foodOrderingOperation } : {})
  }
}

export function commandDefinition(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendCommandDefinitionIR | undefined {
  const source = record(
    value,
    path,
    context,
    [
      'id',
      'name',
      'path',
      'access',
      'idempotency',
      'parameters',
      'commerceOperation',
      'foodOrderingOperation',
      'steps',
      'return'
    ],
    ['id', 'name', 'path', 'access', 'idempotency', 'parameters', 'steps', 'return']
  )
  if (!source) return undefined
  const commandId = id(source.id, path + '.id', context)
  const name = boundedText(source.name, path + '.name', context, 128)
  const route = commandRoute(source.path, path + '.path', context)
  const grant = access(source.access, path + '.access', context)
  const idempotency = record(source.idempotency, path + '.idempotency', context, ['kind', 'header'])
  if (idempotency?.kind !== 'required' || idempotency.header !== 'Idempotency-Key')
    commandError(
      context,
      path + '.idempotency',
      'Commands require the fixed Idempotency-Key replay contract.'
    )
  const operations = fixedOperations(source, path, context)
  const parameters = parseArrayItems(
    source.parameters,
    path + '.parameters',
    context,
    16,
    (entry, entryPath, entryContext) =>
      commandParameter(entry, entryPath, entryContext, operations.commerceOperation ? 1000 : 8192)
  )
  const steps = parseArrayItems(source.steps, path + '.steps', context, 32, step)
  const returns = record(source.return, path + '.return', context, ['resultName', 'fields'])
  const resultName = returns && identifier(returns.resultName, path + '.return.resultName', context)
  const fields = returns && commandFieldSet(returns.fields, path + '.return.fields', context)
  if (
    !commandId ||
    name === undefined ||
    !route ||
    !grant ||
    !parameters ||
    !steps ||
    !resultName ||
    !fields
  )
    return undefined
  uniqueBy(
    parameters.map((entry) => entry.name),
    path + '.parameters',
    context,
    'command parameter'
  )
  uniqueBy(
    steps.map((entry) => entry.id),
    path + '.steps',
    context,
    'command step'
  )
  uniqueBy(
    steps.flatMap((entry) => ('resultName' in entry ? [entry.resultName] : [])),
    path + '.steps',
    context,
    'command result'
  )
  validateStepBody(
    steps,
    Boolean(operations.commerceOperation || operations.foodOrderingOperation),
    path + '.steps',
    context
  )
  return {
    id: commandId,
    name,
    path: route,
    access: grant,
    idempotency: { kind: 'required', header: 'Idempotency-Key' },
    parameters: sorted(parameters, (entry) => entry.name),
    ...operations,
    steps,
    return: { resultName, fields }
  }
}
