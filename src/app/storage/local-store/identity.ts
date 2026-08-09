import {
  DEFAULT_STORAGE_PROFILE_ID,
  resolveStorageDocumentBinding,
  storageDocumentKey,
  type StorageDocumentAuthority,
  type StorageDocumentBinding,
  type StorageDocumentBindingInput
} from '@/app/integrations/storage/types'
import type {
  LocalCanvasIndexInput,
  LocalCanvasMeta,
  LocalCanvasWriteInput
} from '@/app/storage/local-store/types'

/** Every v1 local row belonged to the only provider/profile available at the time. */
export const LEGACY_STORAGE_PROVIDER_ID = 's3-compatible'

export type LocalCanvasLocator = StorageDocumentBindingInput | string

export function legacyLocalCanvasBinding(documentId: string): StorageDocumentBinding {
  return resolveStorageDocumentBinding({
    providerId: LEGACY_STORAGE_PROVIDER_ID,
    profileId: DEFAULT_STORAGE_PROFILE_ID,
    documentId
  })
}

export function localCanvasBinding(
  value: LocalCanvasMeta | LocalCanvasWriteInput | LocalCanvasIndexInput
): StorageDocumentBinding {
  return resolveStorageDocumentBinding({
    providerId: value.providerId,
    profileId: value.profileId,
    documentId: value.id,
    ...(value.authority ? { authority: value.authority } : {})
  })
}

/** String locators are retained only for v1 S3/default-profile callers during migration. */
export function resolveLocalCanvasLocator(locator: LocalCanvasLocator): StorageDocumentBinding {
  return typeof locator === 'string'
    ? legacyLocalCanvasBinding(locator)
    : resolveStorageDocumentBinding(locator)
}

export function localCanvasKey(locator: LocalCanvasLocator): string {
  return storageDocumentKey(resolveLocalCanvasLocator(locator))
}

export function legacyAuthorityMigrationKeys(
  locator: LocalCanvasLocator,
  nextAuthority: StorageDocumentAuthority
): { sourceKey: string; targetKey: string } {
  const sourceBinding = resolveLocalCanvasLocator(locator)
  if (sourceBinding.authority) {
    throw new Error('Legacy storage migration requires an authority-less source')
  }
  return {
    sourceKey: localCanvasKey(sourceBinding),
    targetKey: localCanvasKey({ ...sourceBinding, authority: nextAuthority })
  }
}
