import { browserCredentialStorage } from '@/app/settings/credentials/storage'

import {
  BAIDU_NETDISK_OAUTH_SCOPES,
  parseBaiduNetdiskOAuthPublicMetadata,
  type BaiduNetdiskOAuthPublicMetadata
} from './envelope'

const STORAGE_PREFIX = 'open-pencil:baidu-netdisk-oauth:v1:'
const MAX_BAIDU_NETDISK_OAUTH_METADATA_BYTES = 4 * 1024

function invalidMetadata(): TypeError {
  return new TypeError('Stored Baidu Netdisk account metadata is invalid')
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export interface BaiduNetdiskOAuthMetadataStore {
  read(profileId: string): Promise<BaiduNetdiskOAuthPublicMetadata | null>
  write(metadata: BaiduNetdiskOAuthPublicMetadata): Promise<void>
  remove(profileId: string): Promise<void>
}

function metadataKey(profileId: string): string {
  const metadata = parseBaiduNetdiskOAuthPublicMetadata({
    schemaVersion: 1,
    profileId,
    uk: '0',
    authorizationVersion: '0'.repeat(32),
    grantedScopes: BAIDU_NETDISK_OAUTH_SCOPES,
    oauthClient: { mode: 'self-hosted', appKey: 'validation' }
  })
  return `${STORAGE_PREFIX}${metadata.profileId}`
}

export class LocalBaiduNetdiskOAuthMetadataStore implements BaiduNetdiskOAuthMetadataStore {
  constructor(private readonly storage: Storage | null = browserCredentialStorage()) {}

  async read(profileId: string): Promise<BaiduNetdiskOAuthPublicMetadata | null> {
    const raw = this.storage?.getItem(metadataKey(profileId))
    if (!raw) return null
    if (utf8Bytes(raw) > MAX_BAIDU_NETDISK_OAUTH_METADATA_BYTES) throw invalidMetadata()
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw invalidMetadata()
    }
    return parseBaiduNetdiskOAuthPublicMetadata(parsed)
  }

  async write(metadata: BaiduNetdiskOAuthPublicMetadata): Promise<void> {
    if (!this.storage) throw new Error('Baidu Netdisk account metadata storage is unavailable')
    const parsed = parseBaiduNetdiskOAuthPublicMetadata(metadata)
    const serialized = JSON.stringify(parsed)
    if (utf8Bytes(serialized) > MAX_BAIDU_NETDISK_OAUTH_METADATA_BYTES) {
      throw invalidMetadata()
    }
    this.storage.setItem(metadataKey(parsed.profileId), serialized)
  }

  async remove(profileId: string): Promise<void> {
    this.storage?.removeItem(metadataKey(profileId))
  }
}

export class MemoryBaiduNetdiskOAuthMetadataStore implements BaiduNetdiskOAuthMetadataStore {
  readonly #values = new Map<string, BaiduNetdiskOAuthPublicMetadata>()

  async read(profileId: string): Promise<BaiduNetdiskOAuthPublicMetadata | null> {
    const value = this.#values.get(metadataKey(profileId))
    return value ? parseBaiduNetdiskOAuthPublicMetadata(value) : null
  }

  async write(metadata: BaiduNetdiskOAuthPublicMetadata): Promise<void> {
    const parsed = parseBaiduNetdiskOAuthPublicMetadata(metadata)
    this.#values.set(metadataKey(parsed.profileId), parsed)
  }

  async remove(profileId: string): Promise<void> {
    this.#values.delete(metadataKey(profileId))
  }
}
