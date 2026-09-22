export const DOCTOR_SOURCE = String.raw`import { loadConfig, loadSecrets, PROJECT } from './local-config.mjs'
import { databaseClient, verifyMigration } from './local-database.mjs'
import { runDoctorChecks, verifyDoctorDatabase } from './local-doctor-checks.mjs'

async function doctor() {
  const config = loadConfig()
  const secrets = loadSecrets()
  const results = await runDoctorChecks(config, {
    database: () => verifyDoctorDatabase(databaseClient, config, secrets),
    migration: () => verifyMigration(config, secrets),
    report: ({ code, status }) => console.log('[' + status.toUpperCase() + '] ' + code),
  })
  const browser = PROJECT.browserClient?.authentication
  console.log('[MANUAL] Access tokens must have issuer ' + config.issuer + ', audience ' + config.audience + ' and a UUID sub. A discovery/JWKS check does not prove audience or account isolation.')
  if (browser) console.log('[MANUAL] Register public client ' + browser.clientId + ' with callback http://127.0.0.1:' + config.webPort + browser.callbackPath + ' and browser CORS. Never configure a browser client secret.')
  if (results.some(({ status }) => status !== 'passed' && status !== 'unavailable')) process.exitCode = 1
}
doctor().catch(() => { console.error('Local diagnostics could not load the configuration or dependencies. Run local:configure and local:setup first.'); process.exitCode = 1 })
`
