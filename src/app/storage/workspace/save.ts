import {
  activeStorageProviderID,
  isStorageConfigured,
  readActiveStorageProfileID
} from '@/app/integrations/storage'
import type { StorageDocumentBinding, StorageProviderID } from '@/app/integrations/storage/types'
import { rememberRecentStorageDocument } from '@/app/recent-files'
import { openSettingsDialog } from '@/app/settings/dialog'

type StorageSaveTarget = {
  state: { documentName: string }
  saveFigFileToStorage: (providerId: StorageProviderID) => Promise<boolean>
  getStorageBinding: () => StorageDocumentBinding | null
}

/** Save the open document as a new stored document, or ask for storage settings first. */
export async function saveDocumentToStorage(store: StorageSaveTarget): Promise<boolean> {
  const providerId = activeStorageProviderID.value
  const profileId = readActiveStorageProfileID(providerId)
  const configured = await isStorageConfigured(providerId)
  if (
    activeStorageProviderID.value !== providerId ||
    readActiveStorageProfileID(providerId) !== profileId
  )
    return false
  if (!configured) {
    openSettingsDialog('storage')
    return false
  }
  const saved = await store.saveFigFileToStorage(providerId)
  const binding = store.getStorageBinding()
  if (saved && binding) {
    rememberRecentStorageDocument(providerId, binding.documentId, store.state.documentName)
  }
  return saved
}
