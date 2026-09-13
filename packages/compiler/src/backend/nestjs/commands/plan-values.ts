import type {
  BackendApplicationSpecV1,
  BackendCommandDefinitionIR,
  BackendCommandStepIR,
  BackendCommandValueSourceIR,
  DataFieldIR
} from '@open-pencil/lowcode/backend'

/** References and projection visibility have already passed the shared command validator. */
export function nestJSCommandResultField(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR,
  source: BackendCommandValueSourceIR
): DataFieldIR | undefined {
  if (source.kind !== 'result') return undefined
  const result = command.steps.find(
    (step) => step.kind !== 'assert' && step.resultName === source.name
  )
  if (!result || result.kind === 'assert') return undefined
  return application.dataModel.entities
    .find((entity) => entity.id === result.entityId)
    ?.fields.find((field) => field.id === source.field)
}

function sourceType(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR,
  source: BackendCommandValueSourceIR
): DataFieldIR['type'] | undefined {
  if (source.kind === 'caller-sub') return 'uuid'
  if (source.kind === 'integer-arithmetic') return 'integer'
  if (source.kind === 'parameter')
    return command.parameters.find((parameter) => parameter.name === source.name)?.type
  return nestJSCommandResultField(application, command, source)?.type
}

function canonicalLiteral(
  source: BackendCommandValueSourceIR,
  expected: DataFieldIR['type'] | undefined
): BackendCommandValueSourceIR {
  if (source.kind !== 'literal' || typeof source.value !== 'string') return source
  if (expected === 'uuid') return { ...source, value: source.value.toLowerCase() }
  if (expected !== 'datetime') return source
  // Provider validation bounds RFC3339 input to UTC years 0001..9999 and six digits.
  // Date retains the first three digits; preserve the remaining authored microseconds.
  const fraction = /\.(\d{1,6})(?:Z|[+-])/u.exec(source.value)?.[1] ?? ''
  const microseconds = fraction.padEnd(6, '0').slice(3)
  return {
    ...source,
    value: new Date(source.value).toISOString().slice(0, -1) + microseconds + 'Z'
  }
}

/** SQL projections and UUID inputs are canonical; typed equality must use the same encoding. */
export function nestJSCommandAssertion(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR,
  step: Extract<BackendCommandStepIR, { kind: 'assert' }>
): Omit<Extract<BackendCommandStepIR, { kind: 'assert' }>, 'id'> {
  return {
    kind: step.kind,
    left: canonicalLiteral(step.left, sourceType(application, command, step.right)),
    right: canonicalLiteral(step.right, sourceType(application, command, step.left)),
    operator: step.operator,
    error: step.error
  }
}
