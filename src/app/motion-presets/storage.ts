import { readLocalStorageText, removeLocalStorageText, writeLocalStorageText } from '@/app/cache'

export const MOTION_PRESET_LIBRARY_STORAGE_KEY = 'open-pencil:motion-preset-library:v1'

export interface MotionPresetKeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export interface MotionPresetStorageReadResult {
  value: string | null
  error: Error | null
}

export function browserMotionPresetStorage(): MotionPresetKeyValueStorage | null {
  return {
    getItem: readLocalStorageText,
    setItem: writeLocalStorageText,
    removeItem: removeLocalStorageText
  }
}

export function readMotionPresetStorage(
  storage: MotionPresetKeyValueStorage | null,
  key = MOTION_PRESET_LIBRARY_STORAGE_KEY
): MotionPresetStorageReadResult {
  if (!storage) return { value: null, error: null }
  try {
    return { value: storage.getItem(key), error: null }
  } catch (cause) {
    return {
      value: null,
      error: new Error('Unable to read the local motion preset library.', { cause })
    }
  }
}

export function writeMotionPresetStorage(
  storage: MotionPresetKeyValueStorage | null,
  value: string,
  key = MOTION_PRESET_LIBRARY_STORAGE_KEY
): Error | null {
  if (!storage) return null
  try {
    storage.setItem(key, value)
    return null
  } catch (cause) {
    return new Error('Unable to save the local motion preset library.', { cause })
  }
}

export function removeMotionPresetStorage(
  storage: MotionPresetKeyValueStorage | null,
  key = MOTION_PRESET_LIBRARY_STORAGE_KEY
): Error | null {
  if (!storage?.removeItem) return null
  try {
    storage.removeItem(key)
    return null
  } catch (cause) {
    return new Error('Unable to reset the local motion preset library.', { cause })
  }
}
