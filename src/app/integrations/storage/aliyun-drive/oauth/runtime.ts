import { credentialRef } from '@/app/settings/credentials/reference'
import {
  CredentialStoreError,
  type CredentialManager,
  type CredentialResolver
} from '@/app/settings/credentials/types'
import {
  type AliyunDriveNativeAuthorizeResult,
  type AliyunDriveNativeBridge,
  type AliyunDriveNativeConfidentialOAuthClient,
  type AliyunDriveNativeOAuthClient
} from '@/app/tauri/aliyun-drive'

import { ALIYUN_DRIVE_OAUTH_SCOPES } from '../config'
import type { AliyunDriveOAuthToken } from '../types'
import {
  aliyunDriveOAuthClientPublic,
  aliyunDriveOAuthClientsEqual,
  aliyunDriveOAuthPublicClientsEqual,
  parseAliyunDriveAuthorizationEnvelope,
  parseAliyunDriveAuthorizationEnvelopeJSON,
  parseAliyunDriveOAuthPublicMetadata,
  serializeAliyunDriveAuthorizationEnvelope,
  type AliyunDriveAuthorizationEnvelope,
  type AliyunDriveConfidentialOAuthClient,
  type AliyunDriveOAuthClient,
  type AliyunDriveOAuthPublicMetadata,
  type AliyunDrivePublisherBrokerOAuthClient,
  type AliyunDriveRefreshGrantEnvelope
} from './envelope'
import { AliyunDriveOAuthError, aliyunDriveOAuthNativeFailure } from './errors'
import type { AliyunDriveOAuthMetadataStore } from './metadata'

const ALIYUN_DRIVE_INTEGRATION_ID = 'aliyun-drive'
const ALIYUN_DRIVE_AUTHORIZATION_FIELD = 'authorization'
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000
const MAX_TOKEN_BYTES = 8 * 1024
const MAX_EXPIRES_IN_SECONDS = 31 * 24 * 60 * 60

export type AliyunDriveStoredAuthorization = Readonly<{
  raw: string
  envelope: AliyunDriveAuthorizationEnvelope
  metadata: AliyunDriveOAuthPublicMetadata
}>

export type AliyunDriveValidatedNativeAuthorization = Readonly<{
  envelope: AliyunDriveAuthorizationEnvelope
  accessToken: string
  expiresAt: number
  subject: string
  email?: string
}>

export type CreateAliyunDriveOAuthRuntimeOptions = Readonly<{
  profileId: string
  manager: CredentialManager
  resolver: CredentialResolver
  metadataStore: AliyunDriveOAuthMetadataStore
  publisherClient?: AliyunDrivePublisherBrokerOAuthClient | null
  native?: AliyunDriveNativeBridge
  now?: () => number
}>

export function aliyunDriveAuthorizationCredentialRef(profileId: string) {
  return credentialRef(ALIYUN_DRIVE_INTEGRATION_ID, ALIYUN_DRIVE_AUTHORIZATION_FIELD, profileId)
}

function validToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= MAX_TOKEN_BYTES &&
    value.trim() === value &&
    !/\s/u.test(value) &&
    !/\p{Cc}/u.test(value)
  )
}

function validSubject(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  )
}

function validEmail(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 512 &&
      value.trim() === value &&
      !/\p{Cc}/u.test(value))
  )
}

function validExpiresIn(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) > 0 &&
    (value as number) <= MAX_EXPIRES_IN_SECONDS
  )
}

function exactScopes(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== ALIYUN_DRIVE_OAUTH_SCOPES.length) return false
  const scopes = new Set(value)
  return (
    scopes.size === ALIYUN_DRIVE_OAUTH_SCOPES.length &&
    ALIYUN_DRIVE_OAUTH_SCOPES.every((scope) => scopes.has(scope))
  )
}

export function aliyunDriveNativeOAuthClient(
  client: AliyunDriveOAuthClient
): AliyunDriveNativeOAuthClient {
  if (client.mode === 'publisher-broker-confidential') {
    return Object.freeze({ mode: 'publisher-broker-confidential' })
  }
  if (client.mode === 'self-hosted-confidential') {
    return Object.freeze({
      mode: 'self-hosted-confidential',
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      redirectUri: client.redirectUri
    })
  }
  return Object.freeze({
    mode: 'self-hosted-public',
    clientId: client.clientId,
    redirectUri: client.redirectUri
  })
}

function confidentialNativeOAuthClient(
  client: AliyunDriveConfidentialOAuthClient
): AliyunDriveNativeConfidentialOAuthClient {
  const native = aliyunDriveNativeOAuthClient(client)
  if (native.mode === 'self-hosted-public') {
    throw new AliyunDriveOAuthError('invalid-client', 'Aliyun Drive OAuth mode is invalid')
  }
  return native
}

export function validateAliyunDriveNativeAuthorization(
  client: AliyunDriveOAuthClient,
  authorizationVersion: string,
  result: AliyunDriveNativeAuthorizeResult,
  now: number
): AliyunDriveValidatedNativeAuthorization {
  const expectedGrant = client.mode === 'self-hosted-public' ? 'access-grant' : 'refresh-grant'
  if (
    result.grantType !== expectedGrant ||
    !validToken(result.accessToken) ||
    !validExpiresIn(result.expiresIn) ||
    !exactScopes(result.grantedScopes) ||
    !validSubject(result.subject) ||
    !validEmail(result.email)
  ) {
    throw new AliyunDriveOAuthError(
      result.grantType === expectedGrant ? 'token-response-invalid' : 'invalid-client',
      'Aliyun Drive returned an authorization for the wrong mode or an invalid token response'
    )
  }
  const expiresAt = now + result.expiresIn * 1_000
  if (!Number.isSafeInteger(expiresAt)) {
    throw new AliyunDriveOAuthError(
      'token-response-invalid',
      'Aliyun Drive returned an invalid access token expiry'
    )
  }
  let envelope: AliyunDriveAuthorizationEnvelope
  if (result.grantType === 'refresh-grant' && client.mode !== 'self-hosted-public') {
    if (!validToken(result.refreshToken)) {
      throw new AliyunDriveOAuthError(
        'token-response-invalid',
        'Aliyun Drive returned an invalid refresh token'
      )
    }
    envelope = parseAliyunDriveAuthorizationEnvelope({
      schemaVersion: 1,
      grantType: 'refresh-grant',
      subject: result.subject,
      authorizationVersion,
      oauthClient: client,
      refreshToken: result.refreshToken,
      accessToken: result.accessToken,
      accessExpiresAt: expiresAt
    })
  } else if (result.grantType === 'access-grant' && client.mode === 'self-hosted-public') {
    envelope = parseAliyunDriveAuthorizationEnvelope({
      schemaVersion: 1,
      grantType: 'access-grant',
      subject: result.subject,
      authorizationVersion,
      oauthClient: client,
      accessToken: result.accessToken,
      accessExpiresAt: expiresAt
    })
  } else {
    throw new AliyunDriveOAuthError(
      'invalid-client',
      'Aliyun Drive OAuth mode changed unexpectedly'
    )
  }
  return Object.freeze({
    envelope,
    accessToken: result.accessToken,
    expiresAt,
    subject: result.subject,
    ...(result.email === undefined ? {} : { email: result.email })
  })
}

function credentialError(cause: unknown): AliyunDriveOAuthError {
  if (cause instanceof CredentialStoreError && cause.code === 'locked') {
    return new AliyunDriveOAuthError('credential-locked', 'The credential store is locked', {
      cause
    })
  }
  return new AliyunDriveOAuthError(
    'credential-unavailable',
    'The encrypted credential store is unavailable',
    { cause }
  )
}

function validateStoredPair(
  envelope: AliyunDriveAuthorizationEnvelope,
  metadata: AliyunDriveOAuthPublicMetadata,
  publisherClient?: AliyunDrivePublisherBrokerOAuthClient | null
): void {
  if (
    envelope.subject !== metadata.subject ||
    envelope.authorizationVersion !== metadata.authorizationVersion ||
    envelope.grantType !== metadata.grantType ||
    !aliyunDriveOAuthPublicClientsEqual(
      aliyunDriveOAuthClientPublic(envelope.oauthClient),
      metadata.oauthClient
    ) ||
    (envelope.grantType === 'access-grant' &&
      metadata.grantType === 'access-grant' &&
      envelope.accessExpiresAt !== metadata.accessExpiresAt)
  ) {
    throw new AliyunDriveOAuthError(
      'authority-mismatch',
      'Aliyun Drive credential does not match its public account binding'
    )
  }
  if (
    envelope.oauthClient.mode === 'publisher-broker-confidential' &&
    (!publisherClient || !aliyunDriveOAuthClientsEqual(envelope.oauthClient, publisherClient))
  ) {
    throw new AliyunDriveOAuthError(
      'authority-mismatch',
      'Aliyun Drive publisher authorization does not match this build'
    )
  }
}

export async function readAliyunDriveStoredAuthorization(
  options: Pick<
    CreateAliyunDriveOAuthRuntimeOptions,
    'profileId' | 'manager' | 'resolver' | 'metadataStore' | 'publisherClient'
  >
): Promise<AliyunDriveStoredAuthorization> {
  const reference = aliyunDriveAuthorizationCredentialRef(options.profileId)
  let status: Awaited<ReturnType<CredentialManager['status']>>
  try {
    status = await options.manager.status(reference)
  } catch (cause) {
    throw credentialError(cause)
  }
  if (status === 'locked') {
    throw new AliyunDriveOAuthError('credential-locked', 'The credential store is locked')
  }
  if (status === 'unavailable') {
    throw new AliyunDriveOAuthError(
      'credential-unavailable',
      'The encrypted credential store is unavailable'
    )
  }
  if (status === 'missing') {
    throw new AliyunDriveOAuthError('credential-missing', 'Aliyun Drive credential is missing')
  }
  let raw: string | null
  try {
    raw = await options.resolver.resolve(reference)
  } catch (cause) {
    throw credentialError(cause)
  }
  if (!raw) {
    throw new AliyunDriveOAuthError('credential-missing', 'Aliyun Drive credential is missing')
  }
  let envelope: AliyunDriveAuthorizationEnvelope
  try {
    envelope = parseAliyunDriveAuthorizationEnvelopeJSON(raw)
  } catch (cause) {
    throw new AliyunDriveOAuthError('credential-invalid', 'Aliyun Drive credential is invalid', {
      cause
    })
  }
  let metadata: AliyunDriveOAuthPublicMetadata | null
  try {
    const candidate = await options.metadataStore.read(options.profileId)
    metadata = candidate ? parseAliyunDriveOAuthPublicMetadata(candidate) : null
  } catch (cause) {
    throw new AliyunDriveOAuthError('metadata-invalid', 'Aliyun Drive metadata is invalid', {
      cause
    })
  }
  if (!metadata) {
    throw new AliyunDriveOAuthError('metadata-missing', 'Aliyun Drive account metadata is missing')
  }
  validateStoredPair(envelope, metadata, options.publisherClient)
  return Object.freeze({ raw, envelope, metadata })
}

function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('The operation was aborted', 'AbortError')
      )
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
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
            : new Error('Aliyun Drive access token request failed', { cause: error })
        )
        return undefined
      }
    )
  })
}

export function createAliyunDriveOAuthRuntime(options: CreateAliyunDriveOAuthRuntimeOptions) {
  const now = options.now ?? Date.now
  const reference = aliyunDriveAuthorizationCredentialRef(options.profileId)
  let refreshPromise: Promise<AliyunDriveOAuthToken> | null = null
  let persistenceFailure: AliyunDriveOAuthError | null = null
  let disposed = false

  function failRotationPersistence(...causes: unknown[]): never {
    const failure = new AliyunDriveOAuthError(
      'persistence-failed',
      'The rotated Aliyun Drive refresh token storage outcome could not be verified',
      {
        cause:
          causes.length === 1
            ? causes[0]
            : new AggregateError(causes, 'Aliyun Drive refresh write and readback failed')
      }
    )
    persistenceFailure = failure
    throw failure
  }

  async function commitRotation(
    previousRaw: string,
    replacement: AliyunDriveRefreshGrantEnvelope
  ): Promise<void> {
    const serialized = serializeAliyunDriveAuthorizationEnvelope(replacement)
    let current: string | null
    try {
      current = await options.resolver.resolve(reference)
    } catch (cause) {
      failRotationPersistence(cause)
    }
    if (current !== previousRaw) {
      failRotationPersistence(
        new AliyunDriveOAuthError('busy', 'Aliyun Drive authorization changed during refresh')
      )
    }

    let writeFailed = false
    let writeCause: unknown
    try {
      await options.manager.set(reference, serialized)
    } catch (cause) {
      writeFailed = true
      writeCause = cause
    }

    let committed: string | null
    try {
      committed = await options.resolver.resolve(reference)
    } catch (cause) {
      failRotationPersistence(...(writeFailed ? [writeCause, cause] : [cause]))
    }
    if (committed !== serialized) {
      const readbackCause = new Error('Aliyun Drive refresh token readback did not match')
      failRotationPersistence(...(writeFailed ? [writeCause, readbackCause] : [readbackCause]))
    }

    persistenceFailure = null
  }

  async function performRefresh(): Promise<AliyunDriveOAuthToken> {
    if (disposed) throw new AliyunDriveOAuthError('busy', 'Aliyun Drive runtime was disposed')
    if (!options.native) {
      throw new AliyunDriveOAuthError(
        'unsupported',
        'Aliyun Drive refresh is available only in the desktop app'
      )
    }
    const stored = await readAliyunDriveStoredAuthorization(options)
    if (stored.envelope.grantType !== 'refresh-grant') {
      throw new AliyunDriveOAuthError(
        'reconnect-required',
        'Aliyun Drive public authorization expired; reconnect the account'
      )
    }
    let result: AliyunDriveNativeAuthorizeResult
    try {
      result = await options.native.refresh({
        oauthClient: confidentialNativeOAuthClient(stored.envelope.oauthClient),
        refreshToken: stored.envelope.refreshToken,
        expectedSubject: stored.envelope.subject
      })
    } catch (cause) {
      throw aliyunDriveOAuthNativeFailure(cause)
    }
    let validated: AliyunDriveValidatedNativeAuthorization
    let replacement: AliyunDriveRefreshGrantEnvelope
    try {
      validated = validateAliyunDriveNativeAuthorization(
        stored.envelope.oauthClient,
        stored.envelope.authorizationVersion,
        result,
        now()
      )
      if (
        validated.envelope.grantType !== 'refresh-grant' ||
        validated.envelope.subject !== stored.envelope.subject
      ) {
        throw new AliyunDriveOAuthError(
          'authority-mismatch',
          'Aliyun Drive refresh returned a different account'
        )
      }
      replacement = validated.envelope
      if (replacement.refreshToken === stored.envelope.refreshToken) {
        throw new AliyunDriveOAuthError(
          'token-response-invalid',
          'Aliyun Drive did not rotate the refresh token'
        )
      }
    } catch (cause) {
      const failure =
        cause instanceof AliyunDriveOAuthError
          ? cause
          : new AliyunDriveOAuthError(
              'token-response-invalid',
              'Aliyun Drive refresh response is invalid',
              { cause }
            )
      persistenceFailure = failure
      throw failure
    }
    await commitRotation(stored.raw, replacement)
    return Object.freeze({
      accessToken: validated.accessToken,
      authority: {
        accountId: validated.subject,
        authorizationVersion: validated.envelope.authorizationVersion
      }
    })
  }

  function startRefresh(): Promise<AliyunDriveOAuthToken> {
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

  async function resolveAccessToken(signal?: AbortSignal): Promise<AliyunDriveOAuthToken> {
    if (disposed) throw new AliyunDriveOAuthError('busy', 'Aliyun Drive runtime was disposed')
    if (persistenceFailure) throw persistenceFailure
    signal?.throwIfAborted()
    const stored = await readAliyunDriveStoredAuthorization(options)
    if (stored.envelope.accessExpiresAt > now() + ACCESS_TOKEN_EXPIRY_SKEW_MS) {
      return Object.freeze({
        accessToken: stored.envelope.accessToken,
        authority: {
          accountId: stored.envelope.subject,
          authorizationVersion: stored.envelope.authorizationVersion
        }
      })
    }
    if (stored.envelope.grantType === 'access-grant') {
      throw new AliyunDriveOAuthError(
        'reconnect-required',
        'Aliyun Drive public authorization expired; reconnect the account'
      )
    }
    return waitForSignal(startRefresh(), signal)
  }

  async function getAuthority() {
    if (persistenceFailure) throw persistenceFailure
    const stored = await readAliyunDriveStoredAuthorization(options)
    return Object.freeze({
      accountId: stored.envelope.subject,
      authorizationVersion: stored.envelope.authorizationVersion
    })
  }

  function resetAfterAuthorizationReplacement(): void {
    if (disposed) throw new AliyunDriveOAuthError('busy', 'Aliyun Drive runtime was disposed')
    persistenceFailure = null
  }

  function dispose(): void {
    disposed = true
  }

  return Object.freeze({
    resolveAccessToken,
    getAuthority,
    isRefreshing: () => refreshPromise !== null,
    resetAfterAuthorizationReplacement,
    dispose
  })
}
