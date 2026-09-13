import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { Transform } from 'node:stream'

import type { Plugin } from 'vite'

import {
  parsePreviewLocalBackendConnection,
  type PreviewLocalBackendConnection
} from './connection'

const CONTRACT_PATH = '/_openpencil/preview-contract'
const PRIVATE_REQUEST_HEADERS = new Set([
  'host',
  'cookie',
  'if-none-match',
  'if-modified-since',
  'if-range'
])
const HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'set-cookie'
])

export interface LocalBackendPreviewGuard {
  check(): Promise<void>
  plugin: Plugin
}

function message(unavailable: boolean): Error {
  return new Error(
    unavailable
      ? 'NestJS preview backend is unavailable. Start the exported API with local preview enabled, then reconnect.'
      : 'NestJS preview backend does not match this application. Export and restart the matching backend, then reconnect.'
  )
}

async function inspectContract(connection: PreviewLocalBackendConnection): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${connection.apiPort}${CONTRACT_PATH}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(2000)
  })
  if (
    response.status !== 200 ||
    !response.body ||
    response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json'
  ) {
    await response.body?.cancel()
    throw message(true)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > 4096) throw message(false)
      chunks.push(part.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch {
    throw message(false)
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'applicationDigest,applicationId,version' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('applicationId' in value) ||
    value.applicationId !== connection.applicationId ||
    !('applicationDigest' in value) ||
    value.applicationDigest !== connection.applicationDigest
  )
    throw message(false)
}

function apiPath(url: string | undefined, base: string): string | null {
  if (!url || !url.startsWith(base)) return null
  const suffix = url.slice(base.length)
  if (suffix && suffix[0] !== '/' && suffix[0] !== '?') return null
  return suffix.startsWith('/') ? suffix : '/' + suffix
}

function reject(response: ServerResponse, status: number, text: string): void {
  if (response.headersSent || response.destroyed) {
    response.destroy()
    return
  }
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify({ statusCode: status, message: text }))
}

function forward(
  request: IncomingMessage,
  response: ServerResponse,
  connection: PreviewLocalBackendConnection,
  path: string
): void {
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(
      ([key]) => !HOP_HEADERS.has(key) && !PRIVATE_REQUEST_HEADERS.has(key)
    )
  )
  const upstream = httpRequest(
    { host: '127.0.0.1', port: connection.apiPort, method: request.method, path, headers },
    (result) => {
      if ((result.statusCode ?? 502) >= 300 && (result.statusCode ?? 502) < 400) {
        result.resume()
        reject(response, 502, 'NestJS preview does not follow API redirects.')
        return
      }
      const responseHeaders = Object.fromEntries(
        Object.entries(result.headers).filter(([key]) => !HOP_HEADERS.has(key))
      )
      response.writeHead(result.statusCode ?? 502, {
        ...responseHeaders,
        'cache-control': 'no-store'
      })
      result.pipe(response)
      result.on('error', () => response.destroy())
    }
  )
  let bytes = 0
  const bounded = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.byteLength
      if (bytes > 65536) {
        reject(response, 413, 'Preview API request is too large.')
        done(new Error('Preview request limit exceeded.'))
        return
      }
      done(null, chunk)
    }
  })
  upstream.setTimeout(10000, () => upstream.destroy(new Error('Preview API timeout.')))
  upstream.on('error', () =>
    reject(
      response,
      503,
      'NestJS preview API request failed. Check the local backend and reconnect.'
    )
  )
  bounded.on('error', () => upstream.destroy())
  request.once('aborted', () => upstream.destroy())
  response.once('close', () => {
    if (!response.writableEnded) upstream.destroy()
  })
  request.pipe(bounded).pipe(upstream)
}

/** Every request rechecks the fixed public contract; one failure revokes this preview lifetime. */
export function createLocalBackendPreviewGuard(
  input: PreviewLocalBackendConnection
): LocalBackendPreviewGuard {
  const connection = parsePreviewLocalBackendConnection(input)
  const state: { revoked?: Error } = {}
  const assertActive = () => {
    if (state.revoked) throw state.revoked
  }
  const check = async () => {
    assertActive()
    try {
      await inspectContract(connection)
    } catch (error) {
      state.revoked ??=
        error instanceof Error && error.message.startsWith('NestJS preview backend')
          ? error
          : message(true)
      throw state.revoked
    }
    assertActive()
  }
  const plugin: Plugin = {
    name: 'openpencil-local-backend-preview',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = apiPath(request.url, connection.apiBasePath)
        if (path === null) {
          next()
          return
        }
        if (
          !['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method ?? '') ||
          Array.from(path).some(
            (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === '\\'
          )
        ) {
          reject(response, 400, 'Unsupported preview API request.')
          return
        }
        const length = request.headers['content-length']
        if (length && (!/^\d+$/.test(length) || Number(length) > 65536)) {
          reject(response, 413, 'Preview API request is too large.')
          return
        }
        request.pause()
        void check()
          .then(() => {
            if (!request.socket.destroyed && !response.destroyed)
              forward(request, response, connection, path)
            return undefined
          })
          .catch((error: Error) => reject(response, 503, error.message))
      })
    }
  }
  return { check, plugin }
}
