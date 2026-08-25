import { isBaiduNetdiskAppKey } from '../config'

const BAIDU_NETDISK_OAUTH_SCHEMA_VERSION = 1 as const
const MAX_REFRESH_TOKEN_BYTES = 12 * 1024
const MIN_SECRET_KEY_BYTES = 8
const MAX_SECRET_KEY_BYTES = 4 * 1024
const MAX_UK_LENGTH = 32
const MAX_ACCOUNT_NAME_LENGTH = 256
const AUTHORIZATION_VERSION_PATTERN = /^[a-f0-9]{32}$/
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)$/
const ASCII_GRAPHIC_PATTERN = /^[\x21-\x7e]+$/

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

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function serializedBytes(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? utf8Bytes(serialized) : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key))
}

function boundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  )
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
  return (
    typeof value === 'string' &&
    utf8Bytes(value) >= MIN_SECRET_KEY_BYTES &&
    utf8Bytes(value) <= MAX_SECRET_KEY_BYTES &&
    ASCII_GRAPHIC_PATTERN.test(value)
  )
}

function validRefreshToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    utf8Bytes(value) > 0 &&
    utf8Bytes(value) <= MAX_REFRESH_TOKEN_BYTES &&
    value.trim() === value &&
    !/\s/u.test(value) &&
    !/\p{Cc}/u.test(value)
  )
}

export function hasExactBaiduNetdiskOAuthScopes(
  value: unknown
): value is readonly BaiduNetdiskOAuthScope[] {
  if (!Array.isArray(value) || value.length !== BAIDU_NETDISK_OAUTH_SCOPES.length) return false
  const scopes = new Set(value)
  return (
    scopes.size === BAIDU_NETDISK_OAUTH_SCOPES.length &&
    BAIDU_NETDISK_OAUTH_SCOPES.every((scope) => scopes.has(scope))
  )
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
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    utf8Bytes(value) > MAX_BAIDU_NETDISK_OAUTH_CREDENTIAL_BYTES
  ) {
    throw invalidAuthorization()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw invalidAuthorization()
  }
  return parseBaiduNetdiskRefreshTokenEnvelope(parsed)
}

export function serializeBaiduNetdiskRefreshTokenEnvelope(
  value: BaiduNetdiskRefreshTokenEnvelope
): string {
  const serialized = JSON.stringify(parseBaiduNetdiskRefreshTokenEnvelope(value))
  if (utf8Bytes(serialized) > MAX_BAIDU_NETDISK_OAUTH_CREDENTIAL_BYTES) {
    throw invalidAuthorization()
  }
  return serialized
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
    !boundedText(value.profileId, 64) ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.profileId) ||
    !isBaiduNetdiskUk(value.uk) ||
    !validAuthorizationVersion(value.authorizationVersion) ||
    !hasExactBaiduNetdiskOAuthScopes(value.grantedScopes) ||
    (value.baiduName !== undefined && !boundedText(value.baiduName, MAX_ACCOUNT_NAME_LENGTH)) ||
    (value.netdiskName !== undefined && !boundedText(value.netdiskName, MAX_ACCOUNT_NAME_LENGTH))
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
