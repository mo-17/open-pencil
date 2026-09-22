/** Included only in explicitly connected desktop previews, never standalone exports. */
export const PREVIEW_RELAY_SOURCE = String.raw`
interface PreviewAuthenticationContext { channel: string; parentOrigin: string }
interface PreviewAuthenticationRequest { requestId: string; pollToken: string }
const PREVIEW_AUTH_PATH = '/_openpencil/preview-auth'

function previewRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key))
}

function previewAuthenticationContext(): PreviewAuthenticationContext {
  if (window.location.origin !== 'http://127.0.0.1:5181' || window.name.length > 2048) throw failure()
  const value: unknown = JSON.parse(window.name)
  if (!previewRecord(value, ['protocol', 'channel', 'parentOrigin', 'transport']) ||
      value.protocol !== 'open-pencil-preview-v2' || value.transport !== 'window' ||
      typeof value.channel !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/u.test(value.channel) ||
      typeof value.parentOrigin !== 'string' || value.parentOrigin === 'null') throw failure()
  const origin = new URL(value.parentOrigin)
  if (value.parentOrigin !== 'tauri://localhost' &&
      (origin.origin !== value.parentOrigin || origin.username || origin.password)) throw failure()
  return { channel: value.channel, parentOrigin: value.parentOrigin }
}

async function previewResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json' || !response.body) {
    void response.body?.cancel().catch(() => undefined)
    throw failure()
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const chunk = await readChunk(reader, signal)
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > 16384) throw failure()
      chunks.push(chunk.value)
    }
    if (signal.aborted) throw failure()
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } finally {
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function requestPreviewBrowser(
  context: PreviewAuthenticationContext, requestId: string, signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (opened: boolean) => {
      if (timer !== undefined) clearTimeout(timer)
      window.removeEventListener('message', receive)
      signal.removeEventListener('abort', aborted)
      if (opened) resolve(); else reject(failure('browser-unavailable'))
    }
    const aborted = () => finish(false)
    const receive = (event: MessageEvent<unknown>) => {
      const value = event.data
      if (event.source !== window.parent || event.origin !== context.parentOrigin ||
          !previewRecord(value, ['type', 'version', 'channel', 'requestId', 'opened']) ||
          value.type !== 'openpencil:local-backend-sign-in-result' || value.version !== 1 ||
          value.channel !== context.channel || value.requestId !== requestId ||
          typeof value.opened !== 'boolean') return
      finish(value.opened)
    }
    window.addEventListener('message', receive)
    signal.addEventListener('abort', aborted, { once: true })
    timer = setTimeout(aborted, 15000)
    if (signal.aborted) { aborted(); return }
    try {
      window.parent.postMessage({ type: 'openpencil:local-backend-sign-in', version: 1,
        channel: context.channel, requestId }, context.parentOrigin)
    } catch { finish(false) }
  })
}

function waitPreviewPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(failure()) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve() }, 500)
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
  })
}

async function signInThroughPreview(authorizationURL: URL, generation: number): Promise<void> {
  const signal = AbortSignal.any([operation.signal, AbortSignal.timeout(TRANSACTION_AGE)])
  let request: PreviewAuthenticationRequest | undefined
  const leaving = () => {
    if (generation !== session.generation) return
    clearSession()
    try { window.sessionStorage.removeItem(STORAGE_KEY) } catch { /* This page is leaving. */ }
  }
  window.addEventListener('pagehide', leaving, { once: true })
  try {
    const context = previewAuthenticationContext()
    const created = await fetch(PREVIEW_AUTH_PATH, {
      method: 'POST', body: JSON.stringify({ authorizationURL: authorizationURL.href }),
      headers: { 'content-type': 'application/json' }, credentials: 'omit', redirect: 'error',
      cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    })
    if (created.status !== 201) { void created.body?.cancel().catch(() => undefined); throw failure() }
    const value = await previewResponse(created, signal)
    if (!previewRecord(value, ['requestId', 'pollToken']) ||
        typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value.requestId) ||
        typeof value.pollToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value.pollToken) ||
        value.requestId === value.pollToken) throw failure()
    request = { requestId: value.requestId, pollToken: value.pollToken }
    assertCurrent(generation)
    await requestPreviewBrowser(context, request.requestId, signal)
    for (;;) {
      assertCurrent(generation)
      const response = await fetch(PREVIEW_AUTH_PATH + '/result/' + request.requestId, {
        method: 'POST', headers: { authorization: 'Bearer ' + request.pollToken },
        credentials: 'omit', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      })
      if (response.status === 202) {
        void response.body?.cancel().catch(() => undefined)
        await waitPreviewPoll(signal)
        continue
      }
      if (response.status !== 200) { void response.body?.cancel().catch(() => undefined); throw failure() }
      const result = await previewResponse(response, signal)
      if (!previewRecord(result, ['callbackURL']) || typeof result.callbackURL !== 'string') throw failure()
      assertCurrent(generation)
      await completeAuthorization(new URL(result.callbackURL), consumeTransaction(), generation)
      if (session.generation !== generation + 1 || !session.signedIn) throw failure()
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
      return
    }
  } catch (cause) {
    if (generation === session.generation) {
      const timedOut = signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
      clearSession(true, timedOut ? 'timeout' : failureNotice(cause))
      window.sessionStorage.removeItem(STORAGE_KEY)
    }
    throw failure()
  } finally {
    window.removeEventListener('pagehide', leaving)
    if (request) {
      // Cleanup is independent of the cancelled login signal and contains no authorization code or access token.
      void fetch(PREVIEW_AUTH_PATH + '/' + request.requestId, {
        method: 'DELETE', headers: { authorization: 'Bearer ' + request.pollToken },
        credentials: 'omit', redirect: 'error', cache: 'no-store', keepalive: true,
        signal: AbortSignal.timeout(2000),
      }).then((response) => response.body?.cancel()).catch(() => undefined)
    }
  }
}
`
