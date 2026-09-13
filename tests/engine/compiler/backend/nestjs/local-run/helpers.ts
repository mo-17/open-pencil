import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { compileBrowser, browserApplication } from '../browser-client/helpers'

export function localExport() {
  const application = browserApplication()
  if (!application.httpApi?.browserClient) throw new Error('Expected browser authentication')
  application.httpApi.browserClient.authentication.issuer =
    'http://127.0.0.1:18080/realms/openpencil'
  const output = compileBrowser('react', undefined, application)
  const root = mkdtempSync(join(tmpdir(), 'openpencil-local-export-'))
  for (const [path, content] of output.files) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const backend = join(root, 'backend/nestjs')
  return { root, backend, output }
}

export function runLocal(backend: string, ...args: string[]) {
  return spawnSync('node', ['scripts/local.mjs', ...args], {
    cwd: backend,
    encoding: 'utf8',
    timeout: 10000
  })
}
