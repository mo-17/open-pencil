/** Native IndexedDB helpers for stores that need explicit factory injection. */

export function openIdb(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase, oldVersion: number, transaction: IDBTransaction) => void,
  idbFactory?: IDBFactory
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = idbFactory ?? (Reflect.get(globalThis, 'indexedDB') as IDBFactory | undefined)
    if (!factory) {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const req = factory.open(name, version)
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
