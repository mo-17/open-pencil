import {
  LocalOAuthMetadataStore,
  MemoryOAuthMetadataStore,
  type OAuthMetadataStoreConfig
} from '@/app/integrations/storage/oauth-shared/metadata-store'
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

const metadataStoreConfig = {
  key: metadataKey,
  maxBytes: MAX_BAIDU_NETDISK_OAUTH_METADATA_BYTES,
  parse: parseBaiduNetdiskOAuthPublicMetadata,
  invalid: invalidMetadata,
  unavailableMessage: 'Baidu Netdisk account metadata storage is unavailable'
} satisfies OAuthMetadataStoreConfig<BaiduNetdiskOAuthPublicMetadata>

export class LocalBaiduNetdiskOAuthMetadataStore
  extends LocalOAuthMetadataStore<BaiduNetdiskOAuthPublicMetadata>
  implements BaiduNetdiskOAuthMetadataStore
{
  constructor(storage: Storage | null = browserCredentialStorage()) {
    super(storage, metadataStoreConfig)
  }
}

export class MemoryBaiduNetdiskOAuthMetadataStore
  extends MemoryOAuthMetadataStore<BaiduNetdiskOAuthPublicMetadata>
  implements BaiduNetdiskOAuthMetadataStore
{
  constructor() {
    super(metadataStoreConfig)
  }
}
