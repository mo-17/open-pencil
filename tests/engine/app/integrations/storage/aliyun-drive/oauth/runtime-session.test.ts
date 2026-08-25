/* oxlint-disable eslint/max-lines -- OAuth runtime and session share stateful vault fixtures for rotation recovery. */
import { describe, expect, test } from 'bun:test'

import {
  aliyunDriveOAuthClientPublic,
  parseAliyunDriveAuthorizationEnvelope,
  parseAliyunDriveAuthorizationEnvelopeJSON,
  parseAliyunDriveOAuthPublicMetadata,
  serializeAliyunDriveAuthorizationEnvelope,
  type AliyunDriveAuthorizationEnvelope,
  type AliyunDriveOAuthClient,
  type AliyunDriveOAuthPublicMetadata
} from '@/app/integrations/storage/aliyun-drive/oauth/envelope'
import type { AliyunDriveOAuthError } from '@/app/integrations/storage/aliyun-drive/oauth/errors'
import {
  createAliyunDriveOAuthRuntime,
  type AliyunDriveOAuthMetadataStore
} from '@/app/integrations/storage/aliyun-drive/oauth/runtime'
import { createAliyunDriveOAuthSession } from '@/app/integrations/storage/aliyun-drive/oauth/session'
import {
  CredentialStoreError,
  type CredentialManager,
  type CredentialResolver,
  type CredentialStatus
} from '@/app/settings/credentials/types'
import type {
  AliyunDriveNativeAuthorizeRequest,
  AliyunDriveNativeAuthorizeResult,
  AliyunDriveNativeBridge,
  AliyunDriveNativeRefreshResult
} from '@/app/tauri/aliyun-drive'

const REDIRECT_URI = 'http://127.0.0.1:43127/oauth/aliyun-drive/callback'
const AUTHORIZATION_VERSION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const NOW = 1_800_000_000_000
const SCOPES = ['user:base', 'file:all:read', 'file:all:write']

const CONFIDENTIAL_CLIENT = {
  mode: 'self-hosted-confidential' as const,
  clientId: 'aliyun-client-123',
  clientSecret: 'secret-value-123',
  redirectUri: REDIRECT_URI
}
const PUBLIC_CLIENT = {
  mode: 'self-hosted-public' as const,
  clientId: 'aliyun-client-456',
  redirectUri: REDIRECT_URI
}

type MemoryVault = {
  value: string | null
  status: CredentialStatus
  sets: string[]
  onSet?: (value: string) => void
  onResolve?: (value: string | null) => string | null
}

function credentials(vault: MemoryVault): {
  manager: CredentialManager
  resolver: CredentialResolver
} {
  return {
    manager: {
      backend: 'memory',
      availability: () =>
        Promise.resolve(
          vault.status === 'locked' || vault.status === 'unavailable' ? vault.status : 'available'
        ),
      status: () => Promise.resolve(vault.status),
      async set(_reference, value) {
        vault.onSet?.(value)
        vault.value = value
        vault.status = 'configured'
        vault.sets.push(value)
      },
      async clear() {
        vault.value = null
        vault.status = 'missing'
      }
    },
    resolver: {
      resolve: () => Promise.resolve(vault.onResolve?.(vault.value) ?? vault.value)
    }
  }
}

function metadataStore(initial: AliyunDriveOAuthPublicMetadata | null = null): {
  store: AliyunDriveOAuthMetadataStore
  current: () => AliyunDriveOAuthPublicMetadata | null
} {
  let value = initial
  return {
    store: {
      read: () => Promise.resolve(value),
      write(metadata) {
        value = metadata
        return Promise.resolve()
      },
      remove() {
        value = null
        return Promise.resolve()
      }
    },
    current: () => value
  }
}

function envelope(
  client: AliyunDriveOAuthClient,
  expiresAt: number,
  overrides: Partial<AliyunDriveAuthorizationEnvelope> = {}
): AliyunDriveAuthorizationEnvelope {
  return parseAliyunDriveAuthorizationEnvelope(
    client.mode === 'self-hosted-public'
      ? {
          schemaVersion: 1,
          grantType: 'access-grant',
          subject: 'user-1',
          authorizationVersion: AUTHORIZATION_VERSION,
          oauthClient: client,
          accessToken: 'access-old',
          accessExpiresAt: expiresAt,
          ...overrides
        }
      : {
          schemaVersion: 1,
          grantType: 'refresh-grant',
          subject: 'user-1',
          authorizationVersion: AUTHORIZATION_VERSION,
          oauthClient: client,
          refreshToken: 'refresh-old',
          accessToken: 'access-old',
          accessExpiresAt: expiresAt,
          ...overrides
        }
  )
}

function metadata(value: AliyunDriveAuthorizationEnvelope): AliyunDriveOAuthPublicMetadata {
  const common = {
    schemaVersion: 1,
    profileId: 'default',
    subject: value.subject,
    authorizationVersion: value.authorizationVersion,
    oauthClient: aliyunDriveOAuthClientPublic(value.oauthClient)
  } as const
  return parseAliyunDriveOAuthPublicMetadata(
    value.grantType === 'access-grant'
      ? { ...common, grantType: 'access-grant', accessExpiresAt: value.accessExpiresAt }
      : { ...common, grantType: 'refresh-grant' }
  )
}

function nativeBridge(overrides: Partial<AliyunDriveNativeBridge> = {}): AliyunDriveNativeBridge {
  return {
    authorize: () => Promise.reject(new Error('not implemented')),
    refresh: () => Promise.reject(new Error('not implemented')),
    ...overrides
  }
}

function refreshResult(overrides: Partial<AliyunDriveNativeRefreshResult> = {}) {
  return {
    grantType: 'refresh-grant' as const,
    accessToken: 'access-new',
    refreshToken: 'refresh-new',
    expiresIn: 7_200,
    grantedScopes: SCOPES,
    subject: 'user-1',
    ...overrides
  }
}

describe('Aliyun Drive OAuth runtime', () => {
  test('commits a rotated refresh token before returning its access token', async () => {
    const stored = envelope(CONFIDENTIAL_CLIENT, NOW - 1)
    const vault: MemoryVault = {
      value: serializeAliyunDriveAuthorizationEnvelope(stored),
      status: 'configured',
      sets: []
    }
    const service = credentials(vault)
    const publicStore = metadataStore(metadata(stored))
    const events: string[] = []
    vault.onSet = () => events.push('credential-set')
    const runtime = createAliyunDriveOAuthRuntime({
      profileId: 'default',
      ...service,
      metadataStore: publicStore.store,
      native: nativeBridge({
        refresh(request) {
          events.push(`native:${request.oauthClient.mode}`)
          return Promise.resolve(refreshResult())
        }
      }),
      now: () => NOW
    })

    const token = await runtime.resolveAccessToken()
    events.push('returned')

    expect(token).toEqual({
      accessToken: 'access-new',
      authority: { accountId: 'user-1', authorizationVersion: AUTHORIZATION_VERSION }
    })
    expect(events).toEqual(['native:self-hosted-confidential', 'credential-set', 'returned'])
    expect(parseAliyunDriveAuthorizationEnvelopeJSON(vault.value ?? '').refreshToken).toBe(
      'refresh-new'
    )
  })

  test('accepts an exact rotated-token readback when the credential write throws after committing', async () => {
    const stored = envelope(CONFIDENTIAL_CLIENT, NOW - 1)
    const vault: MemoryVault = {
      value: serializeAliyunDriveAuthorizationEnvelope(stored),
      status: 'configured',
      sets: []
    }
    const service = credentials(vault)
    const manager: CredentialManager = {
      ...service.manager,
      async set(reference, value) {
        await service.manager.set(reference, value)
        throw new Error('credential write result was lost')
      }
    }
    let refreshCalls = 0
    const runtime = createAliyunDriveOAuthRuntime({
      profileId: 'default',
      ...service,
      manager,
      metadataStore: metadataStore(metadata(stored)).store,
      native: nativeBridge({
        refresh() {
          refreshCalls += 1
          return Promise.resolve(refreshResult())
        }
      }),
      now: () => NOW
    })

    await expect(runtime.resolveAccessToken()).resolves.toMatchObject({ accessToken: 'access-new' })
    expect(refreshCalls).toBe(1)
    expect(vault.sets).toHaveLength(1)
    expect(parseAliyunDriveAuthorizationEnvelopeJSON(vault.value ?? '').refreshToken).toBe(
      'refresh-new'
    )
  })

  test('fails closed without restoring a consumed refresh token when the write did not commit', async () => {
    const stored = envelope(CONFIDENTIAL_CLIENT, NOW - 1)
    const previousRaw = serializeAliyunDriveAuthorizationEnvelope(stored)
    const vault: MemoryVault = { value: previousRaw, status: 'configured', sets: [] }
    const service = credentials(vault)
    const manager: CredentialManager = {
      ...service.manager,
      set(_reference, value) {
        vault.sets.push(value)
        return Promise.reject(new Error('credential write failed before commit'))
      }
    }
    let refreshCalls = 0
    const runtime = createAliyunDriveOAuthRuntime({
      profileId: 'default',
      ...service,
      manager,
      metadataStore: metadataStore(metadata(stored)).store,
      native: nativeBridge({
        refresh() {
          refreshCalls += 1
          return Promise.resolve(refreshResult())
        }
      }),
      now: () => NOW
    })

    await expect(runtime.resolveAccessToken()).rejects.toMatchObject<
      Partial<AliyunDriveOAuthError>
    >({ code: 'persistence-failed' })
    await expect(runtime.resolveAccessToken()).rejects.toMatchObject<
      Partial<AliyunDriveOAuthError>
    >({ code: 'persistence-failed' })
    expect(refreshCalls).toBe(1)
    expect(vault.value).toBe(previousRaw)
    expect(vault.sets).toHaveLength(1)
    expect(vault.sets).not.toContain(previousRaw)
  })

  test('keeps a sticky failure and never rolls back after a rotated-token readback mismatch', async () => {
    const stored = envelope(CONFIDENTIAL_CLIENT, NOW - 1)
    const vault: MemoryVault = {
      value: serializeAliyunDriveAuthorizationEnvelope(stored),
      status: 'configured',
      sets: [],
      onResolve: (value) => (value?.includes('refresh-new') ? 'corrupt-readback' : value)
    }
    const service = credentials(vault)
    let refreshCalls = 0
    const runtime = createAliyunDriveOAuthRuntime({
      profileId: 'default',
      ...service,
      metadataStore: metadataStore(metadata(stored)).store,
      native: nativeBridge({
        refresh() {
          refreshCalls += 1
          return Promise.resolve(refreshResult())
        }
      }),
      now: () => NOW
    })

    await expect(runtime.resolveAccessToken()).rejects.toMatchObject<
      Partial<AliyunDriveOAuthError>
    >({ code: 'persistence-failed' })
    await expect(runtime.resolveAccessToken()).rejects.toMatchObject({
      code: 'persistence-failed'
    })
    await expect(runtime.getAuthority()).rejects.toMatchObject({ code: 'persistence-failed' })
    expect(refreshCalls).toBe(1)
    expect(vault.sets).toHaveLength(1)
    expect(parseAliyunDriveAuthorizationEnvelopeJSON(vault.value ?? '').refreshToken).toBe(
      'refresh-new'
    )
  })

  test('keeps a sticky failure when rotated-token readback becomes locked', async () => {
    const stored = envelope(CONFIDENTIAL_CLIENT, NOW - 1)
    const vault: MemoryVault = {
      value: serializeAliyunDriveAuthorizationEnvelope(stored),
      status: 'configured',
      sets: [],
      onResolve(value) {
        if (value?.includes('refresh-new')) {
          throw new CredentialStoreError('locked', 'credential store locked during readback')
        }
        return value
      }
    }
    const service = credentials(vault)
    let refreshCalls = 0
    const runtime = createAliyunDriveOAuthRuntime({
      profileId: 'default',
      ...service,
      metadataStore: metadataStore(metadata(stored)).store,
      native: nativeBridge({
        refresh() {
          refreshCalls += 1
          return Promise.resolve(refreshResult())
        }
      }),
      now: () => NOW
    })

    await expect(runtime.resolveAccessToken()).rejects.toMatchObject({
      code: 'persistence-failed'
    })
    await expect(runtime.resolveAccessToken()).rejects.toMatchObject({
      code: 'persistence-failed'
    })
    expect(refreshCalls).toBe(1)
    expect(vault.sets).toHaveLength(1)
    expect(parseAliyunDriveAuthorizationEnvelopeJSON(vault.value ?? '').refreshToken).toBe(
      'refresh-new'
    )
  })

  test('does not reuse a refresh token after native returns an unrotated grant', async () => {
    const stored = envelope(CONFIDENTIAL_CLIENT, NOW - 1)
    const vault: MemoryVault = {
      value: serializeAliyunDriveAuthorizationEnvelope(stored),
      status: 'configured',
      sets: []
    }
    let refreshCalls = 0
    const runtime = createAliyunDriveOAuthRuntime({
      profileId: 'default',
      ...credentials(vault),
      metadataStore: metadataStore(metadata(stored)).store,
      native: nativeBridge({
        refresh() {
          refreshCalls += 1
          return Promise.resolve(refreshResult({ refreshToken: 'refresh-old' }))
        }
      }),
      now: () => NOW
    })

    await expect(runtime.resolveAccessToken()).rejects.toMatchObject({
      code: 'token-response-invalid'
    })
    await expect(runtime.resolveAccessToken()).rejects.toMatchObject({
      code: 'token-response-invalid'
    })
    expect(refreshCalls).toBe(1)
    expect(vault.sets).toHaveLength(0)
  })

  test('never refreshes an access-only public grant and requires reconnect after expiry', async () => {
    let refreshCalls = 0
    const stored = envelope(PUBLIC_CLIENT, NOW + 120_000)
    const vault: MemoryVault = {
      value: serializeAliyunDriveAuthorizationEnvelope(stored),
      status: 'configured',
      sets: []
    }
    const service = credentials(vault)
    const runtime = createAliyunDriveOAuthRuntime({
      profileId: 'default',
      ...service,
      metadataStore: metadataStore(metadata(stored)).store,
      native: nativeBridge({
        refresh() {
          refreshCalls += 1
          return Promise.resolve(refreshResult())
        }
      }),
      now: () => NOW
    })

    await expect(runtime.resolveAccessToken()).resolves.toMatchObject({ accessToken: 'access-old' })
    const expired = envelope(PUBLIC_CLIENT, NOW)
    vault.value = serializeAliyunDriveAuthorizationEnvelope(expired)
    const expiredMetadata = metadata(expired)
    const expiredRuntime = createAliyunDriveOAuthRuntime({
      profileId: 'default',
      ...service,
      metadataStore: metadataStore(expiredMetadata).store,
      native: nativeBridge({
        refresh() {
          refreshCalls += 1
          return Promise.resolve(refreshResult())
        }
      }),
      now: () => NOW
    })
    await expect(expiredRuntime.resolveAccessToken()).rejects.toMatchObject<
      Partial<AliyunDriveOAuthError>
    >({ code: 'reconnect-required' })
    expect(refreshCalls).toBe(0)
  })

  test('reports locked and unavailable credential stores without native calls', async () => {
    for (const state of ['locked', 'unavailable'] as const) {
      let refreshCalls = 0
      const vault: MemoryVault = { value: null, status: state, sets: [] }
      const runtime = createAliyunDriveOAuthRuntime({
        profileId: 'default',
        ...credentials(vault),
        metadataStore: metadataStore().store,
        native: nativeBridge({
          refresh() {
            refreshCalls += 1
            return Promise.resolve(refreshResult())
          }
        })
      })
      await expect(runtime.resolveAccessToken()).rejects.toMatchObject({
        code: state === 'locked' ? 'credential-locked' : 'credential-unavailable'
      })
      expect(refreshCalls).toBe(0)
    }
  })

  test('uses the stored mode once and never falls back after native refresh failure', async () => {
    const stored = envelope(CONFIDENTIAL_CLIENT, NOW - 1)
    const vault: MemoryVault = {
      value: serializeAliyunDriveAuthorizationEnvelope(stored),
      status: 'configured',
      sets: []
    }
    const modes: string[] = []
    const runtime = createAliyunDriveOAuthRuntime({
      profileId: 'default',
      ...credentials(vault),
      metadataStore: metadataStore(metadata(stored)).store,
      native: nativeBridge({
        refresh(request) {
          modes.push(request.oauthClient.mode)
          return Promise.reject(new Error('offline'))
        }
      }),
      now: () => NOW
    })

    await expect(runtime.resolveAccessToken()).rejects.toMatchObject({ code: 'native-failed' })
    expect(modes).toEqual(['self-hosted-confidential'])
  })
})

describe('Aliyun Drive OAuth session', () => {
  test('recovers a sticky rotation failure only after reconnect durably replaces the grant', async () => {
    const stored = envelope(CONFIDENTIAL_CLIENT, NOW - 1)
    const vault: MemoryVault = {
      value: serializeAliyunDriveAuthorizationEnvelope(stored),
      status: 'configured',
      sets: []
    }
    let corruptRotatedReadback = true
    vault.onResolve = (value) => {
      if (corruptRotatedReadback && value?.includes('refresh-new')) {
        corruptRotatedReadback = false
        return 'corrupt-readback'
      }
      return value
    }
    const publicStore = metadataStore(metadata(stored))
    let refreshCalls = 0
    let authorizeCalls = 0
    const session = createAliyunDriveOAuthSession({
      profileId: 'default',
      ...credentials(vault),
      metadataStore: publicStore.store,
      native: nativeBridge({
        refresh() {
          refreshCalls += 1
          return Promise.resolve(refreshResult())
        },
        authorize() {
          authorizeCalls += 1
          return Promise.resolve(
            refreshResult({
              accessToken: 'access-reconnected',
              refreshToken: 'refresh-reconnected'
            })
          )
        }
      }),
      now: () => NOW,
      randomAuthorizationVersion: () => 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    })

    await expect(session.getAccessToken()).rejects.toMatchObject({
      code: 'persistence-failed'
    })
    await expect(session.getAccessToken()).rejects.toMatchObject({
      code: 'persistence-failed'
    })
    expect(refreshCalls).toBe(1)

    await expect(session.connect({ oauthClient: CONFIDENTIAL_CLIENT })).resolves.toMatchObject({
      authorizationVersion: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    })
    await expect(session.getAccessToken()).resolves.toMatchObject({
      accessToken: 'access-reconnected'
    })
    expect(authorizeCalls).toBe(1)
    expect(refreshCalls).toBe(1)
  })

  test('clears a sticky rotation failure after an explicit durable disconnect', async () => {
    const stored = envelope(CONFIDENTIAL_CLIENT, NOW - 1)
    const vault: MemoryVault = {
      value: serializeAliyunDriveAuthorizationEnvelope(stored),
      status: 'configured',
      sets: [],
      onResolve: (value) => (value?.includes('refresh-new') ? 'corrupt-readback' : value)
    }
    const publicStore = metadataStore(metadata(stored))
    let refreshCalls = 0
    const session = createAliyunDriveOAuthSession({
      profileId: 'default',
      ...credentials(vault),
      metadataStore: publicStore.store,
      native: nativeBridge({
        refresh() {
          refreshCalls += 1
          return Promise.resolve(refreshResult())
        }
      }),
      now: () => NOW
    })

    await expect(session.getAccessToken()).rejects.toMatchObject({
      code: 'persistence-failed'
    })
    await session.disconnect()

    expect(vault.value).toBeNull()
    expect(publicStore.current()).toBeNull()
    await expect(session.getAccessToken()).rejects.toMatchObject({
      code: 'credential-missing'
    })
    expect(refreshCalls).toBe(1)
  })

  test('uses build-owned publisher Broker identity and persists a refresh grant', async () => {
    const vault: MemoryVault = { value: null, status: 'missing', sets: [] }
    const service = credentials(vault)
    const publicStore = metadataStore()
    const requests: AliyunDriveNativeAuthorizeRequest[] = []
    const session = createAliyunDriveOAuthSession({
      profileId: 'default',
      publisherConfig: {
        clientId: 'aliyun-publisher-123'
      },
      ...service,
      metadataStore: publicStore.store,
      native: nativeBridge({
        authorize(request) {
          requests.push(request)
          return Promise.resolve({
            ...refreshResult(),
            email: 'person@example.com'
          })
        }
      }),
      now: () => NOW,
      randomAuthorizationVersion: () => AUTHORIZATION_VERSION
    })

    const connected = await session.connect()

    expect(requests[0]?.oauthClient).toEqual({ mode: 'publisher-broker-confidential' })
    expect(connected).toMatchObject({
      subject: 'user-1',
      authorizationVersion: AUTHORIZATION_VERSION,
      grantType: 'refresh-grant',
      oauthClient: {
        mode: 'publisher-broker-confidential',
        clientId: 'aliyun-publisher-123'
      }
    })
    const stored = parseAliyunDriveAuthorizationEnvelopeJSON(vault.value ?? '')
    expect(stored.oauthClient).toEqual({
      mode: 'publisher-broker-confidential',
      clientId: 'aliyun-publisher-123'
    })
    expect(JSON.stringify(publicStore.current())).not.toContain('broker.example')
    expect(JSON.stringify(publicStore.current())).not.toContain('refresh-new')
  })

  test('persists self-hosted public PKCE as access-only with its expiry', async () => {
    const vault: MemoryVault = { value: null, status: 'missing', sets: [] }
    const publicStore = metadataStore()
    let request: AliyunDriveNativeAuthorizeRequest | null = null
    const session = createAliyunDriveOAuthSession({
      profileId: 'default',
      ...credentials(vault),
      metadataStore: publicStore.store,
      native: nativeBridge({
        authorize(value) {
          request = value
          const result: AliyunDriveNativeAuthorizeResult = {
            grantType: 'access-grant',
            accessToken: 'public-access',
            expiresIn: 30 * 24 * 60 * 60,
            grantedScopes: SCOPES,
            subject: 'user-public'
          }
          return Promise.resolve(result)
        }
      }),
      now: () => NOW,
      randomAuthorizationVersion: () => AUTHORIZATION_VERSION
    })

    const connected = await session.connect({ oauthClient: PUBLIC_CLIENT })

    expect(request?.oauthClient).toEqual(PUBLIC_CLIENT)
    expect(connected.grantType).toBe('access-grant')
    expect(connected.accessExpiresAt).toBe(NOW + 30 * 24 * 60 * 60 * 1_000)
    expect(parseAliyunDriveAuthorizationEnvelopeJSON(vault.value ?? '').grantType).toBe(
      'access-grant'
    )
    expect(publicStore.current()).toMatchObject({
      grantType: 'access-grant',
      accessExpiresAt: connected.accessExpiresAt
    })
  })

  test('rejects a grant class mismatch without falling back or persisting', async () => {
    const vault: MemoryVault = { value: null, status: 'missing', sets: [] }
    let authorizeCalls = 0
    const session = createAliyunDriveOAuthSession({
      profileId: 'default',
      ...credentials(vault),
      metadataStore: metadataStore().store,
      native: nativeBridge({
        authorize() {
          authorizeCalls += 1
          return Promise.resolve({
            grantType: 'access-grant',
            accessToken: 'wrong-class',
            expiresIn: 3_600,
            grantedScopes: SCOPES,
            subject: 'user-1'
          })
        }
      }),
      now: () => NOW,
      randomAuthorizationVersion: () => AUTHORIZATION_VERSION
    })

    await expect(session.connect({ oauthClient: CONFIDENTIAL_CLIENT })).rejects.toMatchObject({
      code: 'invalid-client'
    })
    expect(authorizeCalls).toBe(1)
    expect(vault.value).toBeNull()
  })

  test('surfaces locked and unavailable status explicitly', async () => {
    for (const state of ['locked', 'unavailable'] as const) {
      const session = createAliyunDriveOAuthSession({
        profileId: 'default',
        ...credentials({ value: null, status: state, sets: [] }),
        metadataStore: metadataStore().store,
        native: nativeBridge()
      })
      await expect(session.status()).resolves.toEqual({ state, profileId: 'default' })
    }
  })
})
