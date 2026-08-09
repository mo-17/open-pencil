import {
  GOOGLE_DRIVE_CLIENT_ID_FIELD,
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID
} from './google-drive/config'
import { getGoogleDriveRuntimeServices } from './google-drive/runtime'
import { defineStorageProvider, StorageProviderRegistry } from './registry'
import { createS3StorageAdapter } from './s3/adapter'
import { S3_COMPATIBLE_STORAGE_PROVIDER_ID } from './s3/authority'

export const S3_STORAGE_PROVIDER = defineStorageProvider({
  id: S3_COMPATIBLE_STORAGE_PROVIDER_ID,
  label: 'S3 compatible',
  description: 'AWS S3, Backblaze B2, Cloudflare R2, MinIO, and compatible storage',
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
  preferenceFields: [
    {
      id: GOOGLE_DRIVE_CLIENT_ID_FIELD,
      label: 'OAuth client ID',
      kind: 'text',
      required: true,
      placeholder: '000000000000-example.apps.googleusercontent.com'
    }
  ],
  credentialFields: [],
  createAdapter(runtime) {
    return getGoogleDriveRuntimeServices(runtime).adapter
  }
})

export const storageProviderRegistry = new StorageProviderRegistry([
  GOOGLE_DRIVE_STORAGE_PROVIDER,
  S3_STORAGE_PROVIDER
])
