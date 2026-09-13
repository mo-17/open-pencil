export const COMMAND_INPUT_SOURCE = String.raw`import { BadRequestException, ConflictException } from '@nestjs/common'
import type { Request } from 'express'
import type { CommandLeaf, CommandParameter, CommandRow, CommandValue, Scalar } from './command-types.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY = /^[A-Za-z0-9._:-]{16,128}$/

export function commandRequestKey(request: Request): string {
  const values: string[] = []
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'idempotency-key') {
      const value = request.rawHeaders[index + 1]
      if (typeof value === 'string') values.push(value)
    }
  }
  const key = values[0]
  if (values.length !== 1 || !key || !KEY.test(key) || request.headers['idempotency-key'] !== key)
    throw new BadRequestException('Invalid request.')
  return key
}

function validText(value: string, maximum: number): boolean {
  return value.length <= maximum && !Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code === 0 || (code >= 0xd800 && code <= 0xdfff)
  })
}

function parameterValue(parameter: CommandParameter, value: unknown): Scalar {
  if (parameter.type === 'uuid' && typeof value === 'string' && UUID.test(value)) return value.toLowerCase()
  if (parameter.type === 'boolean' && typeof value === 'boolean') return value
  if (parameter.type === 'string' && typeof value === 'string' && validText(value, parameter.maxLength)) return value
  if (parameter.type === 'integer' && typeof value === 'number' && Number.isInteger(value) &&
      value >= parameter.min && value <= parameter.max) return value === 0 ? 0 : value
  throw new BadRequestException('Invalid request.')
}

export function commandInput(parameters: readonly CommandParameter[], body: unknown): CommandRow {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== parameters.length ||
      Object.keys(body).some((key) => !parameters.some((parameter) => parameter.name === key)))
    throw new BadRequestException('Invalid request.')
  const input: CommandRow = Object.create(null) as CommandRow
  for (const parameter of [...parameters].sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (!Object.hasOwn(body, parameter.name)) throw new BadRequestException('Invalid request.')
    input[parameter.name] = parameterValue(parameter, Reflect.get(body, parameter.name))
  }
  return input
}

export function commandScalar(value: unknown): Scalar {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))) return value
  throw new ConflictException('Request conflict.')
}

function leaf(value: CommandLeaf, input: CommandRow, results: ReadonlyMap<string, CommandRow>, subject: string): Scalar {
  if (value.kind === 'literal') return value.value
  if (value.kind === 'caller-sub') return subject
  if (value.kind === 'parameter') return commandScalar(input[value.name])
  return commandScalar(results.get(value.name)?.[value.field])
}

function integer(value: Scalar): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < -2147483648 || value > 2147483647)
    throw new ConflictException('Request conflict.')
  return value
}

export function commandValue(value: CommandValue, input: CommandRow, results: ReadonlyMap<string, CommandRow>, subject: string): Scalar {
  if (value.kind !== 'integer-arithmetic') return leaf(value, input, results, subject)
  const left = integer(leaf(value.left, input, results, subject))
  const right = integer(leaf(value.right, input, results, subject))
  const result = value.operator === 'add' ? left + right : value.operator === 'subtract' ? left - right : left * right
  return integer(result)
}
`
