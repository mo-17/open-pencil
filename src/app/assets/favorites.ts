export const ASSET_FAVORITES_STORAGE_KEY = 'open-pencil:asset-favorites:v1'
const MAX_FAVORITES = 1000
const MAX_KEY_LENGTH = 4096
const MAX_STORED_LENGTH = 1024 * 1024

export interface AssetFavoritesStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function parseFavorites(raw: string | null): Set<string> {
  if (raw === null) return new Set()
  if (raw.length > MAX_STORED_LENGTH) throw new Error('Asset favorites exceed the storage limit')
  const value: unknown = JSON.parse(raw)
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('keys' in value) ||
    !Array.isArray(value.keys) ||
    value.keys.length > MAX_FAVORITES ||
    value.keys.some((key) => typeof key !== 'string' || !key || key.length > MAX_KEY_LENGTH)
  ) {
    throw new Error('Invalid asset favorites')
  }
  return new Set(value.keys)
}

/** User preference only: these keys never grant module access or load library assets. */
export function createAssetFavorites(storage: AssetFavoritesStorage) {
  let keys = new Set<string>()
  let persistenceFailed = false
  let canWrite = true
  function load() {
    try {
      keys = parseFavorites(storage.getItem(ASSET_FAVORITES_STORAGE_KEY))
      persistenceFailed = false
      canWrite = true
    } catch {
      // Retain session choices and preserve unreadable / newer settings unchanged.
      persistenceFailed = true
      canWrite = false
    }
    return snapshot()
  }
  function snapshot() {
    return { keys: new Set(keys), persistenceFailed }
  }
  function toggle(key: string) {
    if (!key || key.length > MAX_KEY_LENGTH || (!keys.has(key) && keys.size >= MAX_FAVORITES)) {
      persistenceFailed = true
      return snapshot()
    }
    if (keys.has(key)) keys.delete(key)
    else keys.add(key)
    if (canWrite) {
      try {
        const serialized = JSON.stringify({ version: 1, keys: [...keys] })
        if (serialized.length > MAX_STORED_LENGTH)
          throw new Error('Asset favorites exceed the storage limit')
        storage.setItem(ASSET_FAVORITES_STORAGE_KEY, serialized)
        persistenceFailed = false
      } catch {
        persistenceFailed = true
      }
    }
    return snapshot()
  }
  return { load, snapshot, toggle }
}
