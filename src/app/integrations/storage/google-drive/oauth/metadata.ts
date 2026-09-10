import {
  LocalOAuthMetadataStore,
  MemoryOAuthMetadataStore,
  type OAuthMetadataStoreConfig
} from '@/app/integrations/storage/oauth-shared/metadata-store'
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

const metadataStoreConfig = {
  key: metadataKey,
  maxBytes: MAX_GOOGLE_DRIVE_OAUTH_METADATA_BYTES,
  parse: parseGoogleDriveOAuthPublicMetadata,
  invalid: invalidMetadata,
  unavailableMessage: 'Google Drive account metadata storage is unavailable'
} satisfies OAuthMetadataStoreConfig<GoogleDriveOAuthPublicMetadata>

export class LocalGoogleDriveOAuthMetadataStore
  extends LocalOAuthMetadataStore<GoogleDriveOAuthPublicMetadata>
  implements GoogleDriveOAuthMetadataStore
{
  constructor(storage: Storage | null = browserCredentialStorage()) {
    super(storage, metadataStoreConfig)
  }
}

export class MemoryGoogleDriveOAuthMetadataStore
  extends MemoryOAuthMetadataStore<GoogleDriveOAuthPublicMetadata>
  implements GoogleDriveOAuthMetadataStore
{
  constructor() {
    super(metadataStoreConfig)
  }
}
