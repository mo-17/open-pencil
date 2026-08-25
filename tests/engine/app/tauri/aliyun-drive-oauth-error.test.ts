import { describe, expect, test } from 'bun:test'

import {
  AliyunDriveNativeError,
  nativeAliyunDriveError
} from '@/app/tauri/aliyun-drive-oauth-error'

describe('Aliyun Drive native error boundary', () => {
  test('uses static renderer messages instead of provider-controlled text', () => {
    const error = nativeAliyunDriveError({
      code: 'authorization-grant-invalid',
      message: 'provider detail containing account or authorization data'
    })

    expect(error).toBeInstanceOf(AliyunDriveNativeError)
    expect(error.code).toBe('authorization-grant-invalid')
    expect(error.message).toBe('Aliyun Drive authorization grant is invalid or expired')
    expect(error.message).not.toContain('provider detail')
  })

  test('fails closed for unknown codes and accessor properties', () => {
    let getterCalled = false
    const native = Object.create(null)
    Object.defineProperty(native, 'code', {
      get() {
        getterCalled = true
        return 'subject-mismatch'
      }
    })

    const error = nativeAliyunDriveError(native)
    expect(getterCalled).toBe(false)
    expect(error.code).toBe('oauth-failed')
    expect(error.message).toBe('Aliyun Drive authorization failed')
  })

  test('accepts only bounded retry hints on rate limits', () => {
    expect(
      nativeAliyunDriveError({ code: 'rate-limited', retryAfterMs: 12_000 }).retryAfterMs
    ).toBe(12_000)
    expect(
      nativeAliyunDriveError({ code: 'rate-limited', retryAfterMs: 300_001 }).retryAfterMs
    ).toBeUndefined()
    expect(
      nativeAliyunDriveError({ code: 'network-failed', retryAfterMs: 12_000 }).retryAfterMs
    ).toBeUndefined()
  })

  test('preserves an already-normalized error', () => {
    const original = new AliyunDriveNativeError('cancelled')
    expect(nativeAliyunDriveError(original)).toBe(original)
  })
})
