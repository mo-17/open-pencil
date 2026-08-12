type WebFontProxyFetch = (url: string, init?: RequestInit) => Promise<Response>

let fetchProxyQueue: Promise<void> = Promise.resolve()

async function acquireFetchProxy(): Promise<() => void> {
  const previous = fetchProxyQueue
  let release = (): void => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  fetchProxyQueue = previous.then(
    () => current,
    () => current
  )
  await previous.catch(() => undefined)
  return release
}

function requestURL(input: RequestInfo | URL): string {
  if (typeof input === 'string' || input instanceof URL) return input.toString()
  return input.url
}

/**
 * Unifont providers use the ambient fetch implementation internally. Keep
 * every temporary replacement in one process-wide queue so independent font
 * callers cannot restore each other's fetch implementation out of order.
 * Passing no fetcher still takes the lock, protecting native-fetch operations
 * from a concurrent temporary proxy.
 */
export async function withWebFontFetchProxy<T>(
  fetcher: WebFontProxyFetch | undefined,
  operation: () => Promise<T>
): Promise<T> {
  const release = await acquireFetchProxy()
  const originalFetch = globalThis.fetch
  if (fetcher) {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestURL(input)
      if (/^https?:\/\//.test(url)) return fetcher(url, init)
      return originalFetch(input, init)
    }) as typeof fetch
  }

  try {
    return await operation()
  } finally {
    if (fetcher) globalThis.fetch = originalFetch
    release()
  }
}

/** Fetch with the ambient implementation only while no temporary proxy is active. */
export function coordinatedWebFontFetch(
  fetcher: WebFontProxyFetch | undefined,
  url: string,
  init?: RequestInit
): Promise<Response> {
  if (fetcher) return fetcher(url, init)
  return withWebFontFetchProxy(undefined, () => globalThis.fetch(url, init))
}

/** Cache concurrent initialization, but never pin a rejected initialization. */
export function retryableCachedPromise<Key, Value>(
  cache: Map<Key, Promise<Value>>,
  key: Key,
  create: () => Promise<Value>
): Promise<Value> {
  const cached = cache.get(key)
  if (cached) return cached

  const pending = Promise.resolve().then(create)
  cache.set(key, pending)
  void pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key)
  })
  return pending
}
