import {
  getLocalCanvasStore,
  isLocalCanvasStoreDurable,
  type LocalCanvasStore
} from '@/app/storage/local-store'
import {
  withStorageProfileMutationDrain,
  type StorageProfileMutationScope
} from '@/app/storage/mutation-drain'
import { getOutbox, isOutboxDurable, type Outbox } from '@/app/storage/sync/outbox'

export const STORAGE_DURABILITY_UNAVAILABLE_MESSAGE =
  'Durable browser storage is unavailable. Cloud documents were left unchanged; save or export a local .fig file instead.'

export class StorageDurabilityUnavailableError extends Error {
  readonly code = 'durability-unavailable' as const

  constructor(cause?: unknown) {
    super(STORAGE_DURABILITY_UNAVAILABLE_MESSAGE, cause === undefined ? undefined : { cause })
    this.name = 'StorageDurabilityUnavailableError'
  }
}

export type CloudStorageDurabilityDependencies = Readonly<{
  localStore: LocalCanvasStore
  outbox: Outbox
  localStoreDurable: boolean
  outboxDurable: boolean
}>

function defaultDependencies(): CloudStorageDurabilityDependencies {
  return {
    localStore: getLocalCanvasStore(),
    outbox: getOutbox(),
    localStoreDurable: isLocalCanvasStoreDurable(),
    outboxDurable: isOutboxDurable()
  }
}

/**
 * Cloud editing relies on both stores surviving a restart. Probe both IDB databases before any
 * cloud operation changes local or remote state; a production memory fallback is never sufficient.
 */
export async function assertCloudStorageDurability(
  dependencies: CloudStorageDurabilityDependencies = defaultDependencies()
): Promise<void> {
  if (!dependencies.localStoreDurable || !dependencies.outboxDurable) {
    throw new StorageDurabilityUnavailableError()
  }
  try {
    await Promise.all([dependencies.localStore.listMetas(true), dependencies.outbox.list()])
  } catch (cause) {
    throw new StorageDurabilityUnavailableError(cause)
  }
}

/** Hold the profile drain while proving restart durability before the caller can mutate lifecycle. */
export function withDurableStorageProfileMutationDrain<T>(
  scope: StorageProfileMutationScope,
  operation: () => Promise<T> | T,
  signal?: AbortSignal,
  dependencies?: CloudStorageDurabilityDependencies
): Promise<T> {
  return withStorageProfileMutationDrain(
    scope,
    async () => {
      await assertCloudStorageDurability(dependencies)
      return operation()
    },
    signal
  )
}
