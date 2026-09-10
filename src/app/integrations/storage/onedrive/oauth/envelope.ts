import {
  hasExactOAuthKeys as hasExactKeys,
  hasExactOAuthValueSet,
  isBoundedOAuthText,
  isBoundedOAuthToken,
  isOAuthRecord as isRecord,
  oauthSerializedBytes as serializedBytes,
  parseBoundedOAuthJSON,
  stringifyBoundedOAuthJSON
} from '@/app/integrations/storage/oauth-shared/validation'

const ONEDRIVE_OAUTH_SCHEMA_VERSION = 1 as const

const MAX_REFRESH_TOKEN_BYTES = 12 * 1024
const MAX_SUBJECT_LENGTH = 256
const MAX_EMAIL_LENGTH = 320
const AUTHORIZATION_VERSION_PATTERN = /^[a-f0-9]{32}$/
const MICROSOFT_CLIENT_ID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export const MAX_ONEDRIVE_OAUTH_CREDENTIAL_BYTES = 16 * 1024

/**
 * OneDrive phase 1 intentionally uses one fixed delegated permission set for both personal and
 * work/school Microsoft accounts. Files.ReadWrite.AppFolder makes the app-folder boundary
 * service-enforced. OAuth endpoints, tenant selection, and these scopes are owned by the native
 * host; the renderer only verifies the grant returned by that reviewed flow.
 */
export const ONEDRIVE_OAUTH_SCOPES = Object.freeze([
  'openid',
  'profile',
  'email',
  'offline_access',
  'Files.ReadWrite.AppFolder'
] as const)

export type OneDriveOAuthScope = (typeof ONEDRIVE_OAUTH_SCOPES)[number]

export type OneDriveRefreshTokenEnvelope = Readonly<{
  schemaVersion: typeof ONEDRIVE_OAUTH_SCHEMA_VERSION
  refreshToken: string
  clientId: string
  authorizationVersion: string
  subject: string
}>

export type OneDriveOAuthPublicMetadata = Readonly<{
  schemaVersion: typeof ONEDRIVE_OAUTH_SCHEMA_VERSION
  profileId: string
  subject: string
  email?: string
  authorizationVersion: string
  grantedScopes: readonly OneDriveOAuthScope[]
}>

function invalidAuthorization(): TypeError {
  return new TypeError('Stored OneDrive authorization is invalid')
}

function invalidMetadata(): TypeError {
  return new TypeError('Stored OneDrive account metadata is invalid')
}

function validAuthorizationVersion(value: unknown): value is string {
  return typeof value === 'string' && AUTHORIZATION_VERSION_PATTERN.test(value)
}

export function isOneDriveClientId(value: unknown): value is string {
  return typeof value === 'string' && MICROSOFT_CLIENT_ID_PATTERN.test(value)
}

function validRefreshToken(value: unknown): value is string {
  return isBoundedOAuthToken(value, MAX_REFRESH_TOKEN_BYTES)
}

export function hasExactOneDriveOAuthScopes(
  value: unknown
): value is readonly OneDriveOAuthScope[] {
  return hasExactOAuthValueSet(value, ONEDRIVE_OAUTH_SCOPES)
}

/**
 * Microsoft may report the Graph delegated permission in either its short form or its fully
 * qualified resource form. Normalize only that reviewed alias, then require the exact fixed set.
 */
export function canonicalizeOneDriveOAuthScopes(
  value: unknown
): typeof ONEDRIVE_OAUTH_SCOPES | null {
  if (!Array.isArray(value)) return null
  const canonical = value.map((scope) =>
    scope === 'https://graph.microsoft.com/Files.ReadWrite.AppFolder'
      ? 'Files.ReadWrite.AppFolder'
      : scope
  )
  return hasExactOneDriveOAuthScopes(canonical) ? ONEDRIVE_OAUTH_SCOPES : null
}

export function parseOneDriveRefreshTokenEnvelope(value: unknown): OneDriveRefreshTokenEnvelope {
  if (
    !isRecord(value) ||
    value.schemaVersion !== ONEDRIVE_OAUTH_SCHEMA_VERSION ||
    !hasExactKeys(value, [
      'schemaVersion',
      'refreshToken',
      'clientId',
      'authorizationVersion',
      'subject'
    ]) ||
    !validRefreshToken(value.refreshToken) ||
    !isOneDriveClientId(value.clientId) ||
    !validAuthorizationVersion(value.authorizationVersion) ||
    !isBoundedOAuthText(value.subject, {
      maxLength: MAX_SUBJECT_LENGTH,
      requireTrimmed: true
    })
  ) {
    throw invalidAuthorization()
  }

  const parsed = Object.freeze({
    schemaVersion: ONEDRIVE_OAUTH_SCHEMA_VERSION,
    refreshToken: value.refreshToken,
    clientId: value.clientId.toLowerCase(),
    authorizationVersion: value.authorizationVersion,
    subject: value.subject
  })
  const bytes = serializedBytes(parsed)
  if (bytes === null || bytes > MAX_ONEDRIVE_OAUTH_CREDENTIAL_BYTES) {
    throw invalidAuthorization()
  }
  return parsed
}

export function parseOneDriveRefreshTokenEnvelopeJSON(value: string): OneDriveRefreshTokenEnvelope {
  return parseOneDriveRefreshTokenEnvelope(
    parseBoundedOAuthJSON(value, MAX_ONEDRIVE_OAUTH_CREDENTIAL_BYTES, invalidAuthorization)
  )
}

export function serializeOneDriveRefreshTokenEnvelope(value: OneDriveRefreshTokenEnvelope): string {
  return stringifyBoundedOAuthJSON(
    parseOneDriveRefreshTokenEnvelope(value),
    MAX_ONEDRIVE_OAUTH_CREDENTIAL_BYTES,
    invalidAuthorization
  )
}

export function parseOneDriveOAuthPublicMetadata(value: unknown): OneDriveOAuthPublicMetadata {
  if (
    !isRecord(value) ||
    value.schemaVersion !== ONEDRIVE_OAUTH_SCHEMA_VERSION ||
    !hasExactKeys(
      value,
      ['schemaVersion', 'profileId', 'subject', 'authorizationVersion', 'grantedScopes'],
      ['email']
    ) ||
    !isBoundedOAuthText(value.profileId, { maxLength: 64, requireTrimmed: true }) ||
    !/^[a-z0-9._-]+$/.test(value.profileId) ||
    !isBoundedOAuthText(value.subject, {
      maxLength: MAX_SUBJECT_LENGTH,
      requireTrimmed: true
    }) ||
    !validAuthorizationVersion(value.authorizationVersion) ||
    !hasExactOneDriveOAuthScopes(value.grantedScopes) ||
    (value.email !== undefined &&
      !isBoundedOAuthText(value.email, {
        maxLength: MAX_EMAIL_LENGTH,
        requireTrimmed: true
      }))
  ) {
    throw invalidMetadata()
  }

  return Object.freeze({
    schemaVersion: ONEDRIVE_OAUTH_SCHEMA_VERSION,
    profileId: value.profileId,
    subject: value.subject,
    ...(value.email === undefined ? {} : { email: value.email }),
    authorizationVersion: value.authorizationVersion,
    grantedScopes: ONEDRIVE_OAUTH_SCOPES
  })
}

export function oneDriveAccountLabel(metadata: OneDriveOAuthPublicMetadata): string {
  return metadata.email ?? `Microsoft account · ${metadata.subject.slice(-6)}`
}
