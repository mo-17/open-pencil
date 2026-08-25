import { describe, expect, test } from 'bun:test'

import {
  BAIDU_NETDISK_OAUTH_SCOPES,
  type BaiduNetdiskOAuthPublicMetadata
} from '@/app/integrations/storage/baidu-netdisk/oauth/envelope'
import {
  MemoryBaiduNetdiskOAuthMetadataStore,
  type BaiduNetdiskOAuthMetadataStore
} from '@/app/integrations/storage/baidu-netdisk/oauth/metadata'
import {
  baiduNetdiskRefreshTokenCredentialRef,
  createBaiduNetdiskOAuthSession
} from '@/app/integrations/storage/baidu-netdisk/oauth/session'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import { createCredentialServices } from '@/app/settings/credentials/services'
import {
  CredentialStoreError,
  type CredentialManager,
  type CredentialResolver
} from '@/app/settings/credentials/types'
import type {
  BaiduNetdiskNativeAuthorizeRequest,
  BaiduNetdiskNativeAuthorizeResult,
  BaiduNetdiskNativeBridge,
  BaiduNetdiskNativeRefreshRequest,
  BaiduNetdiskNativeRefreshResult
} from '@/app/tauri/baidu-netdisk'

const APP_KEY = 'abcdefghijklmnopqrstuvwx'
const SECRET_KEY = 's'.repeat(32)
const VERSION_A = 'a'.repeat(32)
const VERSION_B = 'b'.repeat(32)
const UK_A = '20828103601234567890'
const UK_B = '20828103601234567891'
const CREDENTIALS_JSON = JSON.stringify({ appKey: APP_KEY, secretKey: SECRET_KEY })

function authorizationResult(
  uk = UK_A,
  refreshToken = 'refresh-token-a'
): BaiduNetdiskNativeAuthorizeResult {
  return {
    accessToken: `access-${uk}`,
    refreshToken,
    expiresIn: 2_592_000,
    grantedScopes: ['netdisk', 'basic'],
    uk,
    netdiskName: `person-${uk.slice(-2)}`
  }
}

function nativeBridge(initial = authorizationResult()) {
  let authorization = initial
  let refreshResult: BaiduNetdiskNativeRefreshResult = {
    ...authorizationResult(initial.uk, 'refresh-token-rotated'),
    accessToken: 'access-token-refreshed'
  }
  const authorizeRequests: BaiduNetdiskNativeAuthorizeRequest[] = []
  const refreshRequests: BaiduNetdiskNativeRefreshRequest[] = []
  const bridge: BaiduNetdiskNativeBridge = {
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
    setAuthorization(value: BaiduNetdiskNativeAuthorizeResult) {
      authorization = value
    },
    setRefresh(value: BaiduNetdiskNativeRefreshResult) {
      refreshResult = value
    }
  }
}

function testSession(
  options: {
    native?: ReturnType<typeof nativeBridge>
    manager?: CredentialManager
    resolver?: CredentialResolver
    metadata?: BaiduNetdiskOAuthMetadataStore
    publisher?: boolean
    versions?: readonly string[]
  } = {}
) {
  const store = new MemoryCredentialStore()
  const credentials = createCredentialServices(store)
  const metadata = options.metadata ?? new MemoryBaiduNetdiskOAuthMetadataStore()
  const native = options.native ?? nativeBridge()
  const versions = options.versions ?? [VERSION_A]
  let versionIndex = 0
  const session = createBaiduNetdiskOAuthSession({
    publisherConfig: options.publisher === false ? null : { appKey: APP_KEY },
    profileId: 'default',
    manager: options.manager ?? credentials.manager,
    resolver: options.resolver ?? credentials.resolver,
    metadataStore: metadata,
    native: native.bridge,
    now: () => 1_000_000,
    randomAuthorizationVersion: () => versions[versionIndex++] ?? VERSION_B
  })
  return { session, credentials, metadata, native }
}

describe('Baidu Netdisk OAuth session', () => {
  test('keeps publisher and self-hosted native requests strictly isolated', async () => {
    const publisher = testSession()
    await publisher.session.connect({ mode: 'publisher-broker' })
    expect(publisher.native.authorizeRequests).toEqual([
      { oauthClient: { mode: 'publisher-broker' }, timeoutMs: 300_000 }
    ])
    expect(JSON.stringify(publisher.native.authorizeRequests)).not.toContain(APP_KEY)
    expect(JSON.stringify(publisher.native.authorizeRequests)).not.toContain('secretKey')

    const selfHosted = testSession()
    await selfHosted.session.connect({ mode: 'self-hosted', credentialsJSON: CREDENTIALS_JSON })
    expect(selfHosted.native.authorizeRequests).toEqual([
      {
        oauthClient: { mode: 'self-hosted', appKey: APP_KEY, secretKey: SECRET_KEY },
        timeoutMs: 300_000
      }
    ])
    const raw = await selfHosted.credentials.resolver.resolve(
      baiduNetdiskRefreshTokenCredentialRef('default')
    )
    expect(raw).toContain(SECRET_KEY)
    expect(raw).toContain('refresh-token-a')
    expect(raw).not.toContain('access-')
    expect(JSON.stringify(await selfHosted.metadata.read('default'))).not.toContain(SECRET_KEY)
  })

  test('rotates and durably reads back the refresh token before returning access', async () => {
    const { session, credentials, native } = testSession()
    await session.connect({ mode: 'publisher-broker' })

    await expect(session.refresh()).resolves.toMatchObject({
      accessToken: 'access-token-refreshed',
      authority: { accountId: UK_A, authorizationVersion: VERSION_A }
    })
    expect(native.refreshRequests).toEqual([
      {
        oauthClient: { mode: 'publisher-broker' },
        refreshToken: 'refresh-token-a',
        expectedUk: UK_A,
        timeoutMs: 30_000
      }
    ])
    const raw = await credentials.resolver.resolve(baiduNetdiskRefreshTokenCredentialRef('default'))
    expect(raw).toContain('refresh-token-rotated')
    expect(raw).not.toContain('refresh-token-a"')
    expect(raw).not.toContain('access-token-refreshed')
  })

  test('fails closed when the rotated refresh token cannot be committed', async () => {
    const store = new MemoryCredentialStore()
    const credentials = createCredentialServices(store)
    let writes = 0
    const manager: CredentialManager = {
      ...credentials.manager,
      async set(reference, value) {
        writes++
        if (writes === 2) throw new CredentialStoreError('failed', 'injected write failure')
        await credentials.manager.set(reference, value)
      }
    }
    const { session } = testSession({ manager, resolver: credentials.resolver })
    await session.connect({ mode: 'publisher-broker' })

    await expect(session.refresh()).rejects.toMatchObject({ code: 'persistence-failed' })
    await expect(session.accessToken()).rejects.toMatchObject({ code: 'persistence-failed' })
    await expect(session.status()).resolves.toMatchObject({
      state: 'invalid',
      reason: 'credential-invalid'
    })
    const raw = await credentials.resolver.resolve(baiduNetdiskRefreshTokenCredentialRef('default'))
    expect(raw).toContain('refresh-token-a')
    expect(raw).not.toContain('refresh-token-rotated')
  })

  test('rolls both records back when the final metadata commit fails', async () => {
    class FailingMetadataStore extends MemoryBaiduNetdiskOAuthMetadataStore {
      writes = 0

      override async write(metadata: BaiduNetdiskOAuthPublicMetadata): Promise<void> {
        this.writes++
        if (this.writes === 2) throw new Error('injected final commit failure')
        await super.write(metadata)
      }
    }
    const metadata = new FailingMetadataStore()
    const { session, credentials } = testSession({ metadata })

    await expect(session.connect({ mode: 'publisher-broker' })).rejects.toMatchObject({
      code: 'persistence-failed'
    })
    await expect(
      credentials.resolver.resolve(baiduNetdiskRefreshTokenCredentialRef('default'))
    ).resolves.toBeNull()
    await expect(metadata.read('default')).resolves.toBeNull()
  })

  test('migrates authorization versions only for the same lossless uk', async () => {
    const native = nativeBridge()
    const { session, credentials } = testSession({
      native,
      versions: [VERSION_A, VERSION_B]
    })
    await session.connect({ mode: 'publisher-broker' })
    native.setAuthorization(authorizationResult(UK_A, 'refresh-token-b'))
    const replacement = await session.connect({ mode: 'publisher-broker', expectedUk: UK_A })
    expect(replacement.authorizationVersion).toBe(VERSION_B)
    expect(replacement.replacedAuthorities).toContainEqual({
      uk: UK_A,
      authorizationVersion: VERSION_A
    })

    native.setAuthorization(authorizationResult(UK_B, 'refresh-token-c'))
    await expect(
      session.connect({ mode: 'publisher-broker', expectedUk: UK_A })
    ).rejects.toMatchObject({ code: 'profile-account-mismatch' })
    const raw = await credentials.resolver.resolve(baiduNetdiskRefreshTokenCredentialRef('default'))
    expect(raw).toContain('refresh-token-b')
    expect(raw).not.toContain('refresh-token-c')
  })

  test('rejects authority mismatches after restart instead of serving a token', async () => {
    const first = testSession()
    await first.session.connect({ mode: 'publisher-broker' })
    const metadata = await first.metadata.read('default')
    if (!metadata) throw new Error('expected metadata')
    await first.metadata.write({ ...metadata, authorizationVersion: VERSION_B })

    const restarted = createBaiduNetdiskOAuthSession({
      publisherConfig: { appKey: APP_KEY },
      profileId: 'default',
      ...first.credentials,
      metadataStore: first.metadata,
      native: first.native.bridge
    })
    await expect(restarted.status()).resolves.toMatchObject({
      state: 'invalid',
      reason: 'authority-mismatch'
    })
    await expect(restarted.accessToken()).rejects.toMatchObject({ code: 'inconsistent-state' })
  })

  test('distinguishes locked and unavailable credential storage', async () => {
    const lockedManager: CredentialManager = {
      backend: 'memory',
      availability: () => Promise.resolve('locked'),
      status: () => Promise.resolve('locked'),
      set: () => Promise.reject(new CredentialStoreError('locked', 'locked')),
      clear: () => Promise.reject(new CredentialStoreError('locked', 'locked'))
    }
    const lockedResolver: CredentialResolver = {
      resolve: () => Promise.reject(new CredentialStoreError('locked', 'locked'))
    }
    const locked = testSession({ manager: lockedManager, resolver: lockedResolver })
    await expect(locked.session.status()).resolves.toEqual({
      state: 'locked',
      profileId: 'default'
    })

    const unavailableManager: CredentialManager = {
      ...lockedManager,
      status: () => Promise.reject(new CredentialStoreError('unavailable', 'unavailable'))
    }
    const unavailable = testSession({ manager: unavailableManager, resolver: lockedResolver })
    await expect(unavailable.session.status()).resolves.toEqual({
      state: 'unavailable',
      profileId: 'default'
    })
  })

  test('never falls back between modes and disconnects both local records', async () => {
    const native = nativeBridge()
    native.bridge.authorize = (request) => {
      native.authorizeRequests.push(request)
      return Promise.reject(
        Object.assign(new Error('self-hosted client rejected'), { code: 'oauth-client-invalid' })
      )
    }
    const { session } = testSession({ native })
    await expect(
      session.connect({ mode: 'self-hosted', credentialsJSON: CREDENTIALS_JSON })
    ).rejects.toMatchObject({ code: 'oauth-client-invalid' })
    expect(native.authorizeRequests).toEqual([
      {
        oauthClient: { mode: 'self-hosted', appKey: APP_KEY, secretKey: SECRET_KEY },
        timeoutMs: 300_000
      }
    ])

    const connected = testSession()
    await connected.session.connect({ mode: 'publisher-broker' })
    await expect(connected.session.disconnect()).resolves.toEqual({
      outcome: 'disconnected',
      localOnly: true
    })
    await expect(connected.session.status()).resolves.toEqual({
      state: 'missing',
      profileId: 'default'
    })
  })

  test('requires an explicit configured publisher mode', async () => {
    const { session, native } = testSession({ publisher: false })
    await expect(session.connect({ mode: 'publisher-broker' })).rejects.toMatchObject({
      code: 'setup-required'
    })
    expect(native.authorizeRequests).toHaveLength(0)

    await expect(
      session.connect({ mode: 'self-hosted', credentialsJSON: CREDENTIALS_JSON })
    ).resolves.toMatchObject({
      clientMode: 'self-hosted',
      grantedScopes: BAIDU_NETDISK_OAUTH_SCOPES
    })
  })
})
