import type { MotionValidationCode, MotionValidationIssue } from './types'

export type MotionValidationRecord = Record<string, unknown>

export interface MotionPortableValidationHelpers {
  invalid(path: string, code: MotionValidationCode, message: string): never
  plainRecord(value: unknown, path: string): MotionValidationRecord
}

interface MotionValidationHelperOptions {
  rejectSymbolFields?: boolean
}

/** Shared resource budget applied before any Motion-adjacent schema walks untrusted values. */
export const MOTION_PORTABLE_VALUE_LIMITS = Object.freeze({
  maxDepth: 64,
  maxEntries: 16_384,
  maxStringLength: 1_048_576,
  maxPathLength: 4_096,
  maxApproxBytes: 16 * 1_024 * 1_024
})

export abstract class MotionIssueValidationError extends Error {
  readonly issues: MotionValidationIssue[]

  protected constructor(issues: MotionValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
    this.name = 'MotionIssueValidationError'
    this.issues = issues
  }
}

type MotionPortableVisit = {
  readonly kind: 'visit'
  readonly value: unknown
  readonly path: string
  readonly depth: number
}

type MotionPortableLeave = { readonly kind: 'leave'; readonly value: object }
type MotionPortableFrame = MotionPortableVisit | MotionPortableLeave

interface MotionPortableValidationContext {
  readonly rootPath: string
  readonly helpers: MotionPortableValidationHelpers
  readonly active: WeakSet<object>
  readonly stack: MotionPortableFrame[]
  entryCount: number
  approximateBytes: number
}

function consumePortableBudget(
  context: MotionPortableValidationContext,
  entryPath: string,
  bytes: number
): void {
  context.approximateBytes += bytes
  if (entryPath.length > MOTION_PORTABLE_VALUE_LIMITS.maxPathLength) {
    context.helpers.invalid(
      entryPath.slice(0, MOTION_PORTABLE_VALUE_LIMITS.maxPathLength),
      'limit_exceeded',
      'Portable Motion value path is too long'
    )
  }
  if (context.approximateBytes > MOTION_PORTABLE_VALUE_LIMITS.maxApproxBytes) {
    context.helpers.invalid(
      context.rootPath,
      'limit_exceeded',
      'Portable Motion value exceeds the resource budget'
    )
  }
}

function pushPortableChild(
  context: MotionPortableValidationContext,
  frame: MotionPortableVisit,
  container: object,
  key: string,
  childPath: string
): void {
  const descriptor = Object.getOwnPropertyDescriptor(container, key)
  if (descriptor?.get || descriptor?.set) {
    context.helpers.invalid(childPath, 'invalid_value', 'Accessor fields are not supported')
  }
  consumePortableBudget(context, childPath, key.length * 2 + 8)
  context.stack.push({
    kind: 'visit',
    value: descriptor?.value,
    path: childPath,
    depth: frame.depth + 1
  })
}

function pushPortableArray(
  context: MotionPortableValidationContext,
  frame: MotionPortableVisit,
  value: unknown[]
): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    context.helpers.invalid(
      frame.path,
      'invalid_type',
      'Expected an array without a custom prototype'
    )
  }
  if (value.length > MOTION_PORTABLE_VALUE_LIMITS.maxEntries - context.entryCount) {
    context.helpers.invalid(
      frame.path,
      'limit_exceeded',
      'Portable Motion value has too many entries'
    )
  }
  const keys = Object.keys(value)
  if (keys.length !== value.length) {
    context.helpers.invalid(
      frame.path,
      'unknown_key',
      'Sparse arrays and custom array fields are not supported'
    )
  }
  context.entryCount += keys.length
  for (let keyIndex = keys.length - 1; keyIndex >= 0; keyIndex--) {
    const key = keys[keyIndex]
    const index = Number(key)
    const childPath = `${frame.path}[${index}]`
    if (!Number.isInteger(index) || index < 0 || String(index) !== key) {
      context.helpers.invalid(
        `${frame.path}.${key}`,
        'unknown_key',
        'Custom array fields are not supported'
      )
    }
    pushPortableChild(context, frame, value, key, childPath)
  }
}

function pushPortableRecord(
  context: MotionPortableValidationContext,
  frame: MotionPortableVisit,
  value: object
): void {
  const record = context.helpers.plainRecord(value, frame.path)
  const keys = Object.keys(record)
  if (keys.length > MOTION_PORTABLE_VALUE_LIMITS.maxEntries - context.entryCount) {
    context.helpers.invalid(
      frame.path,
      'limit_exceeded',
      'Portable Motion value has too many entries'
    )
  }
  context.entryCount += keys.length
  for (let keyIndex = keys.length - 1; keyIndex >= 0; keyIndex--) {
    const key = keys[keyIndex]
    const childPath = `${frame.path}.${key}`
    pushPortableChild(context, frame, record, key, childPath)
  }
}

function visitPortableValue(
  context: MotionPortableValidationContext,
  frame: MotionPortableFrame
): void {
  if (frame.kind === 'leave') {
    context.active.delete(frame.value)
    return
  }
  if (frame.depth > MOTION_PORTABLE_VALUE_LIMITS.maxDepth) {
    context.helpers.invalid(
      frame.path,
      'limit_exceeded',
      'Portable Motion value is nested too deeply'
    )
  }
  const current = frame.value
  if (typeof current === 'string') {
    if (current.length > MOTION_PORTABLE_VALUE_LIMITS.maxStringLength) {
      context.helpers.invalid(frame.path, 'limit_exceeded', 'Portable Motion strings are too long')
    }
    consumePortableBudget(context, frame.path, current.length * 2)
    return
  }
  if (current === null || typeof current !== 'object') {
    consumePortableBudget(context, frame.path, 8)
    return
  }
  if (context.active.has(current)) {
    context.helpers.invalid(frame.path, 'invalid_value', 'Cyclic values are not supported')
  }
  context.active.add(current)
  context.stack.push({ kind: 'leave', value: current })
  if (Array.isArray(current)) pushPortableArray(context, frame, current)
  else pushPortableRecord(context, frame, current)
}

export function assertMotionPortableValue(
  value: unknown,
  path: string,
  helpers: MotionPortableValidationHelpers
): void {
  const context: MotionPortableValidationContext = {
    rootPath: path,
    helpers,
    active: new WeakSet<object>(),
    stack: [{ kind: 'visit', value, path, depth: 0 }],
    entryCount: 0,
    approximateBytes: path.length * 2
  }
  while (context.stack.length > 0) {
    const frame = context.stack.pop()
    if (frame) visitPortableValue(context, frame)
  }
}

export function normalizedMotionText(
  value: unknown,
  path: string,
  min: number,
  max: number,
  invalid: MotionPortableValidationHelpers['invalid']
): string {
  if (typeof value !== 'string') return invalid(path, 'invalid_type', 'Expected a string')
  const normalized = value.trim().normalize('NFC')
  const length = Array.from(normalized).length
  if (length < min || length > max) {
    return invalid(path, 'out_of_range', `Expected ${min} to ${max} Unicode characters`)
  }
  return normalized
}

function parseMotionHttpUrl(
  ref: string,
  path: string,
  invalid: MotionPortableValidationHelpers['invalid'],
  credentialsMessage: string
): string {
  let url: URL
  try {
    url = new URL(ref)
  } catch {
    return invalid(path, 'invalid_value', 'Expected an absolute HTTP(S) URL')
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    return invalid(path, 'invalid_value', credentialsMessage)
  }
  return url.toString()
}

export function parseMotionSourceReference(
  kind: unknown,
  ref: string,
  path: string,
  invalid: MotionPortableValidationHelpers['invalid'],
  credentialsMessage: string
): { kind: 'file' | 'url'; ref: string } {
  if (/\p{Cc}/u.test(ref)) {
    return invalid(`${path}.ref`, 'invalid_value', 'Control characters are not supported')
  }
  if (kind === 'file') return { kind, ref }
  if (kind !== 'url') return invalid(`${path}.kind`, 'invalid_value', 'Expected file or url')
  return {
    kind,
    ref: parseMotionHttpUrl(ref, `${path}.ref`, invalid, credentialsMessage)
  }
}

export function remapMotionIssuePaths(
  issues: readonly MotionValidationIssue[],
  path: string
): MotionValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path.startsWith('motion')
      ? `${path}${issue.path.slice('motion'.length)}`
      : `${path}.${issue.path}`
  }))
}

export function createMotionValidationHelpers(
  createError: (issues: MotionValidationIssue[]) => Error,
  options: MotionValidationHelperOptions = {}
) {
  function invalid(path: string, code: MotionValidationCode, message: string): never {
    throw createError([{ path, code, message }])
  }

  function plainRecord(value: unknown, path: string): MotionValidationRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return invalid(path, 'invalid_type', 'Expected a plain object')
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid(path, 'invalid_type', 'Expected a plain object without a custom prototype')
    }
    if (options.rejectSymbolFields && Object.getOwnPropertySymbols(value).length > 0) {
      return invalid(path, 'unknown_key', 'Symbol fields are not supported')
    }
    return value as MotionValidationRecord
  }

  function strictRecord(
    value: unknown,
    path: string,
    allowedKeys: readonly string[]
  ): MotionValidationRecord {
    const record = plainRecord(value, path)
    for (const key of Object.keys(record)) {
      if (!allowedKeys.includes(key)) invalid(`${path}.${key}`, 'unknown_key', 'Unknown field')
    }
    return record
  }

  function required(record: MotionValidationRecord, key: string, path: string): unknown {
    if (!Object.hasOwn(record, key) || record[key] === undefined) {
      return invalid(`${path}.${key}`, 'invalid_value', 'Required field is missing')
    }
    return record[key]
  }

  return { invalid, plainRecord, required, strictRecord }
}
