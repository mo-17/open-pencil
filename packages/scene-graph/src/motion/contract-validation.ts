import type { MotionValidationIssue } from './types'
import { createMotionValidationHelpers, normalizedMotionText } from './validation-helpers'

const SAFE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/
const DANGEROUS_IDENTIFIERS = new Set(['constructor', 'prototype', '__proto__', 'javascript'])

export const MOTION_CONTRACT_LIMITS = Object.freeze({
  maxIdLength: 64,
  maxReferenceLength: 128
})

type ContractErrorFactory = (issues: MotionValidationIssue[]) => Error

/** Shared scalar guards for independent bounded Motion-adjacent schemas. */
export function createMotionContractValidationHelpers(createError: ContractErrorFactory) {
  const base = createMotionValidationHelpers(createError, { rejectSymbolFields: true })
  const { invalid } = base

  function finiteNumber(value: unknown, path: string): number {
    const isNumber = typeof value === 'number'
    if (!isNumber || !Number.isFinite(value)) {
      return invalid(
        path,
        isNumber ? 'invalid_value' : 'invalid_type',
        isNumber ? 'Expected a finite number' : 'Expected a number'
      )
    }
    return value === 0 ? 0 : value
  }

  function boundedNumber(value: unknown, path: string, min: number, max: number): number {
    const number = finiteNumber(value, path)
    if (number >= min && number <= max) return number
    return invalid(path, 'out_of_range', `Expected a value from ${min} to ${max}`)
  }

  function boundedInteger(value: unknown, path: string, min: number, max: number): number {
    const number = finiteNumber(value, path)
    if (!Number.isInteger(number)) return invalid(path, 'invalid_value', 'Expected an integer')
    return boundedNumber(number, path, min, max)
  }

  function safeString(pattern: RegExp, maxLength: number, label: string) {
    return (value: unknown, path: string): string => {
      const accepted =
        typeof value === 'string' &&
        pattern.test(value) &&
        !DANGEROUS_IDENTIFIERS.has(value.toLowerCase())
      if (accepted) return value
      return invalid(
        path,
        'invalid_value',
        `Expected a safe ${label} of at most ${maxLength} characters`
      )
    }
  }

  const safeId = safeString(SAFE_ID, MOTION_CONTRACT_LIMITS.maxIdLength, 'identifier')
  const safeReference = safeString(
    SAFE_REFERENCE,
    MOTION_CONTRACT_LIMITS.maxReferenceLength,
    'reference'
  )
  const safeNodeReference = safeString(
    SAFE_REFERENCE,
    MOTION_CONTRACT_LIMITS.maxReferenceLength,
    'node reference'
  )

  function booleanValue(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') return invalid(path, 'invalid_type', 'Expected a boolean')
    return value
  }

  function enumValue<T extends string>(
    value: unknown,
    path: string,
    allowed: ReadonlySet<T>,
    label: string
  ): T {
    if (typeof value !== 'string' || !allowed.has(value as T)) {
      return invalid(path, 'invalid_value', `Unknown ${label}`)
    }
    return value as T
  }

  function text(value: unknown, path: string, min: number, max: number): string {
    return normalizedMotionText(value, path, min, max, invalid)
  }

  function uniqueIds(values: readonly { id: string }[], path: string, label: string): void {
    const firstIndexById = new Map<string, number>()
    values.forEach(({ id }, index) => {
      if (firstIndexById.has(id)) {
        invalid(`${path}[${index}].id`, 'invalid_value', `${label} ids must be unique`)
      }
      firstIndexById.set(id, index)
    })
  }

  return {
    ...base,
    booleanValue,
    boundedInteger,
    boundedNumber,
    enumValue,
    finiteNumber,
    safeId,
    safeNodeReference,
    safeReference,
    text,
    uniqueIds
  }
}
