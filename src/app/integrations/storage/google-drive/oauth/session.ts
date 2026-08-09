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
  type GoogleDriveNativeRefreshResult
} from '@/app/tauri/google-drive'

import {
  googleDriveAccountLabel,
  GOOGLE_DRIVE_OAUTH_SCOPES,
  parseGoogleDriveOAuthPublicMetadata,
  parseGoogleDriveRefreshTokenEnvelope,
  parseGoogleDriveRefreshTokenEnvelopeJSON,
  serializeGoogleDriveRefreshTokenEnvelope,
  type GoogleDriveOAuthPublicMetadata,
  type GoogleDriveRefreshTokenEnvelope
} from './envelope'
import { LocalGoogleDriveOAuthMetadataStore, type GoogleDriveOAuthMetadataStore } from './metadata'
import { bestEffortGoogleDriveRevoke, waitForGoogleDriveOAuth } from './runtime'

const GOOGLE_DRIVE_INTEGRATION_ID = 'google-drive'
const GOOGLE_DRIVE_REFRESH_TOKEN_FIELD = 'refresh-token'
const GOOGLE_OAUTH_CLIENT_ID_PATTERN = /^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/
const MAX_OAUTH_TOKEN_LENGTH = 16 * 1024
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000

export type GoogleDriveOAuthErrorCode =
  | 'unsupported'
  | 'cancelled'
  | 'invalid-client-id'
  | 'invalid-profile'
  | 'busy'
  | 'credential-locked'
  | 'credential-unavailable'
  | 'credential-missing'
  | 'credential-invalid'
  | 'metadata-invalid'
  | 'inconsistent-state'
  | 'profile-account-mismatch'
  | 'scope-mismatch'
  | 'subject-mismatch'
  | 'persistence-failed'
  | 'native-failed'

export class GoogleDriveOAuthError extends Error {
  constructor(
    readonly code: GoogleDriveOAuthErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'GoogleDriveOAuthError'
  }
}

export type GoogleDriveOAuthConnection = {
  profileId: string
  subject: string
  email?: string
  accountLabel: string
  authorizationVersion: string
  grantedScopes: typeof GOOGLE_DRIVE_OAUTH_SCOPES
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
  clientId: string
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
}

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

function validatedClientId(value: string): string {
  if (value.length < 20 || value.length > 256 || !GOOGLE_OAUTH_CLIENT_ID_PATTERN.test(value)) {
    throw new GoogleDriveOAuthError('invalid-client-id', 'Google OAuth client ID is invalid')
  }
  return value
}

function randomAuthorizationVersion(): string {
  return randomHex(16)
}

function validToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_OAUTH_TOKEN_LENGTH &&
    !/\p{Cc}/u.test(value)
  )
}

function validExpiry(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 86_400
}

function nativeFailure(error: unknown): GoogleDriveOAuthError {
  if (error instanceof GoogleDriveOAuthError) return error
  const cancelled =
    (error instanceof GoogleDriveNativeError && error.code === 'cancelled') ||
    (error instanceof Error && error.name === 'AbortError')
  return new GoogleDriveOAuthError(
    cancelled ? 'cancelled' : 'native-failed',
    cancelled
      ? 'Google Drive authorization was cancelled'
      : 'Google Drive native authorization failed',
    { cause: error }
  )
}

function connection(metadata: GoogleDriveOAuthPublicMetadata): GoogleDriveOAuthConnection {
  return {
    profileId: metadata.profileId,
    subject: metadata.subject,
    ...(metadata.email ? { email: metadata.email } : {}),
    accountLabel: googleDriveAccountLabel(metadata),
    authorizationVersion: metadata.authorizationVersion,
    grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES
  }
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

function statusFromRecords(
  profileId: string,
  credentialStatus: 'configured' | 'missing' | 'locked' | 'unavailable',
  metadata: MetadataObservation,
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
    const authority = metadata.state === 'valid' ? repairAuthority(metadata.value) : undefined
    let reason: Extract<GoogleDriveOAuthStatus, { state: 'invalid' }>['reason'] =
      'credential-invalid'
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
  return { state: 'connected', ...connection(metadata.value) }
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
  result: GoogleDriveNativeAuthorizeResult
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
    schemaVersion: 1,
    profileId,
    subject: result.subject,
    ...(result.email ? { email: result.email } : {}),
    authorizationVersion,
    grantedScopes: result.grantedScopes
  })
}

function envelopeFromAuthorization(
  authorizationVersion: string,
  result: GoogleDriveNativeAuthorizeResult
): GoogleDriveRefreshTokenEnvelope {
  return parseGoogleDriveRefreshTokenEnvelope({
    schemaVersion: 1,
    refreshToken: result.refreshToken,
    authorizationVersion,
    subject: result.subject
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
  const clientId = validatedClientId(options.clientId)
  const reference = googleDriveRefreshTokenCredentialRef(options.profileId)
  const metadataStore = options.metadataStore ?? new LocalGoogleDriveOAuthMetadataStore()
  const native = options.native ?? googleDriveNativeBridge
  const supported =
    options.native !== undefined || (IS_TAURI && options.manager.backend === 'native')
  const now = options.now ?? Date.now
  const createVersion = options.randomAuthorizationVersion ?? randomAuthorizationVersion
  let cachedAccessToken: GoogleDriveAccessToken | null = null
  let refreshPromise: Promise<GoogleDriveAccessToken> | null = null
  let refreshController: AbortController | null = null
  let generation = 0
  let mutationInProgress = false

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
    if (
      refresh.subject !== metadata.subject ||
      refresh.authorizationVersion !== metadata.authorizationVersion
    ) {
      throw new GoogleDriveOAuthError(
        'inconsistent-state',
        'Google Drive credential does not match its account binding'
      )
    }
    return { metadata, refresh }
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
      return { state: 'valid', value: parseGoogleDriveRefreshTokenEnvelopeJSON(raw) }
    } catch {
      return { state: 'invalid' }
    }
  }

  async function status(): Promise<GoogleDriveOAuthStatus> {
    if (!supported) return { state: 'unsupported', profileId: options.profileId }
    const [credentialStatus, metadata] = await Promise.all([
      observeCredentialStatus(),
      observeMetadata()
    ])
    const refresh = credentialStatus === 'configured' ? await observeRefresh() : undefined
    return statusFromRecords(options.profileId, credentialStatus, metadata, refresh)
  }

  async function previousAuthorization(): Promise<PreviousAuthorization> {
    const credentialStatus = await observeCredentialStatus()
    if (credentialStatus === 'locked') {
      throw new GoogleDriveOAuthError('credential-locked', 'The system credential store is locked')
    }
    if (credentialStatus === 'unavailable') {
      throw new GoogleDriveOAuthError(
        'credential-unavailable',
        'The system credential store is unavailable'
      )
    }
    const metadataObservation = await observeMetadata()
    const metadata = metadataObservation.state === 'valid' ? metadataObservation.value : null
    let credential: string | null = null
    let refresh: GoogleDriveRefreshTokenEnvelope | null = null
    if (credentialStatus === 'configured') {
      try {
        credential = await options.resolver.resolve(reference)
      } catch (cause) {
        if (cause instanceof CredentialStoreError && cause.code === 'locked') {
          throw new GoogleDriveOAuthError(
            'credential-locked',
            'The system credential store is locked',
            { cause }
          )
        }
        throw new GoogleDriveOAuthError(
          'credential-unavailable',
          'The system credential store is unavailable',
          { cause }
        )
      }
      if (credential) {
        try {
          refresh = parseGoogleDriveRefreshTokenEnvelopeJSON(credential)
        } catch (cause) {
          if (!metadata) {
            throw new GoogleDriveOAuthError(
              'inconsistent-state',
              'Google Drive authorization has no trustworthy account identity',
              { cause }
            )
          }
        }
      } else if (!metadata) {
        throw new GoogleDriveOAuthError(
          'inconsistent-state',
          'Google Drive authorization has no trustworthy account identity'
        )
      }
    }
    if (metadataObservation.state === 'invalid' && !refresh) {
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

  async function authorizeReplacement(
    previousSubject: string | null,
    signal?: AbortSignal
  ): Promise<ReplacementAuthorization> {
    let result: GoogleDriveNativeAuthorizeResult
    try {
      result = await native.authorize({ clientId }, signal)
    } catch (cause) {
      throw nativeFailure(cause)
    }
    const authorizationVersion = createVersion()
    let metadata: GoogleDriveOAuthPublicMetadata
    let refresh: GoogleDriveRefreshTokenEnvelope
    try {
      metadata = metadataFromAuthorization(options.profileId, authorizationVersion, result)
      refresh = envelopeFromAuthorization(authorizationVersion, result)
      accessToken(result, metadata, now())
    } catch (cause) {
      await bestEffortGoogleDriveRevoke(native, result.refreshToken)
      throw cause
    }
    if (previousSubject && previousSubject !== metadata.subject) {
      await bestEffortGoogleDriveRevoke(native, result.refreshToken)
      throw new GoogleDriveOAuthError(
        'profile-account-mismatch',
        'Use a new Google Drive profile for a different Google account'
      )
    }
    return { result, metadata, refresh }
  }

  async function persistReplacement(
    previous: PreviousAuthorization,
    replacement: ReplacementAuthorization
  ): Promise<void> {
    try {
      await options.manager.set(
        reference,
        serializeGoogleDriveRefreshTokenEnvelope(replacement.refresh)
      )
      await metadataStore.write(replacement.metadata)
    } catch (cause) {
      try {
        if (previous.credential) await options.manager.set(reference, previous.credential)
        else await options.manager.clear(reference)
      } catch (rollbackError) {
        void rollbackError
      }
      try {
        if (previous.metadata) await metadataStore.write(previous.metadata)
        else await metadataStore.remove(options.profileId)
      } catch (rollbackError) {
        void rollbackError
      }
      // A later status call parses both records and exposes any partial rollback as invalid.
      await bestEffortGoogleDriveRevoke(native, replacement.result.refreshToken)
      throw new GoogleDriveOAuthError(
        'persistence-failed',
        'Google Drive authorization could not be stored',
        { cause }
      )
    }
  }

  async function connect(signal?: AbortSignal): Promise<GoogleDriveOAuthConnectResult> {
    requireSupported()
    beginMutation()
    try {
      const previous = await previousAuthorization()
      const replacement = await authorizeReplacement(
        previous.metadata?.subject ?? previous.refresh?.subject ?? null,
        signal
      )
      await persistReplacement(previous, replacement)
      cachedAccessToken = accessToken(replacement.result, replacement.metadata, now())
      return {
        ...connection(replacement.metadata),
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
          clientId,
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
