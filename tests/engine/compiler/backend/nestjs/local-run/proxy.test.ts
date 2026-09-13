import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { localExport } from './helpers'

test('local static server forwards only the exact API prefix before SPA fallback', () => {
  const { root, backend } = localExport()
  try {
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    symlinkSync(
      dirname(fileURLToPath(import.meta.resolve('vite/package.json'))),
      join(root, 'node_modules/vite'),
      'dir'
    )
    mkdirSync(join(root, 'dist'), { recursive: true })
    writeFileSync(
      join(root, 'openpencil-local-app.json'),
      JSON.stringify({ version: 1, loginPath: '/login-2' })
    )
    writeFileSync(
      join(root, 'dist/index.html'),
      '<!doctype html><title>Local notes fixture</title>'
    )
    const probe = join(backend, 'scripts/proxy-probe.mjs')
    writeFileSync(
      probe,
      String.raw`import { createServer } from 'node:http'
import { startWeb } from './local-web.mjs'
const api = createServer((request, response) => {
  response.writeHead(401, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ path: request.url, authorization: request.headers.authorization }))
})
let web
try {
  await new Promise((done) => api.listen(0, '127.0.0.1', done))
  web = await startWeb({ apiPort: api.address().port, webPort: 0 })
  const origin = 'http://127.0.0.1:' + web.httpServer.address().port
  const root = await fetch(origin + '/', { redirect: 'manual' })
  await root.body?.cancel()
  if (root.status !== 302 || root.headers.get('location') !== '/login-2') throw new Error('Actual login entry redirect failed')
  const response = await fetch(origin + '/api/notes?limit=2', { headers: { authorization: 'Bearer test-fixture' } })
  const apiResult = await response.json()
  if (response.status !== 401 || apiResult.path !== '/notes?limit=2' || apiResult.authorization !== 'Bearer test-fixture') throw new Error('API request forwarding failed')
  for (const path of ['/login-2', '/_openpencil/auth/callback?code=test-fixture', '/apix']) {
    const response = await fetch(origin + path)
    if (response.status !== 200 || !(await response.text()).includes('Local notes fixture')) throw new Error('SPA fallback failed')
  }
  console.log('proxy-and-spa-pass')
} finally {
  if (web) await new Promise((done) => web.httpServer.close(done))
  await new Promise((done) => api.close(done))
}
`
    )
    const result = spawnSync('node', [probe], { cwd: root, encoding: 'utf8', timeout: 15000 })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('proxy-and-spa-pass')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
