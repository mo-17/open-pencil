const GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION = 1 as const
const MAX_REFRESH_TOKEN_LENGTH = 12 * 1024
const MAX_SUBJECT_LENGTH = 256
const MAX_EMAIL_LENGTH = 320
const AUTHORIZATION_VERSION_PATTERN = /^[a-f0-9]{32}$/

export const GOOGLE_DRIVE_OAUTH_SCOPES = Object.freeze([
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.file'
] as const)

export type GoogleDriveOAuthScope = (typeof GOOGLE_DRIVE_OAUTH_SCOPES)[number]

export type GoogleDriveRefreshTokenEnvelope = {
  schemaVersion: typeof GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION
  refreshToken: string
  authorizationVersion: string
  subject: string
}

export type GoogleDriveOAuthPublicMetadata = {
  schemaVersion: typeof GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION
  profileId: string
  subject: string
  email?: string
  authorizationVersion: string
  grantedScopes: readonly GoogleDriveOAuthScope[]
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
  return required.every((key) => key in value) && keys.every((key) => allowed.has(key))
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

function validScopes(value: unknown): value is readonly GoogleDriveOAuthScope[] {
  return (
    Array.isArray(value) &&
    value.length === GOOGLE_DRIVE_OAUTH_SCOPES.length &&
    GOOGLE_DRIVE_OAUTH_SCOPES.every((scope, index) => value[index] === scope)
  )
}

export function parseGoogleDriveRefreshTokenEnvelope(
  value: unknown
): GoogleDriveRefreshTokenEnvelope {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schemaVersion', 'refreshToken', 'authorizationVersion', 'subject']) ||
    value.schemaVersion !== GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION ||
    !boundedText(value.refreshToken, MAX_REFRESH_TOKEN_LENGTH) ||
    !validAuthorizationVersion(value.authorizationVersion) ||
    !boundedText(value.subject, MAX_SUBJECT_LENGTH)
  ) {
    throw new TypeError('Stored Google Drive authorization is invalid')
  }
  return Object.freeze({
    schemaVersion: GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION,
    refreshToken: value.refreshToken,
    authorizationVersion: value.authorizationVersion,
    subject: value.subject
  })
}

export function parseGoogleDriveRefreshTokenEnvelopeJSON(
  value: string
): GoogleDriveRefreshTokenEnvelope {
  if (value.length === 0 || value.length > 16 * 1024) {
    throw new TypeError('Stored Google Drive authorization is invalid')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (cause) {
    throw new TypeError('Stored Google Drive authorization is invalid', { cause })
  }
  return parseGoogleDriveRefreshTokenEnvelope(parsed)
}

export function serializeGoogleDriveRefreshTokenEnvelope(
  value: GoogleDriveRefreshTokenEnvelope
): string {
  return JSON.stringify(parseGoogleDriveRefreshTokenEnvelope(value))
}

export function parseGoogleDriveOAuthPublicMetadata(
  value: unknown
): GoogleDriveOAuthPublicMetadata {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      ['schemaVersion', 'profileId', 'subject', 'authorizationVersion', 'grantedScopes'],
      ['email']
    ) ||
    value.schemaVersion !== GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION ||
    !boundedText(value.profileId, 64) ||
    !/^[a-z0-9._-]+$/.test(value.profileId) ||
    !boundedText(value.subject, MAX_SUBJECT_LENGTH) ||
    !validAuthorizationVersion(value.authorizationVersion) ||
    !validScopes(value.grantedScopes) ||
    (value.email !== undefined && !boundedText(value.email, MAX_EMAIL_LENGTH))
  ) {
    throw new TypeError('Stored Google Drive account metadata is invalid')
  }
  return Object.freeze({
    schemaVersion: GOOGLE_DRIVE_OAUTH_ENVELOPE_VERSION,
    profileId: value.profileId,
    subject: value.subject,
    ...(value.email === undefined ? {} : { email: value.email }),
    authorizationVersion: value.authorizationVersion,
    grantedScopes: GOOGLE_DRIVE_OAUTH_SCOPES
  })
}

export function googleDriveAccountLabel(metadata: GoogleDriveOAuthPublicMetadata): string {
  return metadata.email ?? `Google account · ${metadata.subject.slice(-6)}`
}
