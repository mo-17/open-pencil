/** Generated media URL policy mirrors the public video contract and rejects local hosts. */
export const VIDEO_URL_SOURCE = String.raw`
export function safeVideoURL(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || value === '') return null
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.href !== value || url.username || url.password || url.hash || url.port) return null
    if (!host.includes('.') || host.endsWith('.') || host.startsWith('[') || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return null
    if (['localhost', 'localdomain', 'home.arpa'].includes(host) || ['.localhost', '.local', '.localdomain', '.home.arpa'].some(suffix => host.endsWith(suffix))) return null
    return value
  } catch { return null }
}
`
