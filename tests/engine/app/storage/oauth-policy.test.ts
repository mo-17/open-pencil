import { describe, expect, test } from 'bun:test'

import { AliyunDriveError } from '@/app/integrations/storage/aliyun-drive/errors'
import { AliyunDriveOAuthError } from '@/app/integrations/storage/aliyun-drive/oauth/errors'
import { BaiduNetdiskError } from '@/app/integrations/storage/baidu-netdisk/errors'
import { BaiduNetdiskOAuthError } from '@/app/integrations/storage/baidu-netdisk/oauth/session'
import { GoogleDriveOAuthError } from '@/app/integrations/storage/google-drive/oauth/session'
import { OneDriveError } from '@/app/integrations/storage/onedrive/errors'
import { OneDriveOAuthError } from '@/app/integrations/storage/onedrive/oauth/session'
import { storageSyncErrorPolicy } from '@/app/storage/sync/error-policy'

describe('storage OAuth retry policy', () => {
  test('keeps Broker outages retryable beyond the generic attempt limit', () => {
    expect(
      storageSyncErrorPolicy(
        new GoogleDriveOAuthError('oauth-broker-unavailable', 'Broker unavailable')
      )
    ).toEqual({ permanent: false, retryBeyondAttemptLimit: true })

    expect(
      storageSyncErrorPolicy(
        new GoogleDriveOAuthError('oauth-broker-rate-limited', 'Broker rate limited', {
          retryAfterMs: 60_000
        })
      )
    ).toEqual({
      permanent: false,
      retryAfterMs: 60_000,
      retryBeyondAttemptLimit: true,
      retryScope: 'provider'
    })
  })

  test('parks revoked grants and publisher faults without deleting durable work', () => {
    for (const code of [
      'authorization-grant-invalid',
      'oauth-broker-misconfigured',
      'oauth-broker-protocol-invalid'
    ] as const) {
      expect(
        storageSyncErrorPolicy(new GoogleDriveOAuthError(code, 'Reconnect or repair build'))
      ).toMatchObject({ permanent: true, retryBeyondAttemptLimit: false })
    }
  })

  test('keeps transient OneDrive failures retryable and parks grants that require reconnect', () => {
    expect(storageSyncErrorPolicy(new OneDriveOAuthError('network-failed', 'offline'))).toEqual({
      permanent: false,
      retryBeyondAttemptLimit: true
    })
    expect(
      storageSyncErrorPolicy(
        new OneDriveOAuthError('rate-limited', 'limited', { retryAfterMs: 12_000 })
      )
    ).toEqual({
      permanent: false,
      retryAfterMs: 12_000,
      retryBeyondAttemptLimit: true,
      retryScope: 'provider'
    })
    expect(
      storageSyncErrorPolicy(new OneDriveError('rate-limited', 'limited', { retryAfterMs: 20_000 }))
    ).toEqual({
      permanent: false,
      retryAfterMs: 20_000,
      retryBeyondAttemptLimit: true,
      retryScope: 'provider'
    })
    expect(
      storageSyncErrorPolicy(
        new OneDriveOAuthError('authorization-grant-invalid', 'reconnect OneDrive')
      )
    ).toEqual({ permanent: true, retryBeyondAttemptLimit: false })
  })

  test('classifies Aliyun Drive and Baidu Netdisk data-plane errors by explicit provider code', () => {
    expect(
      storageSyncErrorPolicy(
        new AliyunDriveError('rate-limited', 'limited', { retryAfterMs: 15_000 })
      )
    ).toEqual({
      permanent: false,
      retryAfterMs: 15_000,
      retryBeyondAttemptLimit: true,
      retryScope: 'provider'
    })
    expect(storageSyncErrorPolicy(new AliyunDriveError('preservation-failed', 'unsafe'))).toEqual({
      permanent: true,
      retryBeyondAttemptLimit: false
    })
    expect(storageSyncErrorPolicy(new BaiduNetdiskError('network', 'offline'))).toEqual({
      permanent: false,
      retryBeyondAttemptLimit: true
    })
    expect(storageSyncErrorPolicy(new BaiduNetdiskError('auth', 'reconnect'))).toEqual({
      permanent: true,
      retryBeyondAttemptLimit: false
    })
  })

  test('keeps China-provider Broker outages retryable and parks unusable grants', () => {
    expect(
      storageSyncErrorPolicy(
        new AliyunDriveOAuthError('oauth-broker-unavailable', 'broker offline')
      )
    ).toEqual({ permanent: false, retryBeyondAttemptLimit: true })
    expect(
      storageSyncErrorPolicy(
        new AliyunDriveOAuthError('rate-limited', 'limited', { retryAfterMs: 9_000 })
      )
    ).toEqual({
      permanent: false,
      retryAfterMs: 9_000,
      retryBeyondAttemptLimit: true,
      retryScope: 'provider'
    })
    expect(
      storageSyncErrorPolicy(
        new AliyunDriveOAuthError('authorization-grant-invalid', 'reconnect')
      )
    ).toEqual({ permanent: true, retryBeyondAttemptLimit: false })

    expect(
      storageSyncErrorPolicy(
        new BaiduNetdiskOAuthError('oauth-broker-unavailable', 'broker offline')
      )
    ).toEqual({ permanent: false, retryBeyondAttemptLimit: true })
    expect(
      storageSyncErrorPolicy(
        new BaiduNetdiskOAuthError('rate-limited', 'limited', { retryAfterMs: 11_000 })
      )
    ).toEqual({
      permanent: false,
      retryAfterMs: 11_000,
      retryBeyondAttemptLimit: true,
      retryScope: 'provider'
    })
    expect(
      storageSyncErrorPolicy(new BaiduNetdiskOAuthError('scope-mismatch', 'reconnect'))
    ).toEqual({ permanent: true, retryBeyondAttemptLimit: false })
  })
})
