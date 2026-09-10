export const BACKEND_COMPILER_SIDECAR_PROTOCOL_VERSION = 1 as const

export const BACKEND_COMPILER_SIDECAR_LIMITS = Object.freeze({
  maxStdinBytes: 1_048_576,
  maxOutputBytes: 262_144
})

export const BACKEND_COMPILER_SIDECAR_ERROR_CODES = Object.freeze([
  'arguments-forbidden',
  'incomplete-frame',
  'invalid-frame',
  'invalid-request',
  'invalid-utf8',
  'inspection-failed',
  'plan-rejected',
  'request-limit',
  'response-limit'
] as const)

export type BackendCompilerSidecarErrorCode = (typeof BACKEND_COMPILER_SIDECAR_ERROR_CODES)[number]

export interface BackendCompilerSidecarSuccessV1<TResult> {
  readonly version: typeof BACKEND_COMPILER_SIDECAR_PROTOCOL_VERSION
  readonly requestNonce: string
  readonly ok: true
  readonly result: TResult
}

export interface BackendCompilerSidecarFailureV1 {
  readonly version: typeof BACKEND_COMPILER_SIDECAR_PROTOCOL_VERSION
  readonly requestNonce: string | null
  readonly ok: false
  readonly error: Readonly<{ code: BackendCompilerSidecarErrorCode }>
}

export type BackendCompilerSidecarResponseV1<TResult> =
  | BackendCompilerSidecarSuccessV1<TResult>
  | BackendCompilerSidecarFailureV1

const encoder = new TextEncoder()

export class BackendCompilerSidecarError extends Error {
  readonly code: BackendCompilerSidecarErrorCode

  constructor(code: BackendCompilerSidecarErrorCode) {
    super(code)
    this.name = 'BackendCompilerSidecarError'
    this.code = code
  }
}

function compareASCII(left: string, right: string): number {
  return left < right ? -1 : Number(left > right)
}

function canonicalJSONValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new BackendCompilerSidecarError('response-limit')
    }
    return value
  }
  if (typeof value !== 'object') {
    throw new BackendCompilerSidecarError('response-limit')
  }
  if (ancestors.has(value)) throw new BackendCompilerSidecarError('response-limit')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => canonicalJSONValue(entry, ancestors))
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new BackendCompilerSidecarError('response-limit')
    }
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== 'string')) {
      throw new BackendCompilerSidecarError('response-limit')
    }
    return Object.fromEntries(
      (keys as string[]).sort(compareASCII).map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          throw new BackendCompilerSidecarError('response-limit')
        }
        return [key, canonicalJSONValue(descriptor.value, ancestors)]
      })
    )
  } finally {
    ancestors.delete(value)
  }
}

export function canonicalBackendCompilerSidecarJSON(value: unknown): string {
  return JSON.stringify(canonicalJSONValue(value, new Set()))
}

export function byteLength(value: string): number {
  return encoder.encode(value).byteLength
}

export function backendCompilerSidecarSuccess<TResult>(
  requestNonce: string,
  result: TResult
): BackendCompilerSidecarSuccessV1<TResult> {
  return Object.freeze({
    version: BACKEND_COMPILER_SIDECAR_PROTOCOL_VERSION,
    requestNonce,
    ok: true,
    result
  })
}

export function backendCompilerSidecarFailure(
  requestNonce: string | null,
  code: BackendCompilerSidecarErrorCode
): BackendCompilerSidecarFailureV1 {
  return Object.freeze({
    version: BACKEND_COMPILER_SIDECAR_PROTOCOL_VERSION,
    requestNonce,
    ok: false,
    error: Object.freeze({ code })
  })
}
