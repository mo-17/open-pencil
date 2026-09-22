import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { DOCTOR_CHECKS_SOURCE } from '../backend/nestjs/local-run/doctor-checks'
import { nestJSPreviewApplicationDigest } from '../backend/nestjs/preview-digest'
import type { ManagedPreviewDirectory } from './directory'
import type { ManagedSnapshot } from './plan'
import { parseManagedPreviewEvent, type ManagedPreviewDiagnostic } from './protocol'

/** No shell, installation, service startup or SQL mutation. Only fixed check results leave Node. */
const WORKER_SOURCE =
  DOCTOR_CHECKS_SOURCE +
  String.raw`
let input = ''
for await (const chunk of process.stdin) { input += chunk; if (input.length > 16384) throw new Error('Input limit') }
const { config, existing, running } = JSON.parse(input)
const options = { running, report: (diagnostic) => process.stdout.write(JSON.stringify(diagnostic) + '\n') }
if (existing) {
  options.database = async () => {
    const { loadSecrets } = await import(existing.config)
    const { databaseClient } = await import(existing.database)
    await verifyDoctorDatabase(databaseClient, config, loadSecrets())
  }
  options.migration = async () => {
    const { loadSecrets } = await import(existing.config)
    const { verifyMigration } = await import(existing.database)
    await verifyMigration(config, loadSecrets())
  }
}
await runDoctorChecks(config, options)
`

export async function diagnoseManagedPreview(
  directory: ManagedPreviewDirectory,
  snapshot: ManagedSnapshot,
  initialized: boolean,
  running: boolean,
  signal: AbortSignal,
  report: (item: ManagedPreviewDiagnostic) => void
): Promise<void> {
  signal.throwIfAborted()
  const authentication = snapshot.application.httpApi?.browserClient?.authentication
  if (!authentication) throw new Error('Managed preview requires document sign-in settings.')
  const generation = nestJSPreviewApplicationDigest(snapshot.application)
  const configurationPath = directory.path(`generations/${generation}/scripts/local-config.mjs`)
  const databasePath = directory.path(`generations/${generation}/scripts/local-database.mjs`)
  const existing =
    initialized && existsSync(configurationPath) && existsSync(databasePath)
      ? {
          config: pathToFileURL(configurationPath).href,
          database: pathToFileURL(databasePath).href
        }
      : null
  const env: NodeJS.ProcessEnv = {}
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'SystemRoot',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_CONFIG'
  ])
    if (process.env[key] !== undefined) env[key] = process.env[key]
  if (snapshot.config.caFile) env.NODE_EXTRA_CA_CERTS = snapshot.config.caFile
  const child = spawn('node', ['--input-type=module', '-e', WORKER_SOURCE], {
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.resume()
  let buffer = ''
  let bytes = 0
  const protocol = { invalid: false }
  const abort = () => {
    child.kill('SIGTERM')
  }
  signal.addEventListener('abort', abort, { once: true })
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    bytes += Buffer.byteLength(chunk)
    if (bytes > 8192) {
      protocol.invalid = true
      abort()
      return
    }
    buffer += chunk
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      try {
        const event = parseManagedPreviewEvent({
          version: 1,
          type: 'diagnostic',
          id: 'check',
          diagnostic: JSON.parse(line)
        })
        if (event.type === 'diagnostic' && !signal.aborted) report(event.diagnostic)
      } catch {
        protocol.invalid = true
        abort()
      }
    }
  })
  const timeout = setTimeout(abort, 45000)
  try {
    const completion = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(
      JSON.stringify({
        config: {
          ...snapshot.config,
          webPort: snapshot.config.previewPort,
          issuer: authentication.issuer
        },
        existing,
        running
      })
    )
    try {
      const code = await completion
      signal.throwIfAborted()
      if (code !== 0 || protocol.invalid || buffer) throw new Error('Invalid diagnostic result')
    } catch {
      signal.throwIfAborted()
      report({ code: 'node-runtime', status: 'failed' })
    }
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}
