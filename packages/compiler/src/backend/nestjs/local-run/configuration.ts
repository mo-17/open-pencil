export const CONFIGURATION_SOURCE = String.raw`import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const FRONTEND = resolve(ROOT, '../..')
export const LOCAL = resolve(ROOT, '.local')
export const PROJECT = JSON.parse(readFileSync(resolve(ROOT, 'local-project.json'), 'utf8'))
export const IMAGE = 'postgres:16-alpine'
export function fail(message) { throw new Error(message) }
export function json(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch { fail('Local state file could not be read or parsed. Restore its valid private backup; file contents are never printed.') }
}
export function privateWrite(path, value) {
  writeFileSync(path, value, { mode: 0o600, flag: 'wx' })
}
export function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout: 120000, ...options })
  if (result.status !== 0) fail(executable + ' failed. Check installation, permissions, available ports and Docker Desktop. No credentials are printed.')
  return result.stdout?.trim() ?? ''
}
function port(value, fallback) {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) fail('Ports must be integers between 1024 and 65535.')
  return parsed
}
export function configure(args) {
  if (existsSync(resolve(LOCAL, 'config.json'))) fail('Local configuration already exists; edit .local/config.json explicitly. Existing credentials and data are preserved.')
  const flags = new Map()
  const allowed = ['--local-keycloak', '--issuer', '--audience', '--jwks-url', '--ca', '--web-port', '--api-port', '--db-port']
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    if (!allowed.includes(key) || flags.has(key)) fail('Unknown or repeated configure option.')
    const value = key === '--local-keycloak' ? true : args[++index]
    if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) fail('Missing configure option value.')
    flags.set(key, value)
  }
  const localKeycloak = flags.has('--local-keycloak')
  const browser = PROJECT.browserClient?.authentication
  const issuer = flags.get('--issuer') ?? (localKeycloak ? 'http://127.0.0.1:18080/realms/openpencil' : browser?.issuer)
  const audience = flags.get('--audience') ?? (localKeycloak ? 'openpencil-notes-api' : browser?.resource)
  const jwksURL = flags.get('--jwks-url') ?? (localKeycloak ? 'https://127.0.0.1:18443/realms/openpencil/protocol/openid-connect/certs' : undefined)
  if (!issuer || !audience || !jwksURL) fail('Provide --issuer, --audience and --jwks-url, or explicitly select --local-keycloak.')
  const config = { version: 1, issuer, audience, jwksURL, caFile: flags.has('--ca') ? resolve(String(flags.get('--ca'))) : '',
    webPort: port(flags.get('--web-port'), 5173), apiPort: port(flags.get('--api-port'), 3000), dbPort: port(flags.get('--db-port'), 55432) }
  validateConfig(config)
  mkdirSync(LOCAL, { mode: 0o700, recursive: true })
  privateWrite(resolve(LOCAL, 'config.json'), JSON.stringify(config, null, 2) + '\n')
  console.log('Saved local configuration. Review migrations/001-initial.sql, then run npm run local:setup -- --accept-initial-schema.')
}
export function validateConfig(config) {
  if (config?.version !== 1) fail('Invalid .local/config.json version.')
  for (const key of ['issuer', 'audience', 'jwksURL', 'caFile']) {
    const value = config[key]
    if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail('Invalid local ' + key + ' setting.')
  }
  if (!config.audience) fail('JWT audience must be nonempty and match the access token aud claim.')
  for (const key of ['issuer', 'jwksURL']) {
    let url
    try { url = new URL(config[key]) } catch { fail('Invalid ' + key + ' URL.') }
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if (url.username || url.password || url.hash || url.search ||
        (url.protocol !== 'https:' && !(key === 'issuer' && local && url.protocol === 'http:'))) fail(key + ' requires HTTPS; only a loopback issuer may use HTTP. JWKS always requires verified HTTPS.')
  }
  const browser = PROJECT.browserClient?.authentication
  if (browser && config.issuer !== browser.issuer) fail('JWT issuer differs from the exported browser issuer. Update the document OIDC settings and export again.')
  if (config.caFile && (!existsSync(config.caFile) || !statSync(config.caFile).isFile())) fail('CA file is missing. Pass the trusted PEM certificate path with --ca; TLS verification is never disabled.')
  const ports = ['webPort', 'apiPort', 'dbPort'].map((key) => {
    if (typeof config[key] !== 'number') fail('Local ports must be JSON numbers, not strings.')
    return port(config[key])
  })
  if (new Set(ports).size !== 3) fail('Frontend, API and database ports must differ.')
}
export function loadConfig() {
  if (!existsSync(resolve(LOCAL, 'config.json'))) fail('Run npm run local:configure first.')
  const config = json(resolve(LOCAL, 'config.json'))
  validateConfig(config)
  return config
}
export function loginPath() {
  const path = resolve(FRONTEND, 'openpencil-local-app.json')
  if (!existsSync(path) || statSync(path).size > 4096) fail('Exported frontend login metadata is missing or oversized. Export the frontend and backend together again.')
  const value = json(path)
  if (value?.version !== 1 || Object.keys(value).sort().join(',') !== 'loginPath,version' ||
      typeof value.loginPath !== 'string' || value.loginPath.length > 512 || value.loginPath.length < 2 ||
      !value.loginPath.startsWith('/') || value.loginPath.startsWith('//') || /[?%#\\\u0000-\u0020\u007f]/.test(value.loginPath)) fail('Exported frontend login path is invalid.')
  const parsed = new URL(value.loginPath, 'http://127.0.0.1')
  if (parsed.origin !== 'http://127.0.0.1' || parsed.pathname !== value.loginPath) fail('Exported frontend login path must be canonical and local.')
  return value.loginPath
}
export function loadSecrets(create = false) {
  const path = resolve(LOCAL, 'credentials.json')
  if (!existsSync(path)) {
    if (!create) fail('Run local:setup first. No database credentials have been created.')
    const suffix = randomBytes(8).toString('hex')
    const value = { version: 1, container: 'openpencil-notes-' + suffix, volume: 'openpencil-notes-data-' + suffix,
      admin: randomBytes(32).toString('hex'), runtime: randomBytes(32).toString('hex') }
    privateWrite(path, JSON.stringify(value, null, 2) + '\n')
  }
  const value = json(path)
  if (value.version !== 1 || !/^openpencil-notes-[a-f0-9]{16}$/.test(value.container) ||
      !/^openpencil-notes-data-[a-f0-9]{16}$/.test(value.volume) || !/^[a-f0-9]{64}$/.test(value.admin) || !/^[a-f0-9]{64}$/.test(value.runtime)) fail('Invalid local credential record; original data was preserved.')
  const passwordFile = resolve(LOCAL, 'postgres-password')
  if (!existsSync(passwordFile)) {
    if (!create) fail('Local database password file is missing. Restore it from your private backup or rerun setup explicitly.')
    privateWrite(passwordFile, value.admin + '\n')
  }
  else if (readFileSync(passwordFile, 'utf8') !== value.admin + '\n') fail('Local database password files disagree; original data was preserved.')
  return value
}
export function runtimeEnvironment(config, secrets) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('Remove NODE_TLS_REJECT_UNAUTHORIZED=0. TLS verification cannot be disabled.')
  const auth = PROJECT.authentication
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(config.apiPort), OPENPENCIL_LOCAL_PREVIEW: '1',
    DATABASE_URL: 'postgresql://openpencil_runtime:' + secrets.runtime + '@127.0.0.1:' + config.dbPort + '/openpencil',
    [auth.issuerEnvironment]: config.issuer, [auth.audienceEnvironment]: config.audience, [auth.jwksUrlEnvironment]: config.jwksURL }
  delete env.NODE_EXTRA_CA_CERTS
  if (config.caFile) env.NODE_EXTRA_CA_CERTS = config.caFile
  return env
}
`

/** The managed compiler chooses this fixed layout; no caller-provided path or env override exists. */
export const MANAGED_CONFIGURATION_SOURCE = CONFIGURATION_SOURCE.replace(
  "export const LOCAL = resolve(ROOT, '.local')",
  "export const LOCAL = resolve(ROOT, '../..', '.local')"
)
