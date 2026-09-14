import type {
  BackendCommandDefinitionIR,
  BackendCommandLeafIR,
  BackendCommandParameterIR,
  BackendCommandStepIR,
  BackendCommandValueIR,
  BackendCommandValueSourceIR,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

export const businessParameter = (name: string): BackendCommandLeafIR => ({
  kind: 'parameter',
  name
})
export const businessResult = (name: string, field: string): BackendCommandLeafIR => ({
  kind: 'result',
  name,
  field
})
export const businessLiteral = (value: string | number | boolean | null): BackendCommandLeafIR => ({
  kind: 'literal',
  value
})
export const businessCaller = (): BackendCommandLeafIR => ({ kind: 'caller-sub' })

export const businessUUIDParameter = (name: string): BackendCommandParameterIR => ({
  name,
  type: 'uuid',
  required: true
})
export const businessStringParameter = (
  name: string,
  maxLength = 200
): BackendCommandParameterIR => ({
  name,
  type: 'string',
  required: true,
  maxLength
})

export function businessRead(
  entity: DataEntityIR,
  name: string,
  key: BackendCommandLeafIR,
  fields: readonly string[],
  scope: 'owner' | 'command' | 'tenant' = 'command'
): BackendCommandStepIR {
  return {
    id: name,
    kind: 'data.read',
    entityId: entity.id,
    resultName: name,
    fields: [...fields],
    key,
    scope,
    lock: 'update'
  }
}

export function businessAssert(
  id: string,
  left: BackendCommandValueSourceIR,
  right: BackendCommandValueSourceIR,
  operator: 'eq' | 'neq' | 'gte' | 'lte' = 'eq'
): BackendCommandStepIR {
  return { id, kind: 'assert', left, right, operator, error: 'conflict' }
}

export function businessInsert(
  entity: DataEntityIR,
  name: string,
  values: BackendCommandValueIR[],
  fields: readonly string[]
): BackendCommandStepIR {
  return {
    id: name,
    kind: 'data.mutate',
    operation: 'insert',
    entityId: entity.id,
    resultName: name,
    fields: [...fields],
    values
  }
}

export function businessUpdate(
  entity: DataEntityIR,
  record: string,
  name: string,
  values: BackendCommandValueIR[],
  fields: readonly string[]
): BackendCommandStepIR {
  return {
    id: name,
    kind: 'data.mutate',
    operation: 'update',
    entityId: entity.id,
    resultName: name,
    fields: [...fields],
    record,
    values
  }
}

export function businessCommand(
  id: string,
  name: string,
  access: BackendCommandDefinitionIR['access'],
  parameters: BackendCommandParameterIR[],
  steps: BackendCommandStepIR[],
  returns: BackendCommandDefinitionIR['return']
): BackendCommandDefinitionIR {
  return {
    id,
    name,
    path: `/commands/${id}`,
    access,
    idempotency: { kind: 'required', header: 'Idempotency-Key' },
    parameters,
    steps,
    return: returns
  }
}
