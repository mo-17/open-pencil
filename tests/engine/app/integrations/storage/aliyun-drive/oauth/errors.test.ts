import { describe, expect, test } from 'bun:test'

import { aliyunDriveOAuthNativeFailure } from '@/app/integrations/storage/aliyun-drive/oauth/errors'
import {
  AliyunDriveNativeError,
  type AliyunDriveNativeErrorCode
} from '@/app/tauri/aliyun-drive-oauth-error'

describe('Aliyun Drive OAuth native failure policy', () => {
  test('maps actionable native failures without collapsing retry policy', () => {
    const cases: ReadonlyArray<readonly [AliyunDriveNativeErrorCode, string]> = [
      ['unsupported', 'setup-required'],
      ['oauth-denied', 'authorization-denied'],
      ['timeout', 'authorization-timeout'],
      ['oauth-client-invalid', 'oauth-client-invalid'],
      ['authorization-grant-invalid', 'authorization-grant-invalid'],
      ['redirect-uri-mismatch', 'redirect-uri-mismatch'],
      ['token-request-invalid', 'token-request-invalid'],
      ['token-exchange-failed', 'token-exchange-failed'],
      ['token-response-invalid', 'token-response-invalid'],
      ['userinfo-failed', 'userinfo-failed'],
      ['scope-mismatch', 'scope-mismatch'],
      ['subject-mismatch', 'subject-mismatch'],
      ['network-failed', 'network-failed'],
      ['broker-unavailable', 'oauth-broker-unavailable']
    ]
    for (const [nativeCode, oauthCode] of cases) {
      expect(aliyunDriveOAuthNativeFailure(new AliyunDriveNativeError(nativeCode))).toMatchObject({
        code: oauthCode
      })
    }
  })

  test('preserves only bounded rate-limit hints and maps cancellation', () => {
    expect(
      aliyunDriveOAuthNativeFailure(
        new AliyunDriveNativeError('rate-limited', { retryAfterMs: 12_345 })
      )
    ).toMatchObject({ code: 'rate-limited', retryAfterMs: 12_345 })
    expect(
      aliyunDriveOAuthNativeFailure(
        new AliyunDriveNativeError('network-failed', { retryAfterMs: 12_345 })
      ).retryAfterMs
    ).toBeUndefined()
    expect(aliyunDriveOAuthNativeFailure(new AliyunDriveNativeError('cancelled'))).toMatchObject({
      code: 'cancelled'
    })
  })

  test('uses a static fallback and never evaluates provider-controlled accessors', () => {
    const unsafe = Object.defineProperty({}, 'message', {
      get() {
        throw new Error('must not execute')
      }
    })
    expect(aliyunDriveOAuthNativeFailure(unsafe)).toMatchObject({
      code: 'native-failed',
      message: 'Aliyun Drive native authorization failed'
    })
  })
})
