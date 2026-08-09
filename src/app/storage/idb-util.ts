/** Shared IndexedDB plumbing for the local canvas store and the sync outbox. */

export function openIdb(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase, oldVersion: number, transaction: IDBTransaction) => void
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const req = indexedDB.open(name, version)
    req.onerror = () => reject(req.error ?? new Error(`Failed to open ${name}`))
    req.onblocked = () => reject(new Error(`Opening ${name} blocked by another tab's connection`))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (event) => {
      if (!req.transaction) throw new Error(`Opening ${name} has no upgrade transaction`)
      upgrade(req.result, event.oldVersion, req.transaction)
    }
  })
}

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export async function runIdbReadonlyRequest<T>(
  database: IDBDatabase,
  storeName: string,
  request: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const transaction = database.transaction(storeName, 'readonly')
  const value = await reqToPromise(request(transaction.objectStore(storeName)))
  await txDone(transaction)
  return value
}
