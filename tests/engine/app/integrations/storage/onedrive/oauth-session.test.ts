import { describe, expect, test } from 'bun:test'

import { ONEDRIVE_OAUTH_SCOPES } from '@/app/integrations/storage/onedrive/oauth/envelope'
import { MemoryOneDriveOAuthMetadataStore } from '@/app/integrations/storage/onedrive/oauth/metadata'
import {
  createOneDriveOAuthSession,
  oneDriveRefreshTokenCredentialRef,
  oneDriveSingleAccountId,
  type OneDriveNativeAuthorizeRequest,
  type OneDriveNativeAuthorizeResult,
  type OneDriveNativeRefreshRequest,
  type OneDriveNativeRefreshResult,
  type OneDriveOAuthNativeBridge
} from '@/app/integrations/storage/onedrive/oauth/session'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import { createCredentialServices } from '@/app/settings/credentials/services'

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const VERSION_A = 'a'.repeat(32)
const VERSION_B = 'b'.repeat(32)
const GRAPH_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://graph.microsoft.com/Files.ReadWrite.AppFolder'
] as const

function authorizationResult(
  subject = 'microsoft-subject-a',
  refreshToken = 'refresh-token-a'
): OneDriveNativeAuthorizeResult {
  return {
    accessToken: `access-${subject}`,
    refreshToken,
    expiresIn: 3_600,
    grantedScopes: GRAPH_SCOPES,
    subject,
    email: `${subject}@example.com`
  }
}

function nativeBridge(initial = authorizationResult()) {
  let authorization = initial
  let refreshResult: OneDriveNativeRefreshResult = {
    ...authorizationResult(initial.subject, 'refresh-token-rotated'),
    accessToken: 'access-token-refreshed'
  }
  const authorizeRequests: OneDriveNativeAuthorizeRequest[] = []
  const refreshRequests: OneDriveNativeRefreshRequest[] = []
  const bridge: OneDriveOAuthNativeBridge = {
    authorize(request) {
      authorizeRequests.push(request)
      return Promise.resolve(authorization)
    },
    refresh(request) {
      refreshRequests.push(request)
      return Promise.resolve(refreshResult)
    }
  }
  return {
    bridge,
    authorizeRequests,
    refreshRequests,
    setAuthorization(value: OneDriveNativeAuthorizeResult) {
      authorization = value
    },
    setRefresh(value: OneDriveNativeRefreshResult) {
      refreshResult = value
    }
  }
}

function testSession(options?: {
  native?: ReturnType<typeof nativeBridge>
  now?: () => number
  versions?: readonly string[]
}) {
  const store = new MemoryCredentialStore()
  const credentials = createCredentialServices(store)
  const metadata = new MemoryOneDriveOAuthMetadataStore()
  const native = options?.native ?? nativeBridge()
  const versions = options?.versions ?? [VERSION_A]
  let versionIndex = 0
  const session = createOneDriveOAuthSession({
    clientId: CLIENT_ID,
    profileId: 'default',
    ...credentials,
    metadataStore: metadata,
    native: native.bridge,
    now: options?.now,
    randomAuthorizationVersion: () => versions[versionIndex++] ?? VERSION_B
  })
  return { session, credentials, metadata, native }
}

describe('OneDrive OAuth session', () => {
  test('fails closed when durable reconnect work names multiple accounts', () => {
    expect(
      oneDriveSingleAccountId([
        { accountId: 'microsoft-subject-a', authorizationVersion: VERSION_A },
        { accountId: 'microsoft-subject-a', authorizationVersion: VERSION_B }
      ])
    ).toBe('microsoft-subject-a')
    expect(() =>
      oneDriveSingleAccountId([
        { accountId: 'microsoft-subject-a', authorizationVersion: VERSION_A },
        { accountId: 'microsoft-subject-b', authorizationVersion: VERSION_B }
      ])
    ).toThrow('multiple Microsoft accounts')
  })

  test('connects with the native fixed flow and keeps access tokens memory-only', async () => {
    const { session, credentials, metadata, native } = testSession()

    const connection = await session.connect()
    expect(connection).toMatchObject({
      subject: 'microsoft-subject-a',
      authorizationVersion: VERSION_A,
      grantedScopes: ONEDRIVE_OAUTH_SCOPES,
      authority: { accountId: 'microsoft-subject-a', authorizationVersion: VERSION_A }
    })
    expect(native.authorizeRequests).toEqual([{ timeoutMs: 180_000 }])
    expect(native.authorizeRequests[0]).not.toHaveProperty('clientId')
    expect(native.authorizeRequests[0]).not.toHaveProperty('scopes')
    expect(native.authorizeRequests[0]).not.toHaveProperty('tenant')

    const raw = await credentials.resolver.resolve(oneDriveRefreshTokenCredentialRef('default'))
    expect(raw).toContain('refresh-token-a')
    expect(raw).toContain(CLIENT_ID)
    expect(raw).not.toContain('access-microsoft-subject-a')
    expect(raw).not.toContain('clientSecret')
    expect(await metadata.read('default')).toEqual({
      schemaVersion: 1,
      profileId: 'default',
      subject: 'microsoft-subject-a',
      email: 'microsoft-subject-a@example.com',
      authorizationVersion: VERSION_A,
      grantedScopes: ONEDRIVE_OAUTH_SCOPES
    })

    await expect(session.status()).resolves.toMatchObject({ state: 'connected' })
    await expect(session.getAccessToken()).resolves.toMatchObject({
      accessToken: 'access-microsoft-subject-a',
      authority: { accountId: 'microsoft-subject-a', authorizationVersion: VERSION_A }
    })
    expect(native.refreshRequests).toHaveLength(0)
  })

  test('atomically replaces the encrypted refresh token on every refresh', async () => {
    const { session, credentials, native } = testSession()
    await session.connect()

    const refreshed = await session.refresh()
    expect(refreshed).toMatchObject({
      accessToken: 'access-token-refreshed',
      authority: { accountId: 'microsoft-subject-a', authorizationVersion: VERSION_A }
    })
    expect(native.refreshRequests).toEqual([
      {
        refreshToken: 'refresh-token-a',
        expectedSubject: 'microsoft-subject-a',
        timeoutMs: 30_000
      }
    ])
    expect(native.refreshRequests[0]).not.toHaveProperty('clientId')
    expect(native.refreshRequests[0]).not.toHaveProperty('scopes')

    const raw = await credentials.resolver.resolve(oneDriveRefreshTokenCredentialRef('default'))
    expect(raw).toContain('refresh-token-rotated')
    expect(raw).not.toContain('refresh-token-a"')
    expect(raw).not.toContain('access-token-refreshed')
    await expect(session.status()).resolves.toMatchObject({ state: 'connected' })
  })

  test('preserves native reconnect and rate-limit semantics across the OAuth boundary', async () => {
    const native = nativeBridge()
    const { session } = testSession({ native })
    await session.connect()

    native.bridge.refresh = () =>
      Promise.reject(
        Object.assign(new Error('Microsoft authorization grant is invalid or expired'), {
          code: 'authorization-grant-invalid'
        })
      )
    await expect(session.refresh()).rejects.toMatchObject({
      code: 'authorization-grant-invalid'
    })

    native.bridge.refresh = () =>
      Promise.reject(
        Object.assign(new Error('Microsoft temporarily rate limited OneDrive'), {
          code: 'rate-limited',
          retryAfterMs: 12_000
        })
      )
    await expect(session.refresh()).rejects.toMatchObject({
      code: 'rate-limited',
      retryAfterMs: 12_000
    })
  })

  test('blocks authorization mutation until an in-flight rotated token is durable', async () => {
    const native = nativeBridge()
    let resolveRefresh!: (result: OneDriveNativeRefreshResult) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    native.bridge.refresh = () => {
      markStarted()
      return new Promise<OneDriveNativeRefreshResult>((resolve) => {
        resolveRefresh = resolve
      })
    }
    const { session, credentials } = testSession({ native })
    await session.connect()

    const pendingRefresh = session.refresh()
    await started
    await expect(session.disconnect()).rejects.toMatchObject({ code: 'busy' })
    resolveRefresh({
      ...authorizationResult('microsoft-subject-a', 'refresh-token-rotated'),
      accessToken: 'access-token-refreshed'
    })
    await expect(pendingRefresh).resolves.toMatchObject({
      accessToken: 'access-token-refreshed'
    })
    const raw = await credentials.resolver.resolve(oneDriveRefreshTokenCredentialRef('default'))
    expect(raw).toContain('refresh-token-rotated')
    await expect(session.status()).resolves.toMatchObject({ state: 'connected' })
  })

  test('disconnect removes only local credential and public metadata', async () => {
    const { session, credentials, metadata, native } = testSession()
    await session.connect()

    await expect(session.disconnect()).resolves.toEqual({
      outcome: 'disconnected',
      localOnly: true
    })
    await expect(
      credentials.resolver.resolve(oneDriveRefreshTokenCredentialRef('default'))
    ).resolves.toBeNull()
    await expect(metadata.read('default')).resolves.toBeNull()
    await expect(session.status()).resolves.toEqual({ state: 'missing', profileId: 'default' })
    expect(native.bridge).not.toHaveProperty('revoke')
  })

  test('does not replace a profile with a different Microsoft account', async () => {
    const native = nativeBridge()
    const { session, credentials } = testSession({
      native,
      versions: [VERSION_A, VERSION_B]
    })
    await session.connect()
    native.setAuthorization(authorizationResult('microsoft-subject-b', 'refresh-token-b'))

    await expect(session.connect()).rejects.toMatchObject({
      code: 'profile-account-mismatch'
    })
    const raw = await credentials.resolver.resolve(oneDriveRefreshTokenCredentialRef('default'))
    expect(raw).toContain('refresh-token-a')
    expect(raw).not.toContain('refresh-token-b')
  })

  test('fails closed when a rotated token belongs to a different subject', async () => {
    const native = nativeBridge()
    const { session, credentials } = testSession({ native })
    await session.connect()
    native.setRefresh({
      ...authorizationResult('microsoft-subject-b', 'refresh-token-b'),
      accessToken: 'access-token-b'
    })

    await expect(session.refresh()).rejects.toMatchObject({ code: 'subject-mismatch' })
    const raw = await credentials.resolver.resolve(oneDriveRefreshTokenCredentialRef('default'))
    expect(raw).toContain('refresh-token-a')
    expect(raw).not.toContain('refresh-token-b')
    await expect(session.status()).resolves.toMatchObject({
      state: 'invalid',
      reason: 'credential-invalid'
    })
  })

  test('reports desktop and build configuration boundaries before authorization', async () => {
    const store = new MemoryCredentialStore()
    const credentials = createCredentialServices(store)
    const unsupported = createOneDriveOAuthSession({
      clientId: CLIENT_ID,
      profileId: 'default',
      ...credentials,
      metadataStore: new MemoryOneDriveOAuthMetadataStore()
    })
    await expect(unsupported.status()).resolves.toEqual({
      state: 'unsupported',
      profileId: 'default'
    })

    const setup = createOneDriveOAuthSession({
      clientId: null,
      profileId: 'default',
      ...credentials,
      metadataStore: new MemoryOneDriveOAuthMetadataStore(),
      native: nativeBridge().bridge
    })
    await expect(setup.status()).resolves.toEqual({ state: 'setup', profileId: 'default' })
    await expect(setup.connect()).rejects.toMatchObject({ code: 'setup-required' })
  })
})
