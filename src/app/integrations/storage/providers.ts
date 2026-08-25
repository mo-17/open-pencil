import { ALIYUN_DRIVE_STORAGE_PROVIDER_ID } from './aliyun-drive/config'
import { getAliyunDriveRuntimeServices } from './aliyun-drive/runtime'
import { BAIDU_NETDISK_STORAGE_PROVIDER_ID } from './baidu-netdisk/config'
import { getBaiduNetdiskRuntimeServices } from './baidu-netdisk/runtime'
import {
  GOOGLE_DRIVE_CLIENT_ID_FIELD,
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID
} from './google-drive/config'
import { getGoogleDriveRuntimeServices } from './google-drive/runtime'
import { ONEDRIVE_STORAGE_PROVIDER_ID } from './onedrive/config'
import { getOneDriveRuntimeServices } from './onedrive/runtime'
import { defineStorageProvider, StorageProviderRegistry } from './registry'
import { createS3StorageAdapter } from './s3/adapter'
import { S3_COMPATIBLE_STORAGE_PROVIDER_ID } from './s3/authority'

export const S3_STORAGE_PROVIDER = defineStorageProvider({
  id: S3_COMPATIBLE_STORAGE_PROVIDER_ID,
  label: 'S3 compatible',
  description: 'AWS S3, Backblaze B2, Cloudflare R2, MinIO, and compatible storage',
  authorityMode: 'configuration',
  deletionMode: 'permanent',
  supportsLocalFigImport: false,
  preferenceFields: [
    { id: 'endpoint', label: 'Endpoint', kind: 'url', required: true },
    { id: 'bucket', label: 'Bucket', kind: 'text', required: true },
    { id: 'region', label: 'Region', kind: 'text' }
  ],
  credentialFields: [
    { id: 'access-key-id', label: 'Access key ID', required: true },
    { id: 'secret-access-key', label: 'Secret access key', required: true }
  ],
  createAdapter: createS3StorageAdapter
})

export const GOOGLE_DRIVE_STORAGE_PROVIDER = defineStorageProvider({
  id: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
  label: 'Google Drive',
  description: 'Private OpenPencil documents in your Google Drive account',
  authorityMode: 'account-grant',
  deletionMode: 'trash',
  supportsLocalFigImport: true,
  preferenceFields: [
    {
      id: GOOGLE_DRIVE_CLIENT_ID_FIELD,
      label: 'OAuth client ID',
      kind: 'text',
      placeholder: '000000000000-example.apps.googleusercontent.com'
    }
  ],
  credentialFields: [],
  createAdapter(runtime) {
    return getGoogleDriveRuntimeServices(runtime).adapter
  }
})

export const ONEDRIVE_STORAGE_PROVIDER = defineStorageProvider({
  id: ONEDRIVE_STORAGE_PROVIDER_ID,
  label: 'OneDrive',
  description: 'OpenPencil documents in your Microsoft OneDrive account',
  authorityMode: 'account-grant',
  deletionMode: 'trash',
  supportsLocalFigImport: true,
  preferenceFields: [],
  credentialFields: [],
  createAdapter(runtime) {
    return getOneDriveRuntimeServices(runtime).adapter
  }
})

export const ALIYUN_DRIVE_STORAGE_PROVIDER = defineStorageProvider({
  id: ALIYUN_DRIVE_STORAGE_PROVIDER_ID,
  label: 'Aliyun Drive',
  description: 'OpenPencil documents in your Aliyun Drive application folder',
  authorityMode: 'account-grant',
  deletionMode: 'trash',
  supportsLocalFigImport: true,
  preferenceFields: [],
  credentialFields: [],
  createAdapter(runtime) {
    return getAliyunDriveRuntimeServices(runtime).adapter
  }
})

export const BAIDU_NETDISK_STORAGE_PROVIDER = defineStorageProvider({
  id: BAIDU_NETDISK_STORAGE_PROVIDER_ID,
  label: 'Baidu Netdisk',
  description: 'OpenPencil documents in your Baidu Netdisk app directory',
  authorityMode: 'account-grant',
  deletionMode: 'trash',
  supportsLocalFigImport: true,
  preferenceFields: [],
  credentialFields: [],
  createAdapter(runtime) {
    return getBaiduNetdiskRuntimeServices(runtime).adapter
  }
})

export const storageProviderRegistry = new StorageProviderRegistry([
  GOOGLE_DRIVE_STORAGE_PROVIDER,
  ONEDRIVE_STORAGE_PROVIDER,
  ALIYUN_DRIVE_STORAGE_PROVIDER,
  BAIDU_NETDISK_STORAGE_PROVIDER,
  S3_STORAGE_PROVIDER
])
