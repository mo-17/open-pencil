import type {
  StorageAdapter,
  StorageDocumentMetadata,
  StoragePutDocumentOptions,
  StoragePutDocumentResult
} from '../types'

export function createStorageDocumentWriter<RemoteDocument>(
  prepare: (
    id: string,
    bytes: Uint8Array,
    metadata: StorageDocumentMetadata,
    transfer: StoragePutDocumentOptions
  ) => Promise<
    Readonly<{ current: RemoteDocument | null; conflictResult: StoragePutDocumentResult | null }>
  >,
  write: (
    current: RemoteDocument | null,
    id: string,
    bytes: Uint8Array,
    metadata: StorageDocumentMetadata,
    transfer: StoragePutDocumentOptions
  ) => Promise<StoragePutDocumentResult>
): StorageAdapter['putDocument'] {
  return async (id, bytes, metadata, transfer = {}) => {
    const prepared = await prepare(id, bytes, metadata, transfer)
    if (prepared.conflictResult) return prepared.conflictResult
    return write(prepared.current, id, bytes, metadata, transfer)
  }
}
