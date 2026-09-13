export const LIFECYCLE_SOURCE = String.raw`import { existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer as controlServer } from 'node:http'
import { createServer as portServer } from 'node:net'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { ROOT, FRONTEND, LOCAL, PROJECT, configure, loadConfig, loadSecrets, loginPath, command, runtimeEnvironment, fail, json, privateWrite } from './local-config.mjs'
import { startDatabase, stopDatabase, waitDatabase, initializeDatabase, verifyMigration } from './local-database.mjs'

const runningPath = resolve(LOCAL, 'running.json')
const lockPath = resolve(LOCAL, 'up.lock')
function doctor(config, secrets) {
  command(process.execPath, [resolve(ROOT, 'scripts/local-doctor.mjs')], { env: runtimeEnvironment(config, secrets), stdio: 'inherit' })
}
function installAndBuild(directory, locked) {
  const hasLock = existsSync(resolve(directory, 'package-lock.json'))
  if (locked && !hasLock) fail('The reviewed backend package lock is missing.')
  command('npm', [hasLock ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, stdio: 'inherit', timeout: 600000 })
  command('npm', ['run', 'build'], { cwd: directory, stdio: 'inherit', timeout: 180000 })
}
function portAvailable(port) {
  return new Promise((done, reject) => {
    const server = portServer()
    server.once('error', () => reject(new Error('Port ' + port + ' is occupied. Stop your own conflicting service or explicitly change .local/config.json and the OIDC callback. No process was stopped.')))
    server.listen(port, '127.0.0.1', () => server.close(done))
  })
}
async function setup(config, args) {
  if (args.length !== 1 || args[0] !== '--accept-initial-schema') fail('Review migrations/001-initial.sql, then explicitly authorize new-database initialization with local:setup -- --accept-initial-schema. Setup installs dependencies and may download PostgreSQL 16.')
  if (existsSync(lockPath)) fail('Stop local:up before running setup. Existing services were preserved.')
  installAndBuild(ROOT, true)
  if (PROJECT.browserClient) installAndBuild(FRONTEND, false)
  const secrets = loadSecrets(true)
  startDatabase(config, secrets, true)
  await waitDatabase(config, secrets)
  await initializeDatabase(config, secrets)
  doctor(config, secrets)
  console.log('Setup complete; database data is persistent. Run npm run local:up. No migration is reapplied on startup.')
}
async function down(config, secrets) {
  if (existsSync(runningPath)) {
    const run = json(runningPath)
    if (!Number.isInteger(run.port) || run.port < 1024 || run.port > 65535 || !/^[a-f0-9]{64}$/.test(run.token)) fail('Invalid local control record. No process was stopped.')
    try {
      const response = await fetch('http://127.0.0.1:' + run.port + '/stop', { method: 'POST', headers: { authorization: 'Bearer ' + run.token }, signal: AbortSignal.timeout(15000) })
      if (response.status !== 200) fail('Control request rejected.')
      await response.body?.cancel()
      for (let attempt = 0; attempt < 150 && (existsSync(runningPath) || existsSync(lockPath)); attempt++) await new Promise((done) => setTimeout(done, 100))
      if (existsSync(runningPath) || existsSync(lockPath)) fail('Local shutdown is still in progress.')
    } catch { fail('Saved local session is unreachable. Verify the previous process has exited before removing .local/up.lock and .local/running.json. No arbitrary PID is killed.') }
  } else {
    if (existsSync(lockPath)) fail('A local startup lock exists. Verify the previous local:up process before removing .local/up.lock.')
    stopDatabase(config, secrets)
  }
  console.log('Local services stopped. Database volume and credentials are preserved.')
}
async function up(config, secrets) {
  if (!existsSync(resolve(ROOT, 'dist/main.js')) || !existsSync(resolve(ROOT, 'node_modules/pg/package.json')) ||
      (PROJECT.browserClient && !existsSync(resolve(FRONTEND, 'dist/index.html')))) fail('Built export or installed dependencies are missing. Run local:setup explicitly; startup never installs dependencies.')
  privateWrite(lockPath, String(process.pid) + '\n')
  let api, web, control, closing, databaseStarted = false
  const cleanup = () => closing ??= (async () => {
    if (web) await new Promise((done) => web.httpServer.close(done))
    if (api && api.exitCode === null && api.signalCode === null) {
      await new Promise((done) => {
        const force = setTimeout(() => api.kill('SIGKILL'), 10000)
        api.once('exit', () => { clearTimeout(force); done() })
        api.kill('SIGTERM')
      })
    }
    if (control) await new Promise((done) => control.close(done))
    if (databaseStarted) stopDatabase(config, secrets)
    if (existsSync(runningPath)) unlinkSync(runningPath)
    if (existsSync(lockPath)) unlinkSync(lockPath)
  })()
  try {
    await portAvailable(config.apiPort)
    if (PROJECT.browserClient) await portAvailable(config.webPort)
    startDatabase(config, secrets)
    databaseStarted = true
    await waitDatabase(config, secrets)
    await verifyMigration(config, secrets)
    doctor(config, secrets)
    api = spawn(process.execPath, [resolve(ROOT, 'dist/main.js')], { cwd: ROOT, env: runtimeEnvironment(config, secrets), stdio: ['ignore', 'inherit', 'inherit'] })
    api.once('error', () => void cleanup().catch(() => undefined))
    let ready = false
    for (let attempt = 0; attempt < 50; attempt++) {
      if (api.exitCode !== null || api.signalCode !== null) fail('API exited before readiness. Run local:doctor to check environment, database and identity configuration.')
      try {
        const response = await fetch('http://127.0.0.1:' + config.apiPort + PROJECT.resources[0], { signal: AbortSignal.timeout(500) })
        await response.body?.cancel()
        if (response.status === 401) { ready = true; break }
      } catch { /* The child may still be bootstrapping. */ }
      await new Promise((done) => setTimeout(done, 100))
    }
    if (!ready) fail('API readiness timed out. No authenticated request was made.')
    if (PROJECT.browserClient) {
      const { startWeb } = await import('./local-web.mjs')
      web = await startWeb(config)
      console.log('Open http://127.0.0.1:' + config.webPort + loginPath())
    } else console.log('API ready at http://127.0.0.1:' + config.apiPort + '; this export has no browser OIDC client.')
    const token = randomBytes(32).toString('hex')
    control = controlServer((request, response) => {
      const received = request.headers.authorization ?? ''
      const expected = 'Bearer ' + token
      if (request.method !== 'POST' || request.url !== '/stop' || Buffer.byteLength(received) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) { response.writeHead(404).end(); return }
      response.writeHead(200).end('Stopping')
      void cleanup().catch(() => { process.exitCode = 1 })
    })
    await new Promise((done, reject) => { control.once('error', reject); control.listen(0, '127.0.0.1', done) })
    privateWrite(runningPath, JSON.stringify({ version: 1, port: control.address().port, token }) + '\n')
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void cleanup().catch(() => { process.exitCode = 1 }))
    api.once('exit', () => { if (!closing) { process.exitCode = 1; void cleanup().catch(() => undefined) } })
    console.log('Press Ctrl+C or run local:down to stop. Data stays in the dedicated PostgreSQL volume.')
  } catch (error) { await cleanup(); throw error }
}
async function main() {
  const [action, ...args] = process.argv.slice(2)
  if (action === 'configure') return configure(args)
  if (!['setup', 'up', 'down', 'doctor'].includes(action)) fail('Use local:configure, local:setup, local:up, local:down or local:doctor.')
  const config = loadConfig()
  if (action === 'setup') return setup(config, args)
  if (args.length) fail('Unexpected local command arguments.')
  const secrets = loadSecrets()
  if (action === 'doctor') return doctor(config, secrets)
  if (action === 'down') return down(config, secrets)
  return up(config, secrets)
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Local command failed.'); process.exitCode = 1 })
`

export const WEB_SOURCE = String.raw`import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FRONTEND, PROJECT, loginPath } from './local-config.mjs'

export async function startWeb(config) {
  // Use only the installed export dependency. This command never installs or downloads anything.
  const { preview } = await import(pathToFileURL(resolve(FRONTEND, 'node_modules/vite/dist/node/index.js')).href)
  const base = PROJECT.browserClient.apiBasePath
  const login = loginPath()
  const prefix = '^' + base.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&') + '(?:/|$)'
  return preview({ root: FRONTEND, configFile: false, appType: 'spa',
    plugins: [{ name: 'openpencil-local-entry', configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (['GET', 'HEAD'].includes(request.method) && request.url?.split('?', 1)[0] === '/') {
          response.writeHead(302, { location: login, 'cache-control': 'no-store' }).end()
          return
        }
        next()
      })
    } }],
    preview: { host: '127.0.0.1', port: config.webPort, strictPort: true, open: false,
      proxy: { [prefix]: { target: 'http://127.0.0.1:' + config.apiPort, changeOrigin: false,
        rewrite: (path) => path.slice(base.length) || '/' } } } })
}
`
