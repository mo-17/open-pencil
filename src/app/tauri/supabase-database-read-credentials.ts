import { invoke } from '@tauri-apps/api/core'

import {
  serializeSupabaseDatabaseReadConnectionProfileV1,
  type SupabaseDatabaseReadConnectionProfileV1
} from '@/app/lowcode/supabase/database-read-connection-profile'

export const SUPABASE_DATABASE_READ_CREDENTIAL_MUTATION_RECEIPT_FORMAT =
  'openpencil.supabase-database-read-credential-mutation-receipt.v1' as const

export type SupabaseDatabaseReadCredentialStatusV1 =
  | 'configured'
  | 'missing'
  | 'unavailable'
  | 'invalid'

export type SupabaseDatabaseReadCredentialCommitDurabilityV1 = 'confirmed' | 'unconfirmed'

export type SupabaseDatabaseReadCredentialNativeErrorCode =
  | 'invalid-authority'
  | 'invalid-request'
  | 'invalid-grant-generation'
  | 'invalid-password'
  | 'invalid-connection-profile'
  | 'entropy-unavailable'
  | 'credential-unavailable'
  | 'credential-changed'
  | 'credential-failed'
  | 'invalid-response'

export interface SupabaseDatabaseReadCredentialMutationReceiptV1 {
  readonly format: typeof SUPABASE_DATABASE_READ_CREDENTIAL_MUTATION_RECEIPT_FORMAT
  readonly version: 1
  readonly configured: boolean
  readonly commitDurability: SupabaseDatabaseReadCredentialCommitDurabilityV1
  readonly grantGeneration: string
  readonly credentialIncarnation: string
  readonly connectionProfileDigest: string | null
}

export interface ReplaceSupabaseDatabaseReadCredentialV1 {
  readonly expectedGrantGeneration: string
  readonly password: string
  readonly connectionProfile: SupabaseDatabaseReadConnectionProfileV1
}

export type SupabaseDatabaseReadCredentialNativeInvoke = <T>(
  command: string,
  args?: Record<string, unknown> | Uint8Array
) => Promise<T>

export interface SupabaseDatabaseReadCredentialNativeBridge {
  statusV1(expectedGrantGeneration: string): Promise<SupabaseDatabaseReadCredentialStatusV1>
  replaceV1(
    request: ReplaceSupabaseDatabaseReadCredentialV1
  ): Promise<SupabaseDatabaseReadCredentialMutationReceiptV1>
  clearV1(expectedGrantGeneration: string): Promise<SupabaseDatabaseReadCredentialMutationReceiptV1>
}

type NativeErrorValue = {
  readonly code?: unknown
}

interface SupabaseDatabaseReadCredentialResponseRecord {
  [key: string]: unknown
}

const STATUS_VALUES = new Set<SupabaseDatabaseReadCredentialStatusV1>([
  'configured',
  'missing',
  'unavailable',
  'invalid'
])
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MARKER = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u
const ZERO_MARKER = 'A'.repeat(43)
const MAX_PASSWORD_BYTES = 16 * 1024
const STATUS_REQUEST_MAGIC = 'OPDBRS01'
const REPLACE_REQUEST_MAGIC = 'OPDBRR01'
const CLEAR_REQUEST_MAGIC = 'OPDBRC01'
const REPLACE_REQUEST_HEADER_BYTES = 20
const RECEIPT_KEYS = Object.freeze([
  'format',
  'version',
  'configured',
  'commitDurability',
  'grantGeneration',
  'credentialIncarnation',
  'connectionProfileDigest'
] as const)
const ERROR_CODES = new Set<SupabaseDatabaseReadCredentialNativeErrorCode>([
  'invalid-authority',
  'invalid-request',
  'invalid-grant-generation',
  'invalid-password',
  'invalid-connection-profile',
  'entropy-unavailable',
  'credential-unavailable',
  'credential-changed',
  'credential-failed',
  'invalid-response'
])
const ERROR_MESSAGES: Readonly<Record<SupabaseDatabaseReadCredentialNativeErrorCode, string>> =
  Object.freeze({
    'invalid-authority':
      'The Supabase database-read credential is available only to the main window',
    'invalid-request': 'The Supabase database-read credential request is invalid',
    'invalid-grant-generation': 'The Supabase credential grant generation is invalid',
    'invalid-password': 'The Supabase database-read password is invalid',
    'invalid-connection-profile': 'The Supabase database-read connection profile is invalid',
    'entropy-unavailable': 'Secure Supabase credential rotation is unavailable',
    'credential-unavailable': 'The app-local credential store is unavailable',
    'credential-changed': 'The Supabase credential grant changed before the operation',
    'credential-failed': 'The Supabase database-read credential operation failed',
    'invalid-response': 'The native Supabase database-read credential response is invalid'
  })

export class SupabaseDatabaseReadCredentialNativeError extends Error {
  constructor(readonly code: SupabaseDatabaseReadCredentialNativeErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'SupabaseDatabaseReadCredentialNativeError'
  }
}

function fail(code: SupabaseDatabaseReadCredentialNativeErrorCode): never {
  throw new SupabaseDatabaseReadCredentialNativeError(code)
}

function exactDataRecord(
  value: unknown,
  expectedKeys: readonly string[]
): SupabaseDatabaseReadCredentialResponseRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return fail('invalid-response')
  let prototype: object | null
  let descriptors: PropertyDescriptorMap
  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return fail('invalid-response')
  }
  if (prototype !== Object.prototype && prototype !== null) return fail('invalid-response')
  const keys = Reflect.ownKeys(descriptors)
  const actual = keys.filter((key): key is string => typeof key === 'string').sort()
  const expected = [...expectedKeys].sort()
  if (
    actual.length !== keys.length ||
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
    actual.some(
      (key) => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key] ?? {}, 'value')
    )
  ) {
    return fail('invalid-response')
  }
  const snapshot: SupabaseDatabaseReadCredentialResponseRecord = Object.create(null)
  for (const key of actual) snapshot[key] = descriptors[key]?.value
  return snapshot
}

function grantGeneration(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail('invalid-grant-generation')
  return value
}

function responseGrantGeneration(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail('invalid-response')
  return value
}

function marker(value: unknown): string {
  if (typeof value !== 'string' || !MARKER.test(value) || value === ZERO_MARKER) {
    return fail('invalid-response')
  }
  return value
}

function receipt(
  value: unknown,
  expectedGrantGeneration: string
): SupabaseDatabaseReadCredentialMutationReceiptV1 {
  const source = exactDataRecord(value, RECEIPT_KEYS)
  if (
    source.format !== SUPABASE_DATABASE_READ_CREDENTIAL_MUTATION_RECEIPT_FORMAT ||
    source.version !== 1 ||
    typeof source.configured !== 'boolean' ||
    (source.commitDurability !== 'confirmed' && source.commitDurability !== 'unconfirmed')
  ) {
    return fail('invalid-response')
  }
  const nextGrantGeneration = responseGrantGeneration(source.grantGeneration)
  if (nextGrantGeneration === expectedGrantGeneration) return fail('invalid-response')
  const credentialIncarnation = marker(source.credentialIncarnation)
  const connectionProfileDigest = source.connectionProfileDigest
  if (
    (source.configured && connectionProfileDigest === null) ||
    (!source.configured && connectionProfileDigest !== null)
  ) {
    return fail('invalid-response')
  }
  const normalizedProfileDigest =
    connectionProfileDigest === null ? null : marker(connectionProfileDigest)
  return Object.freeze({
    format: SUPABASE_DATABASE_READ_CREDENTIAL_MUTATION_RECEIPT_FORMAT,
    version: 1,
    configured: source.configured,
    commitDurability: source.commitDurability,
    grantGeneration: nextGrantGeneration,
    credentialIncarnation,
    connectionProfileDigest: normalizedProfileDigest
  })
}

function validPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PASSWORD_BYTES &&
    !value.includes('\0') &&
    new TextEncoder().encode(value).byteLength <= MAX_PASSWORD_BYTES
  )
}

function writeAscii(target: Uint8Array, offset: number, value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index)
  }
  return offset + value.length
}

function generationRequestBody(magic: string, generation: string): Uint8Array {
  const body = new Uint8Array(magic.length + generation.length)
  const generationOffset = writeAscii(body, 0, magic)
  writeAscii(body, generationOffset, generation)
  return body
}

function replaceRequestBody(
  generation: string,
  password: string,
  connectionProfileJSON: string
): Uint8Array {
  const encoder = new TextEncoder()
  const generationBytes = encoder.encode(generation)
  const passwordBytes = encoder.encode(password)
  const profileBytes = encoder.encode(connectionProfileJSON)
  const body = new Uint8Array(
    REPLACE_REQUEST_HEADER_BYTES +
      generationBytes.byteLength +
      passwordBytes.byteLength +
      profileBytes.byteLength
  )
  writeAscii(body, 0, REPLACE_REQUEST_MAGIC)
  const lengths = new DataView(body.buffer, body.byteOffset, REPLACE_REQUEST_HEADER_BYTES)
  lengths.setUint32(8, generationBytes.byteLength, true)
  lengths.setUint32(12, passwordBytes.byteLength, true)
  lengths.setUint32(16, profileBytes.byteLength, true)
  let offset = REPLACE_REQUEST_HEADER_BYTES
  body.set(generationBytes, offset)
  offset += generationBytes.byteLength
  body.set(passwordBytes, offset)
  offset += passwordBytes.byteLength
  body.set(profileBytes, offset)
  passwordBytes.fill(0)
  return body
}

export function nativeSupabaseDatabaseReadCredentialError(
  error: unknown
): SupabaseDatabaseReadCredentialNativeError {
  if (error instanceof SupabaseDatabaseReadCredentialNativeError) return error
  const value =
    typeof error === 'object' && error !== null ? (error as NativeErrorValue) : undefined
  const code =
    typeof value?.code === 'string' &&
    ERROR_CODES.has(value.code as SupabaseDatabaseReadCredentialNativeErrorCode)
      ? (value.code as SupabaseDatabaseReadCredentialNativeErrorCode)
      : 'credential-failed'
  return new SupabaseDatabaseReadCredentialNativeError(code)
}

const DEFAULT_INVOKE = invoke as SupabaseDatabaseReadCredentialNativeInvoke

export function createSupabaseDatabaseReadCredentialNativeBridge(
  invokeCommand: SupabaseDatabaseReadCredentialNativeInvoke = DEFAULT_INVOKE
): SupabaseDatabaseReadCredentialNativeBridge {
  return Object.freeze({
    async statusV1(
      expectedGrantGeneration: string
    ): Promise<SupabaseDatabaseReadCredentialStatusV1> {
      grantGeneration(expectedGrantGeneration)
      const result = await invokeCommand<unknown>(
        'supabase_database_read_credential_status_v1',
        generationRequestBody(STATUS_REQUEST_MAGIC, expectedGrantGeneration)
      ).catch((error: unknown) => {
        throw nativeSupabaseDatabaseReadCredentialError(error)
      })
      if (
        typeof result !== 'string' ||
        !STATUS_VALUES.has(result as SupabaseDatabaseReadCredentialStatusV1)
      ) {
        return fail('invalid-response')
      }
      return result as SupabaseDatabaseReadCredentialStatusV1
    },

    async replaceV1(
      request: ReplaceSupabaseDatabaseReadCredentialV1
    ): Promise<SupabaseDatabaseReadCredentialMutationReceiptV1> {
      const expectedGrantGeneration = grantGeneration(request.expectedGrantGeneration)
      if (!validPassword(request.password)) return fail('invalid-password')
      let connectionProfileJSON: string
      try {
        connectionProfileJSON = serializeSupabaseDatabaseReadConnectionProfileV1(
          request.connectionProfile
        )
      } catch {
        return fail('invalid-connection-profile')
      }
      const body = replaceRequestBody(
        expectedGrantGeneration,
        request.password,
        connectionProfileJSON
      )
      try {
        const result = await invokeCommand<unknown>(
          'supabase_database_read_credential_replace_v1',
          body
        ).catch((error: unknown) => {
          throw nativeSupabaseDatabaseReadCredentialError(error)
        })
        return receipt(result, expectedGrantGeneration)
      } finally {
        body.fill(0)
      }
    },

    async clearV1(
      expectedGrantGeneration: string
    ): Promise<SupabaseDatabaseReadCredentialMutationReceiptV1> {
      grantGeneration(expectedGrantGeneration)
      const result = await invokeCommand<unknown>(
        'supabase_database_read_credential_clear_v1',
        generationRequestBody(CLEAR_REQUEST_MAGIC, expectedGrantGeneration)
      ).catch((error: unknown) => {
        throw nativeSupabaseDatabaseReadCredentialError(error)
      })
      return receipt(result, expectedGrantGeneration)
    }
  })
}

export const supabaseDatabaseReadCredentialNativeBridge =
  createSupabaseDatabaseReadCredentialNativeBridge()
