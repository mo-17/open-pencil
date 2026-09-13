import { runtimeArtifact } from './artifact'

const SOURCE = String.raw`import { createRemoteJWKSet, customFetch } from 'jose'
import type { FetchImplementation } from 'jose'
import type { AuthenticationConfiguration } from './auth.config.js'

const MAX_BYTES = 65536
const MAX_KEYS = 16
const PRIVATE_KEY_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']

function rejected(): Error {
  return new Error('Authentication key retrieval failed.')
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw rejected()
  let abort: (() => void) | undefined
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(rejected())
      signal.addEventListener('abort', abort, { once: true })
      void reader.read().then(resolve, reject)
      if (signal.aborted) abort()
    })
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
  }
}

function validateKeys(value: unknown): void {
  if (!value || typeof value !== 'object' || !('keys' in value) || !Array.isArray(value.keys) ||
      value.keys.length < 1 || value.keys.length > MAX_KEYS) throw rejected()
  for (const key of value.keys) {
    if (!key || typeof key !== 'object' || Array.isArray(key) ||
        PRIVATE_KEY_FIELDS.some((field) => Object.hasOwn(key, field))) throw rejected()
  }
}

const boundedFetch: FetchImplementation = async (url, options) => {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let complete = false
  try {
    const response = await fetch(url, { ...options, redirect: 'manual' })
    if (response.status !== 200 || !response.body) {
      void response.body?.cancel().catch(() => undefined)
      throw rejected()
    }
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const chunk = await readChunk(reader, options.signal)
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > MAX_BYTES) throw rejected()
      chunks.push(chunk.value)
    }
    if (options.signal.aborted) throw rejected()
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const value: unknown = JSON.parse(text)
    validateKeys(value)
    complete = true
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } })
  } catch {
    throw rejected()
  } finally {
    if (!complete) void reader?.cancel().catch(() => undefined)
    reader?.releaseLock()
  }
}

export function createJWKSResolver(configuration: AuthenticationConfiguration) {
  return createRemoteJWKSet(new URL(configuration.jwksURL.href), {
    timeoutDuration: 5000,
    cooldownDuration: 30000,
    cacheMaxAge: 600000,
    [customFetch]: boundedFetch,
  })
}
`

export function emitJWKSArtifact() {
  return runtimeArtifact('jwks.ts', SOURCE)
}
