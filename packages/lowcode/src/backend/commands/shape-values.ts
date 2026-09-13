import { discriminatedRecord } from '../discriminated-record'
import {
  diagnostic,
  id,
  identifier,
  oneOf,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext
} from '../validation-helpers'
import type {
  BackendCommandLeafIR,
  BackendCommandParameterIR,
  BackendCommandValueSourceIR
} from './types'

export function commandError(
  context: BackendValidationContext,
  path: string,
  message: string
): void {
  diagnostic(context, 'backend-command-invalid', path, message)
}

export function commandInteger(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  min = -2147483648,
  max = 2147483647
): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max)
    return value
  commandError(context, path, 'Expected an integer within the declared command bounds.')
  return undefined
}

export function commandFieldSet(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string[] | undefined {
  const fields = parseArrayItems(value, path, context, 64, id)
  if (!fields) return undefined
  if (!fields.length) commandError(context, path, 'Command field projections must be nonempty.')
  uniqueBy(fields, path, context, 'command field')
  return sorted(fields, (field) => field)
}

export function commandParameter(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendCommandParameterIR | undefined {
  const source = record(
    value,
    path,
    context,
    ['name', 'type', 'required', 'min', 'max', 'maxLength'],
    ['name', 'type', 'required']
  )
  if (!source) return undefined
  const name = identifier(source.name, path + '.name', context)
  if (name && (name === 'prototype' || Object.getOwnPropertyNames(Object.prototype).includes(name)))
    commandError(
      context,
      path + '.name',
      'Command parameter names cannot shadow object prototype keys.'
    )
  const type = oneOf(source.type, path + '.type', context, ['uuid', 'boolean', 'integer', 'string'])
  if (source.required !== true)
    commandError(context, path + '.required', 'Command parameters must be required.')
  const allowed = [
    'name',
    'type',
    'required',
    ...(type === 'integer' ? ['min', 'max'] : []),
    ...(type === 'string' ? ['maxLength'] : [])
  ]
  record(source, path, context, allowed)
  if (!name || !type || source.required !== true) return undefined
  if (type === 'integer') {
    const min = commandInteger(source.min, path + '.min', context)
    const max = commandInteger(source.max, path + '.max', context)
    if (min === undefined || max === undefined) return undefined
    if (min > max) commandError(context, path, 'Command parameter minimum cannot exceed maximum.')
    return { name, type, required: true, min, max }
  }
  if (type === 'string') {
    const maxLength = commandInteger(source.maxLength, path + '.maxLength', context, 1, 512)
    return maxLength === undefined ? undefined : { name, type, required: true, maxLength }
  }
  return { name, type, required: true }
}

const LEAVES = {
  parameter: { allowed: ['kind', 'name'], required: ['kind', 'name'] },
  result: { allowed: ['kind', 'name', 'field'], required: ['kind', 'name', 'field'] },
  literal: { allowed: ['kind', 'value'], required: ['kind', 'value'] },
  'caller-sub': { allowed: ['kind'], required: ['kind'] }
} as const

export function commandLeaf(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendCommandLeafIR | undefined {
  const parsed = discriminatedRecord(value, path, context, LEAVES)
  if (!parsed) return undefined
  const { source, kind } = parsed
  if (kind === 'caller-sub') return { kind }
  if (kind === 'literal') {
    const literal = source.value
    if (
      literal === null ||
      typeof literal === 'boolean' ||
      (typeof literal === 'number' && Number.isFinite(literal))
    )
      return { kind, value: literal }
    if (typeof literal === 'string') {
      if (literal.length <= 512 && !literal.includes('\u0000') && !/[\uD800-\uDFFF]/u.test(literal))
        return { kind, value: literal }
      commandError(
        context,
        path + '.value',
        'Command string literals must be bounded Unicode text without NUL.'
      )
    } else commandError(context, path, 'Command literals must be finite scalar values or null.')
    return undefined
  }
  const name = identifier(source.name, path + '.name', context)
  if (!name) return undefined
  if (kind === 'parameter') return { kind, name }
  const field = id(source.field, path + '.field', context)
  return field ? { kind, name, field } : undefined
}

export function commandValue(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendCommandValueSourceIR | undefined {
  const parsed = discriminatedRecord(value, path, context, {
    ...LEAVES,
    'integer-arithmetic': {
      allowed: ['kind', 'operator', 'left', 'right'],
      required: ['kind', 'operator', 'left', 'right']
    }
  })
  if (!parsed) return undefined
  if (parsed.kind !== 'integer-arithmetic') return commandLeaf(parsed.source, path, context)
  const { source, kind } = parsed
  const operator = oneOf(source.operator, path + '.operator', context, [
    'add',
    'subtract',
    'multiply'
  ])
  const left = commandLeaf(source.left, path + '.left', context)
  const right = commandLeaf(source.right, path + '.right', context)
  return operator && left && right ? { kind, operator, left, right } : undefined
}
