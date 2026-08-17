import { IS_BROWSER } from '#core/constants'

/** Keeps the reviewed 10.5 MiB Noto Sans SC face below a hard Worker fetch ceiling. */
export const MAX_BUNDLED_FONT_WORKER_BYTES = 12 * 1024 * 1024

interface DedicatedFontWorkerScope {
  close?: unknown
  fetch?: unknown
  location?: { href?: unknown }
  postMessage?: unknown
}

function dedicatedFontWorkerScope(): DedicatedFontWorkerScope | null {
  if (IS_BROWSER) return null
  const scope: DedicatedFontWorkerScope = globalThis
  if (
    typeof scope.close !== 'function' ||
    typeof scope.postMessage !== 'function' ||
    typeof scope.fetch !== 'function' ||
    typeof scope.location?.href !== 'string' ||
    Reflect.has(scope, 'document')
  ) {
    return null
  }
  return scope
}

export function isBundledFontWebRuntime(): boolean {
  return IS_BROWSER || dedicatedFontWorkerScope() !== null
}

function workerBundledFontURL(scope: DedicatedFontWorkerScope, value: string): URL {
  const base = new URL(scope.location?.href as string)
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('Bundled fonts require an HTTP(S) Dedicated Worker origin')
  }
  const resolved = new URL(value, base)
  if (
    (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') ||
    resolved.origin !== base.origin ||
    resolved.username !== '' ||
    resolved.password !== ''
  ) {
    throw new Error('Bundled fonts must use the Dedicated Worker HTTP(S) origin')
  }
  return resolved
}

function bundledFontSizeError(): RangeError {
  return new RangeError(
    `Bundled font response exceeds ${MAX_BUNDLED_FONT_WORKER_BYTES / 1024 / 1024} MiB`
  )
}

async function boundedBundledFontResponse(response: Response): Promise<ArrayBuffer> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`Bundled font request failed with HTTP ${response.status}`)
  }
  const declaredLength = response.headers.get('content-length')
  if (declaredLength && /^\d+$/.test(declaredLength.trim())) {
    const bytes = Number(declaredLength)
    if (!Number.isSafeInteger(bytes) || bytes > MAX_BUNDLED_FONT_WORKER_BYTES) {
      await response.body?.cancel().catch(() => undefined)
      throw bundledFontSizeError()
    }
  }
  if (!response.body) {
    const result = await response.arrayBuffer()
    if (result.byteLength > MAX_BUNDLED_FONT_WORKER_BYTES) throw bundledFontSizeError()
    return result
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    let next = await reader.read()
    while (!next.done) {
      byteLength += next.value.byteLength
      if (!Number.isSafeInteger(byteLength) || byteLength > MAX_BUNDLED_FONT_WORKER_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw bundledFontSizeError()
      }
      chunks.push(next.value)
      next = await reader.read()
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result.buffer
}

async function fetchBundledFontFromWorker(
  scope: DedicatedFontWorkerScope,
  value: string
): Promise<ArrayBuffer> {
  const url = workerBundledFontURL(scope, value)
  const response = await fetch(url, {
    credentials: 'omit',
    mode: 'same-origin',
    redirect: 'error',
    referrerPolicy: 'no-referrer'
  })
  return boundedBundledFontResponse(response)
}

/** Browser/Vite entrypoint. It deliberately has no fallback to a Node filesystem loader. */
export async function fetchBundledFontBytes(value: string): Promise<ArrayBuffer> {
  if (IS_BROWSER) {
    const response = await fetch(value)
    return response.arrayBuffer()
  }
  const worker = dedicatedFontWorkerScope()
  if (worker) return fetchBundledFontFromWorker(worker, value)
  throw new Error('Bundled fonts require a Window or HTTP(S) Dedicated Worker runtime')
}
