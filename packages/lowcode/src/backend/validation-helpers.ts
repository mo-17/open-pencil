import { BACKEND_LIMITS } from './limits'
import { containsBackendSecretLikeMaterial } from './secret-boundary'
import type { BackendDiagnostic } from './types'

export interface BackendValidationContext {
  diagnostics: BackendDiagnostic[]
}

export interface BackendUnknownRecord {
  readonly [key: string]: unknown
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u
const SAFE_ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,127}$/u
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

interface BoundedDataState {
  readonly context: BackendValidationContext
  readonly stack: WeakSet<object>
  nodes: number
  estimatedBytes: number
}

export function diagnostic(
  context: BackendValidationContext,
  code: string,
  path: string,
  message: string
): void {
  context.diagnostics.push({ code, severity: 'error', path, message })
}

function visitBoundedArray(
  value: readonly unknown[],
  path: string,
  depth: number,
  state: BoundedDataState
): boolean {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    diagnostic(state.context, 'backend-invalid-array', path, 'Only plain arrays are allowed.')
    return false
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (!lengthDescriptor || !('value' in lengthDescriptor)) {
    diagnostic(state.context, 'backend-invalid-array', path, 'Array length must be data-only.')
    return false
  }
  const length = lengthDescriptor.value
  if (!Number.isSafeInteger(length) || length < 0 || length > BACKEND_LIMITS.maxNodes) {
    diagnostic(state.context, 'backend-limit-nodes', path, 'Backend array exceeds the node limit.')
    return false
  }
  let ok = true
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    const index = typeof key === 'string' && /^(?:0|[1-9]\d*)$/u.test(key) ? Number(key) : -1
    if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
      diagnostic(
        state.context,
        'backend-array-property',
        path,
        'Array symbols and custom properties are not allowed.'
      )
      ok = false
    }
  }
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor) {
      diagnostic(state.context, 'backend-sparse-array', path, 'Sparse arrays are not allowed.')
      ok = false
      continue
    }
    if (!descriptor.enumerable) {
      diagnostic(
        state.context,
        'backend-array-property',
        `${path}[${index}]`,
        'Array items must be enumerable data properties.'
      )
      ok = false
      continue
    }
    if (!('value' in descriptor)) {
      diagnostic(
        state.context,
        'backend-accessor',
        `${path}[${index}]`,
        'Accessors are not allowed.'
      )
      ok = false
      continue
    }
    ok = visitBoundedValue(descriptor.value, `${path}[${index}]`, depth + 1, state) && ok
  }
  return ok
}

function visitBoundedObject(
  value: object,
  path: string,
  depth: number,
  state: BoundedDataState
): boolean {
  let ok = true
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    diagnostic(state.context, 'backend-invalid-object', path, 'Only plain objects are allowed.')
    ok = false
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      diagnostic(
        state.context,
        'backend-object-property',
        path,
        'Object symbol properties are not allowed.'
      )
      ok = false
      continue
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable) {
      diagnostic(
        state.context,
        'backend-object-property',
        path,
        'Object properties must be enumerable data properties.'
      )
      ok = false
      continue
    }
    state.estimatedBytes += new TextEncoder().encode(key).byteLength + 2
    if (UNSAFE_KEYS.has(key)) {
      diagnostic(state.context, 'backend-unsafe-key', path, 'Unsafe object key is not allowed.')
      ok = false
      continue
    }
    if (!('value' in descriptor)) {
      diagnostic(state.context, 'backend-accessor', path, 'Accessors are not allowed.')
      ok = false
      continue
    }
    ok = visitBoundedValue(descriptor.value, `${path}.${key}`, depth + 1, state) && ok
  }
  return ok
}

function visitBoundedValue(
  value: unknown,
  path: string,
  depth: number,
  state: BoundedDataState
): boolean {
  state.nodes++
  if (state.nodes > BACKEND_LIMITS.maxNodes) {
    diagnostic(state.context, 'backend-limit-nodes', path, 'Backend data exceeds the node limit.')
    return false
  }
  if (depth > BACKEND_LIMITS.maxDepth) {
    diagnostic(
      state.context,
      'backend-limit-depth',
      path,
      'Backend data exceeds the nesting limit.'
    )
    return false
  }
  if (typeof value === 'string') {
    state.estimatedBytes += new TextEncoder().encode(value).byteLength + 2
    if (value.length <= BACKEND_LIMITS.maxTextLength) return true
    diagnostic(state.context, 'backend-limit-string', path, 'String exceeds the backend limit.')
    return false
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    state.estimatedBytes += 16
    return true
  }
  if (typeof value !== 'object') {
    diagnostic(
      state.context,
      'backend-invalid-json',
      path,
      'Value must be bounded plain JSON data.'
    )
    return false
  }
  if (state.stack.has(value)) {
    diagnostic(state.context, 'backend-cycle', path, 'Cyclic backend data is not allowed.')
    return false
  }
  state.stack.add(value)
  const ok = Array.isArray(value)
    ? visitBoundedArray(value, path, depth, state)
    : visitBoundedObject(value, path, depth, state)
  state.stack.delete(value)
  if (state.estimatedBytes <= BACKEND_LIMITS.maxCanonicalBytes) return ok
  diagnostic(state.context, 'backend-limit-bytes', path, 'Backend data exceeds the byte limit.')
  return false
}

export function assertBoundedBackendData(
  value: unknown,
  context: BackendValidationContext
): boolean {
  const state: BoundedDataState = {
    context,
    stack: new WeakSet<object>(),
    nodes: 0,
    estimatedBytes: 0
  }
  return visitBoundedValue(value, '$', 0, state)
}

export function record(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  allowed: readonly string[],
  required: readonly string[] = allowed
): BackendUnknownRecord | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    diagnostic(context, 'backend-object-required', path, 'Value must be an object.')
    return undefined
  }
  const source = value as BackendUnknownRecord
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) {
      diagnostic(
        context,
        'backend-unknown-field',
        containsBackendSecretLikeMaterial(key) ? path : `${path}.${key}`,
        'Unknown field is not allowed.'
      )
    }
  }
  for (const key of required) {
    if (!(key in source)) {
      diagnostic(context, 'backend-required-field', `${path}.${key}`, 'Required field is missing.')
    }
  }
  return source
}

export function array(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  limit: number
): unknown[] | undefined {
  if (!Array.isArray(value)) {
    diagnostic(context, 'backend-array-required', path, 'Value must be an array.')
    return undefined
  }
  if (value.length > limit) {
    diagnostic(context, 'backend-array-limit', path, `Array must contain at most ${limit} items.`)
    return undefined
  }
  return value
}

export function parseArrayItems<T>(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  limit: number,
  parse: (entry: unknown, entryPath: string, context: BackendValidationContext) => T | undefined,
  allowUndefined = false
): T[] | undefined {
  if (allowUndefined && value === undefined) return undefined
  const values = array(value, path, context, limit)
  if (!values) return undefined
  const parsed = values
    .map((entry, index) => parse(entry, `${path}[${index}]`, context))
    .filter((entry): entry is T => entry !== undefined)
  return parsed.length === values.length ? parsed : undefined
}

export function id(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string | undefined {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    diagnostic(context, 'backend-id-invalid', path, 'Value must be a safe backend identifier.')
    return undefined
  }
  return value
}

export function identifier(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string | undefined {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    diagnostic(context, 'backend-identifier-invalid', path, 'Value must be a plain identifier.')
    return undefined
  }
  return value
}

export function environmentName(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string | undefined {
  if (typeof value !== 'string' || !SAFE_ENVIRONMENT_NAME.test(value)) {
    diagnostic(context, 'backend-environment-name-invalid', path, 'Environment name is invalid.')
    return undefined
  }
  return value
}

export function boundedText(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  maxLength: number = BACKEND_LIMITS.maxTextLength
): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    diagnostic(context, 'backend-text-invalid', path, 'Value must be a bounded non-empty string.')
    return undefined
  }
  return value
}

export function boolean(
  value: unknown,
  path: string,
  context: BackendValidationContext
): boolean | undefined {
  if (typeof value !== 'boolean') {
    diagnostic(context, 'backend-boolean-required', path, 'Value must be a boolean.')
    return undefined
  }
  return value
}

export function oneOf<const T extends string>(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  values: readonly T[]
): T | undefined {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    diagnostic(
      context,
      'backend-enum-invalid',
      path,
      'Value is not supported by this contract version.'
    )
    return undefined
  }
  return value as T
}

export function uniqueBy(
  values: readonly string[],
  path: string,
  context: BackendValidationContext,
  label: string
): boolean {
  const seen = new Set<string>()
  let ok = true
  for (const value of values) {
    if (seen.has(value)) {
      diagnostic(context, 'backend-duplicate', path, `Duplicate ${label} is not allowed.`)
      ok = false
    }
    seen.add(value)
  }
  return ok
}

export function sorted<T>(values: T[], key: (value: T) => string): T[] {
  return values.sort((left, right) => key(left).localeCompare(key(right), 'en'))
}
