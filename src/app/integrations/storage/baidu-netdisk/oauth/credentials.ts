import { parseBaiduNetdiskOAuthClient, type BaiduNetdiskSelfHostedOAuthClient } from './envelope'

export const MAX_BAIDU_NETDISK_SELF_HOSTED_CREDENTIALS_BYTES = 16 * 1024

export type BaiduNetdiskCredentialsErrorCode = 'invalid-credentials' | 'credentials-too-large'

const ERROR_MESSAGES: Readonly<Record<BaiduNetdiskCredentialsErrorCode, string>> = Object.freeze({
  'invalid-credentials': 'The Baidu OAuth credentials file is invalid',
  'credentials-too-large': 'The Baidu OAuth credentials file is too large'
})

export class BaiduNetdiskCredentialsError extends Error {
  constructor(readonly code: BaiduNetdiskCredentialsErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'BaiduNetdiskCredentialsError'
  }
}

function invalidCredentials(): BaiduNetdiskCredentialsError {
  return new BaiduNetdiskCredentialsError('invalid-credentials')
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value)
  return keys.length === 2 && Object.hasOwn(value, 'appKey') && Object.hasOwn(value, 'secretKey')
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
 * Imports only the two Baidu application credential fields. OAuth endpoints, scopes, callback
 * policy, source path, and the original JSON are intentionally neither accepted nor retained.
 */
export function parseBaiduNetdiskSelfHostedCredentials(
  value: unknown
): BaiduNetdiskSelfHostedOAuthClient {
  if (!isRecord(value) || !hasExactKeys(value)) throw invalidCredentials()
  const bytes = serializedBytes(value)
  if (bytes === null) throw invalidCredentials()
  if (bytes > MAX_BAIDU_NETDISK_SELF_HOSTED_CREDENTIALS_BYTES) {
    throw new BaiduNetdiskCredentialsError('credentials-too-large')
  }
  try {
    const parsed = parseBaiduNetdiskOAuthClient({
      mode: 'self-hosted',
      appKey: value.appKey,
      secretKey: value.secretKey
    })
    if (parsed.mode !== 'self-hosted') throw invalidCredentials()
    return parsed
  } catch (cause) {
    if (cause instanceof BaiduNetdiskCredentialsError) throw cause
    throw invalidCredentials()
  }
}

export function parseBaiduNetdiskSelfHostedCredentialsJSON(
  value: string
): BaiduNetdiskSelfHostedOAuthClient {
  if (typeof value !== 'string' || value.length === 0) throw invalidCredentials()
  if (utf8Bytes(value) > MAX_BAIDU_NETDISK_SELF_HOSTED_CREDENTIALS_BYTES) {
    throw new BaiduNetdiskCredentialsError('credentials-too-large')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw invalidCredentials()
  }
  return parseBaiduNetdiskSelfHostedCredentials(parsed)
}
