import { discriminatedRecord } from '../discriminated-record'
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
  const operator = oneOf(source.operator, path + '.operator', context, ['eq', 'gte', 'lte'])
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
    const scope = oneOf(source.scope, path + '.scope', context, ['owner', 'command'])
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
    role: { allowed: ['kind', 'roleId'], required: ['kind', 'roleId'] }
  })
  if (!parsed) return undefined
  if (parsed.kind === 'authenticated') return { kind: parsed.kind }
  const roleId = id(parsed.source.roleId, path + '.roleId', context)
  return roleId ? { kind: 'role', roleId } : undefined
}

export function commandDefinition(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendCommandDefinitionIR | undefined {
  const source = record(value, path, context, [
    'id',
    'name',
    'path',
    'access',
    'idempotency',
    'parameters',
    'steps',
    'return'
  ])
  if (!source) return undefined
  const commandId = id(source.id, path + '.id', context)
  const name = boundedText(source.name, path + '.name', context, 128)
  const route =
    typeof source.path === 'string' &&
    source.path.length <= 128 &&
    /^(?:\/[A-Za-z0-9_-]+)+$/u.test(source.path)
      ? source.path
      : undefined
  if (!route)
    commandError(context, path + '.path', 'Commands require a bounded static absolute POST path.')
  const grant = access(source.access, path + '.access', context)
  const idempotency = record(source.idempotency, path + '.idempotency', context, ['kind', 'header'])
  if (idempotency?.kind !== 'required' || idempotency.header !== 'Idempotency-Key')
    commandError(
      context,
      path + '.idempotency',
      'Commands require the fixed Idempotency-Key replay contract.'
    )
  const parameters = parseArrayItems(
    source.parameters,
    path + '.parameters',
    context,
    16,
    commandParameter
  )
  const steps = parseArrayItems(source.steps, path + '.steps', context, 16, step)
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
  if (!steps.some((entry) => entry.kind === 'data.mutate'))
    commandError(context, path + '.steps', 'Commands require at least one bounded mutation.')
  return {
    id: commandId,
    name,
    path: route,
    access: grant,
    idempotency: { kind: 'required', header: 'Idempotency-Key' },
    parameters: sorted(parameters, (entry) => entry.name),
    steps,
    return: { resultName, fields }
  }
}
