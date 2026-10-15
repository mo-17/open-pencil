import { expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'

import * as v from 'valibot'

import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not listen')
  return address.port
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

test('Vite registers the relay only for a checked local backend and preserves normal callback rendering', async () => {
  const applicationDigest = 'A'.repeat(43)
  let valid = true
  const api = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        version: 1,
        applicationId: 'notes',
        applicationDigest: valid ? applicationDigest : 'B'.repeat(43)
      })
    )
  })
  const apiPort = await listen(api)
  const probe = createServer()
  const previewPort = await listen(probe)
  await close(probe)
  let preview: PreviewServer | undefined
  const initialFiles = new Map([
    ['index.html', '<!doctype html><html><body>Normal preview application</body></html>']
  ])
  try {
    preview = await createPreviewServer({
      initialFiles,
      localBackend: {
        previewPort,
        apiPort,
        apiBasePath: '/api',
        applicationId: 'notes',
        applicationDigest
      }
    })
    const origin = new URL(preview.url).origin
    const authorization = new URL('https://identity.example.test/authorize')
    for (const [key, value] of Object.entries({
      response_type: 'code',
      client_id: 'preview',
      redirect_uri: origin + '/_openpencil/auth/callback',
      scope: 'openid',
      state: 's'.repeat(43),
      nonce: 'n'.repeat(43),
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256'
    }))
      authorization.searchParams.set(key, value)
    const registered = await fetch(origin + '/_openpencil/preview-auth', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ authorizationURL: authorization.href })
    })
    expect(registered.status).toBe(201)
    expect(registered.headers.get('access-control-allow-origin')).toBeNull()
    const crossOrigin = await fetch(origin + '/_openpencil/preview-auth', {
      method: 'OPTIONS',
      headers: { origin: 'http://127.0.0.1:9876', 'access-control-request-method': 'POST' }
    })
    expect(crossOrigin.status).toBe(403)
    expect(crossOrigin.headers.get('access-control-allow-origin')).toBeNull()
    const ticket = v.parse(
      v.pipe(
        v.string(),
        v.parseJson(),
        v.looseObject({ requestId: v.string(), pollToken: v.string() })
      ),
      await registered.text()
    )
    const external = await fetch(
      origin + '/_openpencil/auth/callback?state=' + 'e'.repeat(43) + '&code=external',
      { headers: { accept: 'text/html' } }
    )
    expect(external.status).toBe(200)
    expect(await external.text()).toContain('Normal preview application')
    valid = false
    const stale = await fetch(origin + '/_openpencil/preview-auth/result/' + ticket.requestId, {
      method: 'POST',
      headers: { origin, authorization: 'Bearer ' + ticket.pollToken }
    })
    expect(stale.status).toBe(503)
  } finally {
    await preview?.close()
    await close(api)
  }
  const ordinary = await createPreviewServer({ initialFiles })
  try {
    const origin = new URL(ordinary.url).origin
    const response = await fetch(origin + '/_openpencil/preview-auth', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: '{}'
    })
    expect(response.status).not.toBe(201)
    expect(response.headers.get('content-type')).not.toBe('application/json')
  } finally {
    await ordinary.close()
  }
}, 30000)
