export type {
  AdoptLocalCanvasAuthorityOptions,
  LocalCanvasConflictCopyInput,
  LocalCanvasConflictCopyRecord,
  LocalCanvasIndexInput,
  LocalCanvasMeta,
  LocalCanvasWriteInput,
  LocalSyncStatus,
  MigrateLegacyLocalCanvasAuthorityOptions,
  UpdateLocalCanvasMetaOptions
} from '@/app/storage/local-store/types'
export {
  localCanvasBinding,
  localCanvasKey,
  resolveLocalCanvasLocator,
  type LocalCanvasLocator
} from '@/app/storage/local-store/identity'
export type { LocalCanvasStore } from '@/app/storage/local-store/store'
export {
  getLocalCanvasStore,
  isLocalCanvasStoreDurable,
  isLocalCanvasStoreMemoryFallback,
  resetLocalCanvasStoreForTests
} from '@/app/storage/local-store/store'
export { createMemoryLocalCanvasStore } from '@/app/storage/local-store/memory'
