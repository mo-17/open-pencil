import { browserCredentialStorage } from '@/app/settings/credentials/storage'

import {
  parseGoogleDriveOAuthPublicMetadata,
  type GoogleDriveOAuthPublicMetadata
} from './envelope'

const STORAGE_PREFIX = 'open-pencil:google-drive-oauth:v1:'

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
    if (raw.length > 4 * 1024) {
      throw new TypeError('Stored Google Drive account metadata is invalid')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (cause) {
      throw new TypeError('Stored Google Drive account metadata is invalid', { cause })
    }
    return parseGoogleDriveOAuthPublicMetadata(parsed)
  }

  async write(metadata: GoogleDriveOAuthPublicMetadata): Promise<void> {
    if (!this.storage) throw new Error('Google Drive account metadata storage is unavailable')
    const parsed = parseGoogleDriveOAuthPublicMetadata(metadata)
    this.storage.setItem(metadataKey(parsed.profileId), JSON.stringify(parsed))
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
