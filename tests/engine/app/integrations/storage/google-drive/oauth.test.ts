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
  type GoogleDriveNativeAuthorizeRequest,
  type GoogleDriveNativeAuthorizeResult,
  type GoogleDriveNativeBridge,
  type GoogleDriveNativeErrorCode,
  type GoogleDriveNativeRefreshRequest,
  type GoogleDriveNativeRefreshResult
} from '@/app/tauri/google-drive'

const CLIENT_ID = '1234567890-test.apps.googleusercontent.com'
const VERSION_A = 'a'.repeat(32)
const VERSION_B = 'b'.repeat(32)
const VERSION_C = 'c'.repeat(32)
const PUBLISHER_CLIENT = { mode: 'publisher-broker', clientId: CLIENT_ID } as const
const SELF_HOSTED_CLIENT = {
  mode: 'self-hosted-desktop',
  clientId: '1234567890-self-hosted.apps.googleusercontent.com',
  clientSecret: 'self-hosted-client-secret'
} as const

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
  ['oauth-broker-rate-limited', 'oauth-broker-rate-limited'],
  ['oauth-broker-unavailable', 'oauth-broker-unavailable'],
  ['oauth-broker-misconfigured', 'oauth-broker-misconfigured'],
  ['oauth-broker-protocol-invalid', 'oauth-broker-protocol-invalid'],
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
  const authorizeRequests: GoogleDriveNativeAuthorizeRequest[] = []
  const refreshRequests: GoogleDriveNativeRefreshRequest[] = []
  const revoked: string[] = []
  let revokeError: Error | null = null
  const bridge: GoogleDriveNativeBridge = {
    authorize: (request) => {
      authorizeRequests.push(request)
      return Promise.resolve(nextAuthorization)
    },
    refresh: (request) => {
      refreshRequests.push(request)
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
    authorizeRequests,
    refreshRequests,
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

  test('preserves the Broker retry delay without exposing a response body', async () => {
    const native = nativeBridge()
    const nativeError = new GoogleDriveNativeError(
      'oauth-broker-rate-limited',
      'OpenPencil OAuth Broker rate limit was reached',
      { retryAfterMs: 60_000 }
    )
    native.bridge.authorize = async () => {
      throw nativeError
    }
    const { session } = testSession({ native })

    await expect(session.connect()).rejects.toMatchObject({
      code: 'oauth-broker-rate-limited',
      retryAfterMs: 60_000,
      cause: nativeError
    } satisfies Partial<GoogleDriveOAuthError>)
  })

  test('retains the schema v1 storage bound for safe legacy reconnect identity', () => {
    const base = {
      schemaVersion: 1,
      authorizationVersion: VERSION_A,
      subject: 'google-subject-a'
    } as const
    expect(
      parseGoogleDriveRefreshTokenEnvelope({ ...base, refreshToken: 'r'.repeat(12 * 1024) })
        .refreshToken
    ).toHaveLength(12 * 1024)
    expect(() =>
      parseGoogleDriveRefreshTokenEnvelope({ ...base, refreshToken: 'r'.repeat(12 * 1024 + 1) })
    ).toThrow('Stored Google Drive authorization is invalid')
    expect(() =>
      parseGoogleDriveRefreshTokenEnvelope({ ...base, refreshToken: 'refresh token' })
    ).toThrow('Stored Google Drive authorization is invalid')
  })

  test('rejects a new refresh token beyond the Broker v1 request bound', async () => {
    const oversized = 'r'.repeat(8 * 1024 + 1)
    const native = nativeBridge(authorizationResult('google-subject-a', oversized))
    const { session } = testSession({ native })

    await expect(session.connect()).rejects.toMatchObject({
      code: 'token-response-invalid'
    } satisfies Partial<GoogleDriveOAuthError>)
    expect(native.revoked).toEqual([oversized])
  })

  test('keeps a legacy oversized credential reconnectable without using it', async () => {
    const native = nativeBridge()
    const { session, credentials } = testSession({ native, versions: [VERSION_A, VERSION_B] })
    await session.connect()
    const legacyCredential = serializeGoogleDriveRefreshTokenEnvelope({
      schemaVersion: 1,
      refreshToken: 'r'.repeat(8 * 1024 + 1),
      authorizationVersion: VERSION_A,
      subject: 'google-subject-a'
    })
    await credentials.manager.set(googleDriveRefreshTokenCredentialRef('default'), legacyCredential)
    session.dispose()

    await expect(session.status()).resolves.toMatchObject({
      state: 'invalid',
      reason: 'credential-invalid',
      repairable: true,
      repairAuthorities: [{ subject: 'google-subject-a', authorizationVersion: VERSION_A }]
    })
    await expect(session.getAccessToken()).rejects.toMatchObject({
      code: 'credential-invalid'
    } satisfies Partial<GoogleDriveOAuthError>)
    await expect(session.connect()).resolves.toMatchObject({
      authorizationVersion: VERSION_B,
      replacedAuthorities: [{ subject: 'google-subject-a', authorizationVersion: VERSION_A }]
    })
  })

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
    const { session, credentials, metadata, native } = testSession()

    const connected = await session.connect()

    expect(connected).toEqual({
      profileId: 'default',
      subject: 'google-subject-a',
      email: 'google-subject-a@example.com',
      accountLabel: 'google-subject-a@example.com',
      authorizationVersion: VERSION_A,
      grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES,
      oauthClient: PUBLISHER_CLIENT,
      replacedAuthorities: []
    })
    const publicMetadata = await metadata.read('default')
    expect(JSON.stringify(publicMetadata)).not.toContain('refresh-token')
    expect(JSON.stringify(publicMetadata)).not.toContain('access-')
    expect(JSON.stringify(publicMetadata)).not.toContain('clientSecret')
    const rawCredential = await credentials.resolver.resolve({
      integrationId: 'google-drive',
      profileId: 'default',
      field: 'refresh-token'
    })
    expect(parseGoogleDriveRefreshTokenEnvelopeJSON(rawCredential as string)).toEqual({
      schemaVersion: 2,
      refreshToken: 'refresh-token-a',
      authorizationVersion: VERSION_A,
      subject: 'google-subject-a',
      oauthClient: PUBLISHER_CLIENT
    })
    expect(native.authorizeRequests).toEqual([{ oauthClient: { mode: 'publisher-broker' } }])
  })

  test('reuses an encrypted self-hosted client after restart without a publisher client', async () => {
    let now = 0
    const native = nativeBridge()
    const { session, credentials, metadata } = testSession({ native, now: () => now })

    const connected = await session.connect({ oauthClient: SELF_HOSTED_CLIENT })
    expect(connected.oauthClient).toEqual({
      mode: 'self-hosted-desktop',
      clientId: SELF_HOSTED_CLIENT.clientId
    })
    expect(native.authorizeRequests).toEqual([{ oauthClient: SELF_HOSTED_CLIENT }])
    expect(JSON.stringify(await metadata.read('default'))).not.toContain(
      SELF_HOSTED_CLIENT.clientSecret
    )
    const rawCredential = await credentials.resolver.resolve(
      googleDriveRefreshTokenCredentialRef('default')
    )
    expect(parseGoogleDriveRefreshTokenEnvelopeJSON(rawCredential as string)).toMatchObject({
      schemaVersion: 2,
      oauthClient: SELF_HOSTED_CLIENT
    })

    session.dispose()
    const restarted = createGoogleDriveOAuthSession({
      clientId: null,
      profileId: 'default',
      ...credentials,
      metadataStore: metadata,
      native: native.bridge,
      now: () => now
    })
    await expect(restarted.status()).resolves.toMatchObject({
      state: 'connected',
      oauthClient: {
        mode: 'self-hosted-desktop',
        clientId: SELF_HOSTED_CLIENT.clientId
      }
    })
    now = 3_600_000
    await restarted.getAccessToken()
    expect(native.refreshRequests.at(-1)).toMatchObject({
      oauthClient: SELF_HOSTED_CLIENT,
      refreshToken: 'refresh-token-a',
      expectedSubject: 'google-subject-a'
    })
  })

  test('uses durable work identity to reject a different account before persistence', async () => {
    const native = nativeBridge(authorizationResult('google-subject-b', 'unexpected-grant'))
    const { session } = testSession({ native })

    await expect(
      session.connect({
        oauthClient: SELF_HOSTED_CLIENT,
        expectedSubject: 'google-subject-a'
      })
    ).rejects.toMatchObject({ code: 'profile-account-mismatch' })
    expect(native.revoked).toEqual(['unexpected-grant'])
    expect(await session.status()).toEqual({ state: 'missing', profileId: 'default' })
  })

  test('repairs corrupt OAuth records when durable work supplies the trusted subject', async () => {
    const native = nativeBridge()
    const { session, credentials } = testSession({ native })
    await credentials.manager.set(googleDriveRefreshTokenCredentialRef('default'), '{corrupt')

    await expect(
      session.connect({
        oauthClient: SELF_HOSTED_CLIENT,
        expectedSubject: 'google-subject-a'
      })
    ).resolves.toMatchObject({
      subject: 'google-subject-a',
      oauthClient: {
        mode: 'self-hosted-desktop',
        clientId: SELF_HOSTED_CLIENT.clientId
      }
    })
    const stored = await credentials.resolver.resolve(
      googleDriveRefreshTokenCredentialRef('default')
    )
    expect(parseGoogleDriveRefreshTokenEnvelopeJSON(stored as string)).toMatchObject({
      schemaVersion: 2,
      subject: 'google-subject-a',
      oauthClient: SELF_HOSTED_CLIENT
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
      grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES,
      oauthClient: PUBLISHER_CLIENT
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

  test('revokes a completed native grant when cancellation wins before persistence', async () => {
    const native = nativeBridge()
    const { session, credentials, metadata } = testSession({
      native,
      versions: [VERSION_A, VERSION_B]
    })
    await session.connect()
    const controller = new AbortController()
    native.bridge.authorize = async () => {
      controller.abort(new DOMException('cancelled after native authorization', 'AbortError'))
      return authorizationResult('google-subject-a', 'late-cancel-refresh-token')
    }

    await expect(session.connect({ signal: controller.signal })).rejects.toMatchObject({
      code: 'cancelled'
    } satisfies Partial<GoogleDriveOAuthError>)

    expect(native.revoked).toContain('late-cancel-refresh-token')
    expect(await session.status()).toMatchObject({
      state: 'connected',
      authorizationVersion: VERSION_A
    })
    expect((await metadata.read('default'))?.authorizationVersion).toBe(VERSION_A)
    const stored = await credentials.resolver.resolve(
      googleDriveRefreshTokenCredentialRef('default')
    )
    expect(parseGoogleDriveRefreshTokenEnvelopeJSON(stored as string)).toMatchObject({
      authorizationVersion: VERSION_A,
      refreshToken: 'refresh-token-a'
    })
  })

  for (const boundary of ['staging-metadata', 'credential'] as const) {
    test(`rolls back a replacement when cancellation wins after the ${boundary} write`, async () => {
      const native = nativeBridge()
      const { session, credentials, metadata } = testSession({
        native,
        versions: [VERSION_A, VERSION_B]
      })
      await session.connect()
      const controller = new AbortController()
      const setCredential = credentials.manager.set.bind(credentials.manager)
      const writeMetadata = metadata.write.bind(metadata)
      credentials.manager.set = async (reference, value) => {
        await setCredential(reference, value)
        const envelope = parseGoogleDriveRefreshTokenEnvelopeJSON(value)
        if (boundary === 'credential' && envelope.authorizationVersion === VERSION_B) {
          controller.abort(new DOMException('cancelled after credential write', 'AbortError'))
        }
      }
      metadata.write = async (value) => {
        await writeMetadata(value)
        if (
          boundary === 'staging-metadata' &&
          value.authorizationVersion !== VERSION_A &&
          value.authorizationVersion !== VERSION_B
        ) {
          controller.abort(new DOMException('cancelled after staged metadata write', 'AbortError'))
        }
      }
      native.setAuthorization(
        authorizationResult('google-subject-a', `${boundary}-boundary-refresh-token`)
      )

      await expect(session.connect({ signal: controller.signal })).rejects.toMatchObject({
        code: 'cancelled'
      } satisfies Partial<GoogleDriveOAuthError>)

      expect(native.revoked).toContain(`${boundary}-boundary-refresh-token`)
      expect(await session.status()).toMatchObject({
        state: 'connected',
        authorizationVersion: VERSION_A
      })
      expect((await metadata.read('default'))?.authorizationVersion).toBe(VERSION_A)
      const stored = await credentials.resolver.resolve(
        googleDriveRefreshTokenCredentialRef('default')
      )
      expect(parseGoogleDriveRefreshTokenEnvelopeJSON(stored as string)).toMatchObject({
        authorizationVersion: VERSION_A,
        refreshToken: 'refresh-token-a'
      })
    })
  }

  test('stages a restart-safe mismatch before the synchronous final commit callback', async () => {
    const native = nativeBridge()
    const { session, credentials, metadata } = testSession({
      native,
      versions: [VERSION_A, VERSION_B]
    })
    await session.connect()
    const events: string[] = []
    let stagingVersion = ''
    const setCredential = credentials.manager.set.bind(credentials.manager)
    const writeMetadata = metadata.write.bind(metadata)
    credentials.manager.set = async (reference, value) => {
      const envelope = parseGoogleDriveRefreshTokenEnvelopeJSON(value)
      if (envelope.authorizationVersion === VERSION_B) events.push('credential')
      await setCredential(reference, value)
    }
    metadata.write = async (value) => {
      if (value.authorizationVersion === VERSION_B) events.push('final-metadata')
      else if (value.authorizationVersion !== VERSION_A) {
        stagingVersion = value.authorizationVersion
        events.push('staged-metadata')
      }
      await writeMetadata(value)
    }
    native.setAuthorization(authorizationResult('google-subject-a', 'committed-refresh-token'))

    await expect(
      session.connect({
        onCommitStart() {
          events.push('commit-start')
        }
      })
    ).resolves.toMatchObject({ authorizationVersion: VERSION_B })

    expect(stagingVersion).toMatch(/^[a-f0-9]{32}$/)
    expect(stagingVersion).not.toBe(VERSION_A)
    expect(stagingVersion).not.toBe(VERSION_B)
    expect(events).toEqual(['staged-metadata', 'credential', 'commit-start', 'final-metadata'])
  })

  test('commits when the caller aborts synchronously at the final commit point', async () => {
    const native = nativeBridge()
    const { session, credentials, metadata } = testSession({
      native,
      versions: [VERSION_A, VERSION_B]
    })
    await session.connect()
    const controller = new AbortController()
    native.setAuthorization(authorizationResult('google-subject-a', 'commit-point-refresh-token'))

    await expect(
      session.connect({
        signal: controller.signal,
        onCommitStart() {
          controller.abort(new DOMException('cancelled at commit point', 'AbortError'))
        }
      })
    ).resolves.toMatchObject({ authorizationVersion: VERSION_B })

    expect(controller.signal.aborted).toBe(true)
    expect((await metadata.read('default'))?.authorizationVersion).toBe(VERSION_B)
    const stored = await credentials.resolver.resolve(
      googleDriveRefreshTokenCredentialRef('default')
    )
    expect(parseGoogleDriveRefreshTokenEnvelopeJSON(stored as string)).toMatchObject({
      authorizationVersion: VERSION_B,
      refreshToken: 'commit-point-refresh-token'
    })
    await expect(session.status()).resolves.toMatchObject({
      state: 'connected',
      authorizationVersion: VERSION_B
    })
    expect(native.revoked).not.toContain('commit-point-refresh-token')
  })

  test('accepts a final metadata write error only after exact durable readback', async () => {
    const native = nativeBridge()
    const { session, metadata } = testSession({
      native,
      versions: [VERSION_A, VERSION_B]
    })
    await session.connect()
    const finalWriteFailure = new Error('final metadata acknowledgement failed')
    const writeMetadata = metadata.write.bind(metadata)
    metadata.write = async (value) => {
      await writeMetadata(value)
      if (value.authorizationVersion === VERSION_B) throw finalWriteFailure
    }
    native.setAuthorization(authorizationResult('google-subject-a', 'read-back-refresh-token'))

    await expect(session.connect()).resolves.toMatchObject({
      authorizationVersion: VERSION_B
    })
    await expect(session.status()).resolves.toMatchObject({
      state: 'connected',
      authorizationVersion: VERSION_B
    })
    expect(native.revoked).not.toContain('read-back-refresh-token')
  })

  test('preserves a real final commit when durable readback is unavailable', async () => {
    const native = nativeBridge()
    const { session, credentials, metadata } = testSession({
      native,
      versions: [VERSION_A, VERSION_B]
    })
    await session.connect()
    const finalWriteFailure = new Error('final metadata acknowledgement failed')
    const readbackFailure = new Error('metadata readback unavailable')
    const readMetadata = metadata.read.bind(metadata)
    const writeMetadata = metadata.write.bind(metadata)
    let readbackUnavailable = false
    metadata.read = async (profileId) => {
      if (readbackUnavailable) throw readbackFailure
      return readMetadata(profileId)
    }
    metadata.write = async (value) => {
      await writeMetadata(value)
      if (value.authorizationVersion === VERSION_B) {
        readbackUnavailable = true
        throw finalWriteFailure
      }
    }
    native.setAuthorization(
      authorizationResult('google-subject-a', 'unverified-committed-refresh-token')
    )

    const failure = await session.connect().catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'persistence-failed',
      message: 'Google Drive authorization storage outcome could not be verified'
    })
    expect((failure as Error).cause).toBeInstanceOf(AggregateError)
    expect(((failure as Error).cause as AggregateError).errors).toEqual([
      finalWriteFailure,
      readbackFailure
    ])
    expect(native.revoked).not.toContain('unverified-committed-refresh-token')
    await expect(session.status()).resolves.toMatchObject({
      state: 'invalid',
      reason: 'credential-invalid'
    })

    metadata.read = readMetadata
    metadata.write = writeMetadata
    const restarted = createGoogleDriveOAuthSession({
      clientId: CLIENT_ID,
      profileId: 'default',
      ...credentials,
      metadataStore: metadata,
      native: native.bridge
    })
    await expect(restarted.status()).resolves.toMatchObject({
      state: 'connected',
      authorizationVersion: VERSION_B
    })
  })

  test('preserves a restart-invalid staging mismatch when final write readback is unavailable', async () => {
    const native = nativeBridge()
    const { session, credentials, metadata } = testSession({
      native,
      versions: [VERSION_A, VERSION_B]
    })
    await session.connect()
    const finalWriteFailure = new Error('final metadata write failed')
    const readbackFailure = new Error('metadata readback unavailable')
    const readMetadata = metadata.read.bind(metadata)
    const writeMetadata = metadata.write.bind(metadata)
    let readbackUnavailable = false
    metadata.read = async (profileId) => {
      if (readbackUnavailable) throw readbackFailure
      return readMetadata(profileId)
    }
    metadata.write = async (value) => {
      if (value.authorizationVersion === VERSION_B) {
        readbackUnavailable = true
        throw finalWriteFailure
      }
      await writeMetadata(value)
    }
    native.setAuthorization(
      authorizationResult('google-subject-a', 'unverified-staged-refresh-token')
    )

    const failure = await session.connect().catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'persistence-failed',
      message: 'Google Drive authorization storage outcome could not be verified'
    })
    expect((failure as Error).cause).toBeInstanceOf(AggregateError)
    expect(((failure as Error).cause as AggregateError).errors).toEqual([
      finalWriteFailure,
      readbackFailure
    ])
    expect(native.revoked).not.toContain('unverified-staged-refresh-token')
    await expect(session.status()).resolves.toMatchObject({
      state: 'invalid',
      reason: 'credential-invalid'
    })

    metadata.read = readMetadata
    metadata.write = writeMetadata
    const persistedMetadata = await metadata.read('default')
    expect(persistedMetadata?.authorizationVersion).not.toBe(VERSION_A)
    expect(persistedMetadata?.authorizationVersion).not.toBe(VERSION_B)
    const restarted = createGoogleDriveOAuthSession({
      clientId: CLIENT_ID,
      profileId: 'default',
      ...credentials,
      metadataStore: metadata,
      native: native.bridge
    })
    await expect(restarted.status()).resolves.toMatchObject({
      state: 'invalid',
      reason: 'authority-mismatch'
    })
    await expect(restarted.getAccessToken()).rejects.toMatchObject({
      code: 'inconsistent-state'
    } satisfies Partial<GoogleDriveOAuthError>)
  })

  test('surfaces rollback failures and keeps restart state invalid through staging', async () => {
    const native = nativeBridge()
    const { session, credentials, metadata } = testSession({
      native,
      versions: [VERSION_A, VERSION_B, VERSION_C]
    })
    await session.connect()
    const persistenceFailure = new Error('credential replacement failed after write')
    const credentialRollbackFailure = new Error('credential rollback failed')
    const metadataRollbackFailure = new Error('metadata rollback failed')
    const setCredential = credentials.manager.set.bind(credentials.manager)
    const writeMetadata = metadata.write.bind(metadata)
    credentials.manager.set = async (reference, value) => {
      const envelope = parseGoogleDriveRefreshTokenEnvelopeJSON(value)
      if (envelope.authorizationVersion === VERSION_A) throw credentialRollbackFailure
      await setCredential(reference, value)
      if (envelope.authorizationVersion === VERSION_B) throw persistenceFailure
    }
    metadata.write = async (value) => {
      if (value.authorizationVersion === VERSION_A) throw metadataRollbackFailure
      await writeMetadata(value)
    }
    native.setRevokeError(new Error('replacement revoke failed'))
    native.setAuthorization(
      authorizationResult('google-subject-a', 'rollback-failure-refresh-token')
    )

    const failure = await session.connect().catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'persistence-failed' })
    expect((failure as Error).cause).toBeInstanceOf(AggregateError)
    expect(((failure as Error).cause as AggregateError).errors).toEqual([
      persistenceFailure,
      credentialRollbackFailure,
      metadataRollbackFailure
    ])
    expect(native.revoked).not.toContain('rollback-failure-refresh-token')
    await expect(session.status()).resolves.toEqual({
      state: 'invalid',
      profileId: 'default',
      reason: 'credential-invalid',
      repairable: false,
      repairAuthorities: []
    })
    await expect(session.getAccessToken()).rejects.toMatchObject({
      code: 'persistence-failed'
    } satisfies Partial<GoogleDriveOAuthError>)

    const restarted = createGoogleDriveOAuthSession({
      clientId: CLIENT_ID,
      profileId: 'default',
      ...credentials,
      metadataStore: metadata,
      native: native.bridge
    })
    await expect(restarted.status()).resolves.toMatchObject({
      state: 'invalid',
      reason: 'authority-mismatch'
    })
    await expect(restarted.getAccessToken()).rejects.toMatchObject({
      code: 'inconsistent-state'
    } satisfies Partial<GoogleDriveOAuthError>)

    credentials.manager.set = setCredential
    metadata.write = writeMetadata
    native.setRevokeError(null)
    native.setAuthorization(authorizationResult('google-subject-a', 'recovered-refresh-token'))
    await expect(session.connect()).resolves.toMatchObject({
      authorizationVersion: VERSION_C
    })
    await expect(session.status()).resolves.toMatchObject({
      state: 'connected',
      authorizationVersion: VERSION_C
    })
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
