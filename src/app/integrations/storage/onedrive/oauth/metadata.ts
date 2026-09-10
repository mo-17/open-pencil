import {
  LocalOAuthMetadataStore,
  MemoryOAuthMetadataStore,
  type OAuthMetadataStoreConfig
} from '@/app/integrations/storage/oauth-shared/metadata-store'
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

const metadataStoreConfig = {
  key: metadataKey,
  maxBytes: MAX_ONEDRIVE_OAUTH_METADATA_BYTES,
  parse: parseOneDriveOAuthPublicMetadata,
  invalid: invalidMetadata,
  unavailableMessage: 'OneDrive account metadata storage is unavailable'
} satisfies OAuthMetadataStoreConfig<OneDriveOAuthPublicMetadata>

export class LocalOneDriveOAuthMetadataStore
  extends LocalOAuthMetadataStore<OneDriveOAuthPublicMetadata>
  implements OneDriveOAuthMetadataStore
{
  constructor(storage: Storage | null = browserCredentialStorage()) {
    super(storage, metadataStoreConfig)
  }
}

export class MemoryOneDriveOAuthMetadataStore
  extends MemoryOAuthMetadataStore<OneDriveOAuthPublicMetadata>
  implements OneDriveOAuthMetadataStore
{
  constructor() {
    super(metadataStoreConfig)
  }
}
