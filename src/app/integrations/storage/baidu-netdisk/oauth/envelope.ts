import {
  hasExactOAuthKeys as hasExactKeys,
  hasExactOAuthValueSet,
  isBoundedASCIISecret,
  isBoundedOAuthText,
  isBoundedOAuthToken,
  isOAuthRecord as isRecord,
  oauthSerializedBytes as serializedBytes,
  parseBoundedOAuthJSON,
  stringifyBoundedOAuthJSON
} from '@/app/integrations/storage/oauth-shared/validation'

import { isBaiduNetdiskAppKey } from '../config'

const BAIDU_NETDISK_OAUTH_SCHEMA_VERSION = 1 as const
const MAX_REFRESH_TOKEN_BYTES = 12 * 1024
const MIN_SECRET_KEY_BYTES = 8
const MAX_SECRET_KEY_BYTES = 4 * 1024
const MAX_UK_LENGTH = 32
const MAX_ACCOUNT_NAME_LENGTH = 256
const AUTHORIZATION_VERSION_PATTERN = /^[a-f0-9]{32}$/
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)$/

export const MAX_BAIDU_NETDISK_OAUTH_CREDENTIAL_BYTES = 16 * 1024

/** Exact, fixed provider scopes. Endpoints and scopes are never profile-configurable. */
export const BAIDU_NETDISK_OAUTH_SCOPES = Object.freeze(['basic', 'netdisk'] as const)

export type BaiduNetdiskOAuthScope = (typeof BAIDU_NETDISK_OAUTH_SCOPES)[number]

export type BaiduNetdiskPublisherBrokerOAuthClient = Readonly<{
  mode: 'publisher-broker'
  appKey: string
}>

export type BaiduNetdiskSelfHostedOAuthClient = Readonly<{
  mode: 'self-hosted'
  appKey: string
  secretKey: string
}>

/** Exact OAuth client stored only inside the encrypted authorization envelope. */
export type BaiduNetdiskOAuthClient =
  | BaiduNetdiskPublisherBrokerOAuthClient
  | BaiduNetdiskSelfHostedOAuthClient

/** Public identity projection permitted in metadata and renderer status. */
export type BaiduNetdiskOAuthPublicClient =
  | Readonly<{
      mode: 'publisher-broker'
      appKey: string
    }>
  | Readonly<{
      mode: 'self-hosted'
      appKey: string
    }>

export type BaiduNetdiskRefreshTokenEnvelope = Readonly<{
  schemaVersion: typeof BAIDU_NETDISK_OAUTH_SCHEMA_VERSION
  refreshToken: string
  oauthClient: BaiduNetdiskOAuthClient
  uk: string
  authorizationVersion: string
}>

export type BaiduNetdiskOAuthPublicMetadata = Readonly<{
  schemaVersion: typeof BAIDU_NETDISK_OAUTH_SCHEMA_VERSION
  profileId: string
  uk: string
  baiduName?: string
  netdiskName?: string
  authorizationVersion: string
  grantedScopes: readonly BaiduNetdiskOAuthScope[]
  oauthClient: BaiduNetdiskOAuthPublicClient
}>

function invalidAuthorization(): TypeError {
  return new TypeError('Stored Baidu Netdisk authorization is invalid')
}

function invalidMetadata(): TypeError {
  return new TypeError('Stored Baidu Netdisk account metadata is invalid')
}

function validAuthorizationVersion(value: unknown): value is string {
  return typeof value === 'string' && AUTHORIZATION_VERSION_PATTERN.test(value)
}

export function isBaiduNetdiskUk(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_UK_LENGTH &&
    DECIMAL_PATTERN.test(value)
  )
}

function validSecretKey(value: unknown): value is string {
  return isBoundedASCIISecret(value, MIN_SECRET_KEY_BYTES, MAX_SECRET_KEY_BYTES)
}

function validRefreshToken(value: unknown): value is string {
  return isBoundedOAuthToken(value, MAX_REFRESH_TOKEN_BYTES)
}

export function hasExactBaiduNetdiskOAuthScopes(
  value: unknown
): value is readonly BaiduNetdiskOAuthScope[] {
  return hasExactOAuthValueSet(value, BAIDU_NETDISK_OAUTH_SCOPES)
}

export function parseBaiduNetdiskOAuthClient(value: unknown): BaiduNetdiskOAuthClient {
  if (!isRecord(value) || !isBaiduNetdiskAppKey(value.appKey)) throw invalidAuthorization()
  if (value.mode === 'publisher-broker' && hasExactKeys(value, ['mode', 'appKey'])) {
    return Object.freeze({ mode: 'publisher-broker', appKey: value.appKey })
  }
  if (
    value.mode === 'self-hosted' &&
    hasExactKeys(value, ['mode', 'appKey', 'secretKey']) &&
    validSecretKey(value.secretKey)
  ) {
    return Object.freeze({
      mode: 'self-hosted',
      appKey: value.appKey,
      secretKey: value.secretKey
    })
  }
  throw invalidAuthorization()
}

export function parseBaiduNetdiskOAuthPublicClient(value: unknown): BaiduNetdiskOAuthPublicClient {
  if (!isRecord(value) || !isBaiduNetdiskAppKey(value.appKey)) throw invalidMetadata()
  if (value.mode === 'publisher-broker' && hasExactKeys(value, ['mode', 'appKey'])) {
    return Object.freeze({ mode: 'publisher-broker', appKey: value.appKey })
  }
  if (value.mode === 'self-hosted' && hasExactKeys(value, ['mode', 'appKey'])) {
    return Object.freeze({ mode: 'self-hosted', appKey: value.appKey })
  }
  throw invalidMetadata()
}

export function baiduNetdiskOAuthClientPublic(
  value: BaiduNetdiskOAuthClient
): BaiduNetdiskOAuthPublicClient {
  const client = parseBaiduNetdiskOAuthClient(value)
  return Object.freeze({ mode: client.mode, appKey: client.appKey })
}

export function baiduNetdiskOAuthPublicClientsEqual(
  left: BaiduNetdiskOAuthPublicClient,
  right: BaiduNetdiskOAuthPublicClient
): boolean {
  const parsedLeft = parseBaiduNetdiskOAuthPublicClient(left)
  const parsedRight = parseBaiduNetdiskOAuthPublicClient(right)
  return parsedLeft.mode === parsedRight.mode && parsedLeft.appKey === parsedRight.appKey
}

export function parseBaiduNetdiskRefreshTokenEnvelope(
  value: unknown
): BaiduNetdiskRefreshTokenEnvelope {
  if (
    !isRecord(value) ||
    value.schemaVersion !== BAIDU_NETDISK_OAUTH_SCHEMA_VERSION ||
    !hasExactKeys(value, [
      'schemaVersion',
      'refreshToken',
      'oauthClient',
      'uk',
      'authorizationVersion'
    ]) ||
    !validRefreshToken(value.refreshToken) ||
    !isBaiduNetdiskUk(value.uk) ||
    !validAuthorizationVersion(value.authorizationVersion)
  ) {
    throw invalidAuthorization()
  }
  const parsed = Object.freeze({
    schemaVersion: BAIDU_NETDISK_OAUTH_SCHEMA_VERSION,
    refreshToken: value.refreshToken,
    oauthClient: parseBaiduNetdiskOAuthClient(value.oauthClient),
    uk: value.uk,
    authorizationVersion: value.authorizationVersion
  })
  const bytes = serializedBytes(parsed)
  if (bytes === null || bytes > MAX_BAIDU_NETDISK_OAUTH_CREDENTIAL_BYTES) {
    throw invalidAuthorization()
  }
  return parsed
}

export function parseBaiduNetdiskRefreshTokenEnvelopeJSON(
  value: string
): BaiduNetdiskRefreshTokenEnvelope {
  return parseBaiduNetdiskRefreshTokenEnvelope(
    parseBoundedOAuthJSON(value, MAX_BAIDU_NETDISK_OAUTH_CREDENTIAL_BYTES, invalidAuthorization)
  )
}

export function serializeBaiduNetdiskRefreshTokenEnvelope(
  value: BaiduNetdiskRefreshTokenEnvelope
): string {
  return stringifyBoundedOAuthJSON(
    parseBaiduNetdiskRefreshTokenEnvelope(value),
    MAX_BAIDU_NETDISK_OAUTH_CREDENTIAL_BYTES,
    invalidAuthorization
  )
}

export function parseBaiduNetdiskOAuthPublicMetadata(
  value: unknown
): BaiduNetdiskOAuthPublicMetadata {
  if (
    !isRecord(value) ||
    value.schemaVersion !== BAIDU_NETDISK_OAUTH_SCHEMA_VERSION ||
    !hasExactKeys(
      value,
      ['schemaVersion', 'profileId', 'uk', 'authorizationVersion', 'grantedScopes', 'oauthClient'],
      ['baiduName', 'netdiskName']
    ) ||
    !isBoundedOAuthText(value.profileId, { maxLength: 64, requireTrimmed: true }) ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.profileId) ||
    !isBaiduNetdiskUk(value.uk) ||
    !validAuthorizationVersion(value.authorizationVersion) ||
    !hasExactBaiduNetdiskOAuthScopes(value.grantedScopes) ||
    (value.baiduName !== undefined &&
      !isBoundedOAuthText(value.baiduName, {
        maxLength: MAX_ACCOUNT_NAME_LENGTH,
        requireTrimmed: true
      })) ||
    (value.netdiskName !== undefined &&
      !isBoundedOAuthText(value.netdiskName, {
        maxLength: MAX_ACCOUNT_NAME_LENGTH,
        requireTrimmed: true
      }))
  ) {
    throw invalidMetadata()
  }
  return Object.freeze({
    schemaVersion: BAIDU_NETDISK_OAUTH_SCHEMA_VERSION,
    profileId: value.profileId,
    uk: value.uk,
    ...(value.baiduName === undefined ? {} : { baiduName: value.baiduName }),
    ...(value.netdiskName === undefined ? {} : { netdiskName: value.netdiskName }),
    authorizationVersion: value.authorizationVersion,
    grantedScopes: BAIDU_NETDISK_OAUTH_SCOPES,
    oauthClient: parseBaiduNetdiskOAuthPublicClient(value.oauthClient)
  })
}

export function baiduNetdiskAccountLabel(metadata: BaiduNetdiskOAuthPublicMetadata): string {
  return metadata.netdiskName ?? metadata.baiduName ?? `Baidu account · ${metadata.uk.slice(-6)}`
}
