import { browserCredentialStorage } from '@/app/settings/credentials/storage'

import {
  parseGoogleDriveOAuthPublicMetadata,
  type GoogleDriveOAuthPublicMetadata
} from './envelope'

const STORAGE_PREFIX = 'open-pencil:google-drive-oauth:v1:'
const MAX_GOOGLE_DRIVE_OAUTH_METADATA_BYTES = 4 * 1024

function invalidMetadata(): TypeError {
  return new TypeError('Stored Google Drive account metadata is invalid')
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export interface GoogleDriveOAuthMetadataStore {
  read(profileId: string): Promise<GoogleDriveOAuthPublicMetadata | null>
  write(metadata: GoogleDriveOAuthPublicMetadata): Promise<void>
  remove(profileId: string): Promise<void>
}

function metadataKey(profileId: string): string {
  const metadata = parseGoogleDriveOAuthPublicMetadata({
    schemaVersion: 1,
    profileId,
    subject: 'validation',
    authorizationVersion: '0'.repeat(32),
    grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/drive.file']
  })
  return `${STORAGE_PREFIX}${metadata.profileId}`
}

export class LocalGoogleDriveOAuthMetadataStore implements GoogleDriveOAuthMetadataStore {
  constructor(private readonly storage: Storage | null = browserCredentialStorage()) {}

  async read(profileId: string): Promise<GoogleDriveOAuthPublicMetadata | null> {
    const raw = this.storage?.getItem(metadataKey(profileId))
    if (!raw) return null
    if (utf8Bytes(raw) > MAX_GOOGLE_DRIVE_OAUTH_METADATA_BYTES) throw invalidMetadata()
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw invalidMetadata()
    }
    return parseGoogleDriveOAuthPublicMetadata(parsed)
  }

  async write(metadata: GoogleDriveOAuthPublicMetadata): Promise<void> {
    if (!this.storage) throw new Error('Google Drive account metadata storage is unavailable')
    const parsed = parseGoogleDriveOAuthPublicMetadata(metadata)
    const serialized = JSON.stringify(parsed)
    if (utf8Bytes(serialized) > MAX_GOOGLE_DRIVE_OAUTH_METADATA_BYTES) throw invalidMetadata()
    this.storage.setItem(metadataKey(parsed.profileId), serialized)
  }

  async remove(profileId: string): Promise<void> {
    this.storage?.removeItem(metadataKey(profileId))
  }
}

export class MemoryGoogleDriveOAuthMetadataStore implements GoogleDriveOAuthMetadataStore {
  readonly #values = new Map<string, GoogleDriveOAuthPublicMetadata>()

  async read(profileId: string): Promise<GoogleDriveOAuthPublicMetadata | null> {
    const value = this.#values.get(metadataKey(profileId))
    return value ? parseGoogleDriveOAuthPublicMetadata(value) : null
  }

  async write(metadata: GoogleDriveOAuthPublicMetadata): Promise<void> {
    const parsed = parseGoogleDriveOAuthPublicMetadata(metadata)
    this.#values.set(metadataKey(parsed.profileId), parsed)
  }

  async remove(profileId: string): Promise<void> {
    this.#values.delete(metadataKey(profileId))
  }
}
