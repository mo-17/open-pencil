import { describe, expect, test } from 'bun:test'

import { OneDriveNativeError, nativeOneDriveError } from '@/app/tauri/onedrive-oauth-error'

describe('OneDrive native error boundary', () => {
  test('uses static renderer messages instead of provider-controlled text', () => {
    const error = nativeOneDriveError({
      code: 'authorization-grant-invalid',
      message: 'AADSTS detail containing account or tenant data'
    })

    expect(error).toBeInstanceOf(OneDriveNativeError)
    expect(error.code).toBe('authorization-grant-invalid')
    expect(error.message).toBe('Microsoft authorization grant is invalid or expired')
    expect(error.message).not.toContain('AADSTS')
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

    const error = nativeOneDriveError(native)
    expect(getterCalled).toBe(false)
    expect(error.code).toBe('oauth-failed')
    expect(error.message).toBe('Microsoft authorization failed')
  })

  test('accepts only bounded retry hints on rate limits', () => {
    expect(nativeOneDriveError({ code: 'rate-limited', retryAfterMs: 12_000 }).retryAfterMs).toBe(
      12_000
    )
    expect(
      nativeOneDriveError({ code: 'rate-limited', retryAfterMs: 300_001 }).retryAfterMs
    ).toBeUndefined()
    expect(
      nativeOneDriveError({ code: 'network-failed', retryAfterMs: 12_000 }).retryAfterMs
    ).toBeUndefined()
  })

  test('preserves an already-normalized error', () => {
    const original = new OneDriveNativeError('cancelled')
    expect(nativeOneDriveError(original)).toBe(original)
  })
})
