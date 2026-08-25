import { describe, expect, test } from 'bun:test'

import {
  BaiduNetdiskNativeError,
  nativeBaiduNetdiskError
} from '@/app/tauri/baidu-netdisk-oauth-error'

describe('Baidu Netdisk native error boundary', () => {
  test('uses static renderer messages instead of provider or token text', () => {
    const error = nativeBaiduNetdiskError({
      code: 'authorization-grant-invalid',
      message: 'refresh_token=secret account=person@example.com'
    })

    expect(error).toBeInstanceOf(BaiduNetdiskNativeError)
    expect(error.code).toBe('authorization-grant-invalid')
    expect(error.message).toBe('Baidu authorization grant is invalid or expired')
    expect(error.message).not.toContain('secret')
    expect(error.message).not.toContain('example.com')
  })

  test('fails closed for unknown codes and accessor properties', () => {
    let getterCalled = false
    const native = Object.create(null)
    Object.defineProperty(native, 'code', {
      get() {
        getterCalled = true
        return 'account-mismatch'
      }
    })

    const error = nativeBaiduNetdiskError(native)
    expect(getterCalled).toBe(false)
    expect(error.code).toBe('oauth-failed')
    expect(error.message).toBe('Baidu authorization failed')
  })

  test('accepts only bounded retry hints on rate limits', () => {
    expect(
      nativeBaiduNetdiskError({ code: 'rate-limited', retryAfterMs: 12_000 }).retryAfterMs
    ).toBe(12_000)
    expect(
      nativeBaiduNetdiskError({ code: 'rate-limited', retryAfterMs: 300_001 }).retryAfterMs
    ).toBeUndefined()
    expect(
      nativeBaiduNetdiskError({ code: 'network-failed', retryAfterMs: 12_000 }).retryAfterMs
    ).toBeUndefined()
  })
})
