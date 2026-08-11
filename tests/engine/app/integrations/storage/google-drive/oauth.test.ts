import { describe, expect, test } from 'bun:test'

import {
  parseGoogleDriveRefreshTokenEnvelope,
  parseGoogleDriveOAuthPublicMetadata,
  parseGoogleDriveRefreshTokenEnvelopeJSON,
  serializeGoogleDriveRefreshTokenEnvelope
} from '@/app/integrations/storage/google-drive/oauth/envelope'
import { MemoryGoogleDriveOAuthMetadataStore } from '@/app/integrations/storage/google-drive/oauth/metadata'
import {
  createGoogleDriveOAuthSession,
  GOOGLE_DRIVE_OAUTH_SCOPES,
  googleDriveRefreshTokenCredentialRef,
  type GoogleDriveOAuthError,
  type GoogleDriveOAuthErrorCode
} from '@/app/integrations/storage/google-drive/oauth/session'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import { createCredentialServices } from '@/app/settings/credentials/services'
import {
  GoogleDriveNativeError,
  type GoogleDriveNativeAuthorizeResult,
  type GoogleDriveNativeBridge,
  type GoogleDriveNativeErrorCode,
  type GoogleDriveNativeRefreshResult
} from '@/app/tauri/google-drive'

const CLIENT_ID = '1234567890-test.apps.googleusercontent.com'
const VERSION_A = 'a'.repeat(32)
const VERSION_B = 'b'.repeat(32)
const VERSION_C = 'c'.repeat(32)

const NATIVE_OAUTH_ERROR_CASES = [
  ['scope-mismatch', 'scope-mismatch'],
  ['subject-mismatch', 'subject-mismatch'],
  ['network-failed', 'network-failed'],
  ['timeout', 'authorization-timeout'],
  ['browser-open-failed', 'browser-open-failed'],
  ['oauth-denied', 'authorization-denied'],
  ['oauth-client-invalid', 'oauth-client-invalid'],
  ['authorization-grant-invalid', 'authorization-grant-invalid'],
  ['redirect-uri-mismatch', 'redirect-uri-mismatch'],
  ['token-request-invalid', 'token-request-invalid'],
  ['token-exchange-failed', 'token-exchange-failed'],
  ['token-response-invalid', 'token-response-invalid'],
  ['userinfo-failed', 'userinfo-failed']
] as const satisfies readonly (readonly [GoogleDriveNativeErrorCode, GoogleDriveOAuthErrorCode])[]

function authorizationResult(
  subject = 'google-subject-a',
  refreshToken = 'refresh-token-a'
): GoogleDriveNativeAuthorizeResult {
  return {
    accessToken: `access-${subject}`,
    refreshToken,
    expiresIn: 3_600,
    grantedScopes: [...GOOGLE_DRIVE_OAUTH_SCOPES],
    subject,
    email: `${subject}@example.com`
  }
}

function nativeBridge(initial = authorizationResult()) {
  let nextAuthorization = initial
  let refreshResult: GoogleDriveNativeRefreshResult = {
    accessToken: 'refreshed-access-token',
    expiresIn: 3_600,
    subject: initial.subject,
    email: initial.email
  }
  let refreshCalls = 0
  const revoked: string[] = []
  let revokeError: Error | null = null
  const bridge: GoogleDriveNativeBridge = {
    authorize: () => Promise.resolve(nextAuthorization),
    refresh: () => {
      refreshCalls++
      return Promise.resolve(refreshResult)
    },
    revoke: async ({ token }) => {
      if (revokeError !== null) throw revokeError
      revoked.push(token)
    }
  }
  return {
    bridge,
    revoked,
    refreshCalls: () => refreshCalls,
    setAuthorization(result: GoogleDriveNativeAuthorizeResult) {
      nextAuthorization = result
    },
    setRefresh(result: GoogleDriveNativeRefreshResult) {
      refreshResult = result
    },
    setRevokeError(error: Error | null) {
      revokeError = error
    }
  }
}

function testSession(options?: {
  native?: ReturnType<typeof nativeBridge>
  profileId?: string
  now?: () => number
  versions?: string[]
}) {
  const store = new MemoryCredentialStore()
  const credentials = createCredentialServices(store)
  const metadata = new MemoryGoogleDriveOAuthMetadataStore()
  const native = options?.native ?? nativeBridge()
  const versions = options?.versions ?? [VERSION_A]
  let versionIndex = 0
  const session = createGoogleDriveOAuthSession({
    clientId: CLIENT_ID,
    profileId: options?.profileId ?? 'default',
    ...credentials,
    metadataStore: metadata,
    native: native.bridge,
    now: options?.now,
    randomAuthorizationVersion: () => versions[versionIndex++] ?? VERSION_B
  })
  return { session, store, credentials, metadata, native }
}

describe('Google Drive OAuth session', () => {
  for (const [nativeCode, expectedCode] of NATIVE_OAUTH_ERROR_CASES) {
    test(`preserves native ${nativeCode} authorization failures`, async () => {
      const native = nativeBridge()
      const nativeError = new GoogleDriveNativeError(nativeCode, `Native ${nativeCode}`)
      native.bridge.authorize = async () => {
        throw nativeError
      }
      const { session } = testSession({ native })

      await expect(session.connect()).rejects.toMatchObject({
        code: expectedCode,
        message: nativeError.message,
        cause: nativeError
      } satisfies Partial<GoogleDriveOAuthError>)
    })
  }

  test('preserves semantic native failures while refreshing access tokens', async () => {
    let now = 0
    const native = nativeBridge()
    const { session } = testSession({ native, now: () => now })
    await session.connect()
    now = 3_600_000
    const nativeError = new GoogleDriveNativeError('userinfo-failed', 'Userinfo request failed')
    native.bridge.refresh = async () => {
      throw nativeError
    }

    await expect(session.getAccessToken()).rejects.toMatchObject({
      code: 'userinfo-failed',
      message: nativeError.message,
      cause: nativeError
    } satisfies Partial<GoogleDriveOAuthError>)
  })

  test('keeps native cancellation distinct from generic native failures', async () => {
    const native = nativeBridge()
    native.bridge.authorize = async () => {
      throw new GoogleDriveNativeError('cancelled', 'Native authorization cancelled')
    }
    const { session } = testSession({ native })

    await expect(session.connect()).rejects.toMatchObject({
      code: 'cancelled'
    } satisfies Partial<GoogleDriveOAuthError>)
  })

  test('stores refresh tokens separately from independently readable public metadata', async () => {
    const { session, credentials, metadata } = testSession()

    const connected = await session.connect()

    expect(connected).toEqual({
      profileId: 'default',
      subject: 'google-subject-a',
      email: 'google-subject-a@example.com',
      accountLabel: 'google-subject-a@example.com',
      authorizationVersion: VERSION_A,
      grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES,
      replacedAuthorities: []
    })
    const publicMetadata = await metadata.read('default')
    expect(JSON.stringify(publicMetadata)).not.toContain('refresh-token')
    expect(JSON.stringify(publicMetadata)).not.toContain('access-')
    const rawCredential = await credentials.resolver.resolve({
      integrationId: 'google-drive',
      profileId: 'default',
      field: 'refresh-token'
    })
    expect(parseGoogleDriveRefreshTokenEnvelopeJSON(rawCredential as string)).toEqual({
      schemaVersion: 1,
      refreshToken: 'refresh-token-a',
      authorizationVersion: VERSION_A,
      subject: 'google-subject-a'
    })
  })

  test('status validates the exact credential identity without exposing its token', async () => {
    const metadata = new MemoryGoogleDriveOAuthMetadataStore()
    await metadata.write(
      parseGoogleDriveOAuthPublicMetadata({
        schemaVersion: 1,
        profileId: 'work',
        subject: 'stable-subject',
        email: 'verified@example.com',
        authorizationVersion: VERSION_A,
        grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES
      })
    )
    let resolutionCount = 0
    const session = createGoogleDriveOAuthSession({
      clientId: CLIENT_ID,
      profileId: 'work',
      manager: {
        backend: 'native',
        availability: () => Promise.resolve('available'),
        status: () => Promise.resolve('configured'),
        set: () => Promise.resolve(),
        clear: () => Promise.resolve()
      },
      resolver: {
        resolve: () => {
          resolutionCount++
          return Promise.resolve(
            serializeGoogleDriveRefreshTokenEnvelope(
              parseGoogleDriveRefreshTokenEnvelope({
                schemaVersion: 1,
                refreshToken: 'status-only-refresh-token',
                subject: 'stable-subject',
                authorizationVersion: VERSION_A
              })
            )
          )
        }
      },
      metadataStore: metadata,
      native: nativeBridge().bridge
    })

    expect(await session.status()).toEqual({
      state: 'connected',
      profileId: 'work',
      subject: 'stable-subject',
      email: 'verified@example.com',
      accountLabel: 'verified@example.com',
      authorizationVersion: VERSION_A,
      grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES
    })
    expect(resolutionCount).toBe(1)
    expect(JSON.stringify(await session.status())).not.toContain('status-only-refresh-token')
  })

  test('repairs a credential-first crash only after exposing both same-account authorities', async () => {
    const native = nativeBridge()
    const { session, credentials, metadata } = testSession({
      native,
      versions: [VERSION_A, VERSION_C]
    })
    await session.connect()
    await credentials.manager.set(
      googleDriveRefreshTokenCredentialRef('default'),
      serializeGoogleDriveRefreshTokenEnvelope(
        parseGoogleDriveRefreshTokenEnvelope({
          schemaVersion: 1,
          refreshToken: 'credential-first-crash-token',
          subject: 'google-subject-a',
          authorizationVersion: VERSION_B
        })
      )
    )

    expect(await session.status()).toMatchObject({
      state: 'invalid',
      reason: 'authority-mismatch',
      repairable: true,
      repairAuthority: { subject: 'google-subject-a', authorizationVersion: VERSION_B },
      repairAuthorities: [
        { subject: 'google-subject-a', authorizationVersion: VERSION_B },
        { subject: 'google-subject-a', authorizationVersion: VERSION_A }
      ]
    })
    native.setAuthorization(authorizationResult('google-subject-a', 'replacement-after-crash'))
    const repaired = await session.connect()

    expect(repaired.authorizationVersion).toBe(VERSION_C)
    expect(repaired.replacedAuthorities).toEqual([
      { subject: 'google-subject-a', authorizationVersion: VERSION_B },
      { subject: 'google-subject-a', authorizationVersion: VERSION_A }
    ])
    expect((await metadata.read('default'))?.authorizationVersion).toBe(VERSION_C)
  })

  test('repairs a legacy metadata-first crash with credential authority as the primary preflight', async () => {
    const native = nativeBridge()
    const { session, metadata } = testSession({
      native,
      versions: [VERSION_A, VERSION_C]
    })
    await session.connect()
    await metadata.write(
      parseGoogleDriveOAuthPublicMetadata({
        schemaVersion: 1,
        profileId: 'default',
        subject: 'google-subject-a',
        email: 'google-subject-a@example.com',
        authorizationVersion: VERSION_B,
        grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES
      })
    )

    expect(await session.status()).toMatchObject({
      state: 'invalid',
      reason: 'authority-mismatch',
      repairable: true,
      repairAuthority: { subject: 'google-subject-a', authorizationVersion: VERSION_A },
      repairAuthorities: [
        { subject: 'google-subject-a', authorizationVersion: VERSION_A },
        { subject: 'google-subject-a', authorizationVersion: VERSION_B }
      ]
    })
    native.setAuthorization(authorizationResult('google-subject-a', 'replacement-after-crash'))
    const repaired = await session.connect()

    expect(repaired.authorizationVersion).toBe(VERSION_C)
    expect(repaired.replacedAuthorities).toEqual([
      { subject: 'google-subject-a', authorizationVersion: VERSION_A },
      { subject: 'google-subject-a', authorizationVersion: VERSION_B }
    ])
  })

  test('keeps authorizationVersion stable across a single-flight refresh', async () => {
    let now = 0
    const native = nativeBridge()
    const { session } = testSession({ native, now: () => now })
    await session.connect()
    now = 3_600_000

    const [first, second] = await Promise.all([session.getAccessToken(), session.getAccessToken()])

    expect(native.refreshCalls()).toBe(1)
    expect(first).toEqual(second)
    expect(first.authorizationVersion).toBe(VERSION_A)
    expect(first.subject).toBe('google-subject-a')
  })

  test('does not overwrite a profile when a new grant has a different subject', async () => {
    const native = nativeBridge()
    const { session, metadata, credentials } = testSession({
      native,
      versions: [VERSION_A, VERSION_B]
    })
    await session.connect()
    native.setAuthorization(authorizationResult('google-subject-b', 'refresh-token-b'))

    await expect(session.connect()).rejects.toMatchObject({
      code: 'profile-account-mismatch'
    } satisfies Partial<GoogleDriveOAuthError>)
    expect(native.revoked).toContain('refresh-token-b')
    expect((await metadata.read('default'))?.authorizationVersion).toBe(VERSION_A)
    const raw = await credentials.resolver.resolve({
      integrationId: 'google-drive',
      profileId: 'default',
      field: 'refresh-token'
    })
    expect(parseGoogleDriveRefreshTokenEnvelopeJSON(raw as string).subject).toBe('google-subject-a')
  })

  test('repairs missing credentials only after replacement OAuth proves the same subject', async () => {
    const native = nativeBridge()
    const { session, credentials, metadata } = testSession({
      native,
      versions: [VERSION_A, VERSION_B]
    })
    await session.connect()
    await credentials.manager.clear({
      integrationId: 'google-drive',
      profileId: 'default',
      field: 'refresh-token'
    })
    expect(await session.status()).toMatchObject({
      state: 'invalid',
      reason: 'credential-missing'
    })
    native.setAuthorization(authorizationResult('google-subject-a', 'replacement-refresh-token'))

    await expect(session.connect()).resolves.toMatchObject({
      subject: 'google-subject-a',
      authorizationVersion: VERSION_B
    })
    expect((await metadata.read('default'))?.authorizationVersion).toBe(VERSION_B)
    const raw = await credentials.resolver.resolve({
      integrationId: 'google-drive',
      profileId: 'default',
      field: 'refresh-token'
    })
    expect(parseGoogleDriveRefreshTokenEnvelopeJSON(raw as string)).toMatchObject({
      subject: 'google-subject-a',
      authorizationVersion: VERSION_B,
      refreshToken: 'replacement-refresh-token'
    })
  })

  test('does not repair missing credentials with a different subject', async () => {
    const native = nativeBridge()
    const { session, credentials, metadata } = testSession({
      native,
      versions: [VERSION_A, VERSION_B]
    })
    await session.connect()
    await credentials.manager.clear({
      integrationId: 'google-drive',
      profileId: 'default',
      field: 'refresh-token'
    })
    native.setAuthorization(authorizationResult('google-subject-b', 'replacement-refresh-token'))

    await expect(session.connect()).rejects.toMatchObject({ code: 'profile-account-mismatch' })
    expect(native.revoked).toContain('replacement-refresh-token')
    expect((await metadata.read('default'))?.authorizationVersion).toBe(VERSION_A)
    expect(await session.status()).toMatchObject({
      state: 'invalid',
      reason: 'credential-missing'
    })
  })

  test('keeps durable authorization when revoke fails until explicit local disconnect', async () => {
    const native = nativeBridge()
    const { session } = testSession({ native })
    await session.connect()
    native.setRevokeError(new Error('offline'))

    expect(await session.disconnect()).toEqual({
      outcome: 'revoke-failed',
      reason: 'native-failed'
    })
    expect((await session.status()).state).toBe('connected')
    expect(await session.disconnect({ mode: 'local-only' })).toEqual({
      outcome: 'disconnected',
      localOnly: true
    })
    expect(await session.status()).toEqual({ state: 'missing', profileId: 'default' })
  })

  test('fails closed outside Tauri when no native bridge is injected', async () => {
    const store = new MemoryCredentialStore()
    const credentials = createCredentialServices(store)
    const session = createGoogleDriveOAuthSession({
      clientId: CLIENT_ID,
      profileId: 'browser',
      ...credentials,
      metadataStore: new MemoryGoogleDriveOAuthMetadataStore()
    })

    expect(await session.status()).toEqual({ state: 'unsupported', profileId: 'browser' })
    await expect(session.connect()).rejects.toMatchObject({ code: 'unsupported' })
    await expect(session.getAccessToken()).rejects.toMatchObject({ code: 'unsupported' })
  })

  test('surfaces native authorization cancellation without persisting a grant', async () => {
    const native = nativeBridge()
    native.bridge.authorize = (_request, signal) => {
      signal?.throwIfAborted()
      return Promise.reject(new DOMException('cancelled', 'AbortError'))
    }
    const { session } = testSession({ native })

    await expect(session.connect()).rejects.toMatchObject({ code: 'cancelled' })
    expect(await session.status()).toEqual({ state: 'missing', profileId: 'default' })
  })

  test('rejects broadened scopes and unknown public metadata fields', async () => {
    const native = nativeBridge({
      ...authorizationResult(),
      grantedScopes: [...GOOGLE_DRIVE_OAUTH_SCOPES, 'https://www.googleapis.com/auth/drive']
    })
    const { session } = testSession({ native })

    await expect(session.connect()).rejects.toMatchObject({ code: 'scope-mismatch' })
    expect(() =>
      parseGoogleDriveOAuthPublicMetadata({
        schemaVersion: 1,
        profileId: 'default',
        subject: 'subject',
        authorizationVersion: VERSION_A,
        grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES,
        refreshToken: 'must-not-appear'
      })
    ).toThrow('Stored Google Drive account metadata is invalid')
  })
})
