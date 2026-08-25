import { randomHex } from '@open-pencil/core/random'

import {
  CredentialStoreError,
  type CredentialManager,
  type CredentialResolver,
  type CredentialStatus
} from '@/app/settings/credentials/types'
import {
  type AliyunDriveNativeAuthorizeResult,
  type AliyunDriveNativeBridge
} from '@/app/tauri/aliyun-drive'

import type { AliyunDrivePublisherOAuthBuildConfig } from '../config'
import type { AliyunDriveOAuthToken } from '../types'
import {
  aliyunDriveOAuthClientPublic,
  parseAliyunDriveOAuthClient,
  parseAliyunDriveOAuthPublicMetadata,
  serializeAliyunDriveAuthorizationEnvelope,
  type AliyunDriveOAuthClient,
  type AliyunDriveOAuthPublicMetadata,
  type AliyunDrivePublisherBrokerOAuthClient,
  type AliyunDriveSelfHostedConfidentialOAuthClient,
  type AliyunDriveSelfHostedPublicOAuthClient
} from './envelope'
import { AliyunDriveOAuthError, aliyunDriveOAuthNativeFailure } from './errors'
import type { AliyunDriveOAuthMetadataStore } from './metadata'
import {
  aliyunDriveAuthorizationCredentialRef,
  aliyunDriveNativeOAuthClient,
  createAliyunDriveOAuthRuntime,
  readAliyunDriveStoredAuthorization,
  validateAliyunDriveNativeAuthorization
} from './runtime'

const AUTHORIZE_TIMEOUT_MS = 5 * 60_000

export type AliyunDriveOAuthConnectClient =
  | Readonly<{ mode: 'publisher-broker-confidential' }>
  | AliyunDriveSelfHostedConfidentialOAuthClient
  | AliyunDriveSelfHostedPublicOAuthClient

export type AliyunDriveOAuthConnectOptions = Readonly<{
  signal?: AbortSignal
  oauthClient?: AliyunDriveOAuthConnectClient
  expectedSubject?: string
  onCommitStart?: () => void
}>

export type AliyunDriveOAuthConnection = Readonly<{
  profileId: string
  subject: string
  email?: string
  authorizationVersion: string
  oauthClient: ReturnType<typeof aliyunDriveOAuthClientPublic>
  grantType: 'refresh-grant' | 'access-grant'
  accessExpiresAt?: number
}>

export type AliyunDriveOAuthStatus =
  | Readonly<{ state: 'unsupported'; profileId: string }>
  | Readonly<{ state: 'missing'; profileId: string }>
  | Readonly<{ state: 'locked'; profileId: string }>
  | Readonly<{ state: 'unavailable'; profileId: string }>
  | Readonly<{
      state: 'invalid'
      profileId: string
      reason: 'credential-invalid' | 'metadata-invalid' | 'inconsistent-state'
    }>
  | Readonly<{ state: 'expired' } & AliyunDriveOAuthConnection>
  | Readonly<{ state: 'connected' } & AliyunDriveOAuthConnection>

export type CreateAliyunDriveOAuthSessionOptions = Readonly<{
  profileId: string
  publisherConfig?: AliyunDrivePublisherOAuthBuildConfig | null
  manager: CredentialManager
  resolver: CredentialResolver
  metadataStore: AliyunDriveOAuthMetadataStore
  native?: AliyunDriveNativeBridge
  now?: () => number
  randomAuthorizationVersion?: () => string
}>

type PreviousAuthorization = Readonly<{
  raw: string | null
  metadata: AliyunDriveOAuthPublicMetadata | null
}>

function publisherClient(
  config: AliyunDrivePublisherOAuthBuildConfig | null | undefined
): AliyunDrivePublisherBrokerOAuthClient | null {
  if (!config) return null
  try {
    const client = parseAliyunDriveOAuthClient({
      mode: 'publisher-broker-confidential',
      clientId: config.clientId
    })
    return client.mode === 'publisher-broker-confidential' ? client : null
  } catch {
    return null
  }
}

function connection(metadata: AliyunDriveOAuthPublicMetadata): AliyunDriveOAuthConnection {
  return Object.freeze({
    profileId: metadata.profileId,
    subject: metadata.subject,
    ...(metadata.email === undefined ? {} : { email: metadata.email }),
    authorizationVersion: metadata.authorizationVersion,
    oauthClient: metadata.oauthClient,
    grantType: metadata.grantType,
    ...(metadata.grantType === 'access-grant' ? { accessExpiresAt: metadata.accessExpiresAt } : {})
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new AliyunDriveOAuthError('cancelled', 'Aliyun Drive authorization was cancelled', {
    cause: signal.reason
  })
}

function validExpectedSubject(value: string | undefined): boolean {
  return (
    value === undefined ||
    (value.length > 0 && value.length <= 512 && value.trim() === value && !/\p{Cc}/u.test(value))
  )
}

function metadataFromAuthorization(
  profileId: string,
  validated: ReturnType<typeof validateAliyunDriveNativeAuthorization>,
  email?: string
): AliyunDriveOAuthPublicMetadata {
  const common = {
    schemaVersion: 1,
    profileId,
    subject: validated.subject,
    ...(email === undefined ? {} : { email }),
    authorizationVersion: validated.envelope.authorizationVersion,
    oauthClient: aliyunDriveOAuthClientPublic(validated.envelope.oauthClient)
  } as const
  return parseAliyunDriveOAuthPublicMetadata(
    validated.envelope.grantType === 'access-grant'
      ? {
          ...common,
          grantType: 'access-grant',
          accessExpiresAt: validated.envelope.accessExpiresAt
        }
      : { ...common, grantType: 'refresh-grant' }
  )
}

export function createAliyunDriveOAuthSession(options: CreateAliyunDriveOAuthSessionOptions) {
  const now = options.now ?? Date.now
  const createVersion = options.randomAuthorizationVersion ?? (() => randomHex(16))
  const configuredPublisher = publisherClient(options.publisherConfig)
  const reference = aliyunDriveAuthorizationCredentialRef(options.profileId)
  const runtime = createAliyunDriveOAuthRuntime({
    profileId: options.profileId,
    manager: options.manager,
    resolver: options.resolver,
    metadataStore: options.metadataStore,
    publisherClient: configuredPublisher,
    native: options.native,
    now
  })
  let mutationInProgress = false
  let persistenceFailure: AliyunDriveOAuthError | null = null
  let disposed = false

  function requireNative(): AliyunDriveNativeBridge {
    if (disposed) throw new AliyunDriveOAuthError('busy', 'Aliyun Drive session was disposed')
    if (!options.native) {
      throw new AliyunDriveOAuthError(
        'unsupported',
        'Aliyun Drive authorization is available only in the desktop app'
      )
    }
    return options.native
  }

  function selectedClient(connectOptions: AliyunDriveOAuthConnectOptions): AliyunDriveOAuthClient {
    const requested = connectOptions.oauthClient
    if (!requested || requested.mode === 'publisher-broker-confidential') {
      if (!configuredPublisher) {
        throw new AliyunDriveOAuthError(
          'setup-required',
          'This build does not provide the Aliyun Drive Broker configuration'
        )
      }
      return configuredPublisher
    }
    try {
      const parsed = parseAliyunDriveOAuthClient(requested)
      if (parsed.mode === 'publisher-broker-confidential') {
        throw new AliyunDriveOAuthError('invalid-client', 'Aliyun Drive OAuth client is invalid')
      }
      return parsed
    } catch (cause) {
      if (cause instanceof AliyunDriveOAuthError) throw cause
      throw new AliyunDriveOAuthError('invalid-client', 'Aliyun Drive OAuth client is invalid', {
        cause
      })
    }
  }

  function beginMutation(): void {
    if (disposed) throw new AliyunDriveOAuthError('busy', 'Aliyun Drive session was disposed')
    if (mutationInProgress || runtime.isRefreshing()) {
      throw new AliyunDriveOAuthError('busy', 'Aliyun Drive authorization is already changing')
    }
    mutationInProgress = true
  }

  async function credentialStatus(): Promise<CredentialStatus> {
    try {
      return await options.manager.status(reference)
    } catch (cause) {
      if (cause instanceof CredentialStoreError && cause.code === 'locked') return 'locked'
      return 'unavailable'
    }
  }

  async function previousAuthorization(): Promise<PreviousAuthorization> {
    const status = await credentialStatus()
    if (status === 'locked') {
      throw new AliyunDriveOAuthError('credential-locked', 'The credential store is locked')
    }
    if (status === 'unavailable') {
      throw new AliyunDriveOAuthError(
        'credential-unavailable',
        'The encrypted credential store is unavailable'
      )
    }
    let raw: string | null = null
    if (status === 'configured') {
      try {
        raw = await options.resolver.resolve(reference)
      } catch (cause) {
        throw new AliyunDriveOAuthError(
          'credential-unavailable',
          'The encrypted credential store is unavailable',
          { cause }
        )
      }
    }
    let metadata: AliyunDriveOAuthPublicMetadata | null
    try {
      metadata = await options.metadataStore.read(options.profileId)
    } catch {
      metadata = null
    }
    return { raw, metadata }
  }

  async function rollback(previous: PreviousAuthorization): Promise<void> {
    if (previous.raw) await options.manager.set(reference, previous.raw)
    else await options.manager.clear(reference)
    if (previous.metadata) await options.metadataStore.write(previous.metadata)
    else await options.metadataStore.remove(options.profileId)
  }

  async function persistReplacement(
    previous: PreviousAuthorization,
    metadata: AliyunDriveOAuthPublicMetadata,
    raw: string,
    signal?: AbortSignal,
    onCommitStart?: () => void
  ): Promise<void> {
    const staged = parseAliyunDriveOAuthPublicMetadata({
      ...metadata,
      authorizationVersion: `pending.${metadata.authorizationVersion}`
    })
    let started = false
    try {
      throwIfAborted(signal)
      started = true
      await options.metadataStore.write(staged)
      throwIfAborted(signal)
      await options.manager.set(reference, raw)
      const committed = await options.resolver.resolve(reference)
      if (committed !== raw) throw new Error('Aliyun Drive credential readback did not match')
      throwIfAborted(signal)
      onCommitStart?.()
      await options.metadataStore.write(metadata)
    } catch (cause) {
      if (started) {
        try {
          await rollback(previous)
        } catch (rollbackCause) {
          persistenceFailure = new AliyunDriveOAuthError(
            'persistence-failed',
            'Aliyun Drive authorization could not be stored or rolled back',
            { cause: new AggregateError([cause, rollbackCause], 'Aliyun Drive commit failed') }
          )
          throw persistenceFailure
        }
      }
      throw new AliyunDriveOAuthError(
        'persistence-failed',
        'Aliyun Drive authorization could not be stored',
        { cause }
      )
    }
    persistenceFailure = null
  }

  async function status(): Promise<AliyunDriveOAuthStatus> {
    if (!options.native) return { state: 'unsupported', profileId: options.profileId }
    if (persistenceFailure) {
      return { state: 'invalid', profileId: options.profileId, reason: 'inconsistent-state' }
    }
    const credential = await credentialStatus()
    if (credential === 'locked') return { state: 'locked', profileId: options.profileId }
    if (credential === 'unavailable') return { state: 'unavailable', profileId: options.profileId }
    if (credential === 'missing') {
      try {
        const metadata = await options.metadataStore.read(options.profileId)
        return metadata
          ? { state: 'invalid', profileId: options.profileId, reason: 'inconsistent-state' }
          : { state: 'missing', profileId: options.profileId }
      } catch {
        return { state: 'invalid', profileId: options.profileId, reason: 'metadata-invalid' }
      }
    }
    try {
      const stored = await readAliyunDriveStoredAuthorization({
        ...options,
        publisherClient: configuredPublisher
      })
      const details = connection(stored.metadata)
      return stored.envelope.grantType === 'access-grant' &&
        stored.envelope.accessExpiresAt <= now() + 60_000
        ? { state: 'expired', ...details }
        : { state: 'connected', ...details }
    } catch (cause) {
      if (cause instanceof AliyunDriveOAuthError && cause.code === 'credential-locked') {
        return { state: 'locked', profileId: options.profileId }
      }
      if (cause instanceof AliyunDriveOAuthError && cause.code === 'credential-unavailable') {
        return { state: 'unavailable', profileId: options.profileId }
      }
      let reason: 'metadata-invalid' | 'credential-invalid' | 'inconsistent-state' =
        'inconsistent-state'
      if (cause instanceof AliyunDriveOAuthError && cause.code.startsWith('metadata-')) {
        reason = 'metadata-invalid'
      } else if (cause instanceof AliyunDriveOAuthError && cause.code === 'credential-invalid') {
        reason = 'credential-invalid'
      }
      return { state: 'invalid', profileId: options.profileId, reason }
    }
  }

  async function connect(
    connectOptions: AliyunDriveOAuthConnectOptions = {}
  ): Promise<AliyunDriveOAuthConnection> {
    const native = requireNative()
    if (!validExpectedSubject(connectOptions.expectedSubject)) {
      throw new AliyunDriveOAuthError(
        'profile-account-mismatch',
        'Aliyun Drive profile work has an invalid account identity'
      )
    }
    const client = selectedClient(connectOptions)
    beginMutation()
    try {
      const previous = await previousAuthorization()
      let result: AliyunDriveNativeAuthorizeResult
      try {
        result = await native.authorize(
          {
            oauthClient: aliyunDriveNativeOAuthClient(client),
            timeoutMs: AUTHORIZE_TIMEOUT_MS
          },
          connectOptions.signal
        )
      } catch (cause) {
        throw aliyunDriveOAuthNativeFailure(cause)
      }
      throwIfAborted(connectOptions.signal)
      const authorizationVersion = createVersion()
      const validated = validateAliyunDriveNativeAuthorization(
        client,
        authorizationVersion,
        result,
        now()
      )
      if (connectOptions.expectedSubject && connectOptions.expectedSubject !== validated.subject) {
        throw new AliyunDriveOAuthError(
          'profile-account-mismatch',
          'Use a new Aliyun Drive profile for a different account'
        )
      }
      const metadata = metadataFromAuthorization(options.profileId, validated, validated.email)
      await persistReplacement(
        previous,
        metadata,
        serializeAliyunDriveAuthorizationEnvelope(validated.envelope),
        connectOptions.signal,
        connectOptions.onCommitStart
      )
      runtime.resetAfterAuthorizationReplacement()
      return connection(metadata)
    } finally {
      mutationInProgress = false
    }
  }

  async function getAccessToken(signal?: AbortSignal): Promise<AliyunDriveOAuthToken> {
    if (mutationInProgress) {
      throw new AliyunDriveOAuthError('busy', 'Aliyun Drive authorization is changing')
    }
    if (persistenceFailure) throw persistenceFailure
    return runtime.resolveAccessToken(signal)
  }

  async function disconnect(signal?: AbortSignal): Promise<void> {
    beginMutation()
    try {
      throwIfAborted(signal)
      await options.manager.clear(reference)
      throwIfAborted(signal)
      await options.metadataStore.remove(options.profileId)
      persistenceFailure = null
      runtime.resetAfterAuthorizationReplacement()
    } catch (cause) {
      if (cause instanceof AliyunDriveOAuthError) throw cause
      throw new AliyunDriveOAuthError(
        'persistence-failed',
        'Aliyun Drive authorization could not be removed from this device',
        { cause }
      )
    } finally {
      mutationInProgress = false
    }
  }

  function dispose(): void {
    disposed = true
    runtime.dispose()
  }

  return Object.freeze({ status, connect, disconnect, getAccessToken, dispose })
}

export type { AliyunDriveOAuthMetadataStore } from './metadata'
