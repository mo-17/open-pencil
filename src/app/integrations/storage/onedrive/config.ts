import type { StorageFieldID } from '../types'

export const ONEDRIVE_STORAGE_PROVIDER_ID = 'onedrive'
export const ONEDRIVE_STORAGE_ADAPTER_ID = 'open-pencil.storage.onedrive'
export const ONEDRIVE_STORAGE_PLUGIN_ID = 'open-pencil.onedrive-storage'

export const ONEDRIVE_GRAPH_ORIGIN = 'https://graph.microsoft.com'
export const ONEDRIVE_GRAPH_BASE = `${ONEDRIVE_GRAPH_ORIGIN}/v1.0`
export const ONEDRIVE_APP_DOCUMENTS_FOLDER = 'documents'
export const ONEDRIVE_FIG_MIME_TYPE = 'application/octet-stream'

/** 5 MiB is both within Graph's recommended range and exactly 16 * 320 KiB. */
export const ONEDRIVE_UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024
export const ONEDRIVE_UPLOAD_GRANULARITY_BYTES = 320 * 1024
export const ONEDRIVE_MAX_UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024

const ONEDRIVE_CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The official desktop OAuth application identity is publisher-controlled build input.
 * Per-profile preferences are deliberately ignored and cannot replace that identity.
 */
export function resolveOneDriveClientId(
  _preferences: Readonly<Record<StorageFieldID, string>> = {},
  buildTimeClientId: string | undefined = (
    import.meta.env as Readonly<Record<string, string | undefined>>
  ).VITE_ONEDRIVE_CLIENT_ID
): string | null {
  const value = buildTimeClientId?.trim()
  return value && ONEDRIVE_CLIENT_ID_PATTERN.test(value) ? value.toLocaleLowerCase() : null
}
