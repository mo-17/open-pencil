export const DOCTOR_SOURCE = String.raw`import { loadConfig, loadSecrets, PROJECT, fail } from './local-config.mjs'
import { databaseClient, verifyMigration } from './local-database.mjs'

async function boundedJSON(url) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  if (response.status !== 200 || !response.body) { await response.body?.cancel(); fail('Expected a direct HTTP 200 JSON response.') }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > 65536) fail('Identity metadata exceeds the 64 KiB limit.')
      chunks.push(chunk.value)
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
async function doctor() {
  const config = loadConfig()
  const secrets = loadSecrets()
  const problems = []
  const check = async (name, task, hint) => {
    try { await task(); console.log('[OK] ' + name) }
    catch { problems.push(name); console.error('[FAIL] ' + name + ': ' + hint) }
  }
  await check('Database runtime role', async () => {
    const client = await databaseClient(config, secrets)
    try {
      await client.connect()
      const result = await client.query('SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user')
      if (!result.rows[0] || Object.values(result.rows[0]).some(Boolean)) fail('Runtime database role has excessive privileges.')
      await client.query('SELECT 1')
    } finally { await client.end().catch(() => undefined) }
  }, 'Start this export database, check the configured loopback port and preserved .local credentials; the API must use the restricted runtime role.')
  await check('Applied initial schema', () => verifyMigration(config, secrets), 'Missing or changed migration receipt. Initial SQL is applied only by explicit setup to a fresh database; existing data requires reviewed incremental migrations.')
  await check('OIDC issuer discovery', async () => {
    const metadata = await boundedJSON(config.issuer.replace(/\/$/, '') + '/.well-known/openid-configuration')
    if (metadata.issuer !== config.issuer || !metadata.code_challenge_methods_supported?.includes('S256')) fail('Issuer or PKCE metadata mismatch.')
  }, 'Start the identity service, verify the exact issuer URL and S256 PKCE support. A local HTTPS issuer requires the trusted CA configured with --ca.')
  await check('Verified HTTPS JWKS', async () => {
    const keys = await boundedJSON(config.jwksURL)
    if (!Array.isArray(keys.keys) || !keys.keys.length || keys.keys.length > 16 ||
        keys.keys.some((key) => !key || typeof key !== 'object' || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((field) => Object.hasOwn(key, field)))) fail('Invalid public JWKS.')
  }, 'JWKS must return public keys directly over HTTPS. Check the JWKS port, hostname certificate and trusted PEM CA path; never disable TLS verification.')
  const browser = PROJECT.browserClient?.authentication
  console.log('[MANUAL] Access tokens must have issuer ' + config.issuer + ', audience ' + config.audience + ' and a UUID sub. A discovery/JWKS check does not prove audience or account isolation.')
  if (browser) console.log('[MANUAL] Register public client ' + browser.clientId + ' with callback http://127.0.0.1:' + config.webPort + browser.callbackPath + ' and browser CORS. Never configure a browser client secret.')
  if (problems.length) process.exitCode = 1
}
doctor().catch(() => { console.error('Local diagnostics could not load the configuration or dependencies. Run local:configure and local:setup first.'); process.exitCode = 1 })
`
