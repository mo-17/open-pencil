const PREFIX = 'openpencil:managed-nestjs-preview:v1:'
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u

export type ManagedPreviewSessionStorage = Pick<Storage, 'getItem' | 'setItem'>

/** A locator only: the native companion independently verifies directory and application ownership. */
export function resolveManagedPreviewSession(
  applicationId: string,
  storage: ManagedPreviewSessionStorage = {
    getItem: readLocalStorageText,
    setItem: writeLocalStorageText
  },
  randomUUID: () => string = () => crypto.randomUUID()
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(applicationId)) {
    throw new Error('Managed preview requires a valid application ID.')
  }
  const key = PREFIX + applicationId
  let existing: string | null
  try {
    existing = storage.getItem(key)
  } catch {
    throw new Error('Managed preview session storage is unavailable. No database was created.')
  }
  if (existing !== null) {
    if (!UUID.test(existing)) {
      throw new Error('The saved managed preview session is invalid. Existing data was preserved.')
    }
    return existing
  }
  const sessionId = randomUUID()
  if (!UUID.test(sessionId)) throw new Error('Managed preview session creation failed.')
  try {
    storage.setItem(key, sessionId)
    if (storage.getItem(key) !== sessionId) throw new Error('Storage verification failed.')
  } catch {
    throw new Error('Managed preview session could not be saved. No database was created.')
  }
  return sessionId
}
import { readLocalStorageText, writeLocalStorageText } from '@/app/cache'
