const LEGACY_GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION = 1 as const
const GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION = 2 as const

// Schema v1 historically accepted 12 KiB. Keep parsing that bound so an older credential still
// contributes its non-secret account/grant identity during an explicit reconnect. Newly issued v2
// credentials share a 16 KiB encrypted record with the exact OAuth client that owns the grant.
const MAX_LEGACY_REFRESH_TOKEN_BYTES = 12 * 1024
const MAX_REFRESH_TOKEN_BYTES = 8 * 1024
const MIN_CLIENT_SECRET_BYTES = 8
const MAX_CLIENT_SECRET_BYTES = 4 * 1024
const MAX_CLIENT_ID_PREFIX_BYTES = 200
const MIN_CLIENT_ID_PREFIX_BYTES = 10
const MAX_SUBJECT_LENGTH = 256
const MAX_EMAIL_LENGTH = 320
const AUTHORIZATION_VERSION_PATTERN = /^[a-f0-9]{32}$/
const CLIENT_ID_SUFFIX = '.apps.googleusercontent.com'
const CLIENT_ID_PREFIX_PATTERN = /^[a-zA-Z0-9_-]+$/
const ASCII_GRAPHIC_PATTERN = /^[\x21-\x7e]+$/

export const MAX_GOOGLE_DRIVE_OAUTH_CREDENTIAL_BYTES = 16 * 1024

export const GOOGLE_DRIVE_OAUTH_SCOPES = Object.freeze([
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.file'
] as const)

export type GoogleDriveOAuthScope = (typeof GOOGLE_DRIVE_OAUTH_SCOPES)[number]

export type GoogleDrivePublisherBrokerOAuthClient = Readonly<{
  mode: 'publisher-broker'
  clientId: string
}>

export type GoogleDriveSelfHostedDesktopOAuthClient = Readonly<{
  mode: 'self-hosted-desktop'
  clientId: string
  clientSecret: string
}>

/** Exact OAuth client identity stored in the encrypted authorization record. */
export type GoogleDriveOAuthClient =
  | GoogleDrivePublisherBrokerOAuthClient
  | GoogleDriveSelfHostedDesktopOAuthClient

/** Non-secret projection permitted in public account metadata and Vue state. */
export type GoogleDriveOAuthPublicClient = Readonly<{
  mode: GoogleDriveOAuthClient['mode']
  clientId: string
}>

export type GoogleDriveRefreshTokenEnvelopeV1 = Readonly<{
  /** Legacy publisher/Broker authorization; its client identity came from the build. */
  schemaVersion: typeof LEGACY_GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION
  refreshToken: string
  authorizationVersion: string
  subject: string
}>

export type GoogleDriveRefreshTokenEnvelopeV2 = Readonly<{
  schemaVersion: typeof GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION
  refreshToken: string
  authorizationVersion: string
  subject: string
  oauthClient: GoogleDriveOAuthClient
}>

export type GoogleDriveRefreshTokenEnvelope =
  | GoogleDriveRefreshTokenEnvelopeV1
  | GoogleDriveRefreshTokenEnvelopeV2

export type GoogleDriveOAuthPublicMetadataV1 = Readonly<{
  /** Legacy publisher/Broker authorization; its client identity came from the build. */
  schemaVersion: typeof LEGACY_GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION
  profileId: string
  subject: string
  email?: string
  authorizationVersion: string
  grantedScopes: readonly GoogleDriveOAuthScope[]
}>

export type GoogleDriveOAuthPublicMetadataV2 = Readonly<{
  schemaVersion: typeof GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION
  profileId: string
  subject: string
  email?: string
  authorizationVersion: string
  grantedScopes: readonly GoogleDriveOAuthScope[]
  oauthClient: GoogleDriveOAuthPublicClient
}>

export type GoogleDriveOAuthPublicMetadata =
  | GoogleDriveOAuthPublicMetadataV1
  | GoogleDriveOAuthPublicMetadataV2

export function isGoogleDriveRefreshTokenEnvelopeV1(
  value: GoogleDriveRefreshTokenEnvelope
): value is GoogleDriveRefreshTokenEnvelopeV1 {
  return value.schemaVersion === LEGACY_GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION
}

export function isGoogleDriveRefreshTokenEnvelopeV2(
  value: GoogleDriveRefreshTokenEnvelope
): value is GoogleDriveRefreshTokenEnvelopeV2 {
  return value.schemaVersion === GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION
}

export function isGoogleDriveOAuthPublicMetadataV1(
  value: GoogleDriveOAuthPublicMetadata
): value is GoogleDriveOAuthPublicMetadataV1 {
  return value.schemaVersion === LEGACY_GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION
}

export function isGoogleDriveOAuthPublicMetadataV2(
  value: GoogleDriveOAuthPublicMetadata
): value is GoogleDriveOAuthPublicMetadataV2 {
  return value.schemaVersion === GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION
}

function invalidAuthorization(): TypeError {
  return new TypeError('Stored Google Drive authorization is invalid')
}

function invalidMetadata(): TypeError {
  return new TypeError('Stored Google Drive account metadata is invalid')
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
    !/\p{Cc}/u.test(value)
  )
}

function validAuthorizationVersion(value: unknown): value is string {
  return typeof value === 'string' && AUTHORIZATION_VERSION_PATTERN.test(value)
}

function validClientId(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value) return false
  const prefix = value.endsWith(CLIENT_ID_SUFFIX) ? value.slice(0, -CLIENT_ID_SUFFIX.length) : null
  return (
    prefix !== null &&
    utf8Bytes(prefix) >= MIN_CLIENT_ID_PREFIX_BYTES &&
    utf8Bytes(prefix) <= MAX_CLIENT_ID_PREFIX_BYTES &&
    CLIENT_ID_PREFIX_PATTERN.test(prefix)
  )
}

function validClientSecret(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    utf8Bytes(value) >= MIN_CLIENT_SECRET_BYTES &&
    utf8Bytes(value) <= MAX_CLIENT_SECRET_BYTES &&
    ASCII_GRAPHIC_PATTERN.test(value)
  )
}

function validRefreshToken(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === 'string' &&
    utf8Bytes(value) > 0 &&
    utf8Bytes(value) <= maxBytes &&
    value.trim() === value &&
    !/\s/u.test(value) &&
    !/\p{Cc}/u.test(value)
  )
}

function validScopes(value: unknown): value is readonly GoogleDriveOAuthScope[] {
  return (
    Array.isArray(value) &&
    value.length === GOOGLE_DRIVE_OAUTH_SCOPES.length &&
    GOOGLE_DRIVE_OAUTH_SCOPES.every((scope, index) => value[index] === scope)
  )
}

export function parseGoogleDriveOAuthClient(value: unknown): GoogleDriveOAuthClient {
  if (!isRecord(value) || !validClientId(value.clientId)) throw invalidAuthorization()
  if (value.mode === 'publisher-broker' && hasExactKeys(value, ['mode', 'clientId'])) {
    return Object.freeze({ mode: 'publisher-broker', clientId: value.clientId })
  }
  if (
    value.mode === 'self-hosted-desktop' &&
    hasExactKeys(value, ['mode', 'clientId', 'clientSecret']) &&
    validClientSecret(value.clientSecret)
  ) {
    return Object.freeze({
      mode: 'self-hosted-desktop',
      clientId: value.clientId,
      clientSecret: value.clientSecret
    })
  }
  throw invalidAuthorization()
}

export function parseGoogleDriveOAuthPublicClient(value: unknown): GoogleDriveOAuthPublicClient {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['mode', 'clientId']) ||
    (value.mode !== 'publisher-broker' && value.mode !== 'self-hosted-desktop') ||
    !validClientId(value.clientId)
  ) {
    throw invalidMetadata()
  }
  return Object.freeze({ mode: value.mode, clientId: value.clientId })
}

export function googleDriveOAuthClientPublic(
  value: GoogleDriveOAuthClient
): GoogleDriveOAuthPublicClient {
  const parsed = parseGoogleDriveOAuthClient(value)
  return Object.freeze({ mode: parsed.mode, clientId: parsed.clientId })
}

export function googleDriveOAuthPublicClientsEqual(
  left: GoogleDriveOAuthPublicClient,
  right: GoogleDriveOAuthPublicClient
): boolean {
  const parsedLeft = parseGoogleDriveOAuthPublicClient(left)
  const parsedRight = parseGoogleDriveOAuthPublicClient(right)
  return parsedLeft.mode === parsedRight.mode && parsedLeft.clientId === parsedRight.clientId
}

export function parseGoogleDriveRefreshTokenEnvelope(
  value: unknown
): GoogleDriveRefreshTokenEnvelope {
  if (!isRecord(value)) throw invalidAuthorization()
  let parsed: GoogleDriveRefreshTokenEnvelope
  if (
    value.schemaVersion === LEGACY_GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION &&
    hasExactKeys(value, ['schemaVersion', 'refreshToken', 'authorizationVersion', 'subject']) &&
    validRefreshToken(value.refreshToken, MAX_LEGACY_REFRESH_TOKEN_BYTES) &&
    validAuthorizationVersion(value.authorizationVersion) &&
    boundedText(value.subject, MAX_SUBJECT_LENGTH)
  ) {
    parsed = Object.freeze({
      schemaVersion: LEGACY_GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION,
      refreshToken: value.refreshToken,
      authorizationVersion: value.authorizationVersion,
      subject: value.subject
    })
  } else if (
    value.schemaVersion === GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION &&
    hasExactKeys(value, [
      'schemaVersion',
      'refreshToken',
      'authorizationVersion',
      'subject',
      'oauthClient'
    ]) &&
    validRefreshToken(value.refreshToken, MAX_REFRESH_TOKEN_BYTES) &&
    validAuthorizationVersion(value.authorizationVersion) &&
    boundedText(value.subject, MAX_SUBJECT_LENGTH)
  ) {
    parsed = Object.freeze({
      schemaVersion: GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION,
      refreshToken: value.refreshToken,
      authorizationVersion: value.authorizationVersion,
      subject: value.subject,
      oauthClient: parseGoogleDriveOAuthClient(value.oauthClient)
    })
  } else {
    throw invalidAuthorization()
  }

  const bytes = serializedBytes(parsed)
  if (bytes === null || bytes > MAX_GOOGLE_DRIVE_OAUTH_CREDENTIAL_BYTES) {
    throw invalidAuthorization()
  }
  return parsed
}

export function parseGoogleDriveRefreshTokenEnvelopeJSON(
  value: string
): GoogleDriveRefreshTokenEnvelope {
  if (
    value.length === 0 ||
    utf8Bytes(value) === 0 ||
    utf8Bytes(value) > MAX_GOOGLE_DRIVE_OAUTH_CREDENTIAL_BYTES
  ) {
    throw invalidAuthorization()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw invalidAuthorization()
  }
  return parseGoogleDriveRefreshTokenEnvelope(parsed)
}

export function serializeGoogleDriveRefreshTokenEnvelope(
  value: GoogleDriveRefreshTokenEnvelope
): string {
  const serialized = JSON.stringify(parseGoogleDriveRefreshTokenEnvelope(value))
  if (utf8Bytes(serialized) > MAX_GOOGLE_DRIVE_OAUTH_CREDENTIAL_BYTES) {
    throw invalidAuthorization()
  }
  return serialized
}

export function parseGoogleDriveOAuthPublicMetadata(
  value: unknown
): GoogleDriveOAuthPublicMetadata {
  if (!isRecord(value)) throw invalidMetadata()
  if (!boundedText(value.profileId, 64) || !/^[a-z0-9._-]+$/.test(value.profileId)) {
    throw invalidMetadata()
  }
  if (!boundedText(value.subject, MAX_SUBJECT_LENGTH)) throw invalidMetadata()
  if (!validAuthorizationVersion(value.authorizationVersion)) throw invalidMetadata()
  if (!validScopes(value.grantedScopes)) throw invalidMetadata()
  if (value.email !== undefined && !boundedText(value.email, MAX_EMAIL_LENGTH)) {
    throw invalidMetadata()
  }
  const profileId = value.profileId
  const subject = value.subject
  const authorizationVersion = value.authorizationVersion
  const email = value.email

  if (
    value.schemaVersion === LEGACY_GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION &&
    hasExactKeys(
      value,
      ['schemaVersion', 'profileId', 'subject', 'authorizationVersion', 'grantedScopes'],
      ['email']
    )
  ) {
    return Object.freeze({
      schemaVersion: LEGACY_GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION,
      profileId,
      subject,
      ...(email === undefined ? {} : { email }),
      authorizationVersion,
      grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES
    })
  }

  if (
    value.schemaVersion === GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION &&
    hasExactKeys(
      value,
      [
        'schemaVersion',
        'profileId',
        'subject',
        'authorizationVersion',
        'grantedScopes',
        'oauthClient'
      ],
      ['email']
    )
  ) {
    return Object.freeze({
      schemaVersion: GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION,
      profileId,
      subject,
      ...(email === undefined ? {} : { email }),
      authorizationVersion,
      grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES,
      oauthClient: parseGoogleDriveOAuthPublicClient(value.oauthClient)
    })
  }

  throw invalidMetadata()
}

export function googleDriveAccountLabel(metadata: GoogleDriveOAuthPublicMetadata): string {
  return metadata.email ?? `Google account · ${metadata.subject.slice(-6)}`
}
