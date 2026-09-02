import { parseExpression } from '../expression'
import { discriminatedRecord } from './discriminated-record'
import { BACKEND_LIMITS } from './limits'
import {
  BACKEND_WORKFLOW_IR_VERSION,
  type BackendDataFilterIR,
  type BackendDataValueIR,
  type BackendHttpHeaderIR,
  type BackendValueSource,
  type BackendWorkflowDefinitionIR,
  type BackendWorkflowIR,
  type BackendWorkflowStepIR,
  type DataModelIR
} from './types'
import {
  array,
  boolean,
  boundedText,
  environmentName,
  id,
  identifier,
  oneOf,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendUnknownRecord,
  type BackendValidationContext
} from './validation-helpers'
import {
  validateWorkflowDataReferences,
  validateWorkflowMutationShape
} from './workflow-application-validation'

const VALUE_SOURCE_SHAPES = {
  expression: { allowed: ['kind', 'expression'], required: ['kind', 'expression'] },
  environment: { allowed: ['kind', 'name'], required: ['kind', 'name'] }
} as const

const WORKFLOW_STEP_SHAPES = {
  'data.read': {
    allowed: ['id', 'kind', 'entityId', 'resultName', 'fields', 'filters', 'single'],
    required: ['id', 'kind', 'entityId', 'resultName']
  },
  'data.mutate': {
    allowed: ['id', 'kind', 'entityId', 'operation', 'values', 'filters', 'resultName'],
    required: ['id', 'kind', 'entityId', 'operation']
  },
  'http.request': {
    allowed: ['id', 'kind', 'method', 'url', 'headers', 'body', 'resultName'],
    required: ['id', 'kind', 'method', 'url']
  },
  branch: {
    allowed: ['id', 'kind', 'condition', 'consequent', 'alternate'],
    required: ['id', 'kind', 'condition', 'consequent', 'alternate']
  },
  respond: { allowed: ['id', 'kind', 'value', 'status'], required: ['id', 'kind'] },
  call: { allowed: ['id', 'kind', 'workflowId'], required: ['id', 'kind', 'workflowId'] }
} as const

function valueSource(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendValueSource | undefined {
  const parsed = discriminatedRecord(value, path, context, VALUE_SOURCE_SHAPES)
  if (!parsed) return undefined
  const { kind, source } = parsed
  if (kind === 'expression') {
    const expression = boundedText(source.expression, `${path}.expression`, context)
    if (expression && !parseExpression(expression).ok) {
      context.diagnostics.push({
        code: 'backend-workflow-expression-invalid',
        severity: 'error',
        path: `${path}.expression`,
        message: 'Workflow expression is invalid.'
      })
      return undefined
    }
    return expression ? { kind, expression } : undefined
  }
  const name = environmentName(source.name, `${path}.name`, context)
  return name ? { kind, name } : undefined
}

interface WorkflowParseState {
  stepCount: number
}

function dataFilter(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendDataFilterIR | undefined {
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
  const parsedValue = valueSource(source.value, `${path}.value`, context)
  return field && operator && parsedValue ? { field, operator, value: parsedValue } : undefined
}

function dataValue(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendDataValueIR | undefined {
  const source = record(value, path, context, ['field', 'value'])
  if (!source) return undefined
  const field = id(source.field, `${path}.field`, context)
  const parsedValue = valueSource(source.value, `${path}.value`, context)
  return field && parsedValue ? { field, value: parsedValue } : undefined
}

function httpHeader(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendHttpHeaderIR | undefined {
  const source = record(value, path, context, ['name', 'value'])
  if (!source) return undefined
  const name = boundedText(source.name, `${path}.name`, context, 128)
  if (name && !/^[A-Za-z][A-Za-z0-9-]{0,127}$/u.test(name)) {
    context.diagnostics.push({
      code: 'backend-http-header-invalid',
      severity: 'error',
      path: `${path}.name`,
      message: 'HTTP header name is invalid.'
    })
  }
  const parsedValue = valueSource(source.value, `${path}.value`, context)
  return name && /^[A-Za-z][A-Za-z0-9-]{0,127}$/u.test(name) && parsedValue
    ? { name, value: parsedValue }
    : undefined
}

function dataReadStep(
  source: BackendUnknownRecord,
  stepId: string,
  path: string,
  context: BackendValidationContext
): BackendWorkflowStepIR | undefined {
  const entityId = id(source.entityId, `${path}.entityId`, context)
  const resultName = identifier(source.resultName, `${path}.resultName`, context)
  const rawFields =
    source.fields === undefined
      ? undefined
      : array(source.fields, `${path}.fields`, context, BACKEND_LIMITS.maxFieldsPerEntity)
  const fields = rawFields
    ?.map((entry, index) => id(entry, `${path}.fields[${index}]`, context))
    .filter((entry): entry is string => entry !== undefined)
  if (fields) uniqueBy(fields, `${path}.fields`, context, 'data field')
  const filters = parseArrayItems(
    source.filters,
    `${path}.filters`,
    context,
    BACKEND_LIMITS.maxFieldsPerEntity,
    dataFilter,
    true
  )
  const single =
    source.single === undefined ? undefined : boolean(source.single, `${path}.single`, context)
  if (!entityId || !resultName || (rawFields && fields?.length !== rawFields.length))
    return undefined
  return {
    id: stepId,
    kind: 'data.read',
    entityId,
    resultName,
    ...(fields?.length ? { fields } : {}),
    ...(filters?.length ? { filters } : {}),
    ...(single !== undefined ? { single } : {})
  }
}

function dataMutateStep(
  source: BackendUnknownRecord,
  stepId: string,
  path: string,
  context: BackendValidationContext
): BackendWorkflowStepIR | undefined {
  const entityId = id(source.entityId, `${path}.entityId`, context)
  const operation = oneOf(source.operation, `${path}.operation`, context, [
    'insert',
    'update',
    'delete',
    'upsert'
  ])
  const resultName =
    source.resultName === undefined
      ? undefined
      : identifier(source.resultName, `${path}.resultName`, context)
  const values = parseArrayItems(
    source.values,
    `${path}.values`,
    context,
    BACKEND_LIMITS.maxFieldsPerEntity,
    dataValue,
    true
  )
  if (values) {
    uniqueBy(
      values.map((value) => value.field),
      `${path}.values`,
      context,
      'mutation value field'
    )
  }
  const filters = parseArrayItems(
    source.filters,
    `${path}.filters`,
    context,
    BACKEND_LIMITS.maxFieldsPerEntity,
    dataFilter,
    true
  )
  if (
    !entityId ||
    !operation ||
    !validateWorkflowMutationShape(operation, values, filters, path, context)
  ) {
    return undefined
  }
  return {
    id: stepId,
    kind: 'data.mutate',
    entityId,
    operation,
    ...(values?.length ? { values } : {}),
    ...(filters?.length ? { filters } : {}),
    ...(resultName ? { resultName } : {})
  }
}

function httpRequestStep(
  source: BackendUnknownRecord,
  stepId: string,
  path: string,
  context: BackendValidationContext
): BackendWorkflowStepIR | undefined {
  const method = oneOf(source.method, `${path}.method`, context, [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE'
  ])
  const url = valueSource(source.url, `${path}.url`, context)
  const headers = parseArrayItems(
    source.headers,
    `${path}.headers`,
    context,
    BACKEND_LIMITS.maxFieldsPerEntity,
    httpHeader,
    true
  )
  const body =
    source.body === undefined ? undefined : valueSource(source.body, `${path}.body`, context)
  const resultName =
    source.resultName === undefined
      ? undefined
      : identifier(source.resultName, `${path}.resultName`, context)
  if (!method || !url) return undefined
  return {
    id: stepId,
    kind: 'http.request',
    method,
    url,
    ...(headers?.length ? { headers } : {}),
    ...(body ? { body } : {}),
    ...(resultName ? { resultName } : {})
  }
}

function parsedWorkflowExpression(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  label: string
): string | undefined {
  if (value === undefined) return undefined
  const expression = boundedText(value, path, context)
  if (!expression) return undefined
  if (parseExpression(expression).ok) return expression
  context.diagnostics.push({
    code: 'backend-workflow-expression-invalid',
    severity: 'error',
    path,
    message: `${label} expression is invalid.`
  })
  return undefined
}

function branchStep(
  source: BackendUnknownRecord,
  stepId: string,
  path: string,
  context: BackendValidationContext,
  state: WorkflowParseState
): BackendWorkflowStepIR | undefined {
  const condition = parsedWorkflowExpression(
    source.condition,
    `${path}.condition`,
    context,
    'Workflow branch'
  )
  const consequent = workflowSteps(source.consequent, `${path}.consequent`, context, state)
  const alternate = workflowSteps(source.alternate, `${path}.alternate`, context, state)
  return condition && consequent && alternate
    ? { id: stepId, kind: 'branch', condition, consequent, alternate }
    : undefined
}

function parsedResponseStatus(
  value: unknown,
  path: string,
  context: BackendValidationContext
): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isInteger(value) && value >= 200 && value <= 599) {
    return value
  }
  context.diagnostics.push({
    code: 'backend-workflow-status-invalid',
    severity: 'error',
    path,
    message: 'Workflow response status must be an integer from 200 through 599.'
  })
  return undefined
}

function respondStep(
  source: BackendUnknownRecord,
  stepId: string,
  path: string,
  context: BackendValidationContext
): BackendWorkflowStepIR | undefined {
  const responseValue = parsedWorkflowExpression(
    source.value,
    `${path}.value`,
    context,
    'Workflow response'
  )
  const status = parsedResponseStatus(source.status, `${path}.status`, context)
  if (source.value !== undefined && !responseValue) return undefined
  if (source.status !== undefined && status === undefined) return undefined
  return {
    id: stepId,
    kind: 'respond',
    ...(responseValue ? { value: responseValue } : {}),
    ...(status !== undefined ? { status } : {})
  }
}

function dispatchWorkflowStep(
  source: BackendUnknownRecord,
  stepId: string,
  kind: BackendWorkflowStepIR['kind'],
  path: string,
  context: BackendValidationContext,
  state: WorkflowParseState
): BackendWorkflowStepIR | undefined {
  switch (kind) {
    case 'data.read':
      return dataReadStep(source, stepId, path, context)
    case 'data.mutate':
      return dataMutateStep(source, stepId, path, context)
    case 'http.request':
      return httpRequestStep(source, stepId, path, context)
    case 'branch':
      return branchStep(source, stepId, path, context, state)
    case 'respond':
      return respondStep(source, stepId, path, context)
    case 'call': {
      const workflowId = id(source.workflowId, `${path}.workflowId`, context)
      return workflowId ? { id: stepId, kind, workflowId } : undefined
    }
  }
  return undefined
}

function workflowStep(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  state: WorkflowParseState
): BackendWorkflowStepIR | undefined {
  state.stepCount++
  if (state.stepCount > BACKEND_LIMITS.maxWorkflowSteps) {
    context.diagnostics.push({
      code: 'backend-workflow-step-limit',
      severity: 'error',
      path,
      message: 'Workflow step limit exceeded.'
    })
    return undefined
  }
  const parsed = discriminatedRecord(value, path, context, WORKFLOW_STEP_SHAPES)
  if (!parsed) return undefined
  const stepId = id(parsed.source.id, `${path}.id`, context)
  if (!stepId) return undefined
  return dispatchWorkflowStep(parsed.source, stepId, parsed.kind, path, context, state)
}

function workflowSteps(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  state: WorkflowParseState
): BackendWorkflowStepIR[] | undefined {
  const values = array(value, path, context, BACKEND_LIMITS.maxWorkflowSteps)
  if (!values) return undefined
  const parsed = values
    .map((entry, index) => workflowStep(entry, `${path}[${index}]`, context, state))
    .filter((entry): entry is BackendWorkflowStepIR => entry !== undefined)
  uniqueBy(
    parsed.map((entry) => entry.id),
    path,
    context,
    'workflow step id'
  )
  return parsed.length === values.length ? parsed : undefined
}

function workflow(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  state: WorkflowParseState
): BackendWorkflowDefinitionIR | undefined {
  const source = record(value, path, context, ['id', 'name', 'trigger', 'parameters', 'steps'])
  if (!source) return undefined
  const workflowId = id(source.id, `${path}.id`, context)
  const name = boundedText(source.name, `${path}.name`, context, 128)
  const trigger = record(source.trigger, `${path}.trigger`, context, ['kind', 'method', 'access'])
  if (trigger) {
    if (
      trigger.kind !== 'http' ||
      trigger.method !== 'POST' ||
      trigger.access !== 'authenticated'
    ) {
      context.diagnostics.push({
        code: 'backend-workflow-trigger-unsupported',
        severity: 'error',
        path: `${path}.trigger`,
        message: 'Workflow trigger is not supported by this contract version.'
      })
    }
  }
  const rawParameters = array(source.parameters, `${path}.parameters`, context, 64)
  const parameters = (rawParameters ?? [])
    .map((entry, index) => identifier(entry, `${path}.parameters[${index}]`, context))
    .filter((entry): entry is string => entry !== undefined)
  uniqueBy(parameters, `${path}.parameters`, context, 'workflow parameter')
  const steps = workflowSteps(source.steps, `${path}.steps`, context, state)
  return workflowId &&
    name &&
    trigger?.kind === 'http' &&
    trigger.method === 'POST' &&
    trigger.access === 'authenticated' &&
    rawParameters &&
    rawParameters.length === parameters.length &&
    steps
    ? {
        id: workflowId,
        name,
        trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
        parameters,
        steps
      }
    : undefined
}

function walkCalls(steps: readonly BackendWorkflowStepIR[], calls: Set<string>): void {
  for (const step of steps) {
    if (step.kind === 'call') calls.add(step.workflowId)
    if (step.kind === 'branch') {
      walkCalls(step.consequent, calls)
      walkCalls(step.alternate, calls)
    }
  }
}

function validateWorkflowReferences(
  workflows: readonly BackendWorkflowDefinitionIR[],
  model: DataModelIR,
  context: BackendValidationContext
): void {
  const workflowIds = new Set(workflows.map((entry) => entry.id))
  const entityIds = new Set(model.entities.map((entry) => entry.id))
  const calls = new Map<string, Set<string>>()
  const visitSteps = (steps: readonly BackendWorkflowStepIR[], workflowId: string): void => {
    for (const step of steps) {
      if (
        (step.kind === 'data.read' || step.kind === 'data.mutate') &&
        !entityIds.has(step.entityId)
      ) {
        context.diagnostics.push({
          code: 'backend-workflow-entity-missing',
          severity: 'error',
          path: `$.workflows.${workflowId}.${step.id}.entityId`,
          message: 'Workflow step references an unknown entity.'
        })
      }
      if (step.kind === 'branch') {
        visitSteps(step.consequent, workflowId)
        visitSteps(step.alternate, workflowId)
      }
    }
  }
  for (const workflowEntry of workflows) {
    const workflowCalls = new Set<string>()
    walkCalls(workflowEntry.steps, workflowCalls)
    calls.set(workflowEntry.id, workflowCalls)
    visitSteps(workflowEntry.steps, workflowEntry.id)
    for (const targetId of workflowCalls) {
      if (!workflowIds.has(targetId)) {
        context.diagnostics.push({
          code: 'backend-workflow-call-missing',
          severity: 'error',
          path: `$.workflows.${workflowEntry.id}`,
          message: 'Workflow calls an unknown workflow.'
        })
      }
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const cycle = (workflowId: string): boolean => {
    if (visiting.has(workflowId)) return true
    if (visited.has(workflowId)) return false
    visiting.add(workflowId)
    for (const targetId of calls.get(workflowId) ?? []) {
      if (workflowIds.has(targetId) && cycle(targetId)) return true
    }
    visiting.delete(workflowId)
    visited.add(workflowId)
    return false
  }
  for (const workflowId of workflowIds) {
    if (cycle(workflowId)) {
      context.diagnostics.push({
        code: 'backend-workflow-cycle',
        severity: 'error',
        path: '$.workflows.workflows',
        message: 'Recursive workflow calls are not supported.'
      })
      return
    }
  }
}

export function parseBackendWorkflowIR(
  value: unknown,
  path: string,
  model: DataModelIR,
  context: BackendValidationContext
): BackendWorkflowIR | undefined {
  const source = record(value, path, context, ['version', 'workflows'])
  if (!source) return undefined
  if (source.version !== BACKEND_WORKFLOW_IR_VERSION) {
    context.diagnostics.push({
      code: 'backend-workflow-version-unsupported',
      severity: 'error',
      path: `${path}.version`,
      message: 'Backend workflow version is not supported.'
    })
  }
  const rawWorkflows = array(
    source.workflows,
    `${path}.workflows`,
    context,
    BACKEND_LIMITS.maxWorkflows
  )
  const state: WorkflowParseState = { stepCount: 0 }
  const workflows = (rawWorkflows ?? [])
    .map((entry, index) => workflow(entry, `${path}.workflows[${index}]`, context, state))
    .filter((entry): entry is BackendWorkflowDefinitionIR => entry !== undefined)
  uniqueBy(
    workflows.map((entry) => entry.id),
    `${path}.workflows`,
    context,
    'workflow id'
  )
  if (
    source.version !== BACKEND_WORKFLOW_IR_VERSION ||
    !rawWorkflows ||
    workflows.length !== rawWorkflows.length
  ) {
    return undefined
  }
  const result: BackendWorkflowIR = {
    version: BACKEND_WORKFLOW_IR_VERSION,
    workflows: sorted(workflows, (entry) => entry.id)
  }
  validateWorkflowReferences(result.workflows, model, context)
  validateWorkflowDataReferences(result.workflows, model, context)
  return result
}
