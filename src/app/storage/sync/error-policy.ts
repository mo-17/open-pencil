import { AliyunDriveError } from '@/app/integrations/storage/aliyun-drive/errors'
import {
  AliyunDriveOAuthError,
  type AliyunDriveOAuthErrorCode
} from '@/app/integrations/storage/aliyun-drive/oauth/errors'
import { BaiduNetdiskError } from '@/app/integrations/storage/baidu-netdisk/errors'
import {
  BaiduNetdiskOAuthError,
  type BaiduNetdiskOAuthErrorCode
} from '@/app/integrations/storage/baidu-netdisk/oauth/session'
import { GoogleDriveOAuthError } from '@/app/integrations/storage/google-drive/oauth/session'
import { OneDriveError } from '@/app/integrations/storage/onedrive/errors'
import {
  OneDriveOAuthError,
  type OneDriveOAuthErrorCode
} from '@/app/integrations/storage/onedrive/oauth/session'

function hasPermanentErrorMessage(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('403') ||
    msg.includes('401') ||
    msg.includes('access denied') ||
    msg.includes('invalid access key') ||
    msg.includes('not configured')
  )
}

const PERMANENT_GOOGLE_DRIVE_OAUTH_ERRORS = new Set<GoogleDriveOAuthError['code']>([
  'unsupported',
  'invalid-client-id',
  'invalid-profile',
  'credential-locked',
  'credential-unavailable',
  'credential-missing',
  'credential-invalid',
  'metadata-invalid',
  'inconsistent-state',
  'profile-account-mismatch',
  'oauth-client-invalid',
  'authorization-grant-invalid',
  'redirect-uri-mismatch',
  'token-request-invalid',
  'token-response-invalid',
  'oauth-broker-misconfigured',
  'oauth-broker-protocol-invalid',
  'scope-mismatch',
  'subject-mismatch',
  'persistence-failed'
])

const PERMANENT_ONEDRIVE_OAUTH_ERRORS = new Set<OneDriveOAuthErrorCode>([
  'unsupported',
  'setup-required',
  'invalid-profile',
  'credential-locked',
  'credential-unavailable',
  'credential-missing',
  'credential-invalid',
  'metadata-invalid',
  'inconsistent-state',
  'profile-account-mismatch',
  'oauth-client-invalid',
  'authorization-grant-invalid',
  'redirect-uri-mismatch',
  'token-request-invalid',
  'token-response-invalid',
  'scope-mismatch',
  'subject-mismatch',
  'persistence-failed'
])

const PERMANENT_ALIYUN_DRIVE_OAUTH_ERRORS = new Set<AliyunDriveOAuthErrorCode>([
  'unsupported',
  'setup-required',
  'invalid-client',
  'credential-missing',
  'credential-invalid',
  'credential-locked',
  'credential-unavailable',
  'metadata-missing',
  'metadata-invalid',
  'authority-mismatch',
  'profile-account-mismatch',
  'oauth-client-invalid',
  'authorization-grant-invalid',
  'redirect-uri-mismatch',
  'token-request-invalid',
  'token-response-invalid',
  'scope-mismatch',
  'subject-mismatch',
  'reconnect-required',
  'persistence-failed'
])

const PERMANENT_BAIDU_NETDISK_OAUTH_ERRORS = new Set<BaiduNetdiskOAuthErrorCode>([
  'unsupported',
  'setup-required',
  'self-hosted-credentials-required',
  'invalid-profile',
  'credential-locked',
  'credential-unavailable',
  'credential-missing',
  'credential-invalid',
  'metadata-invalid',
  'inconsistent-state',
  'profile-account-mismatch',
  'oauth-client-invalid',
  'authorization-grant-invalid',
  'token-request-invalid',
  'token-response-invalid',
  'scope-mismatch',
  'uk-mismatch',
  'persistence-failed'
])

const TRANSIENT_GOOGLE_DRIVE_OAUTH_ERRORS = new Set<GoogleDriveOAuthError['code']>([
  'oauth-broker-unavailable',
  'oauth-broker-rate-limited'
])
const TRANSIENT_ONEDRIVE_OAUTH_ERRORS = new Set<OneDriveOAuthErrorCode>([
  'network-failed',
  'rate-limited'
])
const TRANSIENT_ALIYUN_DRIVE_OAUTH_ERRORS = new Set<AliyunDriveOAuthErrorCode>([
  'network-failed',
  'rate-limited',
  'oauth-broker-unavailable'
])
const TRANSIENT_BAIDU_NETDISK_OAUTH_ERRORS = new Set<BaiduNetdiskOAuthErrorCode>([
  'network-failed',
  'rate-limited',
  'oauth-broker-unavailable'
])

const PERMANENT_ONEDRIVE_DATA_ERRORS = new Set<OneDriveError['code']>([
  'auth',
  'authorization-changed',
  'permission',
  'quota'
])
const PERMANENT_ALIYUN_DRIVE_DATA_ERRORS = new Set<AliyunDriveError['code']>([
  'auth',
  'authorization-changed',
  'permission',
  'preservation-failed',
  'quota'
])
const PERMANENT_BAIDU_NETDISK_DATA_ERRORS = new Set<BaiduNetdiskError['code']>([
  'auth',
  'authorization-changed',
  'permission',
  'quota'
])
const TRANSIENT_DATA_ERRORS = new Set<
  OneDriveError['code'] | AliyunDriveError['code'] | BaiduNetdiskError['code']
>(['network', 'server', 'rate-limited'])

export type StorageSyncErrorPolicy = Readonly<{
  permanent: boolean
  retryAfterMs?: number
  retryBeyondAttemptLimit: boolean
  retryScope?: 'provider'
}>

function explicitErrorPolicy<Code extends string>(
  code: Code,
  permanentCodes: ReadonlySet<Code>,
  transientCodes: ReadonlySet<Code>,
  rateLimitedCode: Code,
  retryAfterMs?: number
): StorageSyncErrorPolicy {
  return {
    permanent: permanentCodes.has(code),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    retryBeyondAttemptLimit: transientCodes.has(code),
    ...(code === rateLimitedCode ? { retryScope: 'provider' as const } : {})
  }
}

/** Keep Broker outages retryable without conflating them with revoked grants or publisher faults. */
export function storageSyncErrorPolicy(error: unknown): StorageSyncErrorPolicy {
  if (error instanceof GoogleDriveOAuthError) {
    return explicitErrorPolicy(
      error.code,
      PERMANENT_GOOGLE_DRIVE_OAUTH_ERRORS,
      TRANSIENT_GOOGLE_DRIVE_OAUTH_ERRORS,
      'oauth-broker-rate-limited',
      error.retryAfterMs
    )
  }
  if (error instanceof OneDriveOAuthError) {
    return explicitErrorPolicy(
      error.code,
      PERMANENT_ONEDRIVE_OAUTH_ERRORS,
      TRANSIENT_ONEDRIVE_OAUTH_ERRORS,
      'rate-limited',
      error.retryAfterMs
    )
  }
  if (error instanceof AliyunDriveOAuthError) {
    return explicitErrorPolicy(
      error.code,
      PERMANENT_ALIYUN_DRIVE_OAUTH_ERRORS,
      TRANSIENT_ALIYUN_DRIVE_OAUTH_ERRORS,
      'rate-limited',
      error.retryAfterMs
    )
  }
  if (error instanceof BaiduNetdiskOAuthError) {
    return explicitErrorPolicy(
      error.code,
      PERMANENT_BAIDU_NETDISK_OAUTH_ERRORS,
      TRANSIENT_BAIDU_NETDISK_OAUTH_ERRORS,
      'rate-limited',
      error.retryAfterMs
    )
  }
  if (error instanceof OneDriveError) {
    return explicitErrorPolicy(
      error.code,
      PERMANENT_ONEDRIVE_DATA_ERRORS,
      TRANSIENT_DATA_ERRORS,
      'rate-limited',
      error.retryAfterMs ?? undefined
    )
  }
  if (error instanceof AliyunDriveError) {
    return explicitErrorPolicy(
      error.code,
      PERMANENT_ALIYUN_DRIVE_DATA_ERRORS,
      TRANSIENT_DATA_ERRORS,
      'rate-limited',
      error.retryAfterMs ?? undefined
    )
  }
  if (error instanceof BaiduNetdiskError) {
    return explicitErrorPolicy(
      error.code,
      PERMANENT_BAIDU_NETDISK_DATA_ERRORS,
      TRANSIENT_DATA_ERRORS,
      'rate-limited'
    )
  }
  return {
    permanent: hasPermanentErrorMessage(error),
    retryBeyondAttemptLimit: false
  }
}

export function storageSyncFailureIsPermanent(
  policy: StorageSyncErrorPolicy,
  attempts: number,
  maxAttempts: number
): boolean {
  if (policy.permanent) return true
  if (policy.retryBeyondAttemptLimit) return false
  return attempts >= maxAttempts
}
