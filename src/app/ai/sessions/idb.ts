import type { AISessionStorageBackend } from '@/app/ai/sessions/types'
import { openIdb, reqToPromise, txDone } from '@/app/storage/idb'

export const AI_SESSION_DATABASE_NAME = 'open-pencil-ai-sessions'
const AI_SESSION_DATABASE_VERSION = 1
const ALIAS_STORE = 'documentAliases'
const SESSION_STORE = 'sessions'

export function createIdbAISessionBackend(
  databaseName = AI_SESSION_DATABASE_NAME
): AISessionStorageBackend {
  let databasePromise: Promise<IDBDatabase> | null = null

  function database(): Promise<IDBDatabase> {
    databasePromise ??= openIdb(databaseName, AI_SESSION_DATABASE_VERSION, (db) => {
      if (!db.objectStoreNames.contains(ALIAS_STORE)) {
        db.createObjectStore(ALIAS_STORE, { keyPath: 'aliasKey' })
      }
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        const sessions = db.createObjectStore(SESSION_STORE, { keyPath: 'sessionKey' })
        sessions.createIndex('documentScopeId', 'documentScopeId')
        sessions.createIndex('updatedAt', 'updatedAt')
      }
    })
    return databasePromise
  }

  return {
    async resolveAlias(candidate) {
      const db = await database()
      const tx = db.transaction(ALIAS_STORE, 'readwrite')
      const store = tx.objectStore(ALIAS_STORE)
      const existing = await reqToPromise(store.get(candidate.aliasKey))
      if (existing === undefined) store.put(candidate)
      await txDone(tx)
      return existing === undefined ? candidate : existing
    },
    async getAlias(aliasKey) {
      const db = await database()
      const tx = db.transaction(ALIAS_STORE, 'readonly')
      const value = await reqToPromise(tx.objectStore(ALIAS_STORE).get(aliasKey))
      await txDone(tx)
      return value ?? null
    },
    async putAlias(record) {
      const db = await database()
      const tx = db.transaction(ALIAS_STORE, 'readwrite')
      tx.objectStore(ALIAS_STORE).put(record)
      await txDone(tx)
    },
    async deleteAlias(aliasKey) {
      const db = await database()
      const tx = db.transaction(ALIAS_STORE, 'readwrite')
      tx.objectStore(ALIAS_STORE).delete(aliasKey)
      await txDone(tx)
    },
    async listAliases() {
      const db = await database()
      const tx = db.transaction(ALIAS_STORE, 'readonly')
      const values = await reqToPromise(tx.objectStore(ALIAS_STORE).getAll())
      await txDone(tx)
      return values
    },
    async getSession(sessionKey) {
      const db = await database()
      const tx = db.transaction(SESSION_STORE, 'readonly')
      const value = await reqToPromise(tx.objectStore(SESSION_STORE).get(sessionKey))
      await txDone(tx)
      return value ?? null
    },
    async putSession(record) {
      const db = await database()
      const tx = db.transaction(SESSION_STORE, 'readwrite')
      tx.objectStore(SESSION_STORE).put(record)
      await txDone(tx)
    },
    async deleteSession(sessionKey) {
      const db = await database()
      const tx = db.transaction(SESSION_STORE, 'readwrite')
      tx.objectStore(SESSION_STORE).delete(sessionKey)
      await txDone(tx)
    },
    async listSessions() {
      const db = await database()
      const tx = db.transaction(SESSION_STORE, 'readonly')
      const values = await reqToPromise(tx.objectStore(SESSION_STORE).getAll())
      await txDone(tx)
      return values
    },
    async deleteSessions(sessionKeys) {
      if (sessionKeys.length === 0) return
      const db = await database()
      const tx = db.transaction(SESSION_STORE, 'readwrite')
      const store = tx.objectStore(SESSION_STORE)
      for (const key of sessionKeys) store.delete(key)
      await txDone(tx)
    }
  }
}
