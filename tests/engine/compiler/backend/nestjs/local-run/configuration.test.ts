import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { localExport, runLocal } from './helpers'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
function fixture() {
  const result = localExport()
  roots.push(result.root)
  return result
}

describe('exported local runner configuration', () => {
  test('all emitted commands parse under Node and carry the runnable guide', () => {
    const { root, output } = fixture()
    for (const [path] of output.files) {
      if (!path.startsWith('backend/nestjs/scripts/') || !path.endsWith('.mjs')) continue
      const result = spawnSync('node', ['--check', join(root, path)], { encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
    }
    expect(output.files.get('backend/nestjs/LOCAL-RUN.md')).toContain('--accept-initial-schema')
    expect(output.files.get('backend/nestjs/.gitignore')).toContain('.local/')
  })

  test('configuration is explicit, private and cannot overwrite existing settings', () => {
    const { backend } = fixture()
    expect(runLocal(backend, 'configure').status).toBe(1)
    expect(existsSync(join(backend, '.local'))).toBe(false)
    const accepted = runLocal(backend, 'configure', '--local-keycloak')
    expect(accepted.status, accepted.stderr).toBe(0)
    const configPath = join(backend, '.local/config.json')
    const original = readFileSync(configPath, 'utf8')
    expect(JSON.parse(original)).toMatchObject({
      issuer: 'http://127.0.0.1:18080/realms/openpencil',
      audience: 'openpencil-notes-api',
      webPort: 5173,
      apiPort: 3000,
      dbPort: 55432
    })
    expect(statSync(join(backend, '.local')).mode & 0o777).toBe(0o700)
    expect(statSync(configPath).mode & 0o777).toBe(0o600)
    expect(runLocal(backend, 'configure', '--local-keycloak').status).toBe(1)
    expect(readFileSync(configPath, 'utf8')).toBe(original)
    expect(runLocal(backend, 'setup').stderr).toContain('--accept-initial-schema')
    expect(existsSync(join(backend, '.local/credentials.json'))).toBe(false)
    expect(existsSync(join(backend, 'node_modules'))).toBe(false)
  })

  test.each([
    ['plaintext JWKS', ['--jwks-url', 'http://127.0.0.1:18443/certs']],
    ['changed browser issuer', ['--issuer', 'https://other.example']],
    ['missing CA', ['--ca', '/nonexistent/openpencil-ca.pem']],
    ['duplicate ports', ['--api-port', '5173']],
    ['unknown flag', ['--unsafe']],
    ['repeated flag', ['--api-port', '3001', '--api-port', '3002']]
  ])('rejects %s before writing configuration', (_name, flags) => {
    const { backend } = fixture()
    expect(runLocal(backend, 'configure', '--local-keycloak', ...flags).status).toBe(1)
    expect(existsSync(join(backend, '.local/config.json'))).toBe(false)
  })

  test('runtime credentials are random per export and stable on later reads', async () => {
    const first = fixture()
    const second = fixture()
    for (const { backend } of [first, second]) {
      expect(runLocal(backend, 'configure', '--local-keycloak').status).toBe(0)
    }
    const load = async (backend: string) => {
      const config = await import(pathToFileURL(join(backend, 'scripts/local-config.mjs')).href)
      return config.loadSecrets(true)
    }
    const one = await load(first.backend)
    const two = await load(second.backend)
    expect(one).toEqual(await load(first.backend))
    expect(one.runtime).not.toBe(one.admin)
    expect(one.runtime).not.toBe(two.runtime)
    expect(one.volume).not.toBe(two.volume)
    expect(statSync(join(first.backend, '.local/credentials.json')).mode & 0o777).toBe(0o600)
    expect(statSync(join(first.backend, '.local/postgres-password')).mode & 0o777).toBe(0o600)
    const rejected = runLocal(first.backend, 'up')
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain('startup never installs dependencies')
    expect(existsSync(join(first.backend, '.local/up.lock'))).toBe(false)
  })

  test('diagnostics never recreate missing private files and unsafe TLS cannot launch', async () => {
    const { backend } = fixture()
    expect(runLocal(backend, 'configure', '--local-keycloak').status).toBe(0)
    const module = await import(pathToFileURL(join(backend, 'scripts/local-config.mjs')).href)
    const secrets = module.loadSecrets(true)
    const config = module.loadConfig()
    const environment = module.runtimeEnvironment(config, secrets)
    expect(environment.DATABASE_URL).toContain('openpencil_runtime:')
    expect(environment.DATABASE_URL).not.toContain(secrets.admin)
    rmSync(join(backend, '.local/postgres-password'))
    expect(() => module.loadSecrets()).toThrow('password file is missing')
    expect(existsSync(join(backend, '.local/postgres-password'))).toBe(false)
    writeFileSync(join(backend, '.local/postgres-password'), secrets.admin + '\n', { mode: 0o600 })
    const result = spawnSync('node', ['scripts/local.mjs', 'doctor'], {
      cwd: backend,
      encoding: 'utf8',
      env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('TLS verification cannot be disabled')
    expect(result.stderr).not.toContain(secrets.runtime)
  })

  test('corrupt private JSON errors never expose credential fragments', () => {
    const { backend } = fixture()
    expect(runLocal(backend, 'configure', '--local-keycloak').status).toBe(0)
    const canary = 'privateCanaryDoNotPrint9876543210'
    writeFileSync(join(backend, '.local/credentials.json'), '{"admin":' + canary + '}', {
      mode: 0o600
    })
    const result = runLocal(backend, 'doctor')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('file contents are never printed')
    expect(result.stderr).not.toContain(canary.slice(0, 10))
  })

  test('local login redirects reject nonlocal, encoded or noncanonical paths', async () => {
    const { backend, root } = fixture()
    const module = await import(pathToFileURL(join(backend, 'scripts/local-config.mjs')).href)
    for (const loginPath of [
      '//evil.example',
      '/login?next=x',
      '/login#x',
      '/%2fescape',
      '/a/../login',
      '/a\\b',
      '/'
    ]) {
      writeFileSync(
        join(root, 'openpencil-local-app.json'),
        JSON.stringify({ version: 1, loginPath })
      )
      expect(() => module.loginPath()).toThrow()
    }
    writeFileSync(
      join(root, 'openpencil-local-app.json'),
      JSON.stringify({ version: 1, loginPath: '/login-2' })
    )
    expect(module.loginPath()).toBe('/login-2')
  })
})
