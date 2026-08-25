import { IS_TAURI } from '@open-pencil/core/constants'
import { randomHex } from '@open-pencil/core/random'

import { credentialRef } from '@/app/settings/credentials/reference'
import {
  CredentialStoreError,
  type CredentialManager,
  type CredentialResolver
} from '@/app/settings/credentials/types'
import {
  googleDriveNativeBridge,
  GoogleDriveNativeError,
  type GoogleDriveNativeAuthorizeResult,
  type GoogleDriveNativeBridge,
  type GoogleDriveNativeOAuthClient,
  type GoogleDriveNativeRefreshResult
} from '@/app/tauri/google-drive'

import {
  googleDriveAccountLabel,
  googleDriveOAuthClientPublic,
  googleDriveOAuthPublicClientsEqual,
  GOOGLE_DRIVE_OAUTH_SCOPES,
  isGoogleDriveOAuthPublicMetadataV1,
  isGoogleDriveOAuthPublicMetadataV2,
  isGoogleDriveRefreshTokenEnvelopeV1,
  isGoogleDriveRefreshTokenEnvelopeV2,
  parseGoogleDriveOAuthClient,
  parseGoogleDriveOAuthPublicMetadata,
  parseGoogleDriveRefreshTokenEnvelope,
  parseGoogleDriveRefreshTokenEnvelopeJSON,
  serializeGoogleDriveRefreshTokenEnvelope,
  type GoogleDriveOAuthClient,
  type GoogleDriveOAuthPublicMetadata,
  type GoogleDriveOAuthPublicClient,
  type GoogleDriveSelfHostedDesktopOAuthClient,
  type GoogleDriveRefreshTokenEnvelope
} from './envelope'
import { LocalGoogleDriveOAuthMetadataStore, type GoogleDriveOAuthMetadataStore } from './metadata'
import { bestEffortGoogleDriveRevoke, waitForGoogleDriveOAuth } from './runtime'

const GOOGLE_DRIVE_INTEGRATION_ID = 'google-drive'
const GOOGLE_DRIVE_REFRESH_TOKEN_FIELD = 'refresh-token'
const GOOGLE_OAUTH_CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{10,200}\.apps\.googleusercontent\.com$/
const MAX_OAUTH_TOKEN_LENGTH = 8 * 1024
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000

export type GoogleDriveOAuthErrorCode =
  | 'unsupported'
  | 'cancelled'
  | 'invalid-client-id'
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
  | 'redirect-uri-mismatch'
  | 'token-request-invalid'
  | 'browser-open-failed'
  | 'network-failed'
  | 'token-exchange-failed'
  | 'token-response-invalid'
  | 'oauth-broker-rate-limited'
  | 'oauth-broker-unavailable'
  | 'oauth-broker-misconfigured'
  | 'oauth-broker-protocol-invalid'
  | 'userinfo-failed'
  | 'scope-mismatch'
  | 'subject-mismatch'
  | 'persistence-failed'
  | 'native-failed'

type GoogleDriveOAuthErrorOptions = ErrorOptions & {
  retryAfterMs?: number
}

export class GoogleDriveOAuthError extends Error {
  readonly retryAfterMs: number | undefined

  constructor(
    readonly code: GoogleDriveOAuthErrorCode,
    message: string,
    options?: GoogleDriveOAuthErrorOptions
  ) {
    super(message, options)
    this.name = 'GoogleDriveOAuthError'
    const retryAfterMs = options?.retryAfterMs
    this.retryAfterMs =
      Number.isSafeInteger(retryAfterMs) &&
      (retryAfterMs as number) > 0 &&
      (retryAfterMs as number) <= 300_000
        ? retryAfterMs
        : undefined
  }
}

class GoogleDriveOAuthCommitOutcomeUnverifiedError extends Error {
  constructor(readonly failure: GoogleDriveOAuthError) {
    super(failure.message)
    this.name = 'GoogleDriveOAuthCommitOutcomeUnverifiedError'
  }
}

const SEMANTIC_NATIVE_ERROR_CODES: Readonly<
  Partial<Record<GoogleDriveNativeError['code'], GoogleDriveOAuthErrorCode>>
> = {
  'oauth-denied': 'authorization-denied',
  timeout: 'authorization-timeout',
  'oauth-client-invalid': 'oauth-client-invalid',
  'authorization-grant-invalid': 'authorization-grant-invalid',
  'redirect-uri-mismatch': 'redirect-uri-mismatch',
  'token-request-invalid': 'token-request-invalid',
  'browser-open-failed': 'browser-open-failed',
  'network-failed': 'network-failed',
  'token-exchange-failed': 'token-exchange-failed',
  'token-response-invalid': 'token-response-invalid',
  'oauth-broker-rate-limited': 'oauth-broker-rate-limited',
  'oauth-broker-unavailable': 'oauth-broker-unavailable',
  'oauth-broker-misconfigured': 'oauth-broker-misconfigured',
  'oauth-broker-protocol-invalid': 'oauth-broker-protocol-invalid',
  'userinfo-failed': 'userinfo-failed',
  'scope-mismatch': 'scope-mismatch',
  'subject-mismatch': 'subject-mismatch'
}

export type GoogleDriveOAuthConnection = {
  profileId: string
  subject: string
  email?: string
  accountLabel: string
  authorizationVersion: string
  grantedScopes: typeof GOOGLE_DRIVE_OAUTH_SCOPES
  oauthClient: GoogleDriveOAuthPublicClient
}

export type GoogleDriveOAuthRepairAuthority = Readonly<{
  subject: string
  authorizationVersion: string
}>

export type GoogleDriveOAuthConnectResult = GoogleDriveOAuthConnection & {
  /** Non-secret durable authorities that the completed grant safely replaces. */
  replacedAuthorities: readonly GoogleDriveOAuthRepairAuthority[]
}

export type GoogleDriveOAuthStatus =
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
      repairable: boolean
      /** Bounded non-secret authorities observed across credential and public metadata records. */
      repairAuthorities: readonly GoogleDriveOAuthRepairAuthority[]
      /** Credential authority first when it is trustworthy; retained for narrow callers. */
      repairAuthority?: GoogleDriveOAuthRepairAuthority
    }
  | ({ state: 'connected' } & GoogleDriveOAuthConnection)

export type GoogleDriveAccessToken = {
  accessToken: string
  expiresAt: number
  authorizationVersion: string
  subject: string
}

export type GoogleDriveDisconnectResult =
  | { outcome: 'disconnected'; localOnly: boolean }
  | {
      outcome: 'revoke-failed'
      reason:
        | 'credential-locked'
        | 'credential-unavailable'
        | 'credential-invalid'
        | 'native-failed'
    }

export type GoogleDriveDisconnectOptions = {
  mode?: 'revoke' | 'local-only'
}

export type CreateGoogleDriveOAuthSessionOptions = {
  /** Publisher-managed build client ID. May be absent for self-hosted-only builds. */
  clientId: string | null
  profileId: string
  manager: CredentialManager
  resolver: CredentialResolver
  metadataStore?: GoogleDriveOAuthMetadataStore
  native?: GoogleDriveNativeBridge
  now?: () => number
  randomAuthorizationVersion?: () => string
}

type StoredAuthority = {
  metadata: GoogleDriveOAuthPublicMetadata
  refresh: GoogleDriveRefreshTokenEnvelope
  oauthClient: GoogleDriveOAuthClient
}

export type GoogleDriveOAuthConnectClient =
  | Readonly<{ mode: 'publisher-broker' }>
  | GoogleDriveSelfHostedDesktopOAuthClient

export type GoogleDriveOAuthConnectOptions = Readonly<{
  signal?: AbortSignal
  oauthClient?: GoogleDriveOAuthConnectClient
  /** Durable profile work can constrain replacement even if OAuth records were lost. */
  expectedSubject?: string
  /** Synchronously marks the final metadata write as an irreversible local commit. */
  onCommitStart?: () => void
}>

type MetadataObservation =
  | { state: 'valid'; value: GoogleDriveOAuthPublicMetadata }
  | { state: 'missing' }
  | { state: 'invalid' }

type RefreshObservation =
  | { state: 'valid'; value: GoogleDriveRefreshTokenEnvelope }
  | { state: 'missing' }
  | { state: 'invalid' }
  | { state: 'locked' }
  | { state: 'unavailable' }

type InvalidRefreshObservation = Extract<
  RefreshObservation,
  { state: 'missing' } | { state: 'invalid' }
>

type PreviousAuthorization = {
  metadata: GoogleDriveOAuthPublicMetadata | null
  credential: string | null
  refresh: GoogleDriveRefreshTokenEnvelope | null
}

type ReplacementAuthorization = {
  result: GoogleDriveNativeAuthorizeResult
  metadata: GoogleDriveOAuthPublicMetadata
  refresh: GoogleDriveRefreshTokenEnvelope
}

type ReplacementPersistenceObservation =
  | { state: 'committed' }
  | { state: 'not-committed' }
  | { state: 'unavailable'; cause: unknown }

function validatedClientId(value: string): string {
  if (value.length < 20 || value.length > 256 || !GOOGLE_OAUTH_CLIENT_ID_PATTERN.test(value)) {
    throw new GoogleDriveOAuthError('invalid-client-id', 'Google OAuth client ID is invalid')
  }
  return value
}

function publisherOAuthClient(clientId: string | null): GoogleDriveOAuthClient | null {
  if (!clientId) return null
  try {
    return parseGoogleDriveOAuthClient({
      mode: 'publisher-broker',
      clientId: validatedClientId(clientId)
    })
  } catch (cause) {
    throw new GoogleDriveOAuthError('invalid-client-id', 'Google OAuth client ID is invalid', {
      cause
    })
  }
}

function nativeOAuthClient(client: GoogleDriveOAuthClient): GoogleDriveNativeOAuthClient {
  return client.mode === 'publisher-broker'
    ? Object.freeze({ mode: 'publisher-broker' })
    : Object.freeze({
        mode: 'self-hosted-desktop',
        clientId: client.clientId,
        clientSecret: client.clientSecret
      })
}

function randomAuthorizationVersion(): string {
  return randomHex(16)
}

function validToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_OAUTH_TOKEN_LENGTH &&
    value.trim() === value &&
    !/\s/u.test(value) &&
    !/\p{Cc}/u.test(value)
  )
}

function validExpiry(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 86_400
}

function parsePreviousRefreshCredential(
  credential: string,
  hasTrustworthySubject: boolean
): GoogleDriveRefreshTokenEnvelope | null {
  try {
    return parseGoogleDriveRefreshTokenEnvelopeJSON(credential)
  } catch (cause) {
    if (hasTrustworthySubject) return null
    throw new GoogleDriveOAuthError(
      'inconsistent-state',
      'Google Drive authorization has no trustworthy account identity',
      { cause }
    )
  }
}

function nativeFailure(error: unknown): GoogleDriveOAuthError {
  if (error instanceof GoogleDriveOAuthError) return error
  const cancelled =
    (error instanceof GoogleDriveNativeError && error.code === 'cancelled') ||
    (error instanceof Error && error.name === 'AbortError')
  if (cancelled) {
    return new GoogleDriveOAuthError('cancelled', 'Google Drive authorization was cancelled', {
      cause: error
    })
  }
  if (error instanceof GoogleDriveNativeError) {
    const code = SEMANTIC_NATIVE_ERROR_CODES[error.code]
    if (code) {
      return new GoogleDriveOAuthError(code, error.message, {
        cause: error,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs })
      })
    }
  }
  return new GoogleDriveOAuthError('native-failed', 'Google Drive native authorization failed', {
    cause: error
  })
}

function throwIfGoogleDriveOAuthAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new GoogleDriveOAuthError('cancelled', 'Google Drive authorization was cancelled', {
    cause: signal.reason
  })
}

function connection(
  metadata: GoogleDriveOAuthPublicMetadata,
  oauthClient: GoogleDriveOAuthClient | GoogleDriveOAuthPublicClient
): GoogleDriveOAuthConnection {
  return {
    profileId: metadata.profileId,
    subject: metadata.subject,
    ...(metadata.email ? { email: metadata.email } : {}),
    accountLabel: googleDriveAccountLabel(metadata),
    authorizationVersion: metadata.authorizationVersion,
    grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES,
    oauthClient: Object.freeze({ mode: oauthClient.mode, clientId: oauthClient.clientId })
  }
}

function storedOAuthClient(
  metadata: GoogleDriveOAuthPublicMetadata,
  refresh: GoogleDriveRefreshTokenEnvelope,
  publisher: GoogleDriveOAuthClient | null
): GoogleDriveOAuthClient | null {
  if (
    isGoogleDriveOAuthPublicMetadataV1(metadata) &&
    isGoogleDriveRefreshTokenEnvelopeV1(refresh)
  ) {
    return publisher
  }
  if (
    !isGoogleDriveOAuthPublicMetadataV2(metadata) ||
    !isGoogleDriveRefreshTokenEnvelopeV2(refresh)
  ) {
    return null
  }
  if (
    !googleDriveOAuthPublicClientsEqual(
      metadata.oauthClient,
      googleDriveOAuthClientPublic(refresh.oauthClient)
    )
  ) {
    return null
  }
  if (
    refresh.oauthClient.mode === 'publisher-broker' &&
    (!publisher || publisher.clientId !== refresh.oauthClient.clientId)
  ) {
    return null
  }
  return refresh.oauthClient
}

function repairAuthority(
  value: Pick<GoogleDriveOAuthPublicMetadata, 'subject' | 'authorizationVersion'>
): GoogleDriveOAuthRepairAuthority {
  return Object.freeze({
    subject: value.subject,
    authorizationVersion: value.authorizationVersion
  })
}

function durableAuthorities(
  ...values: readonly (GoogleDriveOAuthPublicMetadata | GoogleDriveRefreshTokenEnvelope | null)[]
): readonly GoogleDriveOAuthRepairAuthority[] {
  const candidates = new Map<string, GoogleDriveOAuthRepairAuthority>()
  for (const value of values) {
    if (!value) continue
    const authority = repairAuthority(value)
    candidates.set(`${authority.subject}\u0000${authority.authorizationVersion}`, authority)
  }
  return Object.freeze([...candidates.values()])
}

function stagedAuthorizationVersion(
  previous: PreviousAuthorization,
  replacement: ReplacementAuthorization
): string {
  const finalVersion = replacement.metadata.authorizationVersion
  const blocked = new Set([
    finalVersion,
    previous.metadata?.authorizationVersion,
    previous.refresh?.authorizationVersion
  ])
  for (const prefix of '0123456789abcdef') {
    const candidate = `${prefix}${finalVersion.slice(1)}`
    if (!blocked.has(candidate)) return candidate
  }
  throw new GoogleDriveOAuthError(
    'persistence-failed',
    'Google Drive authorization staging could not be created'
  )
}

function invalidStatus(
  profileId: string,
  reason: Extract<GoogleDriveOAuthStatus, { state: 'invalid' }>['reason'],
  authorities: readonly GoogleDriveOAuthRepairAuthority[],
  repairable: boolean,
  primary?: GoogleDriveOAuthRepairAuthority
): GoogleDriveOAuthStatus {
  return {
    state: 'invalid',
    profileId,
    reason,
    repairable,
    repairAuthorities: authorities,
    ...(primary ? { repairAuthority: primary } : {})
  }
}

function statusForInvalidRefreshObservation(
  profileId: string,
  metadata: MetadataObservation,
  refresh: InvalidRefreshObservation
): GoogleDriveOAuthStatus {
  const authority = metadata.state === 'valid' ? repairAuthority(metadata.value) : undefined
  let reason: Extract<GoogleDriveOAuthStatus, { state: 'invalid' }>['reason'] = 'credential-invalid'
  if (metadata.state === 'invalid') reason = 'metadata-invalid'
  else if (refresh.state === 'missing') reason = 'credential-missing'
  return invalidStatus(
    profileId,
    reason,
    metadata.state === 'valid' ? durableAuthorities(metadata.value) : [],
    authority !== undefined,
    authority
  )
}

function statusFromRecords(
  profileId: string,
  credentialStatus: 'configured' | 'missing' | 'locked' | 'unavailable',
  metadata: MetadataObservation,
  publisher: GoogleDriveOAuthClient | null,
  refresh?: RefreshObservation
): GoogleDriveOAuthStatus {
  if (credentialStatus === 'locked') return { state: 'locked', profileId }
  if (credentialStatus === 'unavailable') return { state: 'unavailable', profileId }
  if (credentialStatus === 'missing') {
    if (metadata.state === 'invalid') return invalidStatus(profileId, 'metadata-invalid', [], false)
    if (metadata.state === 'missing') return { state: 'missing', profileId }
    const authority = repairAuthority(metadata.value)
    return invalidStatus(
      profileId,
      'credential-missing',
      durableAuthorities(metadata.value),
      true,
      authority
    )
  }
  if (!refresh || refresh.state === 'locked') return { state: 'locked', profileId }
  if (refresh.state === 'unavailable') return { state: 'unavailable', profileId }
  if (refresh.state === 'missing' || refresh.state === 'invalid') {
    return statusForInvalidRefreshObservation(profileId, metadata, refresh)
  }
  const refreshAuthority = repairAuthority(refresh.value)
  if (metadata.state === 'invalid') {
    return invalidStatus(
      profileId,
      'metadata-invalid',
      durableAuthorities(refresh.value),
      true,
      refreshAuthority
    )
  }
  if (metadata.state === 'missing') {
    return invalidStatus(
      profileId,
      'metadata-missing',
      durableAuthorities(refresh.value),
      true,
      refreshAuthority
    )
  }
  if (
    refresh.value.subject !== metadata.value.subject ||
    refresh.value.authorizationVersion !== metadata.value.authorizationVersion
  ) {
    const sameSubject = refresh.value.subject === metadata.value.subject
    return invalidStatus(
      profileId,
      'authority-mismatch',
      durableAuthorities(refresh.value, metadata.value),
      sameSubject,
      sameSubject ? refreshAuthority : undefined
    )
  }
  const oauthClient = storedOAuthClient(metadata.value, refresh.value, publisher)
  if (!oauthClient) {
    return invalidStatus(
      profileId,
      'credential-invalid',
      durableAuthorities(refresh.value, metadata.value),
      true,
      refreshAuthority
    )
  }
  return { state: 'connected', ...connection(metadata.value, oauthClient) }
}

function accessToken(
  result: GoogleDriveNativeAuthorizeResult | GoogleDriveNativeRefreshResult,
  authority: Pick<GoogleDriveOAuthPublicMetadata, 'authorizationVersion' | 'subject'>,
  now: number
): GoogleDriveAccessToken {
  if (!validToken(result.accessToken) || !validExpiry(result.expiresIn)) {
    throw new GoogleDriveOAuthError(
      'native-failed',
      'Google Drive returned an invalid access token'
    )
  }
  if (result.subject !== authority.subject) {
    throw new GoogleDriveOAuthError(
      'subject-mismatch',
      'Google Drive authorization belongs to a different account'
    )
  }
  return Object.freeze({
    accessToken: result.accessToken,
    expiresAt: now + result.expiresIn * 1000,
    authorizationVersion: authority.authorizationVersion,
    subject: authority.subject
  })
}

function metadataFromAuthorization(
  profileId: string,
  authorizationVersion: string,
  result: GoogleDriveNativeAuthorizeResult,
  oauthClient: GoogleDriveOAuthClient
): GoogleDriveOAuthPublicMetadata {
  if (
    result.grantedScopes.length !== GOOGLE_DRIVE_OAUTH_SCOPES.length ||
    GOOGLE_DRIVE_OAUTH_SCOPES.some((scope, index) => result.grantedScopes[index] !== scope)
  ) {
    throw new GoogleDriveOAuthError(
      'scope-mismatch',
      'Google Drive did not grant the required scopes'
    )
  }
  return parseGoogleDriveOAuthPublicMetadata({
    schemaVersion: 2,
    profileId,
    subject: result.subject,
    ...(result.email ? { email: result.email } : {}),
    authorizationVersion,
    grantedScopes: result.grantedScopes,
    oauthClient: googleDriveOAuthClientPublic(oauthClient)
  })
}

function envelopeFromAuthorization(
  authorizationVersion: string,
  result: GoogleDriveNativeAuthorizeResult,
  oauthClient: GoogleDriveOAuthClient
): GoogleDriveRefreshTokenEnvelope {
  if (!validToken(result.refreshToken)) {
    throw new GoogleDriveOAuthError(
      'token-response-invalid',
      'Google returned an invalid refresh token'
    )
  }
  return parseGoogleDriveRefreshTokenEnvelope({
    schemaVersion: 2,
    refreshToken: result.refreshToken,
    authorizationVersion,
    subject: result.subject,
    oauthClient
  })
}

export function googleDriveRefreshTokenCredentialRef(profileId: string) {
  try {
    return credentialRef(GOOGLE_DRIVE_INTEGRATION_ID, GOOGLE_DRIVE_REFRESH_TOKEN_FIELD, profileId)
  } catch (cause) {
    throw new GoogleDriveOAuthError('invalid-profile', 'Google Drive profile ID is invalid', {
      cause
    })
  }
}

export function createGoogleDriveOAuthSession(options: CreateGoogleDriveOAuthSessionOptions) {
  const publisher = publisherOAuthClient(options.clientId)
  const reference = googleDriveRefreshTokenCredentialRef(options.profileId)
  const metadataStore = options.metadataStore ?? new LocalGoogleDriveOAuthMetadataStore()
  const native = options.native ?? googleDriveNativeBridge
  const supported = options.native !== undefined || IS_TAURI
  const now = options.now ?? Date.now
  const createVersion = options.randomAuthorizationVersion ?? randomAuthorizationVersion
  let cachedAccessToken: GoogleDriveAccessToken | null = null
  let refreshPromise: Promise<GoogleDriveAccessToken> | null = null
  let refreshController: AbortController | null = null
  let generation = 0
  let mutationInProgress = false
  let persistenceFailure: GoogleDriveOAuthError | null = null

  function requireSupported(): void {
    if (!supported) {
      throw new GoogleDriveOAuthError(
        'unsupported',
        'Google Drive authorization is available only in the desktop app'
      )
    }
  }

  async function readMetadata(): Promise<GoogleDriveOAuthPublicMetadata | null> {
    try {
      return await metadataStore.read(options.profileId)
    } catch (cause) {
      throw new GoogleDriveOAuthError(
        'metadata-invalid',
        'Stored Google Drive account metadata is invalid',
        { cause }
      )
    }
  }

  async function readStoredAuthority(): Promise<StoredAuthority> {
    const metadata = await readMetadata()
    if (!metadata) {
      throw new GoogleDriveOAuthError(
        'inconsistent-state',
        'Google Drive credential is missing account metadata'
      )
    }
    const raw = await options.resolver.resolve(reference)
    if (!raw) {
      throw new GoogleDriveOAuthError('credential-missing', 'Google Drive credential is missing')
    }
    let refresh: GoogleDriveRefreshTokenEnvelope
    try {
      refresh = parseGoogleDriveRefreshTokenEnvelopeJSON(raw)
    } catch (cause) {
      throw new GoogleDriveOAuthError(
        'credential-invalid',
        'Stored Google Drive credential is invalid',
        { cause }
      )
    }
    if (!validToken(refresh.refreshToken)) {
      throw new GoogleDriveOAuthError(
        'credential-invalid',
        'Stored Google Drive credential must be reconnected for this build'
      )
    }
    if (
      refresh.subject !== metadata.subject ||
      refresh.authorizationVersion !== metadata.authorizationVersion
    ) {
      throw new GoogleDriveOAuthError(
        'inconsistent-state',
        'Google Drive credential does not match its account binding'
      )
    }
    const oauthClient = storedOAuthClient(metadata, refresh, publisher)
    if (!oauthClient) {
      throw new GoogleDriveOAuthError(
        'credential-invalid',
        'Stored Google Drive credential must be reconnected for this build'
      )
    }
    return { metadata, refresh, oauthClient }
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
      const value = parseGoogleDriveRefreshTokenEnvelopeJSON(raw)
      return validToken(value.refreshToken) ? { state: 'valid', value } : { state: 'invalid' }
    } catch {
      return { state: 'invalid' }
    }
  }

  async function status(): Promise<GoogleDriveOAuthStatus> {
    if (!supported) return { state: 'unsupported', profileId: options.profileId }
    if (persistenceFailure) {
      return invalidStatus(options.profileId, 'credential-invalid', [], false)
    }
    const [credentialStatus, metadata] = await Promise.all([
      observeCredentialStatus(),
      observeMetadata()
    ])
    const refresh = credentialStatus === 'configured' ? await observeRefresh() : undefined
    return statusFromRecords(options.profileId, credentialStatus, metadata, publisher, refresh)
  }

  async function previousAuthorization(
    durableExpectedSubject: string | null = null
  ): Promise<PreviousAuthorization> {
    const credentialStatus = await observeCredentialStatus()
    if (credentialStatus === 'locked') {
      throw new GoogleDriveOAuthError('credential-locked', 'The credential store is locked')
    }
    if (credentialStatus === 'unavailable') {
      throw new GoogleDriveOAuthError(
        'credential-unavailable',
        'The encrypted credential store is unavailable'
      )
    }
    const metadataObservation = await observeMetadata()
    const metadata = metadataObservation.state === 'valid' ? metadataObservation.value : null
    const trustworthySubject = metadata?.subject ?? durableExpectedSubject
    let credential: string | null = null
    let refresh: GoogleDriveRefreshTokenEnvelope | null = null
    if (credentialStatus === 'configured') {
      try {
        credential = await options.resolver.resolve(reference)
      } catch (cause) {
        if (cause instanceof CredentialStoreError && cause.code === 'locked') {
          throw new GoogleDriveOAuthError('credential-locked', 'The credential store is locked', {
            cause
          })
        }
        throw new GoogleDriveOAuthError(
          'credential-unavailable',
          'The encrypted credential store is unavailable',
          { cause }
        )
      }
      if (credential) {
        refresh = parsePreviousRefreshCredential(credential, trustworthySubject !== null)
      } else if (trustworthySubject === null) {
        throw new GoogleDriveOAuthError(
          'inconsistent-state',
          'Google Drive authorization has no trustworthy account identity'
        )
      }
    }
    if (metadataObservation.state === 'invalid' && !refresh && trustworthySubject === null) {
      throw new GoogleDriveOAuthError(
        'inconsistent-state',
        'Google Drive authorization has no trustworthy account identity'
      )
    }
    if (refresh && metadata && refresh.subject !== metadata.subject) {
      throw new GoogleDriveOAuthError(
        'inconsistent-state',
        'Google Drive credential belongs to a different account than its public binding'
      )
    }
    return { metadata, credential, refresh }
  }

  function replacementOAuthClient(
    previous: PreviousAuthorization,
    requested?: GoogleDriveOAuthConnectClient
  ): GoogleDriveOAuthClient {
    if (requested?.mode === 'self-hosted-desktop') {
      try {
        return parseGoogleDriveOAuthClient(requested)
      } catch (cause) {
        throw new GoogleDriveOAuthError(
          'invalid-client-id',
          'Google Desktop OAuth credentials are invalid',
          { cause }
        )
      }
    }
    if (requested?.mode === 'publisher-broker') {
      if (publisher) return publisher
      throw new GoogleDriveOAuthError(
        'invalid-client-id',
        'This build does not provide a publisher-managed Google OAuth client'
      )
    }
    if (
      previous.refresh &&
      isGoogleDriveRefreshTokenEnvelopeV2(previous.refresh) &&
      previous.refresh.oauthClient.mode === 'self-hosted-desktop'
    ) {
      return previous.refresh.oauthClient
    }
    if (
      previous.metadata &&
      isGoogleDriveOAuthPublicMetadataV2(previous.metadata) &&
      previous.metadata.oauthClient.mode === 'self-hosted-desktop'
    ) {
      throw new GoogleDriveOAuthError(
        'self-hosted-credentials-required',
        'Reimport the Google Desktop OAuth credentials for this profile'
      )
    }
    if (publisher) return publisher
    throw new GoogleDriveOAuthError(
      'invalid-client-id',
      'This build does not provide a publisher-managed Google OAuth client'
    )
  }

  async function authorizeReplacement(
    previousSubject: string | null,
    expectedSubject: string | null,
    oauthClient: GoogleDriveOAuthClient,
    signal?: AbortSignal
  ): Promise<ReplacementAuthorization> {
    if (previousSubject && expectedSubject && previousSubject !== expectedSubject) {
      throw new GoogleDriveOAuthError(
        'inconsistent-state',
        'Google Drive profile work belongs to a different account than its saved authorization'
      )
    }
    let result: GoogleDriveNativeAuthorizeResult
    try {
      result = await native.authorize({ oauthClient: nativeOAuthClient(oauthClient) }, signal)
    } catch (cause) {
      throw nativeFailure(cause)
    }
    const authorizationVersion = createVersion()
    let metadata: GoogleDriveOAuthPublicMetadata
    let refresh: GoogleDriveRefreshTokenEnvelope
    try {
      throwIfGoogleDriveOAuthAborted(signal)
      metadata = metadataFromAuthorization(
        options.profileId,
        authorizationVersion,
        result,
        oauthClient
      )
      refresh = envelopeFromAuthorization(authorizationVersion, result, oauthClient)
      accessToken(result, metadata, now())
    } catch (cause) {
      await bestEffortGoogleDriveRevoke(native, result.refreshToken)
      throw cause
    }
    const requiredSubject = previousSubject ?? expectedSubject
    if (requiredSubject && requiredSubject !== metadata.subject) {
      await bestEffortGoogleDriveRevoke(native, result.refreshToken)
      throw new GoogleDriveOAuthError(
        'profile-account-mismatch',
        'Use a new Google Drive profile for a different Google account'
      )
    }
    return { result, metadata, refresh }
  }

  async function observeReplacementPersistence(
    replacement: ReplacementAuthorization,
    serializedRefresh: string
  ): Promise<ReplacementPersistenceObservation> {
    try {
      const [metadata, refresh] = await Promise.all([
        metadataStore.read(options.profileId),
        options.resolver.resolve(reference)
      ])
      const committed =
        refresh === serializedRefresh &&
        metadata !== null &&
        JSON.stringify(metadata) === JSON.stringify(replacement.metadata)
      return { state: committed ? 'committed' : 'not-committed' }
    } catch (cause) {
      return { state: 'unavailable', cause }
    }
  }

  async function persistReplacement(
    previous: PreviousAuthorization,
    replacement: ReplacementAuthorization,
    signal?: AbortSignal,
    onCommitStart?: () => void
  ): Promise<void> {
    const serializedReplacement = serializeGoogleDriveRefreshTokenEnvelope(replacement.refresh)
    const stagedMetadata = parseGoogleDriveOAuthPublicMetadata({
      ...replacement.metadata,
      authorizationVersion: stagedAuthorizationVersion(previous, replacement)
    })
    let persistenceStarted = false
    try {
      throwIfGoogleDriveOAuthAborted(signal)
      persistenceStarted = true
      // The staged metadata intentionally matches neither the old nor the new
      // credential. Any crash or failed rollback before the final write is
      // therefore invalid after restart instead of silently selecting a grant.
      await metadataStore.write(stagedMetadata)
      throwIfGoogleDriveOAuthAborted(signal)
      await options.manager.set(reference, serializedReplacement)
      throwIfGoogleDriveOAuthAborted(signal)
      onCommitStart?.()
      try {
        // This is the single local commit point. The callback has already made
        // it non-cancellable to the caller, so an abort after this write starts
        // cannot turn a completed replacement into a reported cancellation.
        await metadataStore.write(replacement.metadata)
      } catch (commitCause) {
        const observation = await observeReplacementPersistence(replacement, serializedReplacement)
        if (observation.state === 'not-committed') throw commitCause
        if (observation.state === 'unavailable') {
          const failure = new GoogleDriveOAuthError(
            'persistence-failed',
            'Google Drive authorization storage outcome could not be verified',
            {
              cause: new AggregateError(
                [commitCause, observation.cause],
                'Google Drive authorization commit and durable readback failed'
              )
            }
          )
          throw new GoogleDriveOAuthCommitOutcomeUnverifiedError(failure)
        }
      }
    } catch (cause) {
      // Once the final write has an unobservable result, rollback or revoke could
      // destroy a real commit. Preserve either the exact committed pair or the
      // restart-invalid staged mismatch and require a fresh session to decide.
      if (cause instanceof GoogleDriveOAuthCommitOutcomeUnverifiedError) {
        persistenceFailure = cause.failure
        throw cause.failure
      }
      if (!persistenceStarted) {
        await bestEffortGoogleDriveRevoke(native, replacement.result.refreshToken)
        throw cause
      }
      const rollbackErrors: unknown[] = []
      try {
        if (previous.credential) await options.manager.set(reference, previous.credential)
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
      await bestEffortGoogleDriveRevoke(native, replacement.result.refreshToken)
      if (
        rollbackErrors.length === 0 &&
        cause instanceof GoogleDriveOAuthError &&
        cause.code === 'cancelled'
      ) {
        throw cause
      }
      const failure = new GoogleDriveOAuthError(
        'persistence-failed',
        rollbackErrors.length === 0
          ? 'Google Drive authorization could not be stored'
          : 'Google Drive authorization could not be stored or safely rolled back',
        {
          cause:
            rollbackErrors.length === 0
              ? cause
              : new AggregateError(
                  [cause, ...rollbackErrors],
                  'Google Drive authorization persistence and rollback failed'
                )
        }
      )
      if (rollbackErrors.length > 0) persistenceFailure = failure
      throw failure
    }
    persistenceFailure = null
  }

  async function connect(
    connectOptions: GoogleDriveOAuthConnectOptions = {}
  ): Promise<GoogleDriveOAuthConnectResult> {
    requireSupported()
    beginMutation()
    try {
      const expectedSubject = connectOptions.expectedSubject ?? null
      if (
        expectedSubject !== null &&
        (expectedSubject.length === 0 ||
          expectedSubject.length > 256 ||
          /\p{Cc}/u.test(expectedSubject))
      ) {
        throw new GoogleDriveOAuthError(
          'inconsistent-state',
          'Google Drive profile work has an invalid account identity'
        )
      }
      const previous = await previousAuthorization(expectedSubject)
      const previousSubject = previous.metadata?.subject ?? previous.refresh?.subject ?? null
      const oauthClient = replacementOAuthClient(previous, connectOptions.oauthClient)
      const replacement = await authorizeReplacement(
        previousSubject,
        expectedSubject,
        oauthClient,
        connectOptions.signal
      )
      await persistReplacement(
        previous,
        replacement,
        connectOptions.signal,
        connectOptions.onCommitStart
      )
      cachedAccessToken = accessToken(replacement.result, replacement.metadata, now())
      return {
        ...connection(replacement.metadata, oauthClient),
        replacedAuthorities: durableAuthorities(previous.refresh, previous.metadata)
      }
    } finally {
      mutationInProgress = false
    }
  }

  function beginMutation(): void {
    if (mutationInProgress) {
      throw new GoogleDriveOAuthError('busy', 'Google Drive authorization is already changing')
    }
    mutationInProgress = true
    generation++
    refreshController?.abort()
    cachedAccessToken = null
  }

  async function refreshAccessToken(): Promise<GoogleDriveAccessToken> {
    const refreshGeneration = generation
    const authority = await readStoredAuthority()
    const controller = new AbortController()
    refreshController = controller
    let result: GoogleDriveNativeRefreshResult
    try {
      result = await native.refresh(
        {
          oauthClient: nativeOAuthClient(authority.oauthClient),
          refreshToken: authority.refresh.refreshToken,
          expectedSubject: authority.metadata.subject
        },
        controller.signal
      )
    } catch (cause) {
      throw nativeFailure(cause)
    } finally {
      if (refreshController === controller) refreshController = null
    }
    if (refreshGeneration !== generation) {
      throw new GoogleDriveOAuthError('busy', 'Google Drive authorization changed during refresh')
    }
    const value = accessToken(result, authority.metadata, now())
    cachedAccessToken = value
    return value
  }

  async function getAccessToken(signal?: AbortSignal): Promise<GoogleDriveAccessToken> {
    requireSupported()
    if (persistenceFailure) throw persistenceFailure
    if (mutationInProgress) {
      throw new GoogleDriveOAuthError('busy', 'Google Drive authorization is changing')
    }
    if (cachedAccessToken && cachedAccessToken.expiresAt > now() + ACCESS_TOKEN_EXPIRY_SKEW_MS) {
      return waitForGoogleDriveOAuth(Promise.resolve(cachedAccessToken), signal)
    }
    if (!refreshPromise) {
      const pending = refreshAccessToken()
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
    return waitForGoogleDriveOAuth(refreshPromise, signal)
  }

  async function disconnect(
    disconnectOptions: GoogleDriveDisconnectOptions = {},
    signal?: AbortSignal
  ): Promise<GoogleDriveDisconnectResult> {
    const localOnly = disconnectOptions.mode === 'local-only'
    if (!localOnly) requireSupported()
    beginMutation()
    try {
      const credentialStatus = await options.manager.status(reference)
      if (credentialStatus === 'locked') {
        return { outcome: 'revoke-failed', reason: 'credential-locked' }
      }
      if (credentialStatus === 'unavailable') {
        return { outcome: 'revoke-failed', reason: 'credential-unavailable' }
      }
      if (credentialStatus === 'configured' && !localOnly) {
        let authority: StoredAuthority
        try {
          authority = await readStoredAuthority()
        } catch {
          return { outcome: 'revoke-failed', reason: 'credential-invalid' }
        }
        try {
          await native.revoke({ token: authority.refresh.refreshToken }, signal)
        } catch {
          return { outcome: 'revoke-failed', reason: 'native-failed' }
        }
      }
      try {
        await options.manager.clear(reference)
        await metadataStore.remove(options.profileId)
      } catch (cause) {
        throw new GoogleDriveOAuthError(
          'persistence-failed',
          'Google Drive authorization could not be cleared',
          { cause }
        )
      }
      persistenceFailure = null
      return { outcome: 'disconnected', localOnly }
    } finally {
      mutationInProgress = false
    }
  }

  function dispose(): void {
    generation++
    refreshController?.abort()
    refreshController = null
    cachedAccessToken = null
  }

  return Object.freeze({ status, connect, disconnect, getAccessToken, dispose })
}

export { GOOGLE_DRIVE_OAUTH_SCOPES }
export type { GoogleDriveOAuthPublicMetadata, GoogleDriveOAuthMetadataStore }
