/** A fixed private launcher. Commands and paths never come from renderer-supplied source. */
export const MANAGED_WORKER_SOURCE = String.raw`import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { ROOT, LOCAL, loadConfig, loadSecrets, runtimeEnvironment, json, fail } from '../local-config.mjs'
import { startDatabase, stopDatabase, waitDatabase, initializeDatabase, verifyMigration } from '../local-database.mjs'
import { applyManagedMigration, inspectManagedDatabase } from './database.mjs'

const BASE = resolve(ROOT, '../..')
const action = process.argv[2]
// The companion keeps stdin open. EOF or cancellation closes this entire owned process group,
// including npm children; API sockets and PostgreSQL transactions cannot outlive this launcher.
function revoke() {
  if (process.platform !== 'win32') { try { process.kill(-process.pid, 'SIGKILL'); return } catch { /* Group already gone. */ } }
  process.exit(1)
}
process.stdin.resume()
process.stdin.once('end', revoke)
process.once('SIGTERM', revoke)
process.once('SIGINT', revoke)
function result(value) { process.stdout.write('OPENPENCIL_MANAGED_RESULT ' + JSON.stringify(value) + '\n') }
async function subprocess(executable, args, cwd) {
  const child = spawn(executable, args, { cwd, stdio: ['ignore','pipe','pipe'], env: process.env })
  // Raw compiler/npm output can include private paths or env values. Keep it out of protocol logs.
  child.stdout.resume(); child.stderr.resume()
  await new Promise((done, reject) => {
    child.once('error', () => reject(new Error('Managed build tool could not start.')))
    child.once('exit', (code) => code === 0 ? done() : reject(new Error('Managed dependency install or TypeScript build failed.')))
  })
}
async function main() {
  if (action === 'install') {
    await subprocess('npm', ['ci','--ignore-scripts','--no-audit','--no-fund'], BASE)
    result({ ok: true }); return
  }
  if (action === 'build') {
    await subprocess(process.execPath, [resolve(BASE,'node_modules/typescript/bin/tsc'), '-p', resolve(ROOT,'tsconfig.json')], ROOT)
    result({ ok: true }); return
  }
  if (action === 'stop' && (!existsSync(resolve(LOCAL,'config.json')) || !existsSync(resolve(LOCAL,'credentials.json')))) { result({ ok: true }); return }
  const config = loadConfig()
  const secrets = loadSecrets(action === 'setup')
  if (action === 'stop') { stopDatabase(config, secrets); result({ ok: true }); return }
  if (action === 'api') {
    Object.assign(process.env, runtimeEnvironment(config, secrets))
    await import(pathToFileURL(resolve(ROOT,'dist/main.js')).href)
    return
  }
  if (!['setup','verify','apply'].includes(action)) fail('Unknown managed preview worker action.')
  startDatabase(config, secrets, action === 'setup')
  await waitDatabase(config, secrets)
  const operation = json(resolve(LOCAL,'managed-operation.json'))
  if (operation.planId !== process.argv[3]) fail('Managed operation identity changed.')
  if (action === 'setup') await initializeDatabase(config, secrets, operation.toApplicationDigest, operation.planId, operation.toSchema)
  await verifyMigration(config, secrets)
  const receipt = action === 'apply' ? await applyManagedMigration(config, secrets, operation) : await inspectManagedDatabase(config, secrets, operation.toSchema)
  result({ ok: true, receipt })
}
main().then(() => { if (action !== 'api') process.exit(0) }).catch(() => { result({ ok: false, code: 'managed-worker-failed' }); process.exit(1) })
`
