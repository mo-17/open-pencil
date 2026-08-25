import { browserCredentialStorage } from '@/app/settings/credentials/storage'

import {
  ONEDRIVE_OAUTH_SCOPES,
  parseOneDriveOAuthPublicMetadata,
  type OneDriveOAuthPublicMetadata
} from './envelope'

const STORAGE_PREFIX = 'open-pencil:onedrive-oauth:v1:'
const MAX_ONEDRIVE_OAUTH_METADATA_BYTES = 4 * 1024

function invalidMetadata(): TypeError {
  return new TypeError('Stored OneDrive account metadata is invalid')
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export interface OneDriveOAuthMetadataStore {
  read(profileId: string): Promise<OneDriveOAuthPublicMetadata | null>
  write(metadata: OneDriveOAuthPublicMetadata): Promise<void>
  remove(profileId: string): Promise<void>
}

function metadataKey(profileId: string): string {
  const metadata = parseOneDriveOAuthPublicMetadata({
    schemaVersion: 1,
    profileId,
    subject: 'validation',
    authorizationVersion: '0'.repeat(32),
    grantedScopes: ONEDRIVE_OAUTH_SCOPES
  })
  return `${STORAGE_PREFIX}${metadata.profileId}`
}

export class LocalOneDriveOAuthMetadataStore implements OneDriveOAuthMetadataStore {
  constructor(private readonly storage: Storage | null = browserCredentialStorage()) {}

  async read(profileId: string): Promise<OneDriveOAuthPublicMetadata | null> {
    const raw = this.storage?.getItem(metadataKey(profileId))
    if (!raw) return null
    if (utf8Bytes(raw) > MAX_ONEDRIVE_OAUTH_METADATA_BYTES) throw invalidMetadata()
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw invalidMetadata()
    }
    return parseOneDriveOAuthPublicMetadata(parsed)
  }

  async write(metadata: OneDriveOAuthPublicMetadata): Promise<void> {
    if (!this.storage) throw new Error('OneDrive account metadata storage is unavailable')
    const parsed = parseOneDriveOAuthPublicMetadata(metadata)
    const serialized = JSON.stringify(parsed)
    if (utf8Bytes(serialized) > MAX_ONEDRIVE_OAUTH_METADATA_BYTES) throw invalidMetadata()
    this.storage.setItem(metadataKey(parsed.profileId), serialized)
  }

  async remove(profileId: string): Promise<void> {
    this.storage?.removeItem(metadataKey(profileId))
  }
}

export class MemoryOneDriveOAuthMetadataStore implements OneDriveOAuthMetadataStore {
  readonly #values = new Map<string, OneDriveOAuthPublicMetadata>()

  async read(profileId: string): Promise<OneDriveOAuthPublicMetadata | null> {
    const value = this.#values.get(metadataKey(profileId))
    return value ? parseOneDriveOAuthPublicMetadata(value) : null
  }

  async write(metadata: OneDriveOAuthPublicMetadata): Promise<void> {
    const parsed = parseOneDriveOAuthPublicMetadata(metadata)
    this.#values.set(metadataKey(parsed.profileId), parsed)
  }

  async remove(profileId: string): Promise<void> {
    this.#values.delete(metadataKey(profileId))
  }
}
