import { IDBFactory } from 'fake-indexeddb'

import { commandApplication } from '../command/helpers'
import { runtimeFixture, type RuntimeRecoveryEnvironment } from '../runtime/helpers'

/** Deterministic LockManager double; browser integration separately exercises native locks. */
export function recoveryEnvironment(): RuntimeRecoveryEnvironment {
  const held = new Set<string>()
  const locks = {
    async request<T>(
      name: string,
      options: LockOptions,
      callback: (lock: Lock | null) => Promise<T>
    ) {
      if (!options.ifAvailable || options.mode !== 'exclusive')
        throw new Error('Unexpected lock mode')
      if (held.has(name)) return await callback(null)
      held.add(name)
      try {
        return await callback({ name, mode: 'exclusive' } as Lock)
      } finally {
        held.delete(name)
      }
    }
  } as LockManager
  return { indexedDB: new IDBFactory(), locks, origin: 'https://generated.test' }
}

export const commandInput = {
  commandId: 'save-note',
  payload: { title: 'Immutable note' },
  idempotencyKeyTarget: 'attempt',
  recovery: 'browser' as const
}
export const recoveryInput = { commandId: 'save-note', idempotencyKeyTarget: 'attempt' }

export async function recoveryFixture(
  environment = recoveryEnvironment(),
  application = commandApplication(),
  timeout = 1000
) {
  const fixture = await runtimeFixture(false, application, timeout, environment)
  fixture.auth.transition('user-a')
  fixture.values.set('attempt', '')
  return fixture
}

export async function journalRows(factory: IDBFactory | undefined): Promise<unknown[]> {
  if (!factory) throw new Error('Test IndexedDB factory is required')
  return await new Promise((resolve, reject) => {
    const request = factory.open('openpencil:backend-command-journal:v1', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const tx = database.transaction('attempts', 'readonly')
      const rows = tx.objectStore('attempts').getAll()
      tx.oncomplete = () => {
        database.close()
        resolve(rows.result)
      }
      tx.onabort = () => {
        database.close()
        reject(tx.error)
      }
    }
  })
}

export async function replaceJournalRows(
  factory: IDBFactory | undefined,
  rows: object[]
): Promise<void> {
  if (!factory) throw new Error('Test IndexedDB factory is required')
  await new Promise<void>((resolve, reject) => {
    const request = factory.open('openpencil:backend-command-journal:v1', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('attempts', 'readwrite')
      const store = transaction.objectStore('attempts')
      store.clear()
      for (const row of rows) store.put(row)
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onabort = () => {
        database.close()
        reject(transaction.error)
      }
    }
  })
}
