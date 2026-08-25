export type BaiduNetdiskErrorCode =
  | 'aborted'
  | 'auth'
  | 'authorization-changed'
  | 'conflict'
  | 'foreign-file'
  | 'invalid-input'
  | 'invalid-response'
  | 'network'
  | 'not-found'
  | 'permission'
  | 'precondition'
  | 'quota'
  | 'rate-limited'
  | 'resource-limit'
  | 'server'

export type BaiduNetdiskErrorOptions = Readonly<{
  status?: number
  errno?: number
  retryable?: boolean
  cause?: unknown
}>

export class BaiduNetdiskError extends Error {
  readonly status: number | null
  readonly errno: number | null
  readonly retryable: boolean

  constructor(
    readonly code: BaiduNetdiskErrorCode,
    message: string,
    options: BaiduNetdiskErrorOptions = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'BaiduNetdiskError'
    this.status = options.status ?? null
    this.errno = options.errno ?? null
    this.retryable = options.retryable ?? false
  }
}

export function throwIfBaiduNetdiskAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new BaiduNetdiskError('aborted', 'Baidu Netdisk operation was cancelled', {
    cause: signal.reason
  })
}

export function isBaiduNetdiskAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof BaiduNetdiskError && error.code === 'aborted')
  )
}

export function baiduNetdiskErrorCodeForStatus(status: number): BaiduNetdiskErrorCode {
  if (status === 401) return 'auth'
  if (status === 403) return 'permission'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 412) return 'precondition'
  if (status === 429) return 'rate-limited'
  if (status === 507) return 'quota'
  if (status >= 500) return 'server'
  return 'invalid-response'
}

export function baiduNetdiskErrorCodeForErrno(errno: number): BaiduNetdiskErrorCode {
  if (errno === -6 || errno === 31045) return 'auth'
  if (errno === -9 || errno === 31190) return 'not-found'
  if (errno === -8) return 'conflict'
  if (errno === -10) return 'quota'
  if (errno === 20012) return 'rate-limited'
  if (errno === -7 || errno === 20011 || errno === 20013 || errno === 31024) {
    return 'permission'
  }
  if (errno === 10 || errno === 111 || errno === 31363) return 'server'
  return 'invalid-response'
}

export function isRetryableBaiduNetdiskStatus(status: number): boolean {
  return status === 408 || status === 423 || status === 429 || status >= 500
}
