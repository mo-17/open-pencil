/** Shared by exported local:doctor and the desktop read-only diagnostic worker. */
export const DOCTOR_CHECKS_SOURCE = String.raw`import { lstatSync, readFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { createServer } from 'node:net'
import { spawnSync } from 'node:child_process'

export async function verifyDoctorDatabase(databaseClient, config, secrets) {
  const client = await databaseClient(config, secrets)
  try {
    await client.connect()
    const result = await client.query('SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user')
    if (!result.rows[0] || Object.values(result.rows[0]).some(Boolean)) throw new Error('Runtime role privileges')
    await client.query('SELECT 1')
  } finally { await client.end().catch(() => undefined) }
}

export async function runDoctorChecks(config, options = {}) {
  const results = []
  const check = async (code, task, available = true) => {
    let status = 'unavailable'
    if (available) {
      try { await task(); status = 'passed' }
      catch (error) {
        const cause = error?.cause?.code ?? error?.code
        status = ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(cause) ? 'tls' : cause === 'ENOENT' ? 'missing' : 'failed'
      }
    }
    const result = { code, status }
    results.push(result)
    options.report?.(result)
  }
  const fail = () => { throw new Error('Diagnostic failed') }
  const tool = (command, args) => {
    const result = spawnSync(command, args, { stdio: 'ignore', timeout: 5000 })
    if (result.error) throw result.error
    if (result.status !== 0) fail()
  }
  const port = (value) => new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(value, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()))
  })
  const boundedJSON = async (url) => {
    const signal = AbortSignal.timeout(5000)
    const response = await (options.fetch ?? fetch)(url, { redirect: 'manual', signal })
    if (response.status !== 200 || !response.body) { await response.body?.cancel(); fail() }
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.length
        if (size > 65536) fail()
        chunks.push(chunk.value)
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  await check('ca-file', () => {
    if (!config.caFile) return
    const info = lstatSync(config.caFile)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 262144) fail()
    const source = readFileSync(config.caFile, 'utf8')
    const blocks = source.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
    if (!blocks?.length || /PRIVATE KEY/.test(source)) fail()
    for (const block of blocks) {
      const certificate = new X509Certificate(block)
      if (!certificate.ca || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) fail()
    }
  })
  await check('node-runtime', () => { const [major, minor] = (options.nodeVersion ?? process.versions.node).split('.').map(Number); if (major < 22 || (major === 22 && minor < 12)) fail() })
  await check('npm-runtime', () => (options.tool ?? tool)('npm', ['--version']))
  await check('docker-runtime', () => (options.tool ?? tool)('docker', ['info', '--format', '{{.ServerVersion}}']))
  await check('api-port', () => (options.port ?? port)(config.apiPort), !options.running)
  await check('preview-port', () => (options.port ?? port)(config.webPort), !options.running)
  await check('database', options.database, typeof options.database === 'function')
  await check('migration', options.migration, typeof options.migration === 'function')
  await check('oidc-discovery', async () => {
    const metadata = await boundedJSON(config.issuer.replace(/\/$/, '') + '/.well-known/openid-configuration')
    if (metadata.issuer !== config.issuer || !metadata.code_challenge_methods_supported?.includes('S256')) fail()
  })
  await check('jwks', async () => {
    const keys = await boundedJSON(config.jwksURL)
    if (!Array.isArray(keys.keys) || !keys.keys.length || keys.keys.length > 16 ||
        keys.keys.some((key) => !key || typeof key !== 'object' || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((field) => Object.hasOwn(key, field)))) fail()
  })
  return results
}
`
