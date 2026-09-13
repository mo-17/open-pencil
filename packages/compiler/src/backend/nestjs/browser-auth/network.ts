export const NETWORK_SOURCE = String.raw`
function localBrowser(): boolean {
  return ['127.0.0.1', '[::1]', 'localhost'].includes(window.location.hostname)
}

function admissibleEndpoint(value: string): URL {
  const url = new URL(value)
  const issuer = new URL(CONFIG.authentication.issuer)
  const development = issuer.protocol === 'http:' && localBrowser() &&
    ['127.0.0.1', '[::1]'].includes(issuer.hostname) && url.origin === issuer.origin
  if ((url.protocol !== 'https:' && !development) || url.username || url.password || url.hash) throw failure()
  return url
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  if (signal.aborted) throw failure()
  let abort: (() => void) | undefined
  try {
    return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      abort = () => reject(failure())
      signal.addEventListener('abort', abort, { once: true })
      void reader.read().then(resolve, reject)
      if (signal.aborted) abort()
    })
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
  }
}

function requestBody(value: oidc.FetchBody): BodyInit | null | undefined {
  if (value instanceof Uint8Array) {
    if (value.byteLength > 32768) throw failure()
    return new Uint8Array(value).buffer
  }
  return value
}

function boundedFetch(owner: AbortSignal): oidc.CustomFetch {
  return async (value, options) => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let complete = false
    try {
      const url = admissibleEndpoint(value)
      const signals = [owner, AbortSignal.timeout(10000)]
      if (options.signal) signals.push(options.signal)
      const signal = AbortSignal.any(signals)
      const response = await fetch(url, {
        ...options, body: requestBody(options.body), signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
      })
      if (!response.body || response.status < 200 || response.status >= 500 || response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => undefined)
        throw failure()
      }
      reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      while (true) {
        const chunk = await readChunk(reader, signal)
        if (chunk.done) break
        length += chunk.value.byteLength
        if (length > 65536) throw failure()
        chunks.push(chunk.value)
      }
      if (signal.aborted) throw failure()
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      complete = true
      return new Response(bytes, { status: response.status, headers: response.headers })
    } catch { throw failure() }
    finally {
      if (!complete) void reader?.cancel().catch(() => undefined)
      reader?.releaseLock()
    }
  }
}

async function configuration(generation: number): Promise<oidc.Configuration> {
  const issuer = admissibleEndpoint(CONFIG.authentication.issuer)
  const development = issuer.protocol === 'http:'
  const fetch = boundedFetch(operation.signal)
  const config = await oidc.discovery(issuer, CONFIG.authentication.clientId,
    { token_endpoint_auth_method: 'none' }, oidc.None(), {
      [oidc.customFetch]: fetch,
      timeout: 10,
      execute: [oidc.enableNonRepudiationChecks, ...(development ? [oidc.allowInsecureRequests] : [])],
    })
  assertCurrent(generation)
  const metadata = config.serverMetadata()
  if (metadata.issuer !== CONFIG.authentication.issuer || !metadata.authorization_endpoint ||
      !metadata.token_endpoint || !metadata.jwks_uri ||
      !metadata.code_challenge_methods_supported?.includes('S256')) throw failure()
  for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
    admissibleEndpoint(endpoint)
  }
  config[oidc.customFetch] = fetch
  return config
}
`
