import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { createInterface } from 'node:readline'

import { serializePreviewFiles } from '@open-pencil/compiler'

import { previewSidecarCommandArgs } from '@/app/lowcode/preview-pane/host/tauri-sidecar'

async function port(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test port')
  return address.port
}

async function close(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
  server.closeAllConnections()
  await closed
}

test('real Bun sidecar accepts the native command arguments and JSONL updates, then stops only its preview', async () => {
  const contract = { version: 1, applicationId: 'sidecar-test', applicationDigest: 'A'.repeat(43) }
  let writes = 0
  const api = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/_openpencil/preview-contract') response.end(JSON.stringify(contract))
    else {
      writes += 1
      response.end('{"ok":true}')
    }
  })
  const probe = createServer()
  const localBackend = {
    previewPort: await port(probe),
    apiPort: await port(api),
    apiBasePath: '/api',
    applicationId: contract.applicationId,
    applicationDigest: contract.applicationDigest
  }
  await close(probe)
  const child = spawn(
    process.execPath,
    previewSidecarCommandArgs(process.cwd(), 'vue', localBackend),
    {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    }
  )
  child.stderr.resume()
  const exited = once(child, 'exit')
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  async function event(expected: string): Promise<{ port?: unknown; url?: unknown }> {
    for (;;) {
      const line = await lines.next()
      if (line.done) throw new Error('Sidecar closed before ' + expected)
      let value: unknown
      try {
        value = JSON.parse(line.value)
      } catch {
        continue
      }
      if (!value || typeof value !== 'object' || !('type' in value)) continue
      if (value.type === 'error')
        throw new Error('message' in value ? String(value.message) : 'Sidecar failed')
      if (value.type === expected)
        return {
          ...('port' in value ? { port: value.port } : {}),
          ...('url' in value ? { url: value.url } : {})
        }
    }
  }
  try {
    const ready = await event('ready')
    expect(ready.port).toBe(localBackend.previewPort)
    expect(ready.url).toBe(`http://127.0.0.1:${localBackend.previewPort}/`)
    const files = new Map([['index.html', '<!doctype html><main>Live Vue sidecar</main>']])
    child.stdin.write(
      JSON.stringify({ type: 'update', files: serializePreviewFiles(files) }) + '\n'
    )
    await event('updated')
    const root = `http://127.0.0.1:${localBackend.previewPort}/`
    const callback = await fetch(root + '_openpencil/auth/callback?code=fake', {
      headers: { accept: 'text/html' }
    })
    expect(callback.status).toBe(200)
    expect(await callback.text()).toContain('Live Vue sidecar')
    expect(await (await fetch(root + 'api/notes', { method: 'POST' })).json()).toEqual({ ok: true })
    child.stdin.write('{"type":"close"}\n')
    await event('closing')
    expect((await exited)[0]).toBe(0)
    await expect(fetch(root)).rejects.toThrow()
    const untouchedAPI = await fetch(
      `http://127.0.0.1:${localBackend.apiPort}/_openpencil/preview-contract`
    )
    expect(await untouchedAPI.json()).toEqual(contract)
    expect(writes).toBe(1)
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    await exited
    await close(api)
  }
}, 20_000)
