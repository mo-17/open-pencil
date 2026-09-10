import {
  LocalOAuthMetadataStore,
  MemoryOAuthMetadataStore,
  type OAuthMetadataStoreConfig
} from '@/app/integrations/storage/oauth-shared/metadata-store'
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

function metadataKey(profileId: string): string {
  return `${STORAGE_PREFIX}${requireStorageProfileID(profileId)}`
}

export interface AliyunDriveOAuthMetadataStore {
  read(profileId: string): Promise<AliyunDriveOAuthPublicMetadata | null>
  write(metadata: AliyunDriveOAuthPublicMetadata): Promise<void>
  remove(profileId: string): Promise<void>
}

const metadataStoreConfig = {
  key: metadataKey,
  maxBytes: MAX_ALIYUN_DRIVE_OAUTH_METADATA_BYTES,
  parse: parseAliyunDriveOAuthPublicMetadata,
  invalid: invalidMetadata,
  unavailableMessage: 'Aliyun Drive account metadata storage is unavailable'
} satisfies OAuthMetadataStoreConfig<AliyunDriveOAuthPublicMetadata>

/** Profile-scoped, non-secret account binding stored outside the credential vault. */
export class LocalAliyunDriveOAuthMetadataStore
  extends LocalOAuthMetadataStore<AliyunDriveOAuthPublicMetadata>
  implements AliyunDriveOAuthMetadataStore
{
  constructor(storage: Storage | null = browserCredentialStorage()) {
    super(storage, metadataStoreConfig)
  }
}

export class MemoryAliyunDriveOAuthMetadataStore
  extends MemoryOAuthMetadataStore<AliyunDriveOAuthPublicMetadata>
  implements AliyunDriveOAuthMetadataStore
{
  constructor() {
    super(metadataStoreConfig)
  }
}

export const aliyunDriveOAuthMetadataStore = new LocalAliyunDriveOAuthMetadataStore()
