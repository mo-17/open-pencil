export const BAIDU_NETDISK_STORAGE_PROVIDER_ID = 'baidu-netdisk'
export const BAIDU_NETDISK_STORAGE_ADAPTER_ID = 'open-pencil.storage.baidu-netdisk'
export const BAIDU_NETDISK_STORAGE_PLUGIN_ID = 'open-pencil.baidu-netdisk-storage'

export const BAIDU_NETDISK_AUTH_ORIGIN = 'https://openapi.baidu.com'
export const BAIDU_NETDISK_API_ORIGIN = 'https://pan.baidu.com'
export const BAIDU_NETDISK_PCS_ORIGIN = 'https://d.pcs.baidu.com'
export const BAIDU_NETDISK_APP_ROOT = '/apps/OpenPencil'
export const BAIDU_NETDISK_LOCATE_UPLOAD_APP_ID = '250528'
export const BAIDU_NETDISK_FIG_MIME_TYPE = 'application/octet-stream'

const BAIDU_NETDISK_APP_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

export type BaiduNetdiskPublisherOAuthConfig = Readonly<{
  appKey: string
}>

export function isBaiduNetdiskAppKey(value: unknown): value is string {
  return typeof value === 'string' && BAIDU_NETDISK_APP_KEY_PATTERN.test(value)
}

/**
 * The publisher AppKey is a build input. Profile preferences are deliberately ignored. The Broker
 * origin is a separate Rust-only compile-time constant and never becomes renderer configuration.
 */
export function resolveBaiduNetdiskPublisherOAuthConfig(
  _preferences: Readonly<Record<string, string>> = {},
  buildTimeAppKey: string | undefined = (
    import.meta.env as Readonly<Record<string, string | undefined>>
  ).VITE_BAIDU_NETDISK_APP_KEY
): BaiduNetdiskPublisherOAuthConfig | null {
  const appKey = buildTimeAppKey?.trim()
  return appKey && isBaiduNetdiskAppKey(appKey) ? Object.freeze({ appKey }) : null
}

/** The portable baseline accepted for ordinary users by the official upload API. */
export const BAIDU_NETDISK_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024
/** OpenPencil's product-wide Baidu document limit, enforced before hashing or network work. */
export const BAIDU_NETDISK_MAX_DOCUMENT_BYTES = 512 * 1024 * 1024
export const BAIDU_NETDISK_MAX_UPLOAD_PARTS =
  BAIDU_NETDISK_MAX_DOCUMENT_BYTES / BAIDU_NETDISK_UPLOAD_CHUNK_BYTES
export const BAIDU_NETDISK_LIST_PAGE_SIZE = 100
