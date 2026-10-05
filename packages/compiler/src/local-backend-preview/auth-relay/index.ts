import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { setTimeout, clearTimeout } from 'node:timers'

import { unrefTimer } from '#compiler/node-runtime/timers'
import { fromUint8Array } from 'js-base64'
import type { Plugin } from 'vite'

import type { PreviewLocalBackendConnection } from '../connection'
import { createLocalBackendPreviewGuard } from '../server'
import {
  authFinished,
  authRedirect,
  authReply,
  PreviewAuthRequestError,
  readAuthBody,
  sameOriginAuthRequest,
  singleHeader,
  topLevelAuthRequest
} from './http'
import {
  MAX_AUTH_URL_BYTES,
  parsePreviewAuthorization,
  PREVIEW_AUTH_CALLBACK_PATH,
  PREVIEW_AUTH_PATH,
  previewAuthCallbackURL
} from './validation'

const TTL_MS = 10 * 60 * 1000
const MAX_PENDING = 8
const REQUEST_ID = /^[A-Za-z0-9_-]{43}$/

interface AuthorizationRequest {
  authorizationURL: string
  state: string
  pollToken: string
  expiresAt: number
  expiry: ReturnType<typeof setTimeout>
  opened: boolean
  callbackURL?: string
}

/** A preview-lifetime code relay. PKCE verifiers and tokens stay entirely in the preview iframe. */
export function createPreviewAuthRelay(options: {
  previewPort: number
  check(): Promise<void>
  now?: () => number
}) {
  const origin = `http://127.0.0.1:${options.previewPort}`
  const host = `127.0.0.1:${options.previewPort}`
  const now = options.now ?? Date.now
  const pending = new Map<string, AuthorizationRequest>()
  let disposed = false
  const remove = (id: string) => {
    const record = pending.get(id)
    if (record) clearTimeout(record.expiry)
    pending.delete(id)
  }
  const dispose = () => {
    disposed = true
    for (const id of pending.keys()) remove(id)
  }
  const prune = () => {
    for (const [id, record] of pending) if (record.expiresAt <= now()) remove(id)
  }
  const assertOpen = () => {
    if (disposed) throw new PreviewAuthRequestError(410)
  }
  const guard = async () => {
    assertOpen()
    try {
      await options.check()
    } catch {
      dispose()
      throw new PreviewAuthRequestError(503)
    }
    assertOpen()
    prune()
  }
  const authorized = (request: IncomingMessage, record: AuthorizationRequest) => {
    const authorization = singleHeader(request, 'authorization')
    if (!authorization?.startsWith('Bearer ')) return false
    const token = authorization.slice(7)
    return (
      REQUEST_ID.test(token) && timingSafeEqual(Buffer.from(token), Buffer.from(record.pollToken))
    )
  }

  async function callback(
    request: IncomingMessage,
    response: ServerResponse,
    raw: string,
    next: () => void
  ) {
    const url = new URL(raw, origin)
    const state = url.searchParams.get('state')
    const record = [...pending.values()].find((candidate) => candidate.state === state)
    // Existing top-level exports share this callback route; only consume a relay's exact state.
    if (!record) return next()
    const callbackURL = previewAuthCallbackURL(url)
    if (request.method !== 'GET' || !topLevelAuthRequest(request) || !callbackURL)
      throw new PreviewAuthRequestError(400)
    await guard()
    if (record.expiresAt <= now() || ![...pending.values()].includes(record))
      throw new PreviewAuthRequestError(410)
    if (!record.opened || record.callbackURL) throw new PreviewAuthRequestError(409)
    record.callbackURL = callbackURL
    authFinished(response)
  }

  async function start(request: IncomingMessage, response: ServerResponse, id: string) {
    if (request.method !== 'GET' || !REQUEST_ID.test(id) || !topLevelAuthRequest(request))
      throw new PreviewAuthRequestError(400)
    await guard()
    const record = pending.get(id)
    if (!record || record.opened) throw new PreviewAuthRequestError(404)
    record.opened = true
    authRedirect(response, record.authorizationURL)
  }

  async function begin(request: IncomingMessage, response: ServerResponse) {
    const authorization = parsePreviewAuthorization(await readAuthBody(request), origin)
    if (!authorization) throw new PreviewAuthRequestError(400)
    await guard()
    if (pending.size >= MAX_PENDING) throw new PreviewAuthRequestError(429)
    if ([...pending.values()].some((record) => record.state === authorization.state))
      throw new PreviewAuthRequestError(409)
    const requestId = fromUint8Array(randomBytes(32), true)
    const pollToken = fromUint8Array(randomBytes(32), true)
    const expiry = setTimeout(() => remove(requestId), TTL_MS)
    unrefTimer(expiry)
    pending.set(requestId, {
      ...authorization,
      pollToken,
      opened: false,
      expiresAt: now() + TTL_MS,
      expiry
    })
    authReply(response, 201, { requestId, pollToken })
  }

  async function resultOrCancel(request: IncomingMessage, response: ServerResponse, raw: string) {
    const resultPrefix = PREVIEW_AUTH_PATH + '/result/'
    const result = raw.startsWith(resultPrefix) && request.method === 'POST'
    const cancel = raw.startsWith(PREVIEW_AUTH_PATH + '/') && request.method === 'DELETE'
    const id = raw.slice((result ? resultPrefix : PREVIEW_AUTH_PATH + '/').length)
    if ((!result && !cancel) || !REQUEST_ID.test(id)) throw new PreviewAuthRequestError(400)
    const record = pending.get(id)
    if (!record || !authorized(request, record)) throw new PreviewAuthRequestError(404)
    if (cancel) {
      remove(id)
      authReply(response, 204)
      return
    }
    await guard()
    if (pending.get(id) !== record) throw new PreviewAuthRequestError(410)
    if (!record.callbackURL) {
      authReply(response, 202)
      return
    }
    remove(id)
    authReply(response, 200, { callbackURL: record.callbackURL })
  }

  async function handle(request: IncomingMessage, response: ServerResponse, next: () => void) {
    const raw = request.url ?? ''
    const path = raw.split('?')[0]
    if (
      path !== PREVIEW_AUTH_CALLBACK_PATH &&
      path !== PREVIEW_AUTH_PATH &&
      !raw.startsWith(PREVIEW_AUTH_PATH + '/')
    )
      return next()
    if (singleHeader(request, 'host') !== host) throw new PreviewAuthRequestError(403)
    if (Buffer.byteLength(raw) > MAX_AUTH_URL_BYTES || /[\s\\#]/.test(raw))
      throw new PreviewAuthRequestError(400)
    const isBegin = raw === PREVIEW_AUTH_PATH && request.method === 'POST'
    if (
      !isBegin &&
      (request.headers['transfer-encoding'] ||
        (request.headers['content-length'] && request.headers['content-length'] !== '0'))
    ) {
      request.resume()
      throw new PreviewAuthRequestError(400)
    }
    prune()
    if (path === PREVIEW_AUTH_CALLBACK_PATH) return callback(request, response, raw, next)
    const startPrefix = PREVIEW_AUTH_PATH + '/start/'
    if (raw.startsWith(startPrefix)) return start(request, response, raw.slice(startPrefix.length))
    if (!sameOriginAuthRequest(request, origin)) throw new PreviewAuthRequestError(403)
    if (isBegin) return begin(request, response)
    return resultOrCancel(request, response, raw)
  }

  const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    void handle(request, response, next).catch((error: unknown) => {
      authReply(response, error instanceof PreviewAuthRequestError ? error.status : 400, {
        error: 'Preview authorization request failed.'
      })
    })
  }
  const plugin: Plugin = {
    name: 'openpencil-preview-auth-relay',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(middleware)
      server.httpServer?.once('close', dispose)
    },
    closeBundle: dispose
  }
  return { plugin, middleware, dispose }
}

export async function createLocalBackendPreviewServices(
  connection: PreviewLocalBackendConnection | undefined
) {
  if (!connection) return {}
  const backendGuard = createLocalBackendPreviewGuard(connection)
  await backendGuard.check()
  const authRelay = createPreviewAuthRelay({
    previewPort: connection.previewPort,
    check: () => backendGuard.check()
  })
  return { backendGuard, authRelay }
}
