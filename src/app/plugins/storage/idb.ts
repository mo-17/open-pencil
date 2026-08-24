import { openIdb, reqToPromise, txDone } from '@/app/storage/idb'

import type { AppPluginStateStorage } from './types'

export const APP_PLUGIN_DATABASE_NAME = 'open-pencil-plugins'
const DATABASE_VERSION = 2
const STATE_STORE = 'installedPluginState'
const META_STORE = 'metadata'
const REVISION_KEY = 'revision'

function storedRevision(value: unknown): number {
  if (value === undefined) return 0
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError('Plugin state storage revision is invalid')
  }
  return value as number
}

function nextRevision(value: unknown): number {
  const current = storedRevision(value)
  if (current === Number.MAX_SAFE_INTEGER) {
    throw new Error('Plugin state storage revision is exhausted')
  }
  return current + 1
}

export function createIdbAppPluginStateStorage(
  databaseName = APP_PLUGIN_DATABASE_NAME,
  idbFactory: IDBFactory | undefined = globalThis.indexedDB
): AppPluginStateStorage {
  let databasePromise: Promise<IDBDatabase> | null = null

  function database(): Promise<IDBDatabase> {
    databasePromise ??= openIdb(
      databaseName,
      DATABASE_VERSION,
      (db) => {
        if (!db.objectStoreNames.contains(STATE_STORE)) {
          db.createObjectStore(STATE_STORE, { keyPath: 'pluginId' })
        }
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
      },
      idbFactory
    )
    return databasePromise
  }

  async function mutateState(operation: (store: IDBObjectStore) => void): Promise<void> {
    const db = await database()
    const transaction = db.transaction([STATE_STORE, META_STORE], 'readwrite')
    const metadata = transaction.objectStore(META_STORE)
    const revision = await reqToPromise(metadata.get(REVISION_KEY))
    let next: number
    try {
      next = nextRevision(revision)
    } catch (cause) {
      transaction.abort()
      throw cause
    }
    operation(transaction.objectStore(STATE_STORE))
    metadata.put(next, REVISION_KEY)
    await txDone(transaction)
  }

  return {
    async revision() {
      const db = await database()
      const transaction = db.transaction(META_STORE, 'readonly')
      const value = await reqToPromise(transaction.objectStore(META_STORE).get(REVISION_KEY))
      await txDone(transaction)
      return storedRevision(value)
    },
    async list() {
      const db = await database()
      const transaction = db.transaction(STATE_STORE, 'readonly')
      const values = await reqToPromise(transaction.objectStore(STATE_STORE).getAll())
      await txDone(transaction)
      return values
    },
    async put(record) {
      await mutateState((store) => store.put(record))
    },
    async delete(pluginId) {
      await mutateState((store) => store.delete(pluginId))
    }
  }
}
