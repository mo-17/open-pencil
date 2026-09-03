import type { BackendApplicationSpecV2, BackendFieldScalarType } from '@open-pencil/lowcode/backend'

import {
  resolvedSupabaseAtomicTransactionV2,
  type ResolvedSupabaseAtomicParameterV2
} from './transaction'

function typescriptType(type: BackendFieldScalarType): string {
  switch (type) {
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'string':
    case 'date':
    case 'datetime':
    case 'uuid':
      return 'string'
    default:
      throw new TypeError('Unsupported generated atomic RPC client parameter type.')
  }
}

function validationLines(
  parameter: ResolvedSupabaseAtomicParameterV2,
  expectedVersionParameter: string
): readonly string[] {
  const value = `parameterValues[${JSON.stringify(parameter.name)}]`
  const label = JSON.stringify(`Atomic parameter ${parameter.name} is invalid`)
  if (parameter.name === expectedVersionParameter) {
    return [
      `  if (!Number.isSafeInteger(${value}) || (${value} as number) < 0 || (${value} as number) >= Number.MAX_SAFE_INTEGER) {`,
      `    throw new TypeError(${label})`,
      '  }'
    ]
  }
  switch (parameter.type) {
    case 'integer':
      return [`  if (!Number.isSafeInteger(${value})) throw new TypeError(${label})`]
    case 'number':
      return [
        `  if (typeof ${value} !== 'number' || !Number.isFinite(${value})) throw new TypeError(${label})`
      ]
    case 'boolean':
      return [`  if (typeof ${value} !== 'boolean') throw new TypeError(${label})`]
    case 'string':
      return [
        `  if (typeof ${value} !== 'string' || ${value}.length > OPENPENCIL_ATOMIC_MAX_STRING_LENGTH) {`,
        `    throw new TypeError(${label})`,
        '  }'
      ]
    case 'date':
      return [
        `  if (typeof ${value} !== 'string' || !OPENPENCIL_ATOMIC_DATE.test(${value})) {`,
        `    throw new TypeError(${label})`,
        '  }'
      ]
    case 'datetime':
      return [
        `  if (typeof ${value} !== 'string' || !OPENPENCIL_ATOMIC_DATETIME.test(${value})) {`,
        `    throw new TypeError(${label})`,
        '  }'
      ]
    case 'uuid':
      return [
        `  if (typeof ${value} !== 'string' || !OPENPENCIL_ATOMIC_UUID.test(${value})) {`,
        `    throw new TypeError(${label})`,
        '  }'
      ]
    default:
      throw new TypeError('Unsupported generated atomic RPC client parameter type.')
  }
}

/** Generated React/Vue-neutral wrapper around exactly one PostgREST RPC request. */
export function emitSupabaseAtomicTransactionClientV2(
  application: BackendApplicationSpecV2
): string {
  const transaction = resolvedSupabaseAtomicTransactionV2(application)
  const parameterKeys = transaction.parameters.map((entry) => entry.name)
  const rpcArguments = transaction.parameters
    .map(
      (entry) =>
        `    ${JSON.stringify(entry.sqlArgument)}: parameterValues[${JSON.stringify(entry.name)}]`
    )
    .join(',\n')
  const primaryKeyChecks = transaction.primaryKey.flatMap((entry) => [
    `  if (primaryKey[${JSON.stringify(entry.field)}] !== parameterValues[${JSON.stringify(entry.parameter)}]) {`,
    '    throwAtomicResultError()',
    '  }'
  ])
  return `// Generated from reviewed Backend Application V2 IR. Do not edit by hand.
// The host owns the authenticated Supabase session; this helper accepts no credential or token.
// Exactly one RPC request is made. Serialization conflicts are returned to the caller and never retried.

export interface OpenPencilSupabaseRpcClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>
  ): PromiseLike<OpenPencilSupabaseRpcResponse>
}

export interface OpenPencilSupabaseRpcResponse {
  readonly data: unknown
  readonly error: unknown
  readonly count?: unknown
  readonly status?: unknown
  readonly statusText?: unknown
  readonly success?: unknown
}

export interface OpenPencilAtomicTransactionParameters {
${transaction.parameters.map((entry) => `  ${JSON.stringify(entry.name)}: ${typescriptType(entry.type)}`).join('\n')}
}

export interface OpenPencilAtomicTransactionResult {
  readonly entityId: ${JSON.stringify(transaction.entityId)}
  readonly primaryKey: Readonly<Record<string, string>>
  readonly newVersion: number
}

export type OpenPencilAtomicTransactionErrorCode =
  | 'conflict'
  | 'request-failed'
  | 'invalid-result'

export class OpenPencilAtomicTransactionError extends Error {
  readonly code: OpenPencilAtomicTransactionErrorCode

  constructor(code: OpenPencilAtomicTransactionErrorCode) {
    const message =
      code === 'conflict'
        ? 'Supabase atomic transaction conflicted'
        : code === 'request-failed'
          ? 'Supabase atomic transaction request failed'
          : 'Supabase atomic transaction returned an invalid result'
    super(message)
    this.name = 'OpenPencilAtomicTransactionError'
    this.code = code
  }
}

export const openPencilAtomicTransaction = Object.freeze({
  transactionId: ${JSON.stringify(transaction.id)},
  functionName: ${JSON.stringify(transaction.functionName)},
  parameterKeys: Object.freeze(${JSON.stringify(parameterKeys)}),
  retry: false,
  idempotency: false
} as const)

const OPENPENCIL_ATOMIC_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const OPENPENCIL_ATOMIC_DATE = /^\\d{4}-\\d{2}-\\d{2}$/u
const OPENPENCIL_ATOMIC_DATETIME = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$/u
const OPENPENCIL_ATOMIC_MAX_STRING_LENGTH = 1_000_000
const OPENPENCIL_RPC_LEGACY_ENVELOPE_KEYS = Object.freeze([
  'data',
  'error',
  'count',
  'status',
  'statusText'
] as const)
const OPENPENCIL_RPC_CURRENT_ENVELOPE_KEYS = Object.freeze([
  ...OPENPENCIL_RPC_LEGACY_ENVELOPE_KEYS,
  'success'
] as const)

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  label: string
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(label)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(label)
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    throw new TypeError(label)
  }
  const record: Record<string, unknown> = Object.create(null)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError(label)
    record[key] = descriptor.value
  }
  return record
}

function hasExactOwnDataDescriptors(value: unknown, keys: readonly string[]): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return false
  }
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}

function isDescriptorSafeDataGraph(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>()
): boolean {
  if (value === null) return true
  const valueType = typeof value
  if (
    valueType === 'string' ||
    valueType === 'number' ||
    valueType === 'boolean' ||
    valueType === 'undefined' ||
    valueType === 'bigint'
  ) {
    return true
  }
  if (valueType !== 'object' || Array.isArray(value)) return false
  const objectValue = value as object
  const prototype = Object.getPrototypeOf(objectValue)
  if (prototype !== Object.prototype && prototype !== null) return false
  if (seen.has(objectValue)) return true
  seen.add(objectValue)
  for (const key of Reflect.ownKeys(objectValue)) {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key)
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      !isDescriptorSafeDataGraph(descriptor.value, seen)
    ) {
      return false
    }
  }
  return true
}

type OpenPencilSafeClone =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false }

function safeStructuredClone(value: unknown): OpenPencilSafeClone {
  try {
    if (!isDescriptorSafeDataGraph(value)) return { ok: false }
    return { ok: true, value: structuredClone(value) }
  } catch {
    return { ok: false }
  }
}

function throwAtomicResultError(): never {
  throw new OpenPencilAtomicTransactionError('invalid-result')
}

function exactParameterRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const label = 'Atomic transaction parameters must be an exact data-only object'
  try {
    if (!hasExactOwnDataDescriptors(value, keys)) throw new TypeError(label)
    const cloned = safeStructuredClone(value)
    if (!cloned.ok) throw new TypeError(label)
    return exactDataRecord(cloned.value, keys, label)
  } catch {
    throw new TypeError(label)
  }
}

function exactRpcDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (!hasExactOwnDataDescriptors(value, keys)) return throwAtomicResultError()
    const cloned = safeStructuredClone(value)
    if (!cloned.ok) return throwAtomicResultError()
    return exactDataRecord(cloned.value, keys, 'Invalid Supabase atomic RPC data')
  } catch {
    return throwAtomicResultError()
  }
}

function postgrestErrorCode(value: unknown): string | null {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    const cloned = safeStructuredClone(value)
    if (!cloned.ok || cloned.value === null || typeof cloned.value !== 'object') return null
    const prototype = Object.getPrototypeOf(cloned.value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const code = Object.getOwnPropertyDescriptor(cloned.value, 'code')
    return code?.enumerable === true &&
      'value' in code &&
      typeof code.value === 'string' &&
      code.value.length <= 32
      ? code.value
      : null
  } catch {
    return null
  }
}

type OpenPencilRpcEnvelope =
  | { readonly kind: 'success'; readonly data: unknown }
  | { readonly kind: 'failure'; readonly code: string }

function supabaseRpcEnvelope(value: unknown): OpenPencilRpcEnvelope | null {
  try {
    const legacy = hasExactOwnDataDescriptors(value, OPENPENCIL_RPC_LEGACY_ENVELOPE_KEYS)
    const current =
      !legacy && hasExactOwnDataDescriptors(value, OPENPENCIL_RPC_CURRENT_ENVELOPE_KEYS)
    if (!legacy && !current) return null
    const cloned = safeStructuredClone(value)
    if (!cloned.ok) return null
    const response = exactDataRecord(
      cloned.value,
      current ? OPENPENCIL_RPC_CURRENT_ENVELOPE_KEYS : OPENPENCIL_RPC_LEGACY_ENVELOPE_KEYS,
      'Invalid Supabase atomic RPC envelope'
    )
    if (
      (response.count !== null &&
        (typeof response.count !== 'number' ||
          !Number.isSafeInteger(response.count) ||
          response.count < 0)) ||
      typeof response.status !== 'number' ||
      !Number.isInteger(response.status) ||
      (response.status as number) < 0 ||
      (response.status as number) > 599 ||
      typeof response.statusText !== 'string' ||
      response.statusText.length > 1_000
    ) {
      return null
    }
    if (response.error === null) {
      if (
        (response.status as number) < 200 ||
        (response.status as number) > 299 ||
        (current && response.success !== true)
      ) {
        return null
      }
      return { kind: 'success', data: response.data }
    }
    if (response.error === undefined || response.data !== null) return null
    if (
      ((response.status as number) !== 0 && (response.status as number) < 300) ||
      (current && response.success !== false)
    ) {
      return null
    }
    const code = postgrestErrorCode(response.error)
    return code === null ? null : { kind: 'failure', code }
  } catch {
    return null
  }
}

export async function executeOpenPencilAtomicTransaction(args: {
  readonly supabase: OpenPencilSupabaseRpcClient
  readonly parameters: OpenPencilAtomicTransactionParameters
}): Promise<OpenPencilAtomicTransactionResult> {
  let parameterValues: Record<string, unknown>
  try {
    parameterValues = exactParameterRecord(
      args.parameters,
      openPencilAtomicTransaction.parameterKeys
    )
  } catch {
    throw new TypeError('Atomic transaction parameters must be an exact data-only object')
  }
${transaction.parameters.flatMap((entry) => validationLines(entry, transaction.expectedVersionParameter)).join('\n')}
  let responseValue: unknown
  try {
    responseValue = await args.supabase.rpc(openPencilAtomicTransaction.functionName, {
${rpcArguments}
    })
  } catch {
    throw new OpenPencilAtomicTransactionError('request-failed')
  }
  const response = supabaseRpcEnvelope(responseValue)
  if (!response) throwAtomicResultError()
  if (response.kind === 'failure') {
    throw new OpenPencilAtomicTransactionError(
      response.code === '40001' ? 'conflict' : 'request-failed'
    )
  }
  const result = exactRpcDataRecord(
    response.data,
    ['entityId', 'primaryKey', 'newVersion']
  )
  if (result.entityId !== ${JSON.stringify(transaction.entityId)}) {
    throwAtomicResultError()
  }
  const primaryKey = exactRpcDataRecord(
    result.primaryKey,
    ${JSON.stringify(transaction.primaryKey.map((entry) => entry.field))}
  )
${primaryKeyChecks.join('\n')}
  const expectedNewVersion = (parameterValues[${JSON.stringify(transaction.expectedVersionParameter)}] as number) + 1
  if (!Number.isSafeInteger(result.newVersion) || result.newVersion !== expectedNewVersion) {
    throwAtomicResultError()
  }
  return Object.freeze({
    entityId: ${JSON.stringify(transaction.entityId)},
    primaryKey: Object.freeze({ ...primaryKey }) as Readonly<Record<string, string>>,
    newVersion: result.newVersion
  })
}
`
}
