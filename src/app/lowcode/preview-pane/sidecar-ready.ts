export interface PreviewSidecarReady {
  url: string
  port: number
}

interface PreviewSidecarReadyCandidate {
  type?: unknown
  url?: unknown
  port?: unknown
}

const PREVIEW_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])
const PREVIEW_READY_KEYS = new Set<PropertyKey>(['type', 'url', 'port'])

/**
 * Fail closed before a compiler sidecar URL reaches either an iframe or a
 * host-owned desktop window. The dev server binds a loopback interface and
 * emits a root URL whose explicit port must match the structured event.
 */
export function parsePreviewSidecarReady(value: unknown): PreviewSidecarReady {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Preview sidecar ready event must be an object')
  }
  const source = value as PreviewSidecarReadyCandidate
  if (
    Reflect.ownKeys(value).some((key) => !PREVIEW_READY_KEYS.has(key)) ||
    source.type !== 'ready' ||
    typeof source.url !== 'string' ||
    !Number.isInteger(source.port) ||
    (source.port as number) < 1 ||
    (source.port as number) > 65_535
  ) {
    throw new Error('Preview sidecar ready event is invalid')
  }
  const parsed = new URL(source.url)
  const port = source.port as number
  if (
    parsed.protocol !== 'http:' ||
    !PREVIEW_LOOPBACK_HOSTS.has(parsed.hostname) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== String(port) ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.href !== source.url
  ) {
    throw new Error('Preview sidecar URL must be a canonical loopback HTTP origin')
  }
  return { url: parsed.href, port }
}
