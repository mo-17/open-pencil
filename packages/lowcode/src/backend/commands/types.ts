export const BACKEND_COMMAND_IR_VERSION = 1 as const

/** Caller parameters never select an entity, column, operation, or executable source. */
export type BackendCommandParameterIR =
  | { name: string; type: 'uuid' | 'boolean'; required: true }
  | { name: string; type: 'integer'; required: true; min: number; max: number }
  | { name: string; type: 'string'; required: true; maxLength: number }

export type BackendCommandLeafIR =
  | { kind: 'parameter'; name: string }
  | { kind: 'result'; name: string; field: string }
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'caller-sub' }

/** Arithmetic has exactly two scalar leaves and checked signed-32-bit results. */
export type BackendCommandValueSourceIR =
  | BackendCommandLeafIR
  | {
      kind: 'integer-arithmetic'
      operator: 'add' | 'subtract' | 'multiply'
      left: BackendCommandLeafIR
      right: BackendCommandLeafIR
    }

export interface BackendCommandValueIR {
  field: string
  value: BackendCommandValueSourceIR
}

interface BackendCommandMutationIR {
  id: string
  kind: 'data.mutate'
  entityId: string
  values: BackendCommandValueIR[]
  resultName: string
  fields: string[]
}

/** Every read and mutation produces exactly one row; any other count aborts the transaction. */
export type BackendCommandStepIR =
  | {
      id: string
      kind: 'data.read'
      entityId: string
      resultName: string
      fields: string[]
      key: BackendCommandLeafIR
      scope: 'owner' | 'command'
      lock: 'update'
    }
  | (BackendCommandMutationIR & { operation: 'insert' })
  | (BackendCommandMutationIR & { operation: 'update'; record: string })
  | {
      id: string
      kind: 'assert'
      left: BackendCommandValueSourceIR
      operator: 'eq' | 'gte' | 'lte'
      right: BackendCommandValueSourceIR
      error: 'not-found' | 'conflict'
    }

export interface BackendCommandDefinitionIR {
  id: string
  name: string
  /** Static POST route relative to the HTTP API browser mount, when configured. */
  path: string
  access: { kind: 'authenticated' } | { kind: 'role'; roleId: string }
  /** Stable (application, command, verified subject, key) identity; never keyed by definition digest. */
  idempotency: { kind: 'required'; header: 'Idempotency-Key' }
  parameters: BackendCommandParameterIR[]
  /** Explicit command-local authority; it does not grant the caller resource CRUD permissions. */
  steps: BackendCommandStepIR[]
  return: { resultName: string; fields: string[] }
}

export interface BackendCommandIRV1 {
  version: typeof BACKEND_COMMAND_IR_VERSION
  commands: BackendCommandDefinitionIR[]
}
