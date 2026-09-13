export const DATABASE_SOURCE = String.raw`import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, LOCAL, IMAGE, command, fail } from './local-config.mjs'
import { initializeManagedReceipt, grantManagedTables } from './managed/database.mjs'

function inspect(kind, name) {
  const result = spawnSync('docker', [kind, 'inspect', name], { encoding: 'utf8', timeout: 15000 })
  if (result.status !== 0) return undefined
  return JSON.parse(result.stdout)[0]
}
export function verifyContainer(config, secrets) {
  const container = inspect('container', secrets.container)
  if (!container) return undefined
  const bindings = container.HostConfig?.PortBindings?.['5432/tcp']
  const volume = container.Mounts?.find((entry) => entry.Destination === '/var/lib/postgresql/data')
  if (container.Config?.Labels?.['openpencil.local-owner'] !== secrets.container ||
      container.Config?.Image !== IMAGE || bindings?.length !== 1 || bindings[0].HostIp !== '127.0.0.1' ||
      bindings[0].HostPort !== String(config.dbPort) || volume?.Name !== secrets.volume) fail('Database container identity or loopback binding does not match this export. No container was changed.')
  return container
}
export function startDatabase(config, secrets, setup = false) {
  command('docker', ['info', '--format', '{{.ServerVersion}}'])
  if (!inspect('image', IMAGE)) {
    if (!setup) fail('PostgreSQL 16 image is missing. Run local:setup explicitly to download it.')
    console.log('Downloading the PostgreSQL 16 image for this explicit setup command...')
    command('docker', ['pull', IMAGE], { stdio: 'inherit', timeout: 600000 })
  }
  const container = verifyContainer(config, secrets)
  if (container) {
    if (!container.State.Running) command('docker', ['start', secrets.container])
    return
  }
  const volume = inspect('volume', secrets.volume)
  if (!setup && !volume) fail('Database volume is missing. Startup cannot initialize a replacement database; restore your backup or run setup explicitly.')
  if (volume && volume.Labels?.['openpencil.local-owner'] !== secrets.container) fail('Database volume ownership does not match. Existing data was preserved.')
  if (!volume) command('docker', ['volume', 'create', '--label', 'openpencil.local-owner=' + secrets.container, secrets.volume])
  command('docker', ['run', '--detach', '--pull=never', '--name', secrets.container,
    '--label', 'openpencil.local-owner=' + secrets.container, '--publish', '127.0.0.1:' + config.dbPort + ':5432',
    '--memory', '512m', '--cpus', '1', '--mount', 'type=volume,source=' + secrets.volume + ',target=/var/lib/postgresql/data',
    '--mount', 'type=bind,source=' + resolve(LOCAL, 'postgres-password') + ',target=/run/secrets/postgres-password,readonly',
    '--env', 'POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password', '--env', 'POSTGRES_USER=openpencil_admin',
    '--env', 'POSTGRES_DB=openpencil', IMAGE])
}
export function stopDatabase(config, secrets) {
  const container = verifyContainer(config, secrets)
  if (container?.State.Running) command('docker', ['stop', '--time', '10', secrets.container])
}
export async function databaseClient(config, secrets, admin = false) {
  const { Client } = await import('pg')
  return new Client({ host: '127.0.0.1', port: config.dbPort, database: 'openpencil',
    user: admin ? 'openpencil_admin' : 'openpencil_runtime', password: admin ? secrets.admin : secrets.runtime,
    ssl: false, connectionTimeoutMillis: 1500, statement_timeout: 10000, query_timeout: 12000 })
}
export async function waitDatabase(config, secrets) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const client = await databaseClient(config, secrets, true)
    try { await client.connect(); await client.query('SELECT 1'); return } catch {
      if (attempt === 39) fail('PostgreSQL did not become ready. Check Docker and the database port; credentials were not printed.')
    } finally { await client.end().catch(() => undefined) }
    await new Promise((done) => setTimeout(done, 500))
  }
}
export function migration() {
  const sql = readFileSync(resolve(ROOT, 'migrations/001-initial.sql'), 'utf8')
  if (!sql.includes('\nBEGIN;\n') || !sql.endsWith('\nCOMMIT;\n')) fail('Initial migration boundaries changed; review and apply manually.')
  return { sql, digest: createHash('sha256').update(sql).digest('hex') }
}
export async function verifyMigration(config, secrets) {
  const client = await databaseClient(config, secrets, true)
  try {
    await client.connect()
    const result = await client.query('SELECT digest FROM openpencil_local.initial_schema WHERE id = 1')
    if (result.rows[0]?.digest !== migration().digest) fail('Initial schema differs from the applied schema. Export changes require a reviewed incremental migration; no SQL was replayed.')
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Initial schema')) throw error
    fail('Initial schema is not recorded. Run local:setup only for a new database; restore existing data rather than replaying SQL.')
  } finally { await client.end().catch(() => undefined) }
}
export async function initializeDatabase(config, secrets, managedApplicationDigest, managedPlanId, managedSchema) {
  const client = await databaseClient(config, secrets, true)
  try {
    await client.connect()
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(1869636974, 1)")
    const existing = await client.query("SELECT to_regclass('openpencil_local.initial_schema') AS name")
    const initial = migration()
    if (existing.rows[0].name) {
      const recorded = await client.query('SELECT digest FROM openpencil_local.initial_schema WHERE id = 1')
      if (recorded.rows[0]?.digest !== initial.digest) fail('Initial schema differs from the applied schema. No migration was replayed; write and review an incremental migration.')
      if (managedApplicationDigest) await initializeManagedReceipt(client, managedApplicationDigest, false, managedPlanId, managedSchema)
      await client.query('COMMIT')
      return
    }
    const tables = await client.query("SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public' LIMIT 1")
    const roles = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'openpencil_runtime'")
    if (tables.rowCount || roles.rowCount) fail('Existing tables or runtime role found without a migration receipt. Setup refuses to adopt or overwrite existing data.')
    // All DDL and its receipt commit together. A failed setup never leaves a half-applied schema.
    await client.query(initial.sql.replace('\nBEGIN;\n', '\n').replace(/\nCOMMIT;\n$/, '\n'))
    await client.query("CREATE ROLE openpencil_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '" + secrets.runtime + "'")
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
    await client.query('GRANT CONNECT ON DATABASE openpencil TO openpencil_runtime')
    await client.query('GRANT USAGE ON SCHEMA public TO openpencil_runtime')
    if (managedApplicationDigest) await grantManagedTables(client, managedSchema)
    else await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openpencil_runtime')
    await client.query('CREATE SCHEMA openpencil_local')
    await client.query('REVOKE ALL ON SCHEMA openpencil_local FROM PUBLIC')
    await client.query('CREATE TABLE openpencil_local.initial_schema (id integer PRIMARY KEY CHECK (id = 1), digest text NOT NULL)')
    await client.query('INSERT INTO openpencil_local.initial_schema (id, digest) VALUES (1, $1)', [initial.digest])
    if (managedApplicationDigest) await initializeManagedReceipt(client, managedApplicationDigest, true, managedPlanId, managedSchema)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof Error && /^(Existing tables|Initial schema|Initial migration)/.test(error.message)) throw error
    fail('Database initialization failed and rolled back. Review the initial SQL and existing database; credentials were not printed.')
  } finally { await client.end().catch(() => undefined) }
}
`
