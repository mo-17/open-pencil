/** Browser-owned request journal. No credentials or server results enter this schema. */
export const COMMAND_JOURNAL_SOURCE = String.raw`
import { BackendCommandError, validCommandKey } from './lowcode-backend-api'

export interface CommandJournalRecord {
  version: 1
  slot: string
  definition: string
  key: string
  payload: string
  createdAt: number
}
const DATABASE = 'openpencil:backend-command-journal:v1'
const STORE = 'attempts'
const STORAGE_TIMEOUT_MS = 5000
const RECORD_KEYS = ['version', 'slot', 'definition', 'key', 'payload', 'createdAt']

function checkedRecord(value: unknown, slot: string): CommandJournalRecord | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new BackendCommandError(503)
  const row = value as Partial<CommandJournalRecord>
  if (Object.keys(row).length !== RECORD_KEYS.length || Object.keys(row).some(key => !RECORD_KEYS.includes(key)) ||
    row.version !== 1 || row.slot !== slot || slot.length > 16384 ||
    typeof row.definition !== 'string' || row.definition.length > 128 || !row.definition ||
    !validCommandKey(row.key) || typeof row.payload !== 'string' || row.payload.length > 65536 ||
    typeof row.createdAt !== 'number' || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0) throw new BackendCommandError(503)
  return row as CommandJournalRecord
}

function openJournal(signal: AbortSignal): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (signal.aborted || typeof indexedDB === 'undefined') { reject(new BackendCommandError(503)); return }
    let request: IDBOpenDBRequest
    let finished = false
    const fail = () => {
      if (finished) return
      finished = true; clearTimeout(timer); signal.removeEventListener('abort', fail)
      reject(new BackendCommandError(503))
    }
    const timer = setTimeout(fail, STORAGE_TIMEOUT_MS)
    signal.addEventListener('abort', fail, { once: true })
    try { request = indexedDB.open(DATABASE, 1) } catch { fail(); return }
    request.onupgradeneeded = () => {
      if (finished) { request.transaction?.abort(); return }
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'slot' })
    }
    request.onerror = fail
    request.onblocked = fail
    request.onsuccess = () => {
      const database = request.result
      if (finished || signal.aborted) { database.close(); fail(); return }
      finished = true; clearTimeout(timer); signal.removeEventListener('abort', fail)
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

async function journalTransaction<T>(slot: string, mode: IDBTransactionMode, signal: AbortSignal,
  operation: (store: IDBObjectStore, row: CommandJournalRecord | undefined, result: (value: T) => void) => void): Promise<T> {
  const database = await openJournal(signal)
  try {
    return await new Promise<T>((resolve, reject) => {
      if (signal.aborted) { reject(new BackendCommandError(503)); return }
      let transaction: IDBTransaction
      try { transaction = database.transaction(STORE, mode, { durability: 'strict' }) }
      catch { reject(new BackendCommandError(503)); return }
      let error: unknown
      let value: T
      let assigned = false
      let finished = false
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
      const fail = () => {
        if (finished) return
        finished = true; cleanup()
        reject(error instanceof BackendCommandError ? error : new BackendCommandError(503))
      }
      const abort = () => {
        if (finished) return
        error ??= new BackendCommandError(503)
        try { transaction.abort() } catch { /* The result remains uncertain; never dispatch. */ }
        fail()
      }
      const timer = setTimeout(abort, STORAGE_TIMEOUT_MS)
      signal.addEventListener('abort', abort, { once: true })
      transaction.onabort = fail
      transaction.onerror = () => { error ??= new BackendCommandError(503) }
      // A request's success is insufficient: callers may dispatch only after transaction complete.
      transaction.oncomplete = () => {
        if (finished) return
        finished = true
        cleanup()
        if (signal.aborted || !assigned) reject(new BackendCommandError(503))
        else resolve(value)
      }
      const store = transaction.objectStore(STORE)
      // A mismatched existing schema could commit under a different key and hide the attempt.
      if (store.keyPath !== 'slot' || store.autoIncrement) { abort(); return }
      const request = store.get(slot)
      request.onsuccess = () => {
        if (finished) return
        try {
          if (signal.aborted) { abort(); return }
          operation(store, checkedRecord(request.result, slot), next => { value = next; assigned = true })
        } catch (failure) { error = failure; abort() }
      }
    })
  } finally { database.close() }
}

export function readCommandJournal(slot: string, signal: AbortSignal): Promise<CommandJournalRecord | undefined> {
  return journalTransaction(slot, 'readonly', signal, (_store, row, result) => result(row))
}

export function createCommandJournal(record: CommandJournalRecord, signal: AbortSignal): Promise<void> {
  checkedRecord(record, record.slot)
  return journalTransaction(record.slot, 'readwrite', signal, (store, row, result) => {
    if (row) throw new BackendCommandError(409)
    const count = store.count()
    count.onsuccess = () => {
      if (signal.aborted || count.result >= 256) { count.transaction?.abort(); return }
      store.add(record)
      result(undefined)
    }
  })
}

export function acknowledgeCommandJournal(slot: string, key: string, definition: string, signal: AbortSignal): Promise<void> {
  return journalTransaction(slot, 'readwrite', signal, (store, row, result) => {
    if (!row || row.key !== key || row.definition !== definition) throw new BackendCommandError(409)
    store.delete(slot)
    result(undefined)
  })
}

export async function withCommandJournalLock<T>(slot: string, operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new BackendCommandError(503)
  try {
    return await navigator.locks.request('openpencil:command:' + slot, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) throw new BackendCommandError(409)
      return await operation()
    })
  } catch (error) { throw error instanceof BackendCommandError ? error : new BackendCommandError(503) }
}
`
