import type { StorageFieldID } from '../types'

export const GOOGLE_DRIVE_STORAGE_PROVIDER_ID = 'google-drive'
export const GOOGLE_DRIVE_STORAGE_ADAPTER_ID = 'open-pencil.storage.google-drive'
export const GOOGLE_DRIVE_STORAGE_PLUGIN_ID = 'open-pencil.google-drive-storage'
export const GOOGLE_DRIVE_CLIENT_ID_FIELD: StorageFieldID = 'client-id'

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * OAuth client IDs are public application identifiers. Production builds provide one at build
 * time; developers may override it in the non-secret provider preferences without rebuilding.
 */
export function resolveGoogleDriveClientId(
  preferences: Readonly<Record<StorageFieldID, string>>,
  buildTimeClientId: string | undefined = import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID
): string | null {
  return text(preferences[GOOGLE_DRIVE_CLIENT_ID_FIELD]) ?? text(buildTimeClientId)
}
