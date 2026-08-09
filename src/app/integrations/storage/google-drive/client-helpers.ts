import type {
  StorageDocumentAuthority,
  StorageDocumentMetadata,
  StorageRemoteRevision
} from '../types'
import { GoogleDriveError, parseRetryAfter, throwIfAborted } from './errors'
import {
  GOOGLE_DRIVE_API_ORIGIN,
  GOOGLE_DRIVE_APP_PROPERTY,
  GOOGLE_DRIVE_APP_PROPERTY_VALUE,
  type GoogleDriveClientLimits,
  type GoogleDriveFile,
  type GoogleDriveOAuthToken,
  type GoogleDriveSleep,
  type GoogleDriveUploadMetadata
} from './types'

export const FILE_FIELDS = [
  'id',
  'name',
  'mimeType',
  'modifiedTime',
  'size',
  'version',
  'md5Checksum',
  'headRevisionId',
  'trashed',
  'appProperties'
].join(',')

const DEFAULT_LIMITS = {
  maxDownloadBytes: 512 * 1024 * 1024,
  maxErrorBytes: 64 * 1024,
  maxJsonBytes: 2 * 1024 * 1024,
  maxListPages: 20,
  maxListItems: 5_000,
  maxChangePages: 20,
  maxChanges: 5_000,
  maxRequestAttempts: 4,
  maxUploadAttempts: 12,
  maxUploadSessionRestarts: 2
}

export type ResolvedLimits = {
  [Key in keyof typeof DEFAULT_LIMITS]: number
}

export type ResolvedToken = {
  accessToken: string
  authority: StorageDocumentAuthority
}

export type CachedMetadata = StorageDocumentMetadata & { size: number | null }

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new GoogleDriveError('invalid-input', `${label} must be a positive integer`)
  }
  return value
}

export function resolveLimits(input: GoogleDriveClientLimits | undefined): ResolvedLimits {
  return {
    maxDownloadBytes: positiveInteger(
      input?.maxDownloadBytes,
      DEFAULT_LIMITS.maxDownloadBytes,
      'maxDownloadBytes'
    ),
    maxErrorBytes: positiveInteger(
      input?.maxErrorBytes,
      DEFAULT_LIMITS.maxErrorBytes,
      'maxErrorBytes'
    ),
    maxJsonBytes: positiveInteger(input?.maxJsonBytes, DEFAULT_LIMITS.maxJsonBytes, 'maxJsonBytes'),
    maxListPages: positiveInteger(input?.maxListPages, DEFAULT_LIMITS.maxListPages, 'maxListPages'),
    maxListItems: positiveInteger(input?.maxListItems, DEFAULT_LIMITS.maxListItems, 'maxListItems'),
    maxChangePages: positiveInteger(
      input?.maxChangePages,
      DEFAULT_LIMITS.maxChangePages,
      'maxChangePages'
    ),
    maxChanges: positiveInteger(input?.maxChanges, DEFAULT_LIMITS.maxChanges, 'maxChanges'),
    maxRequestAttempts: positiveInteger(
      input?.maxRequestAttempts,
      DEFAULT_LIMITS.maxRequestAttempts,
      'maxRequestAttempts'
    ),
    maxUploadAttempts: positiveInteger(
      input?.maxUploadAttempts,
      DEFAULT_LIMITS.maxUploadAttempts,
      'maxUploadAttempts'
    ),
    maxUploadSessionRestarts:
      positiveInteger(
        input?.maxUploadSessionRestarts === undefined
          ? undefined
          : input.maxUploadSessionRestarts + 1,
        DEFAULT_LIMITS.maxUploadSessionRestarts + 1,
        'maxUploadSessionRestarts'
      ) - 1
  }
}

export const defaultSleep: GoogleDriveSleep = (delayMs, signal) => {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs)
    if (!signal) return
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new GoogleDriveError('aborted', 'Google Drive operation was cancelled'))
      },
      { once: true }
    )
  })
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function boundedString(value: unknown, label: string, maxLength = 1_024): string {
  if (typeof value !== 'string' || !value || value.length > maxLength) {
    throw new GoogleDriveError('invalid-response', `Google Drive returned an invalid ${label}`)
  }
  return value
}

export function optionalString(value: unknown, maxLength = 1_024): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined
}

export function parseTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return new Date(0).toISOString()
  }
  return new Date(value).toISOString()
}

export function parseSize(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export function parseAppProperties(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) return {}
  if (!isRecord(value)) {
    throw new GoogleDriveError('invalid-response', 'Google Drive returned invalid appProperties')
  }
  const entries = Object.entries(value)
  if (entries.length > 100) {
    throw new GoogleDriveError('resource-limit', 'Google Drive appProperties exceeded the limit')
  }
  const output: [string, string][] = []
  for (const [key, entry] of entries) {
    if (key.length > 124 || typeof entry !== 'string' || entry.length > 124) {
      throw new GoogleDriveError('invalid-response', 'Google Drive returned invalid appProperties')
    }
    output.push([key, entry])
  }
  return Object.fromEntries(output)
}

function parseMd5FromGoogleHash(value: string | null): string | undefined {
  if (!value) return undefined
  const encoded = value
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.startsWith('md5='))
    ?.slice(4)
  if (!encoded || encoded.length > 64) return undefined
  try {
    const binary = atob(encoded)
    if (binary.length !== 16) return undefined
    return Array.from(binary, (character) =>
      character.charCodeAt(0).toString(16).padStart(2, '0')
    ).join('')
  } catch {
    return undefined
  }
}

export function revisionFrom(
  headers: Headers,
  file?: Pick<GoogleDriveFile, 'version' | 'headRevisionId' | 'md5Checksum'>
): StorageRemoteRevision | null {
  const revision: Record<string, string> = {}
  const etag = headers.get('etag')
  const generation = headers.get('x-goog-generation')
  const checksum = file?.md5Checksum ?? parseMd5FromGoogleHash(headers.get('x-goog-hash'))
  if (file?.version) revision.version = file.version
  if (file?.headRevisionId) revision.headRevisionId = file.headRevisionId
  if (checksum) revision.checksum = checksum
  if (etag) revision.etag = etag
  if (generation) revision.generation = generation
  return Object.keys(revision).length > 0 ? revision : null
}

export function validateDocumentId(id: string): string {
  const trimmed = id.trim()
  if (!trimmed || trimmed.length > 256 || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new GoogleDriveError('invalid-input', 'Google Drive document ID is invalid')
  }
  return trimmed
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 32 || code === 127) return true
  }
  return false
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function validateUploadMetadata(metadata: GoogleDriveUploadMetadata): {
  name: string
  appProperties: Readonly<Record<string, string>>
} {
  const name = metadata.name.trim()
  if (
    !name ||
    !name.toLocaleLowerCase().endsWith('.fig') ||
    hasControlCharacter(name) ||
    byteLength(name) > 512
  ) {
    throw new GoogleDriveError('invalid-input', 'Google Drive upload requires a valid .fig name')
  }
  const entries = Object.entries(metadata.appProperties ?? {})
  if (entries.length > 99) {
    throw new GoogleDriveError(
      'invalid-input',
      'Google Drive upload appProperties exceeded the limit'
    )
  }
  const appProperties: [string, string][] = []
  for (const [key, value] of entries) {
    if (
      !key ||
      hasControlCharacter(key) ||
      hasControlCharacter(value) ||
      byteLength(key) > 124 ||
      byteLength(value) > 124
    ) {
      throw new GoogleDriveError('invalid-input', 'Google Drive upload appProperties are invalid')
    }
    appProperties.push([key, value])
  }
  return { name, appProperties: Object.fromEntries(appProperties) }
}

export function validateEtag(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 1_024 || hasControlCharacter(trimmed)) {
    throw new GoogleDriveError('invalid-input', 'Google Drive ETag is invalid')
  }
  return trimmed
}

export function validatePageToken(token: string, label = 'page token'): string {
  const trimmed = token.trim()
  if (!trimmed || trimmed.length > 4_096 || hasControlCharacter(trimmed)) {
    throw new GoogleDriveError('invalid-input', `Google Drive ${label} is invalid`)
  }
  return trimmed
}

export function exactAuthority(
  actual: StorageDocumentAuthority,
  expected: StorageDocumentAuthority | undefined
): void {
  if (
    expected &&
    (actual.accountId !== expected.accountId ||
      actual.authorizationVersion !== expected.authorizationVersion)
  ) {
    throw new GoogleDriveError(
      'authorization-changed',
      'Google Drive authorization changed during the operation'
    )
  }
}

export function tokenAuthority(token: GoogleDriveOAuthToken): ResolvedToken {
  const accessToken = token.accessToken.trim()
  const explicitAccountId = token.accountId?.trim()
  const subject = token.subject?.trim()
  if (explicitAccountId && subject && explicitAccountId !== subject) {
    throw new GoogleDriveError('auth', 'Google Drive account identity is inconsistent')
  }
  const accountId = explicitAccountId ?? subject ?? ''
  const authorizationVersion = token.authorizationVersion.trim()
  if (
    !accessToken ||
    accessToken.length > 16_384 ||
    hasControlCharacter(accessToken) ||
    !accountId ||
    accountId.length > 512 ||
    hasControlCharacter(accountId) ||
    !authorizationVersion ||
    authorizationVersion.length > 512 ||
    hasControlCharacter(authorizationVersion)
  ) {
    throw new GoogleDriveError('auth', 'Google Drive authorization is invalid')
  }
  return { accessToken, authority: { accountId, authorizationVersion } }
}

export function isOpenPencilFile(file: GoogleDriveFile): boolean {
  return (
    !file.trashed &&
    file.name.toLocaleLowerCase().endsWith('.fig') &&
    file.appProperties[GOOGLE_DRIVE_APP_PROPERTY] === GOOGLE_DRIVE_APP_PROPERTY_VALUE
  )
}

export function retryDelay(response: Response | null, attempt: number): number {
  return (
    parseRetryAfter(response?.headers.get('retry-after') ?? null) ??
    Math.min(250 * 2 ** Math.max(0, attempt - 1), 4_000)
  )
}

export async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

export function allowedGoogleUrl(value: string, uploadSession = false): string {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new GoogleDriveError('invalid-response', 'Google Drive returned an invalid URL', {
      cause: error
    })
  }
  const allowedPrefix = uploadSession ? '/upload/drive/v3/files' : '/drive/v3/'
  const allowedPath = uploadSession
    ? url.pathname === allowedPrefix || url.pathname.startsWith(`${allowedPrefix}/`)
    : url.pathname.startsWith(allowedPrefix)
  if (
    url.origin !== GOOGLE_DRIVE_API_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    !allowedPath
  ) {
    throw new GoogleDriveError('invalid-response', 'Google Drive URL is outside the allowed API')
  }
  return url.toString()
}

export function contentDispositionName(value: string | null): string | null {
  if (!value || value.length > 2_048) return null
  const encoded = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i.exec(value)?.[1]
  if (encoded) {
    try {
      const decoded = decodeURIComponent(encoded.trim())
      if (decoded && decoded.length <= 512 && !hasControlCharacter(decoded)) return decoded
    } catch (error) {
      void error
    }
  }
  const basic = /(?:^|;)\s*filename=(?:"([^"]+)"|([^;]+))/i.exec(value)
  const name = (basic?.[1] ?? basic?.[2])?.trim()
  return name && name.length <= 512 && !hasControlCharacter(name) ? name : null
}
