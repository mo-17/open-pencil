import { openIdb, reqToPromise, runIdbReadonlyRequest, txDone } from '@/app/storage/idb'

import { MARKETPLACE_SOURCE_STORAGE_KEY } from './contract'

const MARKETPLACE_SOURCE_DATABASE_NAME = 'open-pencil-marketplace-source'
const MARKETPLACE_SOURCE_STORE_NAME = 'sourceState'

export interface MarketplaceSourceStorage {
  read(): Promise<string | null>
  write(value: string): Promise<void>
  compareAndSwap(expected: string | null, value: string): Promise<boolean>
}

export function createMemoryMarketplaceSourceStorage(
  initial: string | null = null
): MarketplaceSourceStorage & { value(): string | null } {
  let stored = initial
  return {
    async read() {
      return stored
    },
    async write(value) {
      stored = value
    },
    async compareAndSwap(expected, value) {
      if (stored !== expected) return false
      stored = value
      return true
    },
    value() {
      return stored
    }
  }
}

export function createBrowserMarketplaceSourceStorage(
  storageKey = MARKETPLACE_SOURCE_STORAGE_KEY,
  databaseName = MARKETPLACE_SOURCE_DATABASE_NAME,
  idbFactory: IDBFactory | undefined = globalThis.indexedDB
): MarketplaceSourceStorage {
  let databasePromise: Promise<IDBDatabase> | null = null

  function database(): Promise<IDBDatabase> {
    databasePromise ??= openIdb(
      databaseName,
      1,
      (db) => {
        if (!db.objectStoreNames.contains(MARKETPLACE_SOURCE_STORE_NAME)) {
          db.createObjectStore(MARKETPLACE_SOURCE_STORE_NAME)
        }
      },
      idbFactory
    )
    return databasePromise
  }

  return {
    async read() {
      const db = await database()
      const value = await runIdbReadonlyRequest(db, MARKETPLACE_SOURCE_STORE_NAME, (store) =>
        store.get(storageKey)
      )
      return typeof value === 'string' ? value : null
    },
    async write(value) {
      const db = await database()
      const transaction = db.transaction(MARKETPLACE_SOURCE_STORE_NAME, 'readwrite')
      transaction.objectStore(MARKETPLACE_SOURCE_STORE_NAME).put(value, storageKey)
      await txDone(transaction)
    },
    async compareAndSwap(expected, value) {
      const db = await database()
      const transaction = db.transaction(MARKETPLACE_SOURCE_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(MARKETPLACE_SOURCE_STORE_NAME)
      const currentValue = await reqToPromise(store.get(storageKey))
      const current = typeof currentValue === 'string' ? currentValue : null
      if (current !== expected) {
        await txDone(transaction)
        return false
      }
      store.put(value, storageKey)
      await txDone(transaction)
      return true
    }
  }
}
