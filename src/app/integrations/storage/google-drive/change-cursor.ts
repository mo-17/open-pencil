import { browserCredentialStorage } from '@/app/settings/credentials/storage'

import type { StorageDocumentAuthority } from '../types'

const STORAGE_PREFIX = 'open-pencil:google-drive:changes:v1:'

export type GoogleDriveChangeCursorIdentity = {
  profileId: string
  authority: StorageDocumentAuthority
}

function boundedSegment(value: string, name: string): string {
  const normalized = value.trim()
  if (!/^[a-z0-9._-]{1,256}$/.test(normalized)) {
    throw new TypeError(`Google Drive ${name} is invalid`)
  }
  return normalized
}

function encodedAccountId(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 256 || /\p{Cc}/u.test(normalized)) {
    throw new TypeError('Google Drive account identity is invalid')
  }
  return encodeURIComponent(normalized)
}

function cursorKey(identity: GoogleDriveChangeCursorIdentity): string {
  return `${STORAGE_PREFIX}${boundedSegment(identity.profileId, 'profile')}:${encodedAccountId(
    identity.authority.accountId
  )}:${boundedSegment(identity.authority.authorizationVersion, 'authorization version')}`
}

export function parseGoogleDriveChangePageToken(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > 4096 || /[\p{Cc}\p{Z}]/u.test(normalized)) {
    throw new TypeError('Google Drive change cursor is invalid')
  }
  return normalized
}

export function readGoogleDriveChangeCursor(
  identity: GoogleDriveChangeCursorIdentity,
  storage: Storage | null = browserCredentialStorage()
): string | null {
  const value = storage?.getItem(cursorKey(identity))
  if (!value) return null
  try {
    return parseGoogleDriveChangePageToken(value)
  } catch {
    storage?.removeItem(cursorKey(identity))
    return null
  }
}

export function writeGoogleDriveChangeCursor(
  identity: GoogleDriveChangeCursorIdentity,
  pageToken: string,
  storage: Storage | null = browserCredentialStorage()
): void {
  storage?.setItem(cursorKey(identity), parseGoogleDriveChangePageToken(pageToken))
}

export function clearGoogleDriveChangeCursor(
  identity: GoogleDriveChangeCursorIdentity,
  storage: Storage | null = browserCredentialStorage()
): void {
  storage?.removeItem(cursorKey(identity))
}
