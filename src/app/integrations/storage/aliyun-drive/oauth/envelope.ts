import {
  hasExactOAuthKeys as hasExactKeys,
  isBoundedASCIISecret,
  isBoundedOAuthText,
  isBoundedOAuthToken,
  isOAuthRecord as isRecord,
  parseBoundedOAuthJSON,
  stringifyBoundedOAuthJSON
} from '@/app/integrations/storage/oauth-shared/validation'
import { isStorageProfileID } from '@/app/integrations/storage/types'

import { isAliyunDriveClientId, parseAliyunDriveLoopbackRedirectURI } from '../config'

export const ALIYUN_DRIVE_OAUTH_ENVELOPE_VERSION = 1 as const
export const MAX_ALIYUN_DRIVE_AUTHORIZATION_BYTES = 16 * 1024

export type AliyunDriveOAuthMode =
  | 'publisher-broker-confidential'
  | 'self-hosted-confidential'
  | 'self-hosted-public'

export type AliyunDrivePublisherBrokerOAuthClient = Readonly<{
  mode: 'publisher-broker-confidential'
  clientId: string
}>

export type AliyunDriveSelfHostedConfidentialOAuthClient = Readonly<{
  mode: 'self-hosted-confidential'
  clientId: string
  clientSecret: string
  redirectUri: string
}>

export type AliyunDriveSelfHostedPublicOAuthClient = Readonly<{
  mode: 'self-hosted-public'
  clientId: string
  redirectUri: string
}>

export type AliyunDriveConfidentialOAuthClient =
  | AliyunDrivePublisherBrokerOAuthClient
  | AliyunDriveSelfHostedConfidentialOAuthClient

export type AliyunDriveOAuthClient =
  | AliyunDriveConfidentialOAuthClient
  | AliyunDriveSelfHostedPublicOAuthClient

/** No secret, token, endpoint, redirect URI, or scope is permitted in public metadata. */
export type AliyunDriveOAuthPublicClient = Readonly<{
  mode: AliyunDriveOAuthMode
  clientId: string
}>

type AliyunDriveAuthorizationBase = Readonly<{
  schemaVersion: typeof ALIYUN_DRIVE_OAUTH_ENVELOPE_VERSION
  subject: string
  authorizationVersion: string
  oauthClient: AliyunDriveOAuthClient
  accessToken: string
  accessExpiresAt: number
}>

export type AliyunDriveRefreshGrantEnvelope = AliyunDriveAuthorizationBase &
  Readonly<{
    grantType: 'refresh-grant'
    oauthClient: AliyunDriveConfidentialOAuthClient
    refreshToken: string
  }>

export type AliyunDriveAccessGrantEnvelope = AliyunDriveAuthorizationBase &
  Readonly<{
    grantType: 'access-grant'
    oauthClient: AliyunDriveSelfHostedPublicOAuthClient
  }>

export type AliyunDriveAuthorizationEnvelope =
  | AliyunDriveRefreshGrantEnvelope
  | AliyunDriveAccessGrantEnvelope

type AliyunDriveOAuthPublicMetadataBase = Readonly<{
  schemaVersion: typeof ALIYUN_DRIVE_OAUTH_ENVELOPE_VERSION
  profileId: string
  subject: string
  email?: string
  authorizationVersion: string
  oauthClient: AliyunDriveOAuthPublicClient
}>

export type AliyunDriveRefreshGrantPublicMetadata = AliyunDriveOAuthPublicMetadataBase &
  Readonly<{ grantType: 'refresh-grant' }>

export type AliyunDriveAccessGrantPublicMetadata = AliyunDriveOAuthPublicMetadataBase &
  Readonly<{
    grantType: 'access-grant'
    accessExpiresAt: number
  }>

export type AliyunDriveOAuthPublicMetadata =
  | AliyunDriveRefreshGrantPublicMetadata
  | AliyunDriveAccessGrantPublicMetadata

const AUTHORIZATION_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{15,127}$/
const MAX_TOKEN_BYTES = 8 * 1024
const MAX_SECRET_BYTES = 4 * 1024
const MAX_TIMESTAMP = 8_640_000_000_000_000

function invalidAuthorization(): TypeError {
  return new TypeError('Stored Aliyun Drive authorization is invalid')
}

function invalidMetadata(): TypeError {
  return new TypeError('Stored Aliyun Drive account metadata is invalid')
}

function validAuthorizationVersion(value: unknown): value is string {
  return typeof value === 'string' && AUTHORIZATION_VERSION_PATTERN.test(value)
}

function validSecret(value: unknown): value is string {
  return isBoundedASCIISecret(value, 8, MAX_SECRET_BYTES)
}

function validToken(value: unknown): value is string {
  return isBoundedOAuthToken(value, MAX_TOKEN_BYTES)
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= MAX_TIMESTAMP
}

export function parseAliyunDriveOAuthClient(value: unknown): AliyunDriveOAuthClient {
  if (!isRecord(value) || !isAliyunDriveClientId(value.clientId)) throw invalidAuthorization()
  if (value.mode === 'publisher-broker-confidential' && hasExactKeys(value, ['mode', 'clientId'])) {
    return Object.freeze({
      mode: 'publisher-broker-confidential',
      clientId: value.clientId
    })
  }
  if (
    value.mode === 'self-hosted-confidential' &&
    hasExactKeys(value, ['mode', 'clientId', 'clientSecret', 'redirectUri']) &&
    validSecret(value.clientSecret)
  ) {
    const redirectURI = parseAliyunDriveLoopbackRedirectURI(value.redirectUri)
    if (!redirectURI) throw invalidAuthorization()
    return Object.freeze({
      mode: 'self-hosted-confidential',
      clientId: value.clientId,
      clientSecret: value.clientSecret,
      redirectUri: redirectURI
    })
  }
  if (
    value.mode === 'self-hosted-public' &&
    hasExactKeys(value, ['mode', 'clientId', 'redirectUri'])
  ) {
    const redirectURI = parseAliyunDriveLoopbackRedirectURI(value.redirectUri)
    if (!redirectURI) throw invalidAuthorization()
    return Object.freeze({
      mode: 'self-hosted-public',
      clientId: value.clientId,
      redirectUri: redirectURI
    })
  }
  throw invalidAuthorization()
}

export function parseAliyunDriveOAuthPublicClient(value: unknown): AliyunDriveOAuthPublicClient {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['mode', 'clientId']) ||
    !isAliyunDriveClientId(value.clientId) ||
    !['publisher-broker-confidential', 'self-hosted-confidential', 'self-hosted-public'].includes(
      String(value.mode)
    )
  ) {
    throw invalidMetadata()
  }
  return Object.freeze({
    mode: value.mode as AliyunDriveOAuthMode,
    clientId: value.clientId
  })
}

export function aliyunDriveOAuthClientPublic(
  client: AliyunDriveOAuthClient
): AliyunDriveOAuthPublicClient {
  return Object.freeze({ mode: client.mode, clientId: client.clientId })
}

export function aliyunDriveOAuthClientsEqual(
  left: AliyunDriveOAuthClient,
  right: AliyunDriveOAuthClient
): boolean {
  if (left.mode !== right.mode || left.clientId !== right.clientId) {
    return false
  }
  if (left.mode === 'publisher-broker-confidential') {
    return right.mode === 'publisher-broker-confidential'
  }
  if (left.mode === 'self-hosted-confidential') {
    return (
      right.mode === 'self-hosted-confidential' &&
      left.clientSecret === right.clientSecret &&
      left.redirectUri === right.redirectUri
    )
  }
  return right.mode === 'self-hosted-public' && left.redirectUri === right.redirectUri
}

export function aliyunDriveOAuthPublicClientsEqual(
  left: AliyunDriveOAuthPublicClient,
  right: AliyunDriveOAuthPublicClient
): boolean {
  return left.mode === right.mode && left.clientId === right.clientId
}

export function parseAliyunDriveAuthorizationEnvelope(
  value: unknown
): AliyunDriveAuthorizationEnvelope {
  if (
    !isRecord(value) ||
    value.schemaVersion !== ALIYUN_DRIVE_OAUTH_ENVELOPE_VERSION ||
    !isBoundedOAuthText(value.subject, { maxBytes: 512, requireTrimmed: true }) ||
    !validAuthorizationVersion(value.authorizationVersion) ||
    !validToken(value.accessToken) ||
    !validTimestamp(value.accessExpiresAt)
  ) {
    throw invalidAuthorization()
  }
  const oauthClient = parseAliyunDriveOAuthClient(value.oauthClient)
  const base = {
    schemaVersion: ALIYUN_DRIVE_OAUTH_ENVELOPE_VERSION,
    subject: value.subject,
    authorizationVersion: value.authorizationVersion,
    accessToken: value.accessToken,
    accessExpiresAt: value.accessExpiresAt
  } as const
  if (
    value.grantType === 'refresh-grant' &&
    oauthClient.mode !== 'self-hosted-public' &&
    hasExactKeys(value, [
      'schemaVersion',
      'grantType',
      'subject',
      'authorizationVersion',
      'oauthClient',
      'refreshToken',
      'accessToken',
      'accessExpiresAt'
    ]) &&
    validToken(value.refreshToken)
  ) {
    return Object.freeze({
      ...base,
      grantType: 'refresh-grant',
      oauthClient,
      refreshToken: value.refreshToken
    })
  }
  if (
    value.grantType === 'access-grant' &&
    oauthClient.mode === 'self-hosted-public' &&
    hasExactKeys(value, [
      'schemaVersion',
      'grantType',
      'subject',
      'authorizationVersion',
      'oauthClient',
      'accessToken',
      'accessExpiresAt'
    ])
  ) {
    return Object.freeze({
      ...base,
      grantType: 'access-grant',
      oauthClient
    })
  }
  throw invalidAuthorization()
}

export function parseAliyunDriveAuthorizationEnvelopeJSON(
  value: string
): AliyunDriveAuthorizationEnvelope {
  return parseAliyunDriveAuthorizationEnvelope(
    parseBoundedOAuthJSON(value, MAX_ALIYUN_DRIVE_AUTHORIZATION_BYTES, invalidAuthorization)
  )
}

export function serializeAliyunDriveAuthorizationEnvelope(
  value: AliyunDriveAuthorizationEnvelope
): string {
  return stringifyBoundedOAuthJSON(
    parseAliyunDriveAuthorizationEnvelope(value),
    MAX_ALIYUN_DRIVE_AUTHORIZATION_BYTES,
    invalidAuthorization
  )
}

export function parseAliyunDriveOAuthPublicMetadata(
  value: unknown
): AliyunDriveOAuthPublicMetadata {
  const profileId = isRecord(value) && typeof value.profileId === 'string' ? value.profileId : ''
  if (
    !isRecord(value) ||
    value.schemaVersion !== ALIYUN_DRIVE_OAUTH_ENVELOPE_VERSION ||
    !isStorageProfileID(profileId) ||
    !isBoundedOAuthText(value.subject, { maxBytes: 512, requireTrimmed: true }) ||
    (value.email !== undefined &&
      !isBoundedOAuthText(value.email, { maxBytes: 512, requireTrimmed: true })) ||
    !validAuthorizationVersion(value.authorizationVersion)
  ) {
    throw invalidMetadata()
  }
  const oauthClient = parseAliyunDriveOAuthPublicClient(value.oauthClient)
  const base = {
    schemaVersion: ALIYUN_DRIVE_OAUTH_ENVELOPE_VERSION,
    profileId,
    subject: value.subject,
    ...(value.email === undefined ? {} : { email: value.email }),
    authorizationVersion: value.authorizationVersion,
    oauthClient
  } as const
  const commonKeys = [
    'schemaVersion',
    'profileId',
    'subject',
    'authorizationVersion',
    'oauthClient',
    'grantType'
  ] as const
  if (
    value.grantType === 'refresh-grant' &&
    oauthClient.mode !== 'self-hosted-public' &&
    hasExactKeys(value, commonKeys, ['email'])
  ) {
    return Object.freeze({ ...base, grantType: 'refresh-grant' })
  }
  if (
    value.grantType === 'access-grant' &&
    oauthClient.mode === 'self-hosted-public' &&
    validTimestamp(value.accessExpiresAt) &&
    hasExactKeys(value, [...commonKeys, 'accessExpiresAt'], ['email'])
  ) {
    return Object.freeze({
      ...base,
      grantType: 'access-grant',
      accessExpiresAt: value.accessExpiresAt
    })
  }
  throw invalidMetadata()
}

export function parseAliyunDriveOAuthPublicMetadataJSON(
  value: string
): AliyunDriveOAuthPublicMetadata {
  return parseAliyunDriveOAuthPublicMetadata(
    parseBoundedOAuthJSON(value, MAX_ALIYUN_DRIVE_AUTHORIZATION_BYTES, invalidMetadata)
  )
}

export function serializeAliyunDriveOAuthPublicMetadata(
  value: AliyunDriveOAuthPublicMetadata
): string {
  return stringifyBoundedOAuthJSON(
    parseAliyunDriveOAuthPublicMetadata(value),
    MAX_ALIYUN_DRIVE_AUTHORIZATION_BYTES,
    invalidMetadata
  )
}
