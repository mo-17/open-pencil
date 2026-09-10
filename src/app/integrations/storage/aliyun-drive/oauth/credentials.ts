import {
  hasExactOAuthKeys as hasExactKeys,
  isOAuthRecord as isRecord,
  oauthSerializedBytes as serializedBytes,
  parseBoundedOAuthJSON
} from '@/app/integrations/storage/oauth-shared/validation'

import {
  parseAliyunDriveOAuthClient,
  type AliyunDriveSelfHostedConfidentialOAuthClient,
  type AliyunDriveSelfHostedPublicOAuthClient
} from './envelope'

export const MAX_ALIYUN_DRIVE_OAUTH_CREDENTIALS_BYTES = 8 * 1024

export type AliyunDriveImportedOAuthClient =
  | AliyunDriveSelfHostedConfidentialOAuthClient
  | AliyunDriveSelfHostedPublicOAuthClient

export type AliyunDriveOAuthCredentialsErrorCode = 'invalid-credentials' | 'credentials-too-large'

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

/**
 * Strict OpenPencil import format. OAuth endpoints, scopes, token values, and publisher mode are
 * deliberately not accepted; the host fixes official endpoints and exact scopes.
 */
export function parseAliyunDriveOAuthCredentials(value: unknown): AliyunDriveImportedOAuthClient {
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
  return parseAliyunDriveOAuthCredentials(
    parseBoundedOAuthJSON(
      value,
      MAX_ALIYUN_DRIVE_OAUTH_CREDENTIALS_BYTES,
      invalidCredentials,
      () => new AliyunDriveOAuthCredentialsError('credentials-too-large')
    )
  )
}
