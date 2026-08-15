import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  PLUGIN_RUNTIME_COMPUTE_ABI,
  PLUGIN_RUNTIME_INDEX_FORMAT,
  PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION,
  PLUGIN_RUNTIME_PACKAGE_FORMAT,
  PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
  createPluginRuntimeAsset,
  parsePluginRuntimePackage,
  pluginRuntimePackageCanonicalByteLength,
  type PluginRuntimeIndexPayloadV1,
  type PluginRuntimePackagePayloadV1,
  type SignedPluginRuntimePackageV1
} from '@open-pencil/plugin-contracts'

import { runOpenPencilCLI } from '#tests/helpers/cli'

const MANIFEST_DIGEST = 'A'.repeat(43)
const GENERATED_AT = '2026-08-05T00:00:00.000Z'
const EXPIRES_AT = '2026-08-10T00:00:00.000Z'
const temporaryDirectories: string[] = []

interface KeyPaths {
  privateKey: string
  publicKey: string
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

async function writeKeys(directory: string, prefix: string): Promise<KeyPaths> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const privateKey = join(directory, `${prefix}-private.pem`)
  const publicKey = join(directory, `${prefix}-public.pem`)
  await Bun.write(
    privateKey,
    pem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  )
  await Bun.write(
    publicKey,
    pem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey))
  )
  return { privateKey, publicKey }
}

function section(id: number, payload: number[]): number[] {
  return [id, payload.length, ...payload]
}

function text(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)]
  return [bytes.length, ...bytes]
}

function safeWasm(): Uint8Array {
  const exports = [
    [...text('memory'), 2, 0],
    [...text('openpencil_alloc'), 0, 0],
    [...text('openpencil_dealloc'), 0, 1],
    [...text('openpencil_compute'), 0, 2]
  ]
  const bodies = [
    [0, 0x20, 0, 0x0b],
    [0, 0x0b],
    [0, 0x41, 0, 0x0b]
  ]
  return new Uint8Array([
    0,
    0x61,
    0x73,
    0x6d,
    1,
    0,
    0,
    0,
    ...section(
      1,
      [3, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 0, 0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f]
    ),
    ...section(3, [3, 0, 1, 2]),
    ...section(5, [1, 1, 1, 4]),
    ...section(7, [exports.length, ...exports.flat()]),
    ...section(10, [bodies.length, ...bodies.flatMap((body) => [body.length, ...body])])
  ])
}

async function runtimePayload(): Promise<PluginRuntimePackagePayloadV1> {
  return {
    format: PLUGIN_RUNTIME_PACKAGE_FORMAT,
    schemaVersion: PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
    plugin: { id: 'acme.analytics', version: '1.0.0' },
    publisher: { id: 'acme', keyId: 'acme.release' },
    declarativeManifestDigest: MANIFEST_DIGEST,
    runtime: {
      kind: 'wasm',
      abi: PLUGIN_RUNTIME_COMPUTE_ABI,
      capabilities: [],
      limits: {
        timeoutMs: 2_000,
        maxInputBytes: 256 * 1024,
        maxOutputBytes: 256 * 1024,
        maxMemoryPages: 4
      },
      asset: await createPluginRuntimeAsset('wasm', safeWasm())
    }
  }
}

async function fixture(): Promise<{
  directory: string
  payloadPath: string
  runtimePath: string
  publisher: KeyPaths
  root: KeyPaths
}> {
  const directory = join(tmpdir(), `openpencil-runtime-cli-${randomUUID()}`)
  temporaryDirectories.push(directory)
  await mkdir(directory, { recursive: true })
  const payloadPath = join(directory, 'runtime-payload.json')
  await Bun.write(payloadPath, JSON.stringify(await runtimePayload()))
  return {
    directory,
    payloadPath,
    runtimePath: join(directory, 'runtime.json'),
    publisher: await writeKeys(directory, 'publisher'),
    root: await writeKeys(directory, 'root')
  }
}

async function signRuntime(
  payloadPath: string,
  runtimePath: string,
  privateKey: string
): Promise<SignedPluginRuntimePackageV1> {
  const result = await runOpenPencilCLI([
    'plugin',
    'runtime',
    'sign',
    payloadPath,
    '--private-key',
    privateKey,
    '-o',
    runtimePath,
    '--json'
  ])
  expect(result).toMatchObject({ exitCode: 0, stderr: '' })
  return parsePluginRuntimePackage(
    (JSON.parse(result.stdout) as { runtimePackage: unknown }).runtimePackage
  )
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('plugin runtime CLI', () => {
  test('validates, signs, and verifies a publisher runtime with strict coordinates', async () => {
    const current = await fixture()
    const validated = await runOpenPencilCLI([
      'plugin',
      'runtime',
      'validate',
      current.payloadPath,
      '--json'
    ])
    expect(validated).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(validated.stdout)).toMatchObject({
      valid: true,
      signed: false,
      signatureVerified: false,
      runtimePackage: { plugin: { id: 'acme.analytics', version: '1.0.0' } }
    })

    const runtimePackage = await signRuntime(
      current.payloadPath,
      current.runtimePath,
      current.publisher.privateKey
    )
    const validatedSigned = await runOpenPencilCLI([
      'plugin',
      'runtime',
      'validate',
      current.runtimePath
    ])
    expect(validatedSigned).toMatchObject({ exitCode: 0, stderr: '' })
    expect(validatedSigned.stdout).toContain('Valid runtime asset envelope (signature not checked)')
    expect(validatedSigned.stdout).not.toContain('Valid signed plugin runtime package')
    const unpinned = await runOpenPencilCLI([
      'plugin',
      'runtime',
      'verify',
      current.runtimePath,
      '--public-key',
      current.publisher.publicKey
    ])
    expect(unpinned.exitCode).toBe(1)
    expect(unpinned.stderr).toContain('plugin-id')
    const verified = await runOpenPencilCLI([
      'plugin',
      'runtime',
      'verify',
      current.runtimePath,
      '--public-key',
      current.publisher.publicKey,
      '--plugin-id',
      'acme.analytics',
      '--plugin-version',
      '1.0.0',
      '--publisher-id',
      'acme',
      '--key-id',
      'acme.release',
      '--manifest-digest',
      MANIFEST_DIGEST,
      '--digest',
      runtimePackage.integrity.digest,
      '--byte-length',
      String(pluginRuntimePackageCanonicalByteLength(runtimePackage)),
      '--json'
    ])
    expect(verified).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(verified.stdout)).toMatchObject({
      verifiedDigest: runtimePackage.integrity.digest,
      verifiedKeyId: 'acme.release',
      executionStatus: 'eligible',
      wasmSafety: { maximumMemoryPages: 4 }
    })
  })

  test('builds and verifies a root-signed runtime index without fetching packages', async () => {
    const current = await fixture()
    const runtimePackage = await signRuntime(
      current.payloadPath,
      current.runtimePath,
      current.publisher.privateKey
    )
    const payload: PluginRuntimeIndexPayloadV1 = {
      format: PLUGIN_RUNTIME_INDEX_FORMAT,
      schemaVersion: PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION,
      indexId: 'openpencil.marketplace.runtime',
      version: '1.0.0',
      generatedAt: GENERATED_AT,
      expiresAt: EXPIRES_AT,
      entries: [
        {
          pluginId: runtimePackage.plugin.id,
          version: runtimePackage.plugin.version,
          publisherId: runtimePackage.publisher.id,
          keyId: runtimePackage.publisher.keyId,
          declarativeManifestDigest: runtimePackage.declarativeManifestDigest,
          runtimeKind: runtimePackage.runtime.kind,
          runtimePackageUrl: 'https://plugins.example.com/acme.analytics/1.0.0/runtime.json',
          runtimePackageDigest: runtimePackage.integrity.digest,
          runtimePackageByteLength: pluginRuntimePackageCanonicalByteLength(runtimePackage)
        }
      ]
    }
    const payloadPath = join(current.directory, 'runtime-index-payload.json')
    const indexPath = join(current.directory, 'runtime-index.json')
    await Bun.write(payloadPath, JSON.stringify(payload))

    const built = await runOpenPencilCLI([
      'plugin',
      'runtime-index',
      'build',
      payloadPath,
      '--private-key',
      current.root.privateKey,
      '--key-id',
      'marketplace.root.2026',
      '-o',
      indexPath,
      '--json'
    ])
    expect(built).toMatchObject({ exitCode: 0, stderr: '' })
    const builtReport = JSON.parse(built.stdout) as {
      runtimeIndex: { integrity: { digest: string } }
      output: string
    }
    expect(builtReport.output).toBe(indexPath)

    const unpinned = await runOpenPencilCLI([
      'plugin',
      'runtime-index',
      'verify',
      indexPath,
      '--public-key',
      current.root.publicKey
    ])
    expect(unpinned.exitCode).toBe(1)
    expect(unpinned.stderr).toContain('index-id')

    const verified = await runOpenPencilCLI([
      'plugin',
      'runtime-index',
      'verify',
      indexPath,
      '--public-key',
      current.root.publicKey,
      '--index-id',
      'openpencil.marketplace.runtime',
      '--key-id',
      'marketplace.root.2026',
      '--digest',
      builtReport.runtimeIndex.integrity.digest,
      '--now',
      '2026-08-06T00:00:00.000Z',
      '--json'
    ])
    expect(verified).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(verified.stdout)).toMatchObject({
      index: {
        indexId: 'openpencil.marketplace.runtime',
        entries: [{ pluginId: 'acme.analytics' }]
      },
      verifiedKeyId: 'marketplace.root.2026',
      verifiedAt: '2026-08-06T00:00:00.000Z',
      diagnostics: []
    })
  })

  test('validate checks the unsigned payload embedded asset digest and WASM envelope', async () => {
    const current = await fixture()
    const payload = structuredClone(await runtimePayload())
    payload.runtime.asset.digest = 'Q'.repeat(43)
    await Bun.write(current.payloadPath, JSON.stringify(payload))

    const validated = await runOpenPencilCLI([
      'plugin',
      'runtime',
      'validate',
      current.payloadPath,
      '--json'
    ])
    expect(validated.exitCode).toBe(1)
    expect(validated.stderr).toContain('Runtime asset digest mismatch')
  })

  test('fails closed for substituted runtime coordinates and expired runtime indexes', async () => {
    const current = await fixture()
    const runtimePackage = await signRuntime(
      current.payloadPath,
      current.runtimePath,
      current.publisher.privateKey
    )
    const substituted = await runOpenPencilCLI([
      'plugin',
      'runtime',
      'verify',
      current.runtimePath,
      '--public-key',
      current.publisher.publicKey,
      '--plugin-id',
      'hostile.analytics',
      '--plugin-version',
      '1.0.0',
      '--publisher-id',
      'acme',
      '--key-id',
      'acme.release',
      '--manifest-digest',
      MANIFEST_DIGEST,
      '--digest',
      runtimePackage.integrity.digest,
      '--byte-length',
      String(pluginRuntimePackageCanonicalByteLength(runtimePackage))
    ])
    expect(substituted.exitCode).toBe(1)
    expect(substituted.stderr).toContain('coordinates do not match')

    const indexPayload: PluginRuntimeIndexPayloadV1 = {
      format: PLUGIN_RUNTIME_INDEX_FORMAT,
      schemaVersion: PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION,
      indexId: 'openpencil.marketplace.runtime',
      version: '1.0.0',
      generatedAt: GENERATED_AT,
      expiresAt: EXPIRES_AT,
      entries: []
    }
    const payloadPath = join(current.directory, 'empty-index-payload.json')
    const indexPath = join(current.directory, 'empty-index.json')
    await Bun.write(payloadPath, JSON.stringify(indexPayload))
    const built = await runOpenPencilCLI([
      'plugin',
      'runtime-index',
      'build',
      payloadPath,
      '--private-key',
      current.root.privateKey,
      '-o',
      indexPath,
      '--json'
    ])
    expect(built.exitCode).toBe(0)
    const builtIndex = JSON.parse(built.stdout) as {
      runtimeIndex: { integrity: { digest: string } }
    }
    const expired = await runOpenPencilCLI([
      'plugin',
      'runtime-index',
      'verify',
      indexPath,
      '--public-key',
      current.root.publicKey,
      '--index-id',
      'openpencil.marketplace.runtime',
      '--key-id',
      'openpencil.marketplace.runtime',
      '--digest',
      builtIndex.runtimeIndex.integrity.digest,
      '--now',
      EXPIRES_AT
    ])
    expect(expired.exitCode).toBe(1)
    expect(expired.stderr).toContain('expired')
  })
})
