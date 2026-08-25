import { requireStorageProfileID } from '@/app/integrations/storage/types'
import { browserCredentialStorage } from '@/app/settings/credentials/storage'

import {
  parseAliyunDriveOAuthPublicMetadata,
  type AliyunDriveOAuthPublicMetadata
} from './envelope'

const STORAGE_PREFIX = 'open-pencil:aliyun-drive-oauth:v1:'
const MAX_ALIYUN_DRIVE_OAUTH_METADATA_BYTES = 4 * 1024

function invalidMetadata(): TypeError {
  return new TypeError('Stored Aliyun Drive account metadata is invalid')
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function metadataKey(profileId: string): string {
  return `${STORAGE_PREFIX}${requireStorageProfileID(profileId)}`
}

export interface AliyunDriveOAuthMetadataStore {
  read(profileId: string): Promise<AliyunDriveOAuthPublicMetadata | null>
  write(metadata: AliyunDriveOAuthPublicMetadata): Promise<void>
  remove(profileId: string): Promise<void>
}

/** Profile-scoped, non-secret account binding stored outside the credential vault. */
export class LocalAliyunDriveOAuthMetadataStore implements AliyunDriveOAuthMetadataStore {
  constructor(private readonly storage: Storage | null = browserCredentialStorage()) {}

  async read(profileId: string): Promise<AliyunDriveOAuthPublicMetadata | null> {
    const raw = this.storage?.getItem(metadataKey(profileId))
    if (!raw) return null
    if (utf8Bytes(raw) > MAX_ALIYUN_DRIVE_OAUTH_METADATA_BYTES) throw invalidMetadata()
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw invalidMetadata()
    }
    return parseAliyunDriveOAuthPublicMetadata(parsed)
  }

  async write(metadata: AliyunDriveOAuthPublicMetadata): Promise<void> {
    if (!this.storage) throw new Error('Aliyun Drive account metadata storage is unavailable')
    const parsed = parseAliyunDriveOAuthPublicMetadata(metadata)
    const serialized = JSON.stringify(parsed)
    if (utf8Bytes(serialized) > MAX_ALIYUN_DRIVE_OAUTH_METADATA_BYTES) {
      throw invalidMetadata()
    }
    this.storage.setItem(metadataKey(parsed.profileId), serialized)
  }

  async remove(profileId: string): Promise<void> {
    this.storage?.removeItem(metadataKey(profileId))
  }
}

export class MemoryAliyunDriveOAuthMetadataStore implements AliyunDriveOAuthMetadataStore {
  readonly #values = new Map<string, AliyunDriveOAuthPublicMetadata>()

  async read(profileId: string): Promise<AliyunDriveOAuthPublicMetadata | null> {
    const value = this.#values.get(metadataKey(profileId))
    return value ? parseAliyunDriveOAuthPublicMetadata(value) : null
  }

  async write(metadata: AliyunDriveOAuthPublicMetadata): Promise<void> {
    const parsed = parseAliyunDriveOAuthPublicMetadata(metadata)
    this.#values.set(metadataKey(parsed.profileId), parsed)
  }

  async remove(profileId: string): Promise<void> {
    this.#values.delete(metadataKey(profileId))
  }
}

export const aliyunDriveOAuthMetadataStore = new LocalAliyunDriveOAuthMetadataStore()
