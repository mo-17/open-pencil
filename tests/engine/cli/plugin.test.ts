import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  PLUGIN_CATALOG_FORMAT,
  PLUGIN_CATALOG_SCHEMA_VERSION,
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_LIMITS,
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  parsePluginManifest,
  parseVersionedPluginManifest,
  type PluginCatalogPayloadV1,
  type PluginManifestPayloadV1
} from '@open-pencil/core/plugins'

import { runOpenPencilCLI } from '#tests/helpers/cli'
import { cliSourcePath } from '#tests/helpers/paths'

import { pluginPayloadV2 } from '../plugins/helpers'

const temporaryDirectories: string[] = []

function payload(): PluginManifestPayloadV1 {
  return {
    format: PLUGIN_MANIFEST_FORMAT,
    schemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
    plugin: { id: 'example.chart', name: 'Example Chart', version: '1.2.3' },
    publisher: { id: 'example', name: 'Example Publisher', keyId: 'example-key-1' },
    engineRange: '>=0.13.0 <1.0.0',
    capabilities: [],
    contributions: {
      modules: [
        {
          moduleType: 'chart',
          name: 'Chart',
          description: 'A declarative chart module',
          adapterId: 'example.chart',
          configVersion: 1,
          defaultSize: { width: 360, height: 240 },
          defaultConfig: {
            chartType: 'bar',
            values: [12, 24],
            labels: ['First', 'Second'],
            color: '#3366FF',
            showValues: true
          },
          fields: [
            {
              path: ['color'],
              kind: 'color',
              label: 'Color'
            }
          ]
        }
      ]
    }
  }
}

function catalogPayload(): PluginCatalogPayloadV1 {
  return {
    format: PLUGIN_CATALOG_FORMAT,
    schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
    catalogId: 'official',
    version: '1.0.0',
    generatedAt: '2026-08-05T00:00:00.000Z',
    expiresAt: '2026-08-15T00:00:00.000Z',
    entries: [
      {
        pluginId: 'example.chart',
        version: '1.2.3',
        digest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        manifestUrl: 'https://plugins.invalid/example.chart/1.2.3.json',
        publisherId: 'example',
        keyId: 'example-key-1'
      }
    ]
  }
}

function pem(label: string, buffer: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  const encoded =
    btoa(binary)
      .match(/.{1,64}/g)
      ?.join('\n') ?? ''
  return `-----BEGIN ${label}-----\n${encoded}\n-----END ${label}-----\n`
}

async function writeKeys(directory: string): Promise<{
  privateKey: string
  privatePem: string
  publicKey: string
  publicPem: string
}> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const privatePem = pem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const publicPem = pem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey))
  const privateKey = join(directory, 'private.pem')
  const publicKey = join(directory, 'public.pem')
  await Bun.write(privateKey, privatePem)
  await Bun.write(publicKey, publicPem)
  return { privateKey, privatePem, publicKey, publicPem }
}

async function fixture(): Promise<{
  directory: string
  payloadPath: string
  manifestPath: string
  privateKey: string
  privatePem: string
  publicKey: string
  publicPem: string
}> {
  const directory = join(tmpdir(), `openpencil-plugin-cli-${randomUUID()}`)
  temporaryDirectories.push(directory)
  await mkdir(directory, { recursive: true })
  const payloadPath = join(directory, 'payload.json')
  await Bun.write(payloadPath, JSON.stringify(payload()))
  return {
    directory,
    payloadPath,
    manifestPath: join(directory, 'manifest.json'),
    ...(await writeKeys(directory))
  }
}

async function runWithEnvironment(
  args: string[],
  environment: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const process = Bun.spawn(['bun', cliSourcePath('index.ts'), ...args], {
    env: { ...Bun.env, ...environment },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('plugin manifest CLI', () => {
  test('validates unsigned payloads as bounded declarative manifests', async () => {
    const { payloadPath } = await fixture()
    const result = await runOpenPencilCLI(['plugin', 'manifest', 'validate', payloadPath, '--json'])

    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: true,
      signed: false,
      schemaVersion: 1,
      manifest: { plugin: { id: 'example.chart', version: '1.2.3' } }
    })
  })

  test('validates, signs, and verifies schema-v2 manifests with explicit version reports', async () => {
    const { payloadPath, manifestPath, privateKey, publicKey } = await fixture()
    await Bun.write(payloadPath, JSON.stringify(pluginPayloadV2()))

    const validated = await runOpenPencilCLI([
      'plugin',
      'manifest',
      'validate',
      payloadPath,
      '--json'
    ])
    expect(validated).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(validated.stdout)).toMatchObject({
      valid: true,
      signed: false,
      schemaVersion: 2
    })

    const signed = await runOpenPencilCLI([
      'plugin',
      'manifest',
      'sign',
      payloadPath,
      '--private-key',
      privateKey,
      '-o',
      manifestPath,
      '--json'
    ])
    expect(signed).toMatchObject({ exitCode: 0, stderr: '' })
    const signedReport = JSON.parse(signed.stdout) as {
      schemaVersion: number
      manifest: unknown
    }
    expect(signedReport.schemaVersion).toBe(2)
    expect(parseVersionedPluginManifest(signedReport.manifest).schemaVersion).toBe(2)

    const verified = await runOpenPencilCLI([
      'plugin',
      'manifest',
      'verify',
      manifestPath,
      '--public-key',
      publicKey,
      '--engine-version',
      '0.13.2',
      '--json'
    ])
    expect(verified).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(verified.stdout)).toMatchObject({
      schemaVersion: 2,
      manifest: { schemaVersion: 2 }
    })
  })

  test('fails closed for unknown manifest schema versions', async () => {
    const { payloadPath } = await fixture()
    await Bun.write(payloadPath, JSON.stringify({ ...pluginPayloadV2(), schemaVersion: 3 }))

    const result = await runOpenPencilCLI(['plugin', 'manifest', 'validate', payloadPath])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('schemaVersion')
  })

  test('rejects an oversized manifest before parsing it', async () => {
    const { directory } = await fixture()
    const oversizedPath = join(directory, 'oversized.json')
    await Bun.write(oversizedPath, new Uint8Array(PLUGIN_MANIFEST_LIMITS.maxJsonBytes + 1))

    const result = await runOpenPencilCLI(['plugin', 'manifest', 'validate', oversizedPath])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(`may not exceed ${PLUGIN_MANIFEST_LIMITS.maxJsonBytes} bytes`)
  })

  test('signs from an explicit key file and verifies with the trusted public key', async () => {
    const { payloadPath, manifestPath, privateKey, privatePem, publicKey } = await fixture()
    const signed = await runOpenPencilCLI([
      'plugin',
      'manifest',
      'sign',
      payloadPath,
      '--private-key',
      privateKey,
      '-o',
      manifestPath,
      '--json'
    ])

    expect(signed).toMatchObject({ exitCode: 0, stderr: '' })
    expect(signed.stdout).not.toContain(privatePem.trim())
    const signedReport = JSON.parse(signed.stdout) as { manifest: unknown; output: string }
    expect(signedReport.output).toBe(manifestPath)
    expect(parsePluginManifest(signedReport.manifest).integrity.signature.keyId).toBe(
      'example-key-1'
    )

    const verified = await runOpenPencilCLI([
      'plugin',
      'manifest',
      'verify',
      manifestPath,
      '--public-key',
      publicKey,
      '--key-id',
      'example-key-1',
      '--engine-version',
      '0.13.2',
      '--json'
    ])
    expect(verified).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(verified.stdout)).toMatchObject({
      verifiedKeyId: 'example-key-1',
      manifest: { plugin: { id: 'example.chart' } }
    })
  })

  test('reads a private key from a named environment reference at invocation time', async () => {
    const { payloadPath, manifestPath, privatePem } = await fixture()
    const name = `OPENPENCIL_PLUGIN_KEY_${randomUUID().replaceAll('-', '_')}`

    const signed = await runWithEnvironment(
      [
        'plugin',
        'manifest',
        'sign',
        payloadPath,
        '--private-key-env',
        name,
        '-o',
        manifestPath,
        '--json'
      ],
      { [name]: privatePem }
    )

    expect(signed).toMatchObject({ exitCode: 0, stderr: '' })
    expect(signed.stdout).not.toContain(privatePem.trim())
    expect(await Bun.file(manifestPath).text()).not.toContain('PRIVATE KEY')
  })

  test('fails closed for ambiguous key references and a mismatched trusted key', async () => {
    const first = await fixture()
    const secondDirectory = join(first.directory, 'second')
    await mkdir(secondDirectory)
    const second = await writeKeys(secondDirectory)
    const ambiguous = await runOpenPencilCLI([
      'plugin',
      'manifest',
      'sign',
      first.payloadPath,
      '--private-key',
      first.privateKey,
      '--private-key-env',
      'UNUSED_KEY',
      '-o',
      first.manifestPath
    ])
    expect(ambiguous.exitCode).toBe(1)
    expect(ambiguous.stderr).toContain('exactly one')

    const signed = await runOpenPencilCLI([
      'plugin',
      'manifest',
      'sign',
      first.payloadPath,
      '--private-key',
      first.privateKey,
      '-o',
      first.manifestPath
    ])
    expect(signed.exitCode).toBe(0)
    const rejected = await runOpenPencilCLI([
      'plugin',
      'manifest',
      'verify',
      first.manifestPath,
      '--public-key',
      second.publicKey,
      '--engine-version',
      '0.13.2'
    ])
    expect(rejected.exitCode).toBe(1)
    expect(rejected.stderr).toContain('signature verification failed')
  })
})

describe('plugin catalog CLI', () => {
  test('builds and verifies a signed catalog without fetching manifest URLs', async () => {
    const { directory, privateKey, publicKey } = await fixture()
    const payloadPath = join(directory, 'catalog-payload.json')
    const catalogPath = join(directory, 'catalog.json')
    await Bun.write(payloadPath, JSON.stringify(catalogPayload()))

    const built = await runOpenPencilCLI([
      'plugin',
      'catalog',
      'build',
      payloadPath,
      '--private-key',
      privateKey,
      '--key-id',
      'catalog-root-1',
      '-o',
      catalogPath,
      '--json'
    ])
    expect(built).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(built.stdout)).toMatchObject({
      catalog: {
        catalogId: 'official',
        integrity: { signature: { keyId: 'catalog-root-1' } },
        entries: [{ manifestUrl: 'https://plugins.invalid/example.chart/1.2.3.json' }]
      },
      output: catalogPath
    })

    const verified = await runOpenPencilCLI([
      'plugin',
      'catalog',
      'verify',
      catalogPath,
      '--public-key',
      publicKey,
      '--catalog-id',
      'official',
      '--key-id',
      'catalog-root-1',
      '--now',
      '2026-08-06T00:00:00.000Z',
      '--json'
    ])
    expect(verified).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(verified.stdout)).toMatchObject({
      catalog: { catalogId: 'official', version: '1.0.0' },
      verifiedKeyId: 'catalog-root-1',
      verifiedAt: '2026-08-06T00:00:00.000Z',
      diagnostics: []
    })
  })

  test('fails closed for a mismatched catalog identity and an expired catalog', async () => {
    const { directory, privateKey, publicKey } = await fixture()
    const payloadPath = join(directory, 'catalog-payload.json')
    const catalogPath = join(directory, 'catalog.json')
    await Bun.write(payloadPath, JSON.stringify(catalogPayload()))
    const built = await runOpenPencilCLI([
      'plugin',
      'catalog',
      'build',
      payloadPath,
      '--private-key',
      privateKey,
      '-o',
      catalogPath
    ])
    expect(built.exitCode).toBe(0)

    const wrongIdentity = await runOpenPencilCLI([
      'plugin',
      'catalog',
      'verify',
      catalogPath,
      '--public-key',
      publicKey,
      '--catalog-id',
      'other',
      '--now',
      '2026-08-06T00:00:00.000Z'
    ])
    expect(wrongIdentity.exitCode).toBe(1)
    expect(wrongIdentity.stderr).toContain('catalog id is not trusted')

    const expired = await runOpenPencilCLI([
      'plugin',
      'catalog',
      'verify',
      catalogPath,
      '--public-key',
      publicKey,
      '--catalog-id',
      'official',
      '--now',
      '2026-08-15T00:00:00.000Z'
    ])
    expect(expired.exitCode).toBe(1)
    expect(expired.stderr).toContain('expired')
  })
})
