import { openIdb, reqToPromise, txDone } from '@/app/storage/idb-util'

import type { AppPluginStateStorage } from './types'

export const APP_PLUGIN_DATABASE_NAME = 'open-pencil-plugins'
const DATABASE_VERSION = 1
const STATE_STORE = 'installedPluginState'

export function createIdbAppPluginStateStorage(
  databaseName = APP_PLUGIN_DATABASE_NAME
): AppPluginStateStorage {
  let databasePromise: Promise<IDBDatabase> | null = null

  function database(): Promise<IDBDatabase> {
    databasePromise ??= openIdb(databaseName, DATABASE_VERSION, (db) => {
      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE, { keyPath: 'pluginId' })
      }
    })
    return databasePromise
  }

  return {
    async list() {
      const db = await database()
      const transaction = db.transaction(STATE_STORE, 'readonly')
      const values = await reqToPromise(transaction.objectStore(STATE_STORE).getAll())
      await txDone(transaction)
      return values
    },
    async put(record) {
      const db = await database()
      const transaction = db.transaction(STATE_STORE, 'readwrite')
      transaction.objectStore(STATE_STORE).put(record)
      await txDone(transaction)
    },
    async delete(pluginId) {
      const db = await database()
      const transaction = db.transaction(STATE_STORE, 'readwrite')
      transaction.objectStore(STATE_STORE).delete(pluginId)
      await txDone(transaction)
    }
  }
}
