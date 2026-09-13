import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { localExport, runLocal } from './helpers'

test('local:down waits for both control record removal and final startup-lock release', () => {
  const { root, backend } = localExport()
  try {
    const configuration = runLocal(backend, 'configure', '--local-keycloak')
    expect(configuration.status, configuration.stderr).toBe(0)
    const probe = join(backend, 'scripts/shutdown-probe.mjs')
    writeFileSync(
      probe,
      String.raw`import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LOCAL, ROOT, loadSecrets } from './local-config.mjs'
loadSecrets(true)
const running = resolve(LOCAL, 'running.json')
const lock = resolve(LOCAL, 'up.lock')
const token = 'a'.repeat(64)
let unlocked = false
const control = createServer((request, response) => {
  if (request.url !== '/stop' || request.method !== 'POST' || request.headers.authorization !== 'Bearer ' + token) {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200).end('Stopping')
  // Model the real cleanup ordering, with a scheduling delay before its final unlink.
  setTimeout(() => unlinkSync(running), 25)
  setTimeout(() => { unlinkSync(lock); unlocked = true }, 450)
})
let child
try {
  await new Promise((done, reject) => { control.once('error', reject); control.listen(0, '127.0.0.1', done) })
  writeFileSync(running, JSON.stringify({ version: 1, port: control.address().port, token }), { mode: 0o600 })
  writeFileSync(lock, 'isolated-shutdown-fixture\n', { mode: 0o600 })
  child = spawn(process.execPath, [resolve(ROOT, 'scripts/local.mjs'), 'down'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done) })
  if (code !== 0 || !unlocked || existsSync(running) || existsSync(lock) || !output.includes('Local services stopped.')) {
    throw new Error('local:down reported completion before the final startup lock was released')
  }
  console.log('shutdown-completion-pass')
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM')
  await new Promise((done) => control.close(done))
}
`
    )
    const result = spawnSync('node', [probe], { cwd: root, encoding: 'utf8', timeout: 10000 })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('shutdown-completion-pass')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
