import type { StorageFieldID } from '../types'

export const ALIYUN_DRIVE_STORAGE_PROVIDER_ID = 'aliyun-drive'
export const ALIYUN_DRIVE_STORAGE_ADAPTER_ID = 'open-pencil.storage.aliyun-drive'
export const ALIYUN_DRIVE_STORAGE_PLUGIN_ID = 'open-pencil.aliyun-drive-storage'

export const ALIYUN_DRIVE_OPENAPI_ORIGIN = 'https://openapi.alipan.com'
export const ALIYUN_DRIVE_OPENAPI_BASE = ALIYUN_DRIVE_OPENAPI_ORIGIN
export const ALIYUN_DRIVE_APP_DOCUMENTS_FOLDER = 'documents'
export const ALIYUN_DRIVE_FIG_MIME_TYPE = 'application/octet-stream'

/** A conservative desktop chunk size inside Aliyun Drive's documented part bounds. */
export const ALIYUN_DRIVE_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024
export const ALIYUN_DRIVE_MIN_UPLOAD_PART_BYTES = 100 * 1024
export const ALIYUN_DRIVE_MAX_UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024
export const ALIYUN_DRIVE_MAX_UPLOAD_PARTS = 10_000

export const ALIYUN_DRIVE_OAUTH_SCOPES = [
  'user:base',
  'file:all:read',
  'file:all:write'
] as const
export const ALIYUN_DRIVE_OAUTH_SCOPE = ALIYUN_DRIVE_OAUTH_SCOPES.join(',')
export const ALIYUN_DRIVE_OAUTH_STYLE = 'folder'
export const ALIYUN_DRIVE_OAUTH_DRIVE = 'backup'
export const ALIYUN_DRIVE_OAUTH_AUTHORIZE_URL = `${ALIYUN_DRIVE_OPENAPI_ORIGIN}/oauth/authorize`
export const ALIYUN_DRIVE_OAUTH_TOKEN_URL = `${ALIYUN_DRIVE_OPENAPI_ORIGIN}/oauth/access_token`
export const ALIYUN_DRIVE_OAUTH_USERINFO_URL = `${ALIYUN_DRIVE_OPENAPI_ORIGIN}/oauth/users/info`
export const ALIYUN_DRIVE_OAUTH_REDIRECT_PATH = '/oauth/aliyun-drive/callback'

const ALIYUN_DRIVE_CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{8,256}$/

export type AliyunDrivePublisherOAuthBuildConfig = Readonly<{
  clientId: string
}>

export function isAliyunDriveClientId(value: unknown): value is string {
  return typeof value === 'string' && ALIYUN_DRIVE_CLIENT_ID_PATTERN.test(value)
}

export function parseAliyunDriveLoopbackRedirectURI(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() !== value || value.length > 512) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const port = Number(url.port)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !Number.isSafeInteger(port) ||
    port < 1_024 ||
    port > 65_535 ||
    url.pathname === '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    return null
  }
  return url.toString()
}

/**
 * The official desktop OAuth application identity is publisher-controlled build input.
 * Profile preferences are deliberately ignored and cannot replace that identity.
 */
export function resolveAliyunDriveClientId(
  _preferences: Readonly<Record<StorageFieldID, string>> = {},
  buildTimeClientId: string | undefined = (
    import.meta.env as Readonly<Record<string, string | undefined>>
  ).VITE_ALIYUN_DRIVE_CLIENT_ID
): string | null {
  const value = buildTimeClientId?.trim()
  return value && isAliyunDriveClientId(value) ? value : null
}

/** Publisher client identity is visible; Broker origin and callback remain Rust-only build input. */
export function resolveAliyunDrivePublisherOAuthConfig(
  _preferences: Readonly<Record<StorageFieldID, string>> = {},
  build: Readonly<{
    clientId?: string
  }> = {
    clientId: (import.meta.env as Readonly<Record<string, string | undefined>>)
      .VITE_ALIYUN_DRIVE_CLIENT_ID
  }
): AliyunDrivePublisherOAuthBuildConfig | null {
  const clientId = build.clientId?.trim()
  return clientId && isAliyunDriveClientId(clientId)
    ? Object.freeze({ clientId })
    : null
}
