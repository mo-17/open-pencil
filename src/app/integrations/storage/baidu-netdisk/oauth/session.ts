/* oxlint-disable eslint/max-lines -- One session owns strict mode isolation, durable grant replacement, and single-use refresh rotation. */

import { randomHex } from '@open-pencil/core/random'

import type { StorageDocumentAuthority } from '@/app/integrations/storage/types'
import { credentialRef } from '@/app/settings/credentials/reference'
import {
  CredentialStoreError,
  type CredentialManager,
  type CredentialResolver
} from '@/app/settings/credentials/types'
import type {
  BaiduNetdiskNativeAuthorizeResult,
  BaiduNetdiskNativeBridge,
  BaiduNetdiskNativeOAuthClient,
  BaiduNetdiskNativeRefreshResult
} from '@/app/tauri/baidu-netdisk'

import type { BaiduNetdiskPublisherOAuthConfig } from '../config'
import type { BaiduNetdiskAccessToken } from '../types'
import { parseBaiduNetdiskSelfHostedCredentialsJSON } from './credentials'
import {
  baiduNetdiskAccountLabel,
  baiduNetdiskOAuthClientPublic,
  baiduNetdiskOAuthPublicClientsEqual,
  BAIDU_NETDISK_OAUTH_SCOPES,
  hasExactBaiduNetdiskOAuthScopes,
  isBaiduNetdiskUk,
  parseBaiduNetdiskOAuthClient,
  parseBaiduNetdiskOAuthPublicMetadata,
  parseBaiduNetdiskRefreshTokenEnvelope,
  parseBaiduNetdiskRefreshTokenEnvelopeJSON,
  serializeBaiduNetdiskRefreshTokenEnvelope,
  type BaiduNetdiskOAuthClient,
  type BaiduNetdiskOAuthPublicMetadata,
  type BaiduNetdiskRefreshTokenEnvelope
} from './envelope'
import {
  LocalBaiduNetdiskOAuthMetadataStore,
  type BaiduNetdiskOAuthMetadataStore
} from './metadata'

const BAIDU_NETDISK_INTEGRATION_ID = 'baidu-netdisk'
const BAIDU_NETDISK_REFRESH_TOKEN_FIELD = 'refresh-token'
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000
const MAX_ACCESS_TOKEN_BYTES = 32 * 1024
const AUTHORIZE_TIMEOUT_MS = 300_000
const REFRESH_TIMEOUT_MS = 30_000

export type BaiduNetdiskOAuthErrorCode =
  | 'unsupported'
  | 'cancelled'
  | 'setup-required'
  | 'self-hosted-credentials-required'
  | 'invalid-profile'
  | 'busy'
  | 'credential-locked'
  | 'credential-unavailable'
  | 'credential-missing'
  | 'credential-invalid'
  | 'metadata-invalid'
  | 'inconsistent-state'
  | 'profile-account-mismatch'
  | 'authorization-denied'
  | 'authorization-timeout'
  | 'oauth-client-invalid'
  | 'authorization-grant-invalid'
  | 'device-code-expired'
  | 'token-request-invalid'
  | 'browser-open-failed'
  | 'network-failed'
  | 'rate-limited'
  | 'oauth-broker-unavailable'
  | 'token-exchange-failed'
  | 'token-response-invalid'
  | 'userinfo-failed'
  | 'scope-mismatch'
  | 'uk-mismatch'
  | 'persistence-failed'
  | 'native-failed'

type BaiduNetdiskOAuthErrorOptions = ErrorOptions & { retryAfterMs?: number }

export class BaiduNetdiskOAuthError extends Error {
  readonly retryAfterMs: number | undefined

  constructor(
    readonly code: BaiduNetdiskOAuthErrorCode,
    message: string,
    options?: BaiduNetdiskOAuthErrorOptions
  ) {
    super(message, options)
    this.name = 'BaiduNetdiskOAuthError'
    const retryAfterMs = options?.retryAfterMs
    this.retryAfterMs =
      Number.isSafeInteger(retryAfterMs) &&
      (retryAfterMs as number) > 0 &&
      (retryAfterMs as number) <= 300_000
        ? retryAfterMs
        : undefined
  }
}

class BaiduNetdiskOAuthCommitOutcomeUnverifiedError extends Error {
  constructor(readonly failure: BaiduNetdiskOAuthError) {
    super(failure.message)
    this.name = 'BaiduNetdiskOAuthCommitOutcomeUnverifiedError'
  }
}

export function baiduNetdiskSingleAccountId(
  authorities: readonly StorageDocumentAuthority[]
): string | undefined {
  const accountIds = new Set(authorities.map((authority) => authority.accountId))
  if (accountIds.size > 1) {
    throw new BaiduNetdiskOAuthError(
      'inconsistent-state',
      'Baidu Netdisk profile contains durable work for multiple accounts'
    )
  }
  return accountIds.values().next().value
}

export type BaiduNetdiskOAuthConnection = Readonly<{
  profileId: string
  uk: string
  baiduName?: string
  netdiskName?: string
  accountLabel: string
  clientMode: BaiduNetdiskOAuthClient['mode']
  authorizationVersion: string
  authority: StorageDocumentAuthority
  grantedScopes: typeof BAIDU_NETDISK_OAUTH_SCOPES
}>

export type BaiduNetdiskOAuthRepairAuthority = Readonly<{
  uk: string
  authorizationVersion: string
}>

export type BaiduNetdiskOAuthConnectResult = BaiduNetdiskOAuthConnection &
  Readonly<{ replacedAuthorities: readonly BaiduNetdiskOAuthRepairAuthority[] }>

export type BaiduNetdiskOAuthStatus =
  | { state: 'unsupported'; profileId: string }
  | { state: 'missing'; profileId: string }
  | { state: 'locked'; profileId: string }
  | { state: 'unavailable'; profileId: string }
  | {
      state: 'invalid'
      profileId: string
      reason:
        | 'metadata-invalid'
        | 'metadata-missing'
        | 'credential-missing'
        | 'credential-invalid'
        | 'authority-mismatch'
        | 'publisher-setup-missing'
    }
  | ({ state: 'connected' } & BaiduNetdiskOAuthConnection)

export type BaiduNetdiskOAuthAccessToken = BaiduNetdiskAccessToken & Readonly<{ expiresAt: number }>

export type BaiduNetdiskDisconnectResult = Readonly<{
  outcome: 'disconnected'
  localOnly: true
}>

type BaiduNetdiskOAuthConnectCommon = Readonly<{
  signal?: AbortSignal
  /** Durable work can constrain reconnect even when one OAuth record was lost. */
  expectedUk?: string
  /** Marks the final metadata write as the non-cancellable local commit point. */
  onCommitStart?: () => void
}>

export type BaiduNetdiskOAuthConnectOptions = BaiduNetdiskOAuthConnectCommon &
  (
    | Readonly<{ mode: 'publisher-broker' }>
    | Readonly<{ mode: 'self-hosted'; credentialsJSON: string }>
  )

export type CreateBaiduNetdiskOAuthSessionOptions = Readonly<{
  publisherConfig: BaiduNetdiskPublisherOAuthConfig | null
  profileId: string
  manager: CredentialManager
  resolver: CredentialResolver
  metadataStore?: BaiduNetdiskOAuthMetadataStore
  native?: BaiduNetdiskNativeBridge
  now?: () => number
  randomAuthorizationVersion?: () => string
}>

type MetadataObservation =
  | { state: 'valid'; value: BaiduNetdiskOAuthPublicMetadata }
  | { state: 'missing' }
  | { state: 'invalid' }

type RefreshObservation =
  | { state: 'valid'; value: BaiduNetdiskRefreshTokenEnvelope }
  | { state: 'missing' }
  | { state: 'invalid' }
  | { state: 'locked' }
  | { state: 'unavailable' }

type PreviousAuthorization = Readonly<{
  rawCredential: string | null
  metadata: BaiduNetdiskOAuthPublicMetadata | null
  refresh: BaiduNetdiskRefreshTokenEnvelope | null
}>

type StoredAuthority = Readonly<{
  metadata: BaiduNetdiskOAuthPublicMetadata
  refresh: BaiduNetdiskRefreshTokenEnvelope
}>

type ReplacementAuthorization = Readonly<{
  result: BaiduNetdiskNativeAuthorizeResult
  metadata: BaiduNetdiskOAuthPublicMetadata
  refresh: BaiduNetdiskRefreshTokenEnvelope
  token: BaiduNetdiskOAuthAccessToken
}>

function randomAuthorizationVersion(): string {
  return randomHex(16)
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function validAccessToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    utf8Bytes(value) > 0 &&
    utf8Bytes(value) <= MAX_ACCESS_TOKEN_BYTES &&
    value.trim() === value &&
    !/\s/u.test(value) &&
    !/\p{Cc}/u.test(value)
  )
}

function validExpiry(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 31_536_000
}

function ownValue(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function nativeCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code = ownValue(error, 'code')
  return typeof code === 'string' ? code : null
}

function nativeRetryAfterMs(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const value = ownValue(error, 'retryAfterMs')
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 300_000
    ? (value as number)
    : undefined
}

function nativeFailure(error: unknown): BaiduNetdiskOAuthError {
  if (error instanceof BaiduNetdiskOAuthError) return error
  if (
    (error instanceof Error && error.name === 'AbortError') ||
    nativeCode(error) === 'cancelled'
  ) {
    return new BaiduNetdiskOAuthError('cancelled', 'Baidu authorization was cancelled', {
      cause: error
    })
  }
  const codeByNativeCode: Readonly<Partial<Record<string, BaiduNetdiskOAuthErrorCode>>> = {
    'oauth-denied': 'authorization-denied',
    timeout: 'authorization-timeout',
    'oauth-client-invalid': 'oauth-client-invalid',
    'authorization-grant-invalid': 'authorization-grant-invalid',
    'device-code-expired': 'device-code-expired',
    'token-request-invalid': 'token-request-invalid',
    'browser-open-failed': 'browser-open-failed',
    'network-failed': 'network-failed',
    'rate-limited': 'rate-limited',
    'broker-unavailable': 'oauth-broker-unavailable',
    'token-exchange-failed': 'token-exchange-failed',
    'token-response-invalid': 'token-response-invalid',
    'userinfo-failed': 'userinfo-failed',
    'scope-mismatch': 'scope-mismatch',
    'account-mismatch': 'uk-mismatch'
  }
  const mapped = nativeCode(error)
  const code = mapped ? codeByNativeCode[mapped] : undefined
  if (!code) {
    return new BaiduNetdiskOAuthError('native-failed', 'Baidu native authorization failed', {
      cause: error
    })
  }
  const retryAfterMs = code === 'rate-limited' ? nativeRetryAfterMs(error) : undefined
  return new BaiduNetdiskOAuthError(
    code,
    error instanceof Error ? error.message : 'Baidu native authorization failed',
    retryAfterMs === undefined ? { cause: error } : { cause: error, retryAfterMs }
  )
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new BaiduNetdiskOAuthError('cancelled', 'Baidu authorization was cancelled', {
    cause: signal.reason
  })
}

function waitForSignal<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(
        new BaiduNetdiskOAuthError('cancelled', 'Baidu authorization was cancelled', {
          cause: signal.reason
        })
      )
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void pending.then(
      (value) => {
        cleanup()
        resolve(value)
        return undefined
      },
      (error) => {
        cleanup()
        reject(error instanceof Error ? error : nativeFailure(error))
        return undefined
      }
    )
  })
}

function nativeOAuthClient(client: BaiduNetdiskOAuthClient): BaiduNetdiskNativeOAuthClient {
  return client.mode === 'publisher-broker'
    ? Object.freeze({ mode: 'publisher-broker' })
    : Object.freeze({
        mode: 'self-hosted',
        appKey: client.appKey,
        secretKey: client.secretKey
      })
}

function publisherOAuthClient(
  config: BaiduNetdiskPublisherOAuthConfig | null
): BaiduNetdiskOAuthClient | null {
  if (!config) return null
  try {
    return parseBaiduNetdiskOAuthClient({ mode: 'publisher-broker', ...config })
  } catch {
    return null
  }
}

function connection(metadata: BaiduNetdiskOAuthPublicMetadata): BaiduNetdiskOAuthConnection {
  return Object.freeze({
    profileId: metadata.profileId,
    uk: metadata.uk,
    ...(metadata.baiduName ? { baiduName: metadata.baiduName } : {}),
    ...(metadata.netdiskName ? { netdiskName: metadata.netdiskName } : {}),
    accountLabel: baiduNetdiskAccountLabel(metadata),
    clientMode: metadata.oauthClient.mode,
    authorizationVersion: metadata.authorizationVersion,
    authority: Object.freeze({
      accountId: metadata.uk,
      authorizationVersion: metadata.authorizationVersion
    }),
    grantedScopes: BAIDU_NETDISK_OAUTH_SCOPES
  })
}

function durableAuthorities(
  ...values: readonly (BaiduNetdiskOAuthPublicMetadata | BaiduNetdiskRefreshTokenEnvelope | null)[]
): readonly BaiduNetdiskOAuthRepairAuthority[] {
  const authorities = new Map<string, BaiduNetdiskOAuthRepairAuthority>()
  for (const value of values) {
    if (!value) continue
    const authority = Object.freeze({
      uk: value.uk,
      authorizationVersion: value.authorizationVersion
    })
    authorities.set(`${authority.uk}\u0000${authority.authorizationVersion}`, authority)
  }
  return Object.freeze([...authorities.values()])
}

function accessToken(
  result: Pick<BaiduNetdiskNativeAuthorizeResult, 'accessToken' | 'expiresIn' | 'uk'>,
  authority: Pick<BaiduNetdiskOAuthPublicMetadata, 'uk' | 'authorizationVersion'>,
  now: number
): BaiduNetdiskOAuthAccessToken {
  if (!validAccessToken(result.accessToken) || !validExpiry(result.expiresIn)) {
    throw new BaiduNetdiskOAuthError(
      'token-response-invalid',
      'Baidu returned an invalid access token'
    )
  }
  if (!isBaiduNetdiskUk(result.uk) || result.uk !== authority.uk) {
    throw new BaiduNetdiskOAuthError(
      'uk-mismatch',
      'Baidu authorization belongs to a different account'
    )
  }
  return Object.freeze({
    accessToken: result.accessToken,
    expiresAt: now + result.expiresIn * 1_000,
    authority: Object.freeze({
      accountId: authority.uk,
      authorizationVersion: authority.authorizationVersion
    })
  })
}

function metadataFromAuthorization(
  profileId: string,
  authorizationVersion: string,
  result: BaiduNetdiskNativeAuthorizeResult,
  oauthClient: BaiduNetdiskOAuthClient
): BaiduNetdiskOAuthPublicMetadata {
  if (!hasExactBaiduNetdiskOAuthScopes(result.grantedScopes)) {
    throw new BaiduNetdiskOAuthError(
      'scope-mismatch',
      'Baidu did not grant the exact basic and netdisk scopes'
    )
  }
  try {
    return parseBaiduNetdiskOAuthPublicMetadata({
      schemaVersion: 1,
      profileId,
      uk: result.uk,
      ...(result.baiduName === undefined ? {} : { baiduName: result.baiduName }),
      ...(result.netdiskName === undefined ? {} : { netdiskName: result.netdiskName }),
      authorizationVersion,
      grantedScopes: BAIDU_NETDISK_OAUTH_SCOPES,
      oauthClient: baiduNetdiskOAuthClientPublic(oauthClient)
    })
  } catch (cause) {
    throw new BaiduNetdiskOAuthError(
      'token-response-invalid',
      'Baidu returned invalid account metadata',
      { cause }
    )
  }
}

function envelopeFromAuthorization(
  authorizationVersion: string,
  result: Pick<BaiduNetdiskNativeAuthorizeResult, 'refreshToken' | 'uk'>,
  oauthClient: BaiduNetdiskOAuthClient
): BaiduNetdiskRefreshTokenEnvelope {
  try {
    return parseBaiduNetdiskRefreshTokenEnvelope({
      schemaVersion: 1,
      refreshToken: result.refreshToken,
      oauthClient,
      uk: result.uk,
      authorizationVersion
    })
  } catch (cause) {
    throw new BaiduNetdiskOAuthError(
      'token-response-invalid',
      'Baidu returned an invalid refresh token',
      { cause }
    )
  }
}

function stagedAuthorizationVersion(finalVersion: string, previous: PreviousAuthorization): string {
  const blocked = new Set([
    finalVersion,
    previous.metadata?.authorizationVersion,
    previous.refresh?.authorizationVersion
  ])
  for (const prefix of '0123456789abcdef') {
    const candidate = `${prefix}${finalVersion.slice(1)}`
    if (!blocked.has(candidate)) return candidate
  }
  throw new BaiduNetdiskOAuthError(
    'persistence-failed',
    'Baidu authorization staging could not be created'
  )
}

export function baiduNetdiskRefreshTokenCredentialRef(profileId: string) {
  try {
    return credentialRef(BAIDU_NETDISK_INTEGRATION_ID, BAIDU_NETDISK_REFRESH_TOKEN_FIELD, profileId)
  } catch (cause) {
    throw new BaiduNetdiskOAuthError('invalid-profile', 'Baidu profile ID is invalid', { cause })
  }
}

export function createBaiduNetdiskOAuthSession(options: CreateBaiduNetdiskOAuthSessionOptions) {
  const publisher = publisherOAuthClient(options.publisherConfig)
  const reference = baiduNetdiskRefreshTokenCredentialRef(options.profileId)
  const metadataStore = options.metadataStore ?? new LocalBaiduNetdiskOAuthMetadataStore()
  const now = options.now ?? Date.now
  const createVersion = options.randomAuthorizationVersion ?? randomAuthorizationVersion
  let cachedAccessToken: BaiduNetdiskOAuthAccessToken | null = null
  let refreshPromise: Promise<BaiduNetdiskOAuthAccessToken> | null = null
  let refreshController: AbortController | null = null
  let generation = 0
  let mutationInProgress = false
  let persistenceFailure: BaiduNetdiskOAuthError | null = null
  let disposed = false

  function requireNative(): BaiduNetdiskNativeBridge {
    if (disposed) {
      throw new BaiduNetdiskOAuthError('busy', 'Baidu authorization session was disposed')
    }
    if (!options.native) {
      throw new BaiduNetdiskOAuthError(
        'unsupported',
        'Baidu authorization is available only in the desktop app'
      )
    }
    return options.native
  }

  async function observeCredentialStatus(): Promise<
    'configured' | 'missing' | 'locked' | 'unavailable'
  > {
    try {
      return await options.manager.status(reference)
    } catch (cause) {
      return cause instanceof CredentialStoreError && cause.code === 'locked'
        ? 'locked'
        : 'unavailable'
    }
  }

  async function observeMetadata(): Promise<MetadataObservation> {
    try {
      const value = await metadataStore.read(options.profileId)
      return value ? { state: 'valid', value } : { state: 'missing' }
    } catch {
      return { state: 'invalid' }
    }
  }

  async function observeRefresh(): Promise<RefreshObservation> {
    let raw: string | null
    try {
      raw = await options.resolver.resolve(reference)
    } catch (cause) {
      if (cause instanceof CredentialStoreError && cause.code === 'locked') {
        return { state: 'locked' }
      }
      if (cause instanceof CredentialStoreError && cause.code === 'unavailable') {
        return { state: 'unavailable' }
      }
      return { state: 'invalid' }
    }
    if (!raw) return { state: 'missing' }
    try {
      return { state: 'valid', value: parseBaiduNetdiskRefreshTokenEnvelopeJSON(raw) }
    } catch {
      return { state: 'invalid' }
    }
  }

  function recordsMatch(
    metadata: BaiduNetdiskOAuthPublicMetadata,
    refresh: BaiduNetdiskRefreshTokenEnvelope
  ): boolean {
    if (
      metadata.uk !== refresh.uk ||
      metadata.authorizationVersion !== refresh.authorizationVersion ||
      !baiduNetdiskOAuthPublicClientsEqual(
        metadata.oauthClient,
        baiduNetdiskOAuthClientPublic(refresh.oauthClient)
      )
    ) {
      return false
    }
    if (refresh.oauthClient.mode !== 'publisher-broker') return true
    return (
      publisher !== null &&
      baiduNetdiskOAuthPublicClientsEqual(
        metadata.oauthClient,
        baiduNetdiskOAuthClientPublic(publisher)
      )
    )
  }

  async function status(): Promise<BaiduNetdiskOAuthStatus> {
    if (!options.native) return { state: 'unsupported', profileId: options.profileId }
    if (persistenceFailure) {
      return { state: 'invalid', profileId: options.profileId, reason: 'credential-invalid' }
    }
    const [credentialStatus, metadata] = await Promise.all([
      observeCredentialStatus(),
      observeMetadata()
    ])
    if (credentialStatus === 'locked') return { state: 'locked', profileId: options.profileId }
    if (credentialStatus === 'unavailable') {
      return { state: 'unavailable', profileId: options.profileId }
    }
    if (credentialStatus === 'missing') {
      if (metadata.state === 'missing') return { state: 'missing', profileId: options.profileId }
      return {
        state: 'invalid',
        profileId: options.profileId,
        reason: metadata.state === 'invalid' ? 'metadata-invalid' : 'credential-missing'
      }
    }
    const refresh = await observeRefresh()
    if (refresh.state === 'locked') return { state: 'locked', profileId: options.profileId }
    if (refresh.state === 'unavailable') {
      return { state: 'unavailable', profileId: options.profileId }
    }
    if (refresh.state === 'missing' || refresh.state === 'invalid') {
      return {
        state: 'invalid',
        profileId: options.profileId,
        reason: refresh.state === 'missing' ? 'credential-missing' : 'credential-invalid'
      }
    }
    if (metadata.state === 'missing') {
      return { state: 'invalid', profileId: options.profileId, reason: 'metadata-missing' }
    }
    if (metadata.state === 'invalid') {
      return { state: 'invalid', profileId: options.profileId, reason: 'metadata-invalid' }
    }
    if (refresh.value.oauthClient.mode === 'publisher-broker' && !publisher) {
      return {
        state: 'invalid',
        profileId: options.profileId,
        reason: 'publisher-setup-missing'
      }
    }
    if (!recordsMatch(metadata.value, refresh.value)) {
      return { state: 'invalid', profileId: options.profileId, reason: 'authority-mismatch' }
    }
    return { state: 'connected', ...connection(metadata.value) }
  }

  async function readStoredAuthority(): Promise<StoredAuthority> {
    requireNative()
    let metadata: BaiduNetdiskOAuthPublicMetadata | null
    try {
      metadata = await metadataStore.read(options.profileId)
    } catch (cause) {
      throw new BaiduNetdiskOAuthError(
        'metadata-invalid',
        'Stored Baidu account metadata is invalid',
        { cause }
      )
    }
    if (!metadata) {
      throw new BaiduNetdiskOAuthError(
        'inconsistent-state',
        'Baidu credential is missing account metadata'
      )
    }
    let raw: string | null
    try {
      raw = await options.resolver.resolve(reference)
    } catch (cause) {
      if (cause instanceof CredentialStoreError && cause.code === 'locked') {
        throw new BaiduNetdiskOAuthError('credential-locked', 'The credential store is locked', {
          cause
        })
      }
      throw new BaiduNetdiskOAuthError(
        'credential-unavailable',
        'The encrypted credential store is unavailable',
        { cause }
      )
    }
    if (!raw) throw new BaiduNetdiskOAuthError('credential-missing', 'Baidu credential is missing')
    let refresh: BaiduNetdiskRefreshTokenEnvelope
    try {
      refresh = parseBaiduNetdiskRefreshTokenEnvelopeJSON(raw)
    } catch (cause) {
      throw new BaiduNetdiskOAuthError('credential-invalid', 'Stored Baidu credential is invalid', {
        cause
      })
    }
    if (refresh.oauthClient.mode === 'publisher-broker' && !publisher) {
      throw new BaiduNetdiskOAuthError(
        'setup-required',
        'This build does not provide the saved Baidu publisher OAuth configuration'
      )
    }
    if (!recordsMatch(metadata, refresh)) {
      throw new BaiduNetdiskOAuthError(
        'inconsistent-state',
        'Baidu credential does not match its public account binding or configured mode'
      )
    }
    return { metadata, refresh }
  }

  async function previousAuthorization(expectedUk: string | null): Promise<PreviousAuthorization> {
    const credentialStatus = await observeCredentialStatus()
    if (credentialStatus === 'locked') {
      throw new BaiduNetdiskOAuthError('credential-locked', 'The credential store is locked')
    }
    if (credentialStatus === 'unavailable') {
      throw new BaiduNetdiskOAuthError(
        'credential-unavailable',
        'The encrypted credential store is unavailable'
      )
    }
    let metadata: BaiduNetdiskOAuthPublicMetadata | null = null
    try {
      metadata = await metadataStore.read(options.profileId)
    } catch {
      metadata = null
    }
    let rawCredential: string | null = null
    let refresh: BaiduNetdiskRefreshTokenEnvelope | null = null
    if (credentialStatus === 'configured') {
      try {
        rawCredential = await options.resolver.resolve(reference)
      } catch (cause) {
        if (cause instanceof CredentialStoreError && cause.code === 'locked') {
          throw new BaiduNetdiskOAuthError('credential-locked', 'The credential store is locked', {
            cause
          })
        }
        throw new BaiduNetdiskOAuthError(
          'credential-unavailable',
          'The encrypted credential store is unavailable',
          { cause }
        )
      }
      if (rawCredential) {
        try {
          refresh = parseBaiduNetdiskRefreshTokenEnvelopeJSON(rawCredential)
        } catch {
          refresh = null
        }
      }
    }
    if (metadata && refresh && metadata.uk !== refresh.uk) {
      throw new BaiduNetdiskOAuthError(
        'inconsistent-state',
        'Baidu credential belongs to a different account than its public binding'
      )
    }
    if ((rawCredential || metadata) && !expectedUk && !metadata?.uk && !refresh?.uk) {
      throw new BaiduNetdiskOAuthError(
        'inconsistent-state',
        'Baidu authorization has no trustworthy account identity'
      )
    }
    return { rawCredential, metadata, refresh }
  }

  function requestedOAuthClient(
    connectOptions: BaiduNetdiskOAuthConnectOptions
  ): BaiduNetdiskOAuthClient {
    if (connectOptions.mode === 'publisher-broker') {
      if (!publisher) {
        throw new BaiduNetdiskOAuthError(
          'setup-required',
          'This build does not provide the Baidu publisher AppKey and Broker origin'
        )
      }
      return publisher
    }
    try {
      return parseBaiduNetdiskSelfHostedCredentialsJSON(connectOptions.credentialsJSON)
    } catch (cause) {
      throw new BaiduNetdiskOAuthError(
        'self-hosted-credentials-required',
        'Import a valid Baidu appKey/secretKey credentials JSON file',
        { cause }
      )
    }
  }

  function beginMutation(): void {
    if (disposed) {
      throw new BaiduNetdiskOAuthError('busy', 'Baidu authorization session was disposed')
    }
    if (mutationInProgress) {
      throw new BaiduNetdiskOAuthError('busy', 'Baidu authorization is already changing')
    }
    // A successful Baidu refresh invalidates the predecessor. It must finish the durable write.
    if (refreshPromise || refreshController) {
      throw new BaiduNetdiskOAuthError('busy', 'Baidu access is currently being refreshed')
    }
    mutationInProgress = true
    generation++
    cachedAccessToken = null
  }

  async function observeReplacementPersistence(
    metadata: BaiduNetdiskOAuthPublicMetadata,
    serializedRefresh: string
  ): Promise<'committed' | 'not-committed' | 'unavailable'> {
    try {
      const [persistedMetadata, persistedRefresh] = await Promise.all([
        metadataStore.read(options.profileId),
        options.resolver.resolve(reference)
      ])
      return persistedRefresh === serializedRefresh &&
        persistedMetadata !== null &&
        JSON.stringify(persistedMetadata) === JSON.stringify(metadata)
        ? 'committed'
        : 'not-committed'
    } catch {
      return 'unavailable'
    }
  }

  async function persistReplacement(
    previous: PreviousAuthorization,
    replacement: ReplacementAuthorization,
    signal?: AbortSignal,
    onCommitStart?: () => void
  ): Promise<void> {
    const serialized = serializeBaiduNetdiskRefreshTokenEnvelope(replacement.refresh)
    const staged = parseBaiduNetdiskOAuthPublicMetadata({
      ...replacement.metadata,
      authorizationVersion: stagedAuthorizationVersion(
        replacement.metadata.authorizationVersion,
        previous
      )
    })
    let persistenceStarted = false
    try {
      throwIfAborted(signal)
      persistenceStarted = true
      await metadataStore.write(staged)
      throwIfAborted(signal)
      await options.manager.set(reference, serialized)
      throwIfAborted(signal)
      onCommitStart?.()
      try {
        await metadataStore.write(replacement.metadata)
      } catch (commitCause) {
        const observation = await observeReplacementPersistence(replacement.metadata, serialized)
        if (observation === 'not-committed') throw commitCause
        if (observation === 'unavailable') {
          const failure = new BaiduNetdiskOAuthError(
            'persistence-failed',
            'Baidu authorization storage outcome could not be verified',
            { cause: commitCause }
          )
          throw new BaiduNetdiskOAuthCommitOutcomeUnverifiedError(failure)
        }
      }
    } catch (cause) {
      if (cause instanceof BaiduNetdiskOAuthCommitOutcomeUnverifiedError) {
        persistenceFailure = cause.failure
        throw cause.failure
      }
      if (!persistenceStarted) throw cause
      const rollbackErrors: unknown[] = []
      try {
        if (previous.rawCredential) await options.manager.set(reference, previous.rawCredential)
        else await options.manager.clear(reference)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      try {
        if (previous.metadata) await metadataStore.write(previous.metadata)
        else await metadataStore.remove(options.profileId)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      if (
        rollbackErrors.length === 0 &&
        cause instanceof BaiduNetdiskOAuthError &&
        cause.code === 'cancelled'
      ) {
        throw cause
      }
      const failure = new BaiduNetdiskOAuthError(
        'persistence-failed',
        rollbackErrors.length === 0
          ? 'Baidu authorization could not be stored'
          : 'Baidu authorization could not be stored or safely rolled back',
        {
          cause:
            rollbackErrors.length === 0
              ? cause
              : new AggregateError(
                  [cause, ...rollbackErrors],
                  'Baidu authorization persistence and rollback failed'
                )
        }
      )
      if (rollbackErrors.length > 0) persistenceFailure = failure
      throw failure
    }
    persistenceFailure = null
  }

  async function connect(
    connectOptions: BaiduNetdiskOAuthConnectOptions
  ): Promise<BaiduNetdiskOAuthConnectResult> {
    const native = requireNative()
    beginMutation()
    try {
      const expectedUk = connectOptions.expectedUk ?? null
      if (expectedUk !== null && !isBaiduNetdiskUk(expectedUk)) {
        throw new BaiduNetdiskOAuthError(
          'inconsistent-state',
          'Baidu profile work has an invalid account identity'
        )
      }
      const previous = await previousAuthorization(expectedUk)
      const previousUk = previous.metadata?.uk ?? previous.refresh?.uk ?? null
      if (previousUk && expectedUk && previousUk !== expectedUk) {
        throw new BaiduNetdiskOAuthError(
          'inconsistent-state',
          'Baidu profile work belongs to a different account'
        )
      }
      const oauthClient = requestedOAuthClient(connectOptions)
      let result: BaiduNetdiskNativeAuthorizeResult
      try {
        result = await native.authorize(
          { oauthClient: nativeOAuthClient(oauthClient), timeoutMs: AUTHORIZE_TIMEOUT_MS },
          connectOptions.signal
        )
      } catch (cause) {
        throw nativeFailure(cause)
      }
      throwIfAborted(connectOptions.signal)
      const authorizationVersion = createVersion()
      const metadata = metadataFromAuthorization(
        options.profileId,
        authorizationVersion,
        result,
        oauthClient
      )
      const refresh = envelopeFromAuthorization(authorizationVersion, result, oauthClient)
      const token = accessToken(result, metadata, now())
      const requiredUk = previousUk ?? expectedUk
      if (requiredUk && requiredUk !== metadata.uk) {
        throw new BaiduNetdiskOAuthError(
          'profile-account-mismatch',
          'Use a new Baidu Netdisk profile for a different account'
        )
      }
      const replacement = Object.freeze({ result, metadata, refresh, token })
      await persistReplacement(
        previous,
        replacement,
        connectOptions.signal,
        connectOptions.onCommitStart
      )
      if (!disposed) cachedAccessToken = token
      return Object.freeze({
        ...connection(metadata),
        replacedAuthorities: durableAuthorities(previous.refresh, previous.metadata)
      })
    } finally {
      mutationInProgress = false
    }
  }

  async function persistRotatedRefresh(
    replacement: BaiduNetdiskRefreshTokenEnvelope
  ): Promise<void> {
    const serialized = serializeBaiduNetdiskRefreshTokenEnvelope(replacement)
    let writeCause: unknown = null
    try {
      await options.manager.set(reference, serialized)
    } catch (cause) {
      writeCause = cause
    }
    try {
      const committed = await options.resolver.resolve(reference)
      if (committed !== serialized) throw new Error('Baidu refresh token readback did not match')
    } catch (cause) {
      const failure = new BaiduNetdiskOAuthError(
        'persistence-failed',
        'The rotated Baidu refresh token could not be stored',
        {
          cause:
            writeCause === null
              ? cause
              : new AggregateError([writeCause, cause], 'Baidu refresh write and readback failed')
        }
      )
      persistenceFailure = failure
      cachedAccessToken = null
      throw failure
    }
  }

  async function performRefresh(): Promise<BaiduNetdiskOAuthAccessToken> {
    const native = requireNative()
    const refreshGeneration = generation
    const stored = await readStoredAuthority()
    const controller = new AbortController()
    refreshController = controller
    let result: BaiduNetdiskNativeRefreshResult
    try {
      result = await native.refresh(
        {
          oauthClient: nativeOAuthClient(stored.refresh.oauthClient),
          refreshToken: stored.refresh.refreshToken,
          expectedUk: stored.metadata.uk,
          timeoutMs: REFRESH_TIMEOUT_MS
        },
        controller.signal
      )
    } catch (cause) {
      throw nativeFailure(cause)
    } finally {
      if (refreshController === controller) refreshController = null
    }
    if (refreshGeneration !== generation) {
      throw new BaiduNetdiskOAuthError('busy', 'Baidu authorization changed during refresh')
    }

    let token: BaiduNetdiskOAuthAccessToken
    let replacement: BaiduNetdiskRefreshTokenEnvelope
    try {
      if (!hasExactBaiduNetdiskOAuthScopes(result.grantedScopes)) {
        throw new BaiduNetdiskOAuthError(
          'scope-mismatch',
          'Baidu did not retain the exact basic and netdisk scopes'
        )
      }
      if (result.refreshToken === stored.refresh.refreshToken) {
        throw new BaiduNetdiskOAuthError(
          'token-response-invalid',
          'Baidu did not rotate the single-use refresh token'
        )
      }
      token = accessToken(result, stored.metadata, now())
      replacement = envelopeFromAuthorization(
        stored.refresh.authorizationVersion,
        result,
        stored.refresh.oauthClient
      )
    } catch (cause) {
      const failure =
        cause instanceof BaiduNetdiskOAuthError
          ? cause
          : new BaiduNetdiskOAuthError(
              'token-response-invalid',
              'Baidu refresh response is invalid',
              { cause }
            )
      persistenceFailure = failure
      cachedAccessToken = null
      throw failure
    }

    await persistRotatedRefresh(replacement)
    if (refreshGeneration !== generation) {
      throw new BaiduNetdiskOAuthError('busy', 'Baidu authorization changed during refresh')
    }
    persistenceFailure = null
    if (!disposed) cachedAccessToken = token
    return token
  }

  function startRefresh(): Promise<BaiduNetdiskOAuthAccessToken> {
    if (!refreshPromise) {
      const pending = performRefresh()
      refreshPromise = pending
      void pending.then(
        () => {
          if (refreshPromise === pending) refreshPromise = null
          return undefined
        },
        () => {
          if (refreshPromise === pending) refreshPromise = null
          return undefined
        }
      )
    }
    return refreshPromise
  }

  async function refresh(signal?: AbortSignal): Promise<BaiduNetdiskOAuthAccessToken> {
    requireNative()
    if (persistenceFailure) throw persistenceFailure
    if (mutationInProgress) {
      throw new BaiduNetdiskOAuthError('busy', 'Baidu authorization is changing')
    }
    return waitForSignal(startRefresh(), signal)
  }

  async function accessTokenForDataPlane(
    signal?: AbortSignal
  ): Promise<BaiduNetdiskOAuthAccessToken> {
    requireNative()
    if (persistenceFailure) throw persistenceFailure
    if (mutationInProgress) {
      throw new BaiduNetdiskOAuthError('busy', 'Baidu authorization is changing')
    }
    if (cachedAccessToken && cachedAccessToken.expiresAt > now() + ACCESS_TOKEN_EXPIRY_SKEW_MS) {
      return waitForSignal(Promise.resolve(cachedAccessToken), signal)
    }
    return waitForSignal(startRefresh(), signal)
  }

  async function disconnect(signal?: AbortSignal): Promise<BaiduNetdiskDisconnectResult> {
    beginMutation()
    try {
      throwIfAborted(signal)
      try {
        await options.manager.clear(reference)
        throwIfAborted(signal)
        await metadataStore.remove(options.profileId)
      } catch (cause) {
        if (cause instanceof BaiduNetdiskOAuthError) throw cause
        const failure = new BaiduNetdiskOAuthError(
          'persistence-failed',
          'Baidu authorization could not be removed from this device',
          { cause }
        )
        persistenceFailure = failure
        throw failure
      }
      persistenceFailure = null
      return Object.freeze({ outcome: 'disconnected', localOnly: true })
    } finally {
      mutationInProgress = false
    }
  }

  function dispose(): void {
    // A detached single-use refresh is still allowed to finish persisting its successor.
    disposed = true
    cachedAccessToken = null
  }

  return Object.freeze({
    status,
    connect,
    refresh,
    disconnect,
    accessToken: accessTokenForDataPlane,
    getAccessToken: accessTokenForDataPlane,
    dispose
  })
}

export type { BaiduNetdiskOAuthMetadataStore, BaiduNetdiskOAuthPublicMetadata }
