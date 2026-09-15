import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'

import type { Page } from '@playwright/test'

/** Serves only an opt-in, locally built export; no Vite or intercepted image responses. */
export async function serveTourExport(directory: string) {
  const root = resolve(directory)
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.jpg': 'image/jpeg',
    '.json': 'application/json'
  }
  const serve = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
      if (!file.startsWith(root + sep) || request.method !== 'GET') {
        response.writeHead(403).end()
        return
      }
      const body = await readFile(file)
      response
        .writeHead(200, {
          'content-type': types[extname(file)] ?? 'application/octet-stream',
          'content-length': body.length
        })
        .end(body)
    } catch {
      response.writeHead(404).end()
    }
  }
  const server = createServer((request, response) => {
    void serve(request, response)
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a local TCP server')
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolveClose()
        })
      })
    }
  }
}

/** Observe real browser resource APIs without replacing PSV, Three or image decoding. */
export function installTourResourceProbe(page: Page) {
  return page.evaluateHandle(() => {
    const create = Reflect.get(URL, 'createObjectURL')
    const revoke = Reflect.get(URL, 'revokeObjectURL')
    const deleteTexture = Reflect.get(WebGL2RenderingContext.prototype, 'deleteTexture')
    const active = new Set<string>()
    const created: string[] = []
    const revoked: string[] = []
    let deletedTextures = 0
    URL.createObjectURL = function (blob) {
      const url = create.call(URL, blob)
      active.add(url)
      created.push(url)
      return url
    }
    URL.revokeObjectURL = function (url) {
      active.delete(url)
      revoked.push(url)
      revoke.call(URL, url)
    }
    WebGL2RenderingContext.prototype.deleteTexture = function (texture) {
      deletedTextures++
      deleteTexture.call(this, texture)
    }
    return {
      snapshot: () => ({
        active: [...active],
        created: [...created],
        revoked: [...revoked],
        deletedTextures
      }),
      restore() {
        URL.createObjectURL = create
        URL.revokeObjectURL = revoke
        WebGL2RenderingContext.prototype.deleteTexture = deleteTexture
      }
    }
  })
}
