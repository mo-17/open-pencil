import { parseBackendFieldDefault } from '../field-default-validation'
import type { DataEntityIR, DataFieldIR, DataModelIR } from '../types'
import type { BackendValidationContext } from '../validation-helpers'
import { commandError } from './shape-values'
import type {
  BackendCommandDefinitionIR,
  BackendCommandLeafIR,
  BackendCommandValueSourceIR
} from './types'

export interface CommandResult {
  entity: DataEntityIR
  fields: readonly string[]
  locked: boolean
}
export interface CommandValueContext {
  command: BackendCommandDefinitionIR
  model: DataModelIR
  results: ReadonlyMap<string, CommandResult>
  context: BackendValidationContext
}
type ValueType = Pick<DataFieldIR, 'type' | 'nullable' | 'enumId'>

function literalType(value: BackendCommandLeafIR & { kind: 'literal' }): ValueType | undefined {
  if (value.value === null) return undefined
  const type = typeof value.value
  if (type === 'number')
    return { type: Number.isInteger(value.value) ? 'integer' : 'number', nullable: false }
  if (type === 'string' || type === 'boolean') return { type, nullable: false }
  return undefined
}

export function commandLeafType(
  source: BackendCommandLeafIR,
  path: string,
  ctx: CommandValueContext
): ValueType | undefined {
  if (source.kind === 'literal') return literalType(source)
  if (source.kind === 'caller-sub') return { type: 'uuid', nullable: false }
  if (source.kind === 'parameter') {
    const parameter = ctx.command.parameters.find((entry) => entry.name === source.name)
    if (parameter) return { type: parameter.type, nullable: false }
    commandError(ctx.context, path, 'Command value references an undeclared parameter.')
    return undefined
  }
  const result = ctx.results.get(source.name)
  if (!result || !result.fields.includes(source.field)) {
    commandError(
      ctx.context,
      path,
      'Command result values must reference a projected field of a prior result.'
    )
    return undefined
  }
  return result.entity.fields.find((field) => field.id === source.field)
}

export function commandValueType(
  source: BackendCommandValueSourceIR,
  path: string,
  ctx: CommandValueContext
): ValueType | undefined {
  if (source.kind !== 'integer-arithmetic') return commandLeafType(source, path, ctx)
  for (const [key, value] of [
    ['left', source.left],
    ['right', source.right]
  ] as const) {
    const type = commandLeafType(value, path + '.' + key, ctx)
    if (
      type?.type !== 'integer' ||
      type.nullable ||
      (value.kind === 'literal' &&
        (Number(value.value) < -2147483648 || Number(value.value) > 2147483647))
    ) {
      commandError(
        ctx.context,
        path + '.' + key,
        'Integer arithmetic requires non-null signed-32-bit integer operands.'
      )
    }
  }
  return { type: 'integer', nullable: false }
}

export function validateCommandAssignment(
  source: BackendCommandValueSourceIR,
  target: ValueType,
  path: string,
  ctx: CommandValueContext
): void {
  if (source.kind === 'literal') {
    parseBackendFieldDefault(
      { kind: 'literal', value: source.value },
      path,
      ctx.context,
      target.type,
      target.nullable
    )
    if (
      target.type === 'integer' &&
      typeof source.value === 'number' &&
      (source.value < -2147483648 || source.value > 2147483647)
    )
      commandError(ctx.context, path, 'Integer command literals must fit signed 32-bit storage.')
    if (
      target.type === 'enum' &&
      source.value !== null &&
      !ctx.model.enums.some(
        (entry) => entry.id === target.enumId && entry.values.includes(String(source.value))
      )
    )
      commandError(
        ctx.context,
        path,
        'Command enum literals must be declared members of the target enum.'
      )
    return
  }
  const actual = commandValueType(source, path, ctx)
  if (
    actual &&
    (actual.type !== target.type ||
      actual.enumId !== target.enumId ||
      (actual.nullable && !target.nullable))
  )
    commandError(ctx.context, path, 'Command value type or nullability does not match its target.')
}

export function validateCommandComparison(
  left: BackendCommandValueSourceIR,
  operator: 'eq' | 'gte' | 'lte',
  right: BackendCommandValueSourceIR,
  path: string,
  ctx: CommandValueContext
): void {
  const leftType = commandValueType(left, path + '.left', ctx)
  const rightType = commandValueType(right, path + '.right', ctx)
  if (left.kind === 'literal' && rightType)
    validateCommandAssignment(left, rightType, path + '.left', ctx)
  else if (right.kind === 'literal' && leftType)
    validateCommandAssignment(right, leftType, path + '.right', ctx)
  else if (
    !leftType ||
    !rightType ||
    leftType.type !== rightType.type ||
    leftType.enumId !== rightType.enumId
  )
    commandError(
      ctx.context,
      path,
      'Command assertions require values of the same scalar or enum type.'
    )
  if (
    operator !== 'eq' &&
    (leftType?.type !== 'integer' ||
      rightType?.type !== 'integer' ||
      leftType.nullable ||
      rightType.nullable)
  )
    commandError(ctx.context, path, 'Ordered command assertions require non-null integers.')
}
