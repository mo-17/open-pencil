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

export type BaiduNetdiskErrorOptions = StorageProviderErrorOptions &
  Readonly<{
    errno?: number
  }>

export class BaiduNetdiskError extends StorageProviderError<BaiduNetdiskErrorCode> {
  readonly errno: number | null

  constructor(
    code: BaiduNetdiskErrorCode,
    message: string,
    options: BaiduNetdiskErrorOptions = {}
  ) {
    super(code, message, options)
    this.name = 'BaiduNetdiskError'
    this.errno = options.errno ?? null
  }
}

export function throwIfBaiduNetdiskAborted(signal?: AbortSignal): void {
  throwIfStorageProviderAborted(
    signal,
    (cause) => new BaiduNetdiskError('aborted', 'Baidu Netdisk operation was cancelled', { cause })
  )
}

export function isBaiduNetdiskAbortError(error: unknown): boolean {
  return isStorageProviderAbortError(error, error instanceof BaiduNetdiskError)
}

export function baiduNetdiskErrorCodeForStatus(status: number): BaiduNetdiskErrorCode {
  return storageErrorCodeForStatus(status, true)
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
  return isRetryableStorageStatus(status, 'all-server-errors')
}
import {
  isRetryableStorageStatus,
  isStorageProviderAbortError,
  StorageProviderError,
  type StorageProviderErrorOptions,
  storageErrorCodeForStatus,
  throwIfStorageProviderAborted
} from '../shared/errors'
