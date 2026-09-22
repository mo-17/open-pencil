import type { IncomingMessage, ServerResponse } from 'node:http'

const MAX_BODY_BYTES = 32 * 1024
const HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy':
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
}

export class PreviewAuthRequestError extends Error {
  constructor(readonly status: number) {
    super('Preview authorization request failed.')
    this.name = 'PreviewAuthRequestError'
  }
}

export function authReply(response: ServerResponse, status: number, value: unknown = {}): void {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, { ...HEADERS, 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

export function authRedirect(response: ServerResponse, destination: string): void {
  response.writeHead(302, { ...HEADERS, location: destination })
  response.end()
}

export function authFinished(response: ServerResponse): void {
  response.writeHead(200, { ...HEADERS, 'content-type': 'text/html; charset=utf-8' })
  response.end(
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>OpenPencil preview</title><body><h1>Authorization received</h1><p>Return to OpenPencil to continue. You may close this tab.</p></body></html>'
  )
}

export function singleHeader(request: IncomingMessage, name: string): string | undefined {
  let count = 0
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === name) count++
  }
  const value = request.headers[name]
  return count === 1 && typeof value === 'string' ? value : undefined
}

export function sameOriginAuthRequest(request: IncomingMessage, origin: string): boolean {
  const site = request.headers['sec-fetch-site']
  return singleHeader(request, 'origin') === origin && (!site || site === 'same-origin')
}

export function topLevelAuthRequest(request: IncomingMessage): boolean {
  const destination = request.headers['sec-fetch-dest']
  const mode = request.headers['sec-fetch-mode']
  return (!destination || destination === 'document') && (!mode || mode === 'navigate')
}

export function readAuthBody(request: IncomingMessage): Promise<unknown> {
  const length = request.headers['content-length']
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    request.resume()
    throw new PreviewAuthRequestError(413)
  }
  if (singleHeader(request, 'content-type')?.split(';')[0].trim() !== 'application/json') {
    request.resume()
    throw new PreviewAuthRequestError(415)
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const cleanup = () => {
      clearTimeout(timer)
      request.off('data', onData)
      request.off('end', onEnd)
      // IncomingMessage can emit error after aborted; retain the one-shot listener
      // so an interrupted body cannot become an unhandled process error.
      request.off('aborted', onError)
    }
    const fail = (status: number) => {
      cleanup()
      request.resume()
      reject(new PreviewAuthRequestError(status))
    }
    const onData = (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_BODY_BYTES) return fail(413)
      chunks.push(chunk)
    }
    const onEnd = () => {
      cleanup()
      try {
        resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))))
      } catch {
        reject(new PreviewAuthRequestError(400))
      }
    }
    const onError = () => fail(400)
    const timer = setTimeout(() => fail(408), 5000)
    timer.unref()
    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    request.once('aborted', onError)
  })
}
