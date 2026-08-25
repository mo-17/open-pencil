import {
  parseAliyunDriveOAuthClient,
  type AliyunDriveSelfHostedConfidentialOAuthClient,
  type AliyunDriveSelfHostedPublicOAuthClient
} from './envelope'

export const MAX_ALIYUN_DRIVE_OAUTH_CREDENTIALS_BYTES = 8 * 1024

export type AliyunDriveImportedOAuthClient =
  | AliyunDriveSelfHostedConfidentialOAuthClient
  | AliyunDriveSelfHostedPublicOAuthClient

export type AliyunDriveOAuthCredentialsErrorCode =
  | 'invalid-credentials'
  | 'credentials-too-large'

const ERROR_MESSAGES: Readonly<Record<AliyunDriveOAuthCredentialsErrorCode, string>> = {
  'invalid-credentials': 'The Aliyun Drive OAuth credentials file is invalid',
  'credentials-too-large': 'The Aliyun Drive OAuth credentials file is too large'
}

export class AliyunDriveOAuthCredentialsError extends Error {
  constructor(readonly code: AliyunDriveOAuthCredentialsErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'AliyunDriveOAuthCredentialsError'
  }
}

function invalidCredentials(): AliyunDriveOAuthCredentialsError {
  return new AliyunDriveOAuthCredentialsError('invalid-credentials')
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => expected.includes(key))
  )
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
 * Strict OpenPencil import format. OAuth endpoints, scopes, token values, and publisher mode are
 * deliberately not accepted; the host fixes official endpoints and exact scopes.
 */
export function parseAliyunDriveOAuthCredentials(
  value: unknown
): AliyunDriveImportedOAuthClient {
  if (!isRecord(value)) throw invalidCredentials()
  const bytes = serializedBytes(value)
  if (bytes === null) throw invalidCredentials()
  if (bytes > MAX_ALIYUN_DRIVE_OAUTH_CREDENTIALS_BYTES) {
    throw new AliyunDriveOAuthCredentialsError('credentials-too-large')
  }
  const confidential = value.mode === 'self-hosted-confidential'
  const publicClient = value.mode === 'self-hosted-public'
  if (
    (!confidential && !publicClient) ||
    !hasExactKeys(
      value,
      confidential
        ? ['mode', 'client_id', 'client_secret', 'redirect_uri']
        : ['mode', 'client_id', 'redirect_uri']
    )
  ) {
    throw invalidCredentials()
  }
  try {
    const client = parseAliyunDriveOAuthClient({
      mode: value.mode,
      clientId: value.client_id,
      ...(confidential ? { clientSecret: value.client_secret } : {}),
      redirectUri: value.redirect_uri
    })
    if (client.mode === 'publisher-broker-confidential') throw invalidCredentials()
    return client
  } catch {
    throw invalidCredentials()
  }
}

export function parseAliyunDriveOAuthCredentialsJSON(
  value: string
): AliyunDriveImportedOAuthClient {
  if (typeof value !== 'string' || value.length === 0) throw invalidCredentials()
  if (utf8Bytes(value) > MAX_ALIYUN_DRIVE_OAUTH_CREDENTIALS_BYTES) {
    throw new AliyunDriveOAuthCredentialsError('credentials-too-large')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw invalidCredentials()
  }
  return parseAliyunDriveOAuthCredentials(parsed)
}
