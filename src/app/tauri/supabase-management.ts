import { invoke } from '@tauri-apps/api/core'

import { withAbortSignal } from './http'

export type SupabaseManagementNativeErrorCode =
  | 'invalid-request'
  | 'invalid-authority'
  | 'credential-missing'
  | 'write-credential-missing'
  | 'credential-not-independent'
  | 'credential-changed'
  | 'credential-unavailable'
  | 'network-failed'
  | 'http-error'
  | 'response-too-large'
  | 'invalid-response'

export interface SupabaseManagementPgCatalogInspectRequestV1 {
  readonly projectRef: string
  /** `null` is restricted to initial review-time organization discovery. */
  readonly expectedOrganizationId: string | null
  readonly expectedGrantGeneration: string
}

export interface SupabaseManagementPgCatalogInspectResultV1 {
  readonly projectRef: string
  readonly organizationId: string
  readonly grantGeneration: string
  readonly queryVersion: string
  /** SHA-256 base64url of the native fixed JSON request body. */
  readonly queryDigest: string
  readonly queryResponse: unknown
}

export type SupabaseManagementNativeInvoke = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>

export interface SupabaseManagementNativeBridge {
  inspectPgCatalogV1(
    request: SupabaseManagementPgCatalogInspectRequestV1,
    signal?: AbortSignal
  ): Promise<SupabaseManagementPgCatalogInspectResultV1>
}

type NativeErrorValue = {
  readonly code?: unknown
  readonly httpStatus?: unknown
  readonly retryAfterSeconds?: unknown
}

const ERROR_CODES = new Set<SupabaseManagementNativeErrorCode>([
  'invalid-request',
  'invalid-authority',
  'credential-missing',
  'write-credential-missing',
  'credential-not-independent',
  'credential-changed',
  'credential-unavailable',
  'network-failed',
  'http-error',
  'response-too-large',
  'invalid-response'
])

const ERROR_MESSAGES: Readonly<Record<SupabaseManagementNativeErrorCode, string>> = Object.freeze({
  'invalid-request': 'The Supabase Management inspection request is invalid',
  'invalid-authority': 'The Supabase project authority does not match the reviewed binding',
  'credential-missing': 'The Supabase Management credential is not configured',
  'write-credential-missing':
    'The independent Supabase Management database-write credential is not configured',
  'credential-not-independent':
    'The Supabase Management read and database-write credentials must be independent',
  'credential-changed': 'The Supabase Management credential changed before inspection',
  'credential-unavailable': 'The app-local credential store is unavailable',
  'network-failed': 'The Supabase Management request failed',
  'http-error': 'Supabase Management returned an unexpected HTTP response',
  'response-too-large': 'The Supabase Management response exceeded the byte limit',
  'invalid-response': 'Supabase Management returned an invalid response'
})

export class SupabaseManagementNativeError extends Error {
  constructor(
    readonly code: SupabaseManagementNativeErrorCode,
    readonly httpStatus?: number,
    readonly retryAfterSeconds?: number
  ) {
    super(ERROR_MESSAGES[code])
    this.name = 'SupabaseManagementNativeError'
  }
}

function boundedInteger(value: unknown, maximum: number): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum
    ? (value as number)
    : undefined
}

export function nativeSupabaseManagementError(error: unknown): SupabaseManagementNativeError {
  if (error instanceof SupabaseManagementNativeError) return error
  const value =
    typeof error === 'object' && error !== null ? (error as NativeErrorValue) : undefined
  const code =
    typeof value?.code === 'string' &&
    ERROR_CODES.has(value.code as SupabaseManagementNativeErrorCode)
      ? (value.code as SupabaseManagementNativeErrorCode)
      : 'network-failed'
  return new SupabaseManagementNativeError(
    code,
    boundedInteger(value?.httpStatus, 599),
    boundedInteger(value?.retryAfterSeconds, 3_600)
  )
}

const DEFAULT_INVOKE = invoke as SupabaseManagementNativeInvoke

export function createSupabaseManagementNativeBridge(
  invokeCommand: SupabaseManagementNativeInvoke = DEFAULT_INVOKE
): SupabaseManagementNativeBridge {
  return Object.freeze({
    async inspectPgCatalogV1(
      request: SupabaseManagementPgCatalogInspectRequestV1,
      signal?: AbortSignal
    ): Promise<SupabaseManagementPgCatalogInspectResultV1> {
      signal?.throwIfAborted()
      const pending = invokeCommand<SupabaseManagementPgCatalogInspectResultV1>(
        'supabase_management_inspect_pg_catalog_v1',
        {
          request: {
            projectRef: request.projectRef,
            expectedOrganizationId: request.expectedOrganizationId,
            expectedGrantGeneration: request.expectedGrantGeneration
          }
        }
      ).catch((error: unknown) => {
        throw nativeSupabaseManagementError(error)
      })
      return signal ? withAbortSignal(pending, signal, nativeSupabaseManagementError) : pending
    }
  })
}

export const supabaseManagementNativeBridge = createSupabaseManagementNativeBridge()
