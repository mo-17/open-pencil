import { describe, expect, test } from 'bun:test'

import { GoogleDriveNativeError, nativeGoogleDriveError } from '@/app/tauri/drive-oauth-error'

describe('Google Drive native errors', () => {
  test('preserves a bounded Broker retry delay from Tauri IPC', () => {
    expect(
      nativeGoogleDriveError({
        code: 'oauth-broker-rate-limited',
        message: 'OpenPencil OAuth Broker rate limit was reached',
        retryAfterMs: 60_000
      })
    ).toMatchObject({
      code: 'oauth-broker-rate-limited',
      retryAfterMs: 60_000
    })
  })

  test('drops untrusted retry values and preserves typed errors', () => {
    expect(
      nativeGoogleDriveError({
        code: 'oauth-broker-rate-limited',
        message: 'rate limited',
        retryAfterMs: 300_001
      }).retryAfterMs
    ).toBeUndefined()

    const existing = new GoogleDriveNativeError('network-failed', 'network failed')
    expect(nativeGoogleDriveError(existing)).toBe(existing)
  })
})
