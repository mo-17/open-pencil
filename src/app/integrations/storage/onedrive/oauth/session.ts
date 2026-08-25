/* oxlint-disable eslint/max-lines -- One session owns restart-safe credential, metadata, refresh-rotation, and grant-replacement invariants. */

import { randomHex } from '@open-pencil/core/random'

import type { StorageDocumentAuthority } from '@/app/integrations/storage/types'
import { credentialRef } from '@/app/settings/credentials/reference'
import {
  CredentialStoreError,
  type CredentialManager,
  type CredentialResolver
} from '@/app/settings/credentials/types'

import type { OneDriveOAuthToken } from '../types'
import {
  canonicalizeOneDriveOAuthScopes,
  isOneDriveClientId,
  oneDriveAccountLabel,
  ONEDRIVE_OAUTH_SCOPES,
  parseOneDriveOAuthPublicMetadata,
  parseOneDriveRefreshTokenEnvelope,
  parseOneDriveRefreshTokenEnvelopeJSON,
  serializeOneDriveRefreshTokenEnvelope,
  type OneDriveOAuthPublicMetadata,
  type OneDriveRefreshTokenEnvelope
} from './envelope'
import { LocalOneDriveOAuthMetadataStore, type OneDriveOAuthMetadataStore } from './metadata'

const ONEDRIVE_INTEGRATION_ID = 'onedrive'
const ONEDRIVE_REFRESH_TOKEN_FIELD = 'refresh-token'
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000
const MAX_ACCESS_TOKEN_BYTES = 16 * 1024
const AUTHORIZE_TIMEOUT_MS = 180_000
const REFRESH_TIMEOUT_MS = 30_000

export type OneDriveNativeAuthorizeRequest = Readonly<{ timeoutMs?: number }>

export type OneDriveNativeAuthorizeResult = Readonly<{
  accessToken: string
  refreshToken: string
  expiresIn: number
  grantedScopes: readonly string[]
  subject: string
  email?: string
}>

export type OneDriveNativeRefreshRequest = Readonly<{
  refreshToken: string
  expectedSubject: string
  timeoutMs?: number
}>

/** Microsoft refresh responses always carry the replacement refresh token. */
export type OneDriveNativeRefreshResult = OneDriveNativeAuthorizeResult

export interface OneDriveOAuthNativeBridge {
  authorize(
    request: OneDriveNativeAuthorizeRequest,
    signal?: AbortSignal
  ): Promise<OneDriveNativeAuthorizeResult>
  refresh(
    request: OneDriveNativeRefreshRequest,
    signal?: AbortSignal
  ): Promise<OneDriveNativeRefreshResult>
}

export type OneDriveOAuthErrorCode =
  | 'unsupported'
  | 'cancelled'
  | 'setup-required'
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
  | 'redirect-uri-mismatch'
  | 'token-request-invalid'
  | 'browser-open-failed'
  | 'network-failed'
  | 'rate-limited'
  | 'token-exchange-failed'
  | 'token-response-invalid'
  | 'userinfo-failed'
  | 'scope-mismatch'
  | 'subject-mismatch'
  | 'persistence-failed'
  | 'native-failed'

type OneDriveOAuthErrorOptions = ErrorOptions & {
  retryAfterMs?: number
}

export class OneDriveOAuthError extends Error {
  readonly retryAfterMs: number | undefined

  constructor(
    readonly code: OneDriveOAuthErrorCode,
    message: string,
    options?: OneDriveOAuthErrorOptions
  ) {
    super(message, options)
    this.name = 'OneDriveOAuthError'
    const retryAfterMs = options?.retryAfterMs
    this.retryAfterMs =
      Number.isSafeInteger(retryAfterMs) &&
      (retryAfterMs as number) > 0 &&
      (retryAfterMs as number) <= 300_000
        ? retryAfterMs
        : undefined
  }
}

/** Resolve a reconnect constraint only when every durable authority belongs to one account. */
export function oneDriveSingleAccountId(
  authorities: readonly StorageDocumentAuthority[]
): string | undefined {
  const accountIds = new Set(authorities.map((authority) => authority.accountId))
  if (accountIds.size > 1) {
    throw new OneDriveOAuthError(
      'inconsistent-state',
      'OneDrive profile contains durable work for multiple Microsoft accounts'
    )
  }
  return accountIds.values().next().value
}

export type OneDriveOAuthConnection = Readonly<{
  profileId: string
  subject: string
  email?: string
  accountLabel: string
  authorizationVersion: string
  authority: StorageDocumentAuthority
  grantedScopes: typeof ONEDRIVE_OAUTH_SCOPES
}>

export type OneDriveOAuthRepairAuthority = Readonly<{
  subject: string
  authorizationVersion: string
}>

export type OneDriveOAuthConnectResult = OneDriveOAuthConnection &
  Readonly<{
    /** Non-secret authority records that a higher-level lifecycle may explicitly adopt. */
    replacedAuthorities: readonly OneDriveOAuthRepairAuthority[]
  }>

export type OneDriveOAuthStatus =
  | { state: 'unsupported'; profileId: string }
  | { state: 'setup'; profileId: string }
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
    }
  | ({ state: 'connected' } & OneDriveOAuthConnection)

export type OneDriveAccessToken = OneDriveOAuthToken &
  Readonly<{
    expiresAt: number
  }>

export type OneDriveDisconnectResult = Readonly<{
  outcome: 'disconnected'
  localOnly: true
}>

export type OneDriveOAuthConnectOptions = Readonly<{
  signal?: AbortSignal
  /** A durable workspace owner can constrain reconnect to its already-bound Microsoft account. */
  expectedSubject?: string
  /** Marks the final metadata write as the non-cancellable local commit point. */
  onCommitStart?: () => void
}>

export type CreateOneDriveOAuthSessionOptions = Readonly<{
  /** Public application ID supplied by the publisher build; it is never profile-overridable. */
  clientId: string | null
  profileId: string
  manager: CredentialManager
  resolver: CredentialResolver
  metadataStore?: OneDriveOAuthMetadataStore
  native?: OneDriveOAuthNativeBridge
  now?: () => number
  randomAuthorizationVersion?: () => string
}>

type MetadataObservation =
  | { state: 'valid'; value: OneDriveOAuthPublicMetadata }
  | { state: 'missing' }
  | { state: 'invalid' }

type RefreshObservation =
  | { state: 'valid'; value: OneDriveRefreshTokenEnvelope }
  | { state: 'missing' }
  | { state: 'invalid' }
  | { state: 'locked' }
  | { state: 'unavailable' }

type PreviousAuthorization = Readonly<{
  rawCredential: string | null
  metadata: OneDriveOAuthPublicMetadata | null
  refresh: OneDriveRefreshTokenEnvelope | null
}>

type StoredAuthority = Readonly<{
  metadata: OneDriveOAuthPublicMetadata
  refresh: OneDriveRefreshTokenEnvelope
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
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 86_400
}

function nativeCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function nativeRetryAfterMs(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const value = Object.getOwnPropertyDescriptor(error, 'retryAfterMs')?.value
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 300_000
    ? (value as number)
    : undefined
}

function nativeFailure(error: unknown): OneDriveOAuthError {
  if (error instanceof OneDriveOAuthError) return error
  if (
    (error instanceof Error && error.name === 'AbortError') ||
    nativeCode(error) === 'cancelled'
  ) {
    return new OneDriveOAuthError('cancelled', 'OneDrive authorization was cancelled', {
      cause: error
    })
  }
  const codeByNativeCode: Readonly<Partial<Record<string, OneDriveOAuthErrorCode>>> = {
    'oauth-denied': 'authorization-denied',
    timeout: 'authorization-timeout',
    'oauth-client-invalid': 'oauth-client-invalid',
    'authorization-grant-invalid': 'authorization-grant-invalid',
    'redirect-uri-mismatch': 'redirect-uri-mismatch',
    'token-request-invalid': 'token-request-invalid',
    'browser-open-failed': 'browser-open-failed',
    'network-failed': 'network-failed',
    'rate-limited': 'rate-limited',
    'token-exchange-failed': 'token-exchange-failed',
    'token-response-invalid': 'token-response-invalid',
    'userinfo-failed': 'userinfo-failed',
    'scope-mismatch': 'scope-mismatch',
    'subject-mismatch': 'subject-mismatch'
  }
  const mapped = nativeCode(error)
  const code = mapped ? codeByNativeCode[mapped] : undefined
  if (code) {
    const retryAfterMs = code === 'rate-limited' ? nativeRetryAfterMs(error) : undefined
    return new OneDriveOAuthError(
      code,
      error instanceof Error ? error.message : 'OneDrive native authorization failed',
      retryAfterMs === undefined ? { cause: error } : { cause: error, retryAfterMs }
    )
  }
  return new OneDriveOAuthError('native-failed', 'OneDrive native authorization failed', {
    cause: error
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new OneDriveOAuthError('cancelled', 'OneDrive authorization was cancelled', {
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
        new OneDriveOAuthError('cancelled', 'OneDrive authorization was cancelled', {
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
        reject(
          error instanceof Error
            ? error
            : new OneDriveOAuthError('native-failed', 'OneDrive operation failed', {
                cause: error
              })
        )
        return undefined
      }
    )
  })
}

function connection(metadata: OneDriveOAuthPublicMetadata): OneDriveOAuthConnection {
  return Object.freeze({
    profileId: metadata.profileId,
    subject: metadata.subject,
    ...(metadata.email ? { email: metadata.email } : {}),
    accountLabel: oneDriveAccountLabel(metadata),
    authorizationVersion: metadata.authorizationVersion,
    authority: Object.freeze({
      accountId: metadata.subject,
      authorizationVersion: metadata.authorizationVersion
    }),
    grantedScopes: ONEDRIVE_OAUTH_SCOPES
  })
}

function repairAuthority(
  value: Pick<
    OneDriveOAuthPublicMetadata | OneDriveRefreshTokenEnvelope,
    'subject' | 'authorizationVersion'
  >
): OneDriveOAuthRepairAuthority {
  return Object.freeze({
    subject: value.subject,
    authorizationVersion: value.authorizationVersion
  })
}

function durableAuthorities(
  ...values: readonly (OneDriveOAuthPublicMetadata | OneDriveRefreshTokenEnvelope | null)[]
): readonly OneDriveOAuthRepairAuthority[] {
  const authorities = new Map<string, OneDriveOAuthRepairAuthority>()
  for (const value of values) {
    if (!value) continue
    const authority = repairAuthority(value)
    authorities.set(`${authority.subject}\u0000${authority.authorizationVersion}`, authority)
  }
  return Object.freeze([...authorities.values()])
}

function accessToken(
  result: OneDriveNativeAuthorizeResult,
  metadata: Pick<OneDriveOAuthPublicMetadata, 'subject' | 'authorizationVersion'>,
  now: number
): OneDriveAccessToken {
  if (!validAccessToken(result.accessToken) || !validExpiry(result.expiresIn)) {
    throw new OneDriveOAuthError(
      'token-response-invalid',
      'OneDrive returned an invalid access token'
    )
  }
  if (result.subject !== metadata.subject) {
    throw new OneDriveOAuthError(
      'subject-mismatch',
      'OneDrive authorization belongs to a different Microsoft account'
    )
  }
  return Object.freeze({
    accessToken: result.accessToken,
    expiresAt: now + result.expiresIn * 1_000,
    authority: Object.freeze({
      accountId: metadata.subject,
      authorizationVersion: metadata.authorizationVersion
    })
  })
}

function metadataFromAuthorization(
  profileId: string,
  authorizationVersion: string,
  result: OneDriveNativeAuthorizeResult
): OneDriveOAuthPublicMetadata {
  if (!canonicalizeOneDriveOAuthScopes(result.grantedScopes)) {
    throw new OneDriveOAuthError(
      'scope-mismatch',
      'Microsoft did not grant the required OneDrive scopes'
    )
  }
  try {
    return parseOneDriveOAuthPublicMetadata({
      schemaVersion: 1,
      profileId,
      subject: result.subject,
      ...(result.email === undefined ? {} : { email: result.email }),
      authorizationVersion,
      grantedScopes: ONEDRIVE_OAUTH_SCOPES
    })
  } catch (cause) {
    throw new OneDriveOAuthError(
      'token-response-invalid',
      'Microsoft returned invalid OneDrive account metadata',
      { cause }
    )
  }
}

function envelopeFromAuthorization(
  clientId: string,
  authorizationVersion: string,
  result: OneDriveNativeAuthorizeResult
): OneDriveRefreshTokenEnvelope {
  try {
    return parseOneDriveRefreshTokenEnvelope({
      schemaVersion: 1,
      refreshToken: result.refreshToken,
      clientId,
      authorizationVersion,
      subject: result.subject
    })
  } catch (cause) {
    throw new OneDriveOAuthError(
      'token-response-invalid',
      'Microsoft returned an invalid OneDrive refresh token',
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
  throw new OneDriveOAuthError(
    'persistence-failed',
    'OneDrive authorization staging could not be created'
  )
}

export function oneDriveRefreshTokenCredentialRef(profileId: string) {
  try {
    return credentialRef(ONEDRIVE_INTEGRATION_ID, ONEDRIVE_REFRESH_TOKEN_FIELD, profileId)
  } catch (cause) {
    throw new OneDriveOAuthError('invalid-profile', 'OneDrive profile ID is invalid', { cause })
  }
}

export function createOneDriveOAuthSession(options: CreateOneDriveOAuthSessionOptions) {
  const clientId =
    options.clientId && isOneDriveClientId(options.clientId) ? options.clientId.toLowerCase() : null
  const reference = oneDriveRefreshTokenCredentialRef(options.profileId)
  const metadataStore = options.metadataStore ?? new LocalOneDriveOAuthMetadataStore()
  const now = options.now ?? Date.now
  const createVersion = options.randomAuthorizationVersion ?? randomAuthorizationVersion
  let cachedAccessToken: OneDriveAccessToken | null = null
  let refreshPromise: Promise<OneDriveAccessToken> | null = null
  let refreshController: AbortController | null = null
  let generation = 0
  let mutationInProgress = false
  let persistenceFailure: OneDriveOAuthError | null = null
  let disposed = false

  function requireConfigured(): Readonly<{
    clientId: string
    native: OneDriveOAuthNativeBridge
  }> {
    if (disposed) {
      throw new OneDriveOAuthError('busy', 'OneDrive authorization session was disposed')
    }
    if (!options.native) {
      throw new OneDriveOAuthError(
        'unsupported',
        'OneDrive authorization is available only in the desktop app'
      )
    }
    if (!clientId) {
      throw new OneDriveOAuthError(
        'setup-required',
        'This build does not provide the OneDrive public client ID'
      )
    }
    return { clientId, native: options.native }
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
      return { state: 'valid', value: parseOneDriveRefreshTokenEnvelopeJSON(raw) }
    } catch {
      return { state: 'invalid' }
    }
  }

  async function status(): Promise<OneDriveOAuthStatus> {
    if (!options.native) return { state: 'unsupported', profileId: options.profileId }
    if (!clientId) return { state: 'setup', profileId: options.profileId }
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
    if (
      refresh.value.clientId !== clientId ||
      refresh.value.subject !== metadata.value.subject ||
      refresh.value.authorizationVersion !== metadata.value.authorizationVersion
    ) {
      return { state: 'invalid', profileId: options.profileId, reason: 'authority-mismatch' }
    }
    return { state: 'connected', ...connection(metadata.value) }
  }

  async function readStoredAuthority(): Promise<StoredAuthority> {
    const configured = requireConfigured()
    let metadata: OneDriveOAuthPublicMetadata | null
    try {
      metadata = await metadataStore.read(options.profileId)
    } catch (cause) {
      throw new OneDriveOAuthError(
        'metadata-invalid',
        'Stored OneDrive account metadata is invalid',
        { cause }
      )
    }
    if (!metadata) {
      throw new OneDriveOAuthError(
        'inconsistent-state',
        'OneDrive credential is missing account metadata'
      )
    }
    let raw: string | null
    try {
      raw = await options.resolver.resolve(reference)
    } catch (cause) {
      if (cause instanceof CredentialStoreError && cause.code === 'locked') {
        throw new OneDriveOAuthError('credential-locked', 'The credential store is locked', {
          cause
        })
      }
      throw new OneDriveOAuthError(
        'credential-unavailable',
        'The encrypted credential store is unavailable',
        { cause }
      )
    }
    if (!raw) {
      throw new OneDriveOAuthError('credential-missing', 'OneDrive credential is missing')
    }
    let refresh: OneDriveRefreshTokenEnvelope
    try {
      refresh = parseOneDriveRefreshTokenEnvelopeJSON(raw)
    } catch (cause) {
      throw new OneDriveOAuthError('credential-invalid', 'Stored OneDrive credential is invalid', {
        cause
      })
    }
    if (
      refresh.clientId !== configured.clientId ||
      refresh.subject !== metadata.subject ||
      refresh.authorizationVersion !== metadata.authorizationVersion
    ) {
      throw new OneDriveOAuthError(
        'inconsistent-state',
        'OneDrive credential does not match its account binding'
      )
    }
    return { metadata, refresh }
  }

  async function previousAuthorization(): Promise<PreviousAuthorization> {
    const credentialStatus = await observeCredentialStatus()
    if (credentialStatus === 'locked') {
      throw new OneDriveOAuthError('credential-locked', 'The credential store is locked')
    }
    if (credentialStatus === 'unavailable') {
      throw new OneDriveOAuthError(
        'credential-unavailable',
        'The encrypted credential store is unavailable'
      )
    }
    let rawCredential: string | null = null
    let refresh: OneDriveRefreshTokenEnvelope | null = null
    if (credentialStatus === 'configured') {
      try {
        rawCredential = await options.resolver.resolve(reference)
      } catch (cause) {
        throw new OneDriveOAuthError(
          'credential-unavailable',
          'The encrypted credential store is unavailable',
          { cause }
        )
      }
      if (rawCredential) {
        try {
          refresh = parseOneDriveRefreshTokenEnvelopeJSON(rawCredential)
        } catch {
          refresh = null
        }
      }
    }
    let metadata: OneDriveOAuthPublicMetadata | null = null
    try {
      metadata = await metadataStore.read(options.profileId)
    } catch {
      metadata = null
    }
    if (metadata && refresh && metadata.subject !== refresh.subject) {
      throw new OneDriveOAuthError(
        'inconsistent-state',
        'OneDrive credential belongs to a different account than its public binding'
      )
    }
    return { rawCredential, metadata, refresh }
  }

  function beginMutation(): void {
    if (disposed) {
      throw new OneDriveOAuthError('busy', 'OneDrive authorization session was disposed')
    }
    if (mutationInProgress) {
      throw new OneDriveOAuthError('busy', 'OneDrive authorization is already changing')
    }
    // A Microsoft refresh can rotate the durable token before the native command returns. Never
    // cancel or supersede an in-flight refresh: doing so could discard the only usable successor.
    if (refreshPromise || refreshController) {
      throw new OneDriveOAuthError('busy', 'OneDrive access is currently being refreshed')
    }
    mutationInProgress = true
    generation++
    cachedAccessToken = null
  }

  async function persistReplacement(
    previous: PreviousAuthorization,
    metadata: OneDriveOAuthPublicMetadata,
    refresh: OneDriveRefreshTokenEnvelope,
    signal?: AbortSignal,
    onCommitStart?: () => void
  ): Promise<void> {
    const serialized = serializeOneDriveRefreshTokenEnvelope(refresh)
    const staged = parseOneDriveOAuthPublicMetadata({
      ...metadata,
      authorizationVersion: stagedAuthorizationVersion(metadata.authorizationVersion, previous)
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
      await metadataStore.write(metadata)
    } catch (cause) {
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
      const failure = new OneDriveOAuthError(
        'persistence-failed',
        rollbackErrors.length === 0
          ? 'OneDrive authorization could not be stored'
          : 'OneDrive authorization could not be stored or safely rolled back',
        {
          cause:
            rollbackErrors.length === 0
              ? cause
              : new AggregateError(
                  [cause, ...rollbackErrors],
                  'OneDrive authorization persistence and rollback failed'
                )
        }
      )
      if (rollbackErrors.length > 0) persistenceFailure = failure
      throw failure
    }
    persistenceFailure = null
  }

  async function connect(
    connectOptions: OneDriveOAuthConnectOptions = {}
  ): Promise<OneDriveOAuthConnectResult> {
    const configured = requireConfigured()
    beginMutation()
    try {
      const expectedSubject = connectOptions.expectedSubject ?? null
      if (
        expectedSubject !== null &&
        (expectedSubject.length === 0 ||
          expectedSubject.length > 256 ||
          expectedSubject.trim() !== expectedSubject ||
          /\p{Cc}/u.test(expectedSubject))
      ) {
        throw new OneDriveOAuthError(
          'inconsistent-state',
          'OneDrive profile work has an invalid account identity'
        )
      }
      const previous = await previousAuthorization()
      const previousSubject = previous.metadata?.subject ?? previous.refresh?.subject ?? null
      if (previousSubject && expectedSubject && previousSubject !== expectedSubject) {
        throw new OneDriveOAuthError(
          'inconsistent-state',
          'OneDrive profile work belongs to a different Microsoft account'
        )
      }
      let result: OneDriveNativeAuthorizeResult
      try {
        result = await configured.native.authorize(
          { timeoutMs: AUTHORIZE_TIMEOUT_MS },
          connectOptions.signal
        )
      } catch (cause) {
        throw nativeFailure(cause)
      }
      throwIfAborted(connectOptions.signal)
      const authorizationVersion = createVersion()
      const metadata = metadataFromAuthorization(options.profileId, authorizationVersion, result)
      const refresh = envelopeFromAuthorization(configured.clientId, authorizationVersion, result)
      const token = accessToken(result, metadata, now())
      const requiredSubject = previousSubject ?? expectedSubject
      if (requiredSubject && requiredSubject !== metadata.subject) {
        throw new OneDriveOAuthError(
          'profile-account-mismatch',
          'Use a new OneDrive profile for a different Microsoft account'
        )
      }
      await persistReplacement(
        previous,
        metadata,
        refresh,
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

  async function performRefresh(): Promise<OneDriveAccessToken> {
    const configured = requireConfigured()
    const refreshGeneration = generation
    const stored = await readStoredAuthority()
    const controller = new AbortController()
    refreshController = controller
    let result: OneDriveNativeRefreshResult
    try {
      result = await configured.native.refresh(
        {
          refreshToken: stored.refresh.refreshToken,
          expectedSubject: stored.metadata.subject,
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
      throw new OneDriveOAuthError('busy', 'OneDrive authorization changed during refresh')
    }

    let token: OneDriveAccessToken
    let replacement: OneDriveRefreshTokenEnvelope
    try {
      if (!canonicalizeOneDriveOAuthScopes(result.grantedScopes)) {
        throw new OneDriveOAuthError(
          'scope-mismatch',
          'Microsoft did not retain the required OneDrive scopes'
        )
      }
      token = accessToken(result, stored.metadata, now())
      replacement = envelopeFromAuthorization(
        stored.refresh.clientId,
        stored.refresh.authorizationVersion,
        result
      )
    } catch (cause) {
      const failure =
        cause instanceof OneDriveOAuthError
          ? cause
          : new OneDriveOAuthError(
              'token-response-invalid',
              'OneDrive refresh response is invalid',
              {
                cause
              }
            )
      persistenceFailure = failure
      throw failure
    }

    const serialized = serializeOneDriveRefreshTokenEnvelope(replacement)
    try {
      await options.manager.set(reference, serialized)
      const committed = await options.resolver.resolve(reference)
      if (committed !== serialized) {
        throw new Error('OneDrive refresh token readback did not match')
      }
    } catch (cause) {
      const failure = new OneDriveOAuthError(
        'persistence-failed',
        'The rotated OneDrive refresh token could not be stored',
        { cause }
      )
      persistenceFailure = failure
      throw failure
    }
    if (refreshGeneration !== generation) {
      throw new OneDriveOAuthError('busy', 'OneDrive authorization changed during refresh')
    }
    persistenceFailure = null
    if (!disposed) cachedAccessToken = token
    return token
  }

  function startRefresh(): Promise<OneDriveAccessToken> {
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

  async function refresh(signal?: AbortSignal): Promise<OneDriveAccessToken> {
    requireConfigured()
    if (persistenceFailure) throw persistenceFailure
    if (mutationInProgress) {
      throw new OneDriveOAuthError('busy', 'OneDrive authorization is changing')
    }
    return waitForSignal(startRefresh(), signal)
  }

  async function getAccessToken(signal?: AbortSignal): Promise<OneDriveAccessToken> {
    requireConfigured()
    if (persistenceFailure) throw persistenceFailure
    if (mutationInProgress) {
      throw new OneDriveOAuthError('busy', 'OneDrive authorization is changing')
    }
    if (cachedAccessToken && cachedAccessToken.expiresAt > now() + ACCESS_TOKEN_EXPIRY_SKEW_MS) {
      return waitForSignal(Promise.resolve(cachedAccessToken), signal)
    }
    return waitForSignal(startRefresh(), signal)
  }

  async function disconnect(signal?: AbortSignal): Promise<OneDriveDisconnectResult> {
    beginMutation()
    try {
      throwIfAborted(signal)
      try {
        await options.manager.clear(reference)
        throwIfAborted(signal)
        await metadataStore.remove(options.profileId)
      } catch (cause) {
        if (cause instanceof OneDriveOAuthError) throw cause
        throw new OneDriveOAuthError(
          'persistence-failed',
          'OneDrive authorization could not be removed from this device',
          { cause }
        )
      }
      persistenceFailure = null
      return Object.freeze({ outcome: 'disconnected', localOnly: true })
    } finally {
      mutationInProgress = false
    }
  }

  function dispose(): void {
    // Let an in-flight Microsoft refresh finish persisting its rotated token. Native timeout bounds
    // the detached work, while clearing this cache prevents the disposed session from serving it.
    disposed = true
    cachedAccessToken = null
  }

  return Object.freeze({ status, connect, refresh, disconnect, getAccessToken, dispose })
}

export { ONEDRIVE_OAUTH_SCOPES }
export type { OneDriveOAuthMetadataStore, OneDriveOAuthPublicMetadata }
