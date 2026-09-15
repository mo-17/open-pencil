import type { BackendCommandParameterIR } from './types'

/** Data-only scalar signatures shared by the reviewed fixed command domains. */
export function requiredUUIDParameter(name: string): BackendCommandParameterIR {
  return { name, type: 'uuid', required: true }
}

export function requiredTextParameter(name: string, maxLength: number): BackendCommandParameterIR {
  return { name, type: 'string', required: true, maxLength }
}

export function requiredIntegerParameter(
  name: string,
  min: number,
  max: number
): BackendCommandParameterIR {
  return { name, type: 'integer', required: true, min, max }
}
