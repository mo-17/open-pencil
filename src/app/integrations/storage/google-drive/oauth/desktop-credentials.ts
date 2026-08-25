import {
  parseGoogleDriveOAuthClient,
  type GoogleDriveSelfHostedDesktopOAuthClient
} from './envelope'

export const MAX_GOOGLE_DRIVE_DESKTOP_CREDENTIALS_BYTES = 16 * 1024

export type GoogleDriveDesktopCredentialsErrorCode = 'invalid-credentials' | 'credentials-too-large'

const ERROR_MESSAGES: Readonly<Record<GoogleDriveDesktopCredentialsErrorCode, string>> = {
  'invalid-credentials': 'The Google Desktop OAuth credentials file is invalid',
  'credentials-too-large': 'The Google Desktop OAuth credentials file is too large'
}

/** Static, non-reflective import failure safe to map into UI or diagnostics. */
export class GoogleDriveDesktopCredentialsError extends Error {
  constructor(readonly code: GoogleDriveDesktopCredentialsErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'GoogleDriveDesktopCredentialsError'
  }
}

function invalidCredentials(): GoogleDriveDesktopCredentialsError {
  return new GoogleDriveDesktopCredentialsError('invalid-credentials')
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyInstalled(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === 'installed' && Object.hasOwn(value, 'installed')
}

function serializedBytes(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? utf8Bytes(serialized) : null
  } catch {
    return null
  }
}

/**
 * Parses Google's downloaded Desktop OAuth object. URI and project fields are deliberately ignored;
 * OpenPencil owns every OAuth endpoint and callback policy.
 */
export function parseGoogleDriveDesktopCredentials(
  value: unknown
): GoogleDriveSelfHostedDesktopOAuthClient {
  if (!isRecord(value) || !hasOnlyInstalled(value)) throw invalidCredentials()
  const bytes = serializedBytes(value)
  if (bytes === null) throw invalidCredentials()
  if (bytes > MAX_GOOGLE_DRIVE_DESKTOP_CREDENTIALS_BYTES) {
    throw new GoogleDriveDesktopCredentialsError('credentials-too-large')
  }
  if (!isRecord(value.installed)) throw invalidCredentials()

  try {
    const client = parseGoogleDriveOAuthClient({
      mode: 'self-hosted-desktop',
      clientId: value.installed.client_id,
      clientSecret: value.installed.client_secret
    })
    if (client.mode !== 'self-hosted-desktop') throw invalidCredentials()
    return client
  } catch {
    throw invalidCredentials()
  }
}

export function parseGoogleDriveDesktopCredentialsJSON(
  value: string
): GoogleDriveSelfHostedDesktopOAuthClient {
  if (typeof value !== 'string' || value.length === 0) throw invalidCredentials()
  if (utf8Bytes(value) > MAX_GOOGLE_DRIVE_DESKTOP_CREDENTIALS_BYTES) {
    throw new GoogleDriveDesktopCredentialsError('credentials-too-large')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw invalidCredentials()
  }
  return parseGoogleDriveDesktopCredentials(parsed)
}
