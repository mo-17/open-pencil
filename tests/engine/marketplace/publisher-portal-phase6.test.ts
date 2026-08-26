import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MARKETPLACE_PUBLISHER_REQUEST_OPERATIONS,
  appendMarketplaceAuditEvent,
  createMarketplaceControlReader,
  createMarketplaceHttpApp,
  createMarketplacePublisherSignedEnvelope,
  createMarketplaceService,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceNonceStore,
  createMemoryMarketplaceRepository,
  parseMarketplaceControlPublisherAuditPage,
  parseMarketplacePublisherSignedEnvelope,
  parseMarketplaceSubmissionPresentation,
  verifyMarketplaceRequest,
  writeMarketplacePublisherSignedEnvelope,
  type MarketplaceArtifactStore,
  type MarketplaceRepository,
  type MarketplaceService
} from '@open-pencil/marketplace'
import { marketplaceCommand } from '@open-pencil/marketplace/cli'
import {
  PLUGIN_RUNTIME_COMPUTE_ABI,
  PLUGIN_RUNTIME_PACKAGE_FORMAT,
  PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
  createPluginRuntimeAsset,
  signPluginRuntimePackage,
  signVersionedPluginManifest
} from '@open-pencil/plugin-contracts'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import {
  pluginConnectorContract,
  pluginPayloadV2,
  pluginStorageProviderContribution
} from '../plugins/helpers'

const NOW = '2026-08-22T08:00:00.000Z'
const BEFORE = '2026-08-22T07:59:00.000Z'
const MARKETPLACE_ID = 'phase6-marketplace'
const ADMIN_TOKEN = 'phase6-admin-token-that-is-at-least-32-characters'
const encoder = new TextEncoder()
const temporaryDirectories: string[] = []

async function privateKeyPem(key: CryptoKey): Promise<string> {
  const base64 = Buffer.from(await crypto.subtle.exportKey('pkcs8', key)).toString('base64')
  return `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function publisher(
  service: MarketplaceService,
  id: string,
  pluginId: string
): Promise<{ id: string; keyId: string; keyPair: CryptoKeyPair; pluginId: string }> {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const keyId = `${id}.release`
  await service.registerPublisher(
    {
      publisher: { id, displayName: `${id} publisher` },
      key: {
        keyId,
        publisherId: id,
        publicKeyPem: await exportEd25519PublicKeyPem(keyPair.publicKey),
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2027-01-01T00:00:00.000Z'
      }
    },
    { actor: `publisher:${id}`, time: BEFORE }
  )
  await service.transitionPublisherKey(keyId, 'active', {
    actor: 'admin:fixture',
    time: BEFORE
  })
  await service.transitionPublisher(id, 'active', { actor: 'admin:fixture', time: BEFORE })
  await service.requestOwnership(pluginId, id, { actor: `publisher:${id}`, time: BEFORE })
  await service.transitionOwnership(pluginId, 'active', {
    actor: 'admin:fixture',
    time: BEFORE
  })
  return { id, keyId, keyPair, pluginId }
}

async function phase6Fixture() {
  const repository = createMemoryMarketplaceRepository()
  const backing = createMemoryMarketplaceArtifactStore()
  let tamperArtifacts = false
  const artifacts: MarketplaceArtifactStore = {
    put: (bytes) => backing.put(bytes),
    async get(digest) {
      const artifact = await backing.get(digest)
      if (!artifact || !tamperArtifacts) return artifact
      const bytes = Uint8Array.from([...artifact.bytes, 0x20])
      return { ...artifact, bytes, byteLength: bytes.byteLength }
    }
  }
  const service = createMarketplaceService({
    repository,
    artifacts,
    marketplaceId: MARKETPLACE_ID,
    publicBaseUrl: 'https://plugins.example.com/',
    now: () => new Date(NOW)
  })
  const acme = await publisher(service, 'acme', 'acme.analytics')
  const beta = await publisher(service, 'beta', 'beta.toolbox')

  const payload = pluginPayloadV2('2.0.0')
  const manifest = await signVersionedPluginManifest(
    {
      ...payload,
      contributions: {
        ...payload.contributions,
        connectors: [pluginConnectorContract()],
        storageProviders: [pluginStorageProviderContribution()]
      }
    },
    acme.keyPair.privateKey
  )
  const runtimePackage = await signPluginRuntimePackage(
    {
      format: PLUGIN_RUNTIME_PACKAGE_FORMAT,
      schemaVersion: PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
      plugin: { id: acme.pluginId, version: '2.0.0' },
      publisher: { id: acme.id, keyId: acme.keyId },
      declarativeManifestDigest: manifest.integrity.digest,
      runtime: {
        kind: 'javascript',
        abi: PLUGIN_RUNTIME_COMPUTE_ABI,
        capabilities: [],
        limits: {
          timeoutMs: 2_000,
          maxInputBytes: 4_096,
          maxOutputBytes: 8_192,
          maxMemoryPages: 4
        },
        asset: await createPluginRuntimeAsset(
          'javascript',
          encoder.encode('export function compute() { return { ok: true } }\n')
        )
      }
    },
    acme.keyPair.privateKey
  )
  const submission = await service.submit(
    {
      id: 'acme-submission-v2',
      publisherId: acme.id,
      channel: 'stable',
      manifest,
      runtimePackage,
      listing: {
        displayName: 'Acme Analytics',
        summary: 'Bounded analytics plugin',
        description: 'Phase 6 publisher presentation fixture.',
        categories: ['analytics'],
        iconUrl: null,
        homepageUrl: null
      },
      authenticatedRequestKeyId: acme.keyId
    },
    { actor: `publisher:${acme.id}`, time: NOW }
  )
  await service.transitionSubmission(submission.id, 'changes_requested', {
    actor: 'admin:reviewer-one',
    reason: 'Clarify the reviewed connector scope',
    time: NOW
  })

  const app = createMarketplaceHttpApp({
    service,
    nonces: createMemoryMarketplaceNonceStore(() => Date.parse(NOW)),
    now: () => Date.parse(NOW),
    admin: { enabled: true, token: ADMIN_TOKEN }
  })
  return {
    acme,
    app,
    beta,
    service,
    submission,
    tamperArtifacts(value: boolean) {
      tamperArtifacts = value
    }
  }
}

function adminHeaders(): HeadersInit {
  return { authorization: `Bearer ${ADMIN_TOKEN}` }
}

describe('Phase 6 local Publisher signed-envelope hand-off', () => {
  test('creates a first-class Publisher registration envelope and preserves its exact raw bytes', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const initialKey = {
      keyId: 'acme.release',
      publisherId: 'acme',
      publicKeyPem: await exportEd25519PublicKeyPem(keyPair.publicKey),
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2027-01-01T00:00:00.000Z'
    }
    const body = encoder.encode(
      `\r\n{\r\n  "publisher": ${JSON.stringify({ id: 'acme', displayName: 'Acme 插件' })},\r\n  "key": ${JSON.stringify({ ...initialKey, predecessorKeyId: null })}\r\n}\r\n`
    )
    const envelope = await createMarketplacePublisherSignedEnvelope(
      {
        operation: 'publisher.register',
        audience: MARKETPLACE_ID,
        publisherId: 'acme',
        keyId: initialKey.keyId,
        body,
        timestamp: NOW,
        nonce: 'phase6register1234567890'
      },
      keyPair.privateKey
    )

    expect(MARKETPLACE_PUBLISHER_REQUEST_OPERATIONS).toContain('publisher.register')
    expect(envelope).toMatchObject({
      format: 'openpencil.marketplace.publisher-signed-envelope',
      schemaVersion: 1,
      operation: 'publisher.register',
      method: 'POST',
      target: '/v1/publishers/register',
      bodyEncoding: 'base64url',
      headers: { publisherId: 'acme', keyId: initialKey.keyId }
    })
    expect(parseMarketplacePublisherSignedEnvelope(envelope).body).toEqual(body)

    await expect(
      createMarketplacePublisherSignedEnvelope(
        {
          operation: 'publisher.register',
          audience: MARKETPLACE_ID,
          publisherId: 'acme',
          keyId: initialKey.keyId,
          body: encoder.encode(
            JSON.stringify({
              publisher: { id: 'acme', displayName: 'Acme Plugins' },
              key: initialKey
            })
          ),
          timestamp: NOW,
          nonce: 'phase6registerwithoutpredecessor'
        },
        keyPair.privateKey
      )
    ).resolves.toMatchObject({ operation: 'publisher.register' })
  })

  test('derives an allowlisted exact target, preserves raw bytes, and writes an exclusive 0600 file', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const body = encoder.encode(
      '{\r\n  "id":"acme-validation", "publisherId":"acme", "channel":"stable",\r\n  "manifest":{"note":"雪"}, "listing":{}\r\n}'
    )
    const envelope = await createMarketplacePublisherSignedEnvelope(
      {
        operation: 'submission.validate',
        audience: MARKETPLACE_ID,
        publisherId: 'acme',
        keyId: 'acme.release',
        body,
        timestamp: NOW,
        nonce: 'phase6nonce1234567890'
      },
      keyPair.privateKey
    )

    expect(envelope).toMatchObject({
      format: 'openpencil.marketplace.publisher-signed-envelope',
      schemaVersion: 1,
      operation: 'submission.validate',
      method: 'POST',
      target: '/v1/submissions/validate',
      bodyEncoding: 'base64url'
    })
    expect(parseMarketplacePublisherSignedEnvelope(envelope).body).toEqual(body)

    const directory = await mkdtemp(join(tmpdir(), 'openpencil-phase6-envelope-'))
    temporaryDirectories.push(directory)
    const output = join(directory, 'ownership.opm-request.json')
    await writeMarketplacePublisherSignedEnvelope(output, envelope)
    expect((await stat(output)).mode & 0o777).toBe(0o600)
    expect(await readFile(output, 'utf8')).not.toContain('PRIVATE KEY')
    await expect(writeMarketplacePublisherSignedEnvelope(output, envelope)).rejects.toThrow()
  })

  test('rejects unknown operations, target/body scope confusion, and oversized raw bodies', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const base = {
      audience: MARKETPLACE_ID,
      publisherId: 'acme',
      keyId: 'acme.release',
      timestamp: NOW,
      nonce: 'phase6nonce1234567890'
    }
    await expect(
      createMarketplacePublisherSignedEnvelope(
        {
          ...base,
          operation: 'release.publish' as never,
          body: encoder.encode('{}')
        },
        keyPair.privateKey
      )
    ).rejects.toThrow('operation')
    await expect(
      createMarketplacePublisherSignedEnvelope(
        {
          ...base,
          operation: 'ownership.request',
          body: encoder.encode('{"pluginId":"acme.analytics","publisherId":"beta"}')
        },
        keyPair.privateKey
      )
    ).rejects.toThrow('publisher')
    await expect(
      createMarketplacePublisherSignedEnvelope(
        {
          ...base,
          operation: 'submission.withdraw',
          submissionId: '../beta-submission',
          body: encoder.encode('{"reason":"Withdraw the invalid draft"}')
        },
        keyPair.privateKey
      )
    ).rejects.toThrow('submission')
    await expect(
      createMarketplacePublisherSignedEnvelope(
        {
          ...base,
          operation: 'ownership.request',
          submissionId: 'beta-submission',
          body: encoder.encode('{"pluginId":"acme.analytics","publisherId":"acme"}')
        },
        keyPair.privateKey
      )
    ).rejects.toThrow('does not accept')
    await expect(
      createMarketplacePublisherSignedEnvelope(
        {
          ...base,
          operation: 'submission.validate',
          body: new Uint8Array(4 * 1024 * 1024 + 1)
        },
        keyPair.privateKey
      )
    ).rejects.toThrow('byte limit')
  })

  test('rejects malformed Publisher registration targets, identities, initial keys, and extra fields', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const key = {
      keyId: 'acme.release',
      publisherId: 'acme',
      publicKeyPem: await exportEd25519PublicKeyPem(keyPair.publicKey),
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2027-01-01T00:00:00.000Z'
    }
    const registration = {
      publisher: { id: 'acme', displayName: 'Acme Plugins' },
      key
    }
    const create = (value: unknown) =>
      createMarketplacePublisherSignedEnvelope(
        {
          operation: 'publisher.register',
          audience: MARKETPLACE_ID,
          publisherId: 'acme',
          keyId: key.keyId,
          body: encoder.encode(JSON.stringify(value)),
          timestamp: NOW,
          nonce: 'phase6registerinvalid123456'
        },
        keyPair.privateKey
      )
    const valid = await create(registration)

    expect(() => parseMarketplacePublisherSignedEnvelope({ ...valid, method: 'GET' })).toThrow(
      'schema'
    )
    expect(() =>
      parseMarketplacePublisherSignedEnvelope({
        ...valid,
        target: '/v1/publishers/register?publisher=acme'
      })
    ).toThrow('target')

    await expect(
      create({ ...registration, publisher: { ...registration.publisher, id: 'beta' } })
    ).rejects.toThrow('registration')
    await expect(create({ ...registration, key: { ...key, publisherId: 'beta' } })).rejects.toThrow(
      'registration'
    )
    await expect(create({ ...registration, key: { ...key, keyId: 'acme.other' } })).rejects.toThrow(
      'registration'
    )
    await expect(
      create({ ...registration, key: { ...key, predecessorKeyId: 'acme.previous' } })
    ).rejects.toThrow('predecessor')
    await expect(create({ ...registration, extra: true })).rejects.toThrow()
    await expect(
      create({
        ...registration,
        publisher: { ...registration.publisher, extra: true }
      })
    ).rejects.toThrow()
    await expect(create({ ...registration, key: { ...key, extra: true } })).rejects.toThrow()
  })

  test('keeps registration body bytes signature-bound so body tampering fails verification', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const key = {
      keyId: 'acme.release',
      publisherId: 'acme',
      publicKeyPem: await exportEd25519PublicKeyPem(keyPair.publicKey),
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2027-01-01T00:00:00.000Z'
    }
    const body = encoder.encode(
      JSON.stringify({
        publisher: { id: 'acme', displayName: 'Acme Plugins' },
        key
      })
    )
    const envelope = await createMarketplacePublisherSignedEnvelope(
      {
        operation: 'publisher.register',
        audience: MARKETPLACE_ID,
        publisherId: 'acme',
        keyId: key.keyId,
        body,
        timestamp: NOW,
        nonce: 'phase6registertamper123456'
      },
      keyPair.privateKey
    )
    const verification = (requestBody: Uint8Array) =>
      verifyMarketplaceRequest(
        {
          method: envelope.method,
          url: `http://marketplace.invalid${envelope.target}`,
          body: requestBody,
          headers: envelope.headers
        },
        {
          audience: MARKETPLACE_ID,
          now: () => Date.parse(NOW),
          nonces: createMemoryMarketplaceNonceStore(() => Date.parse(NOW)),
          resolvePublicKey: async (publisherId, keyId) =>
            publisherId === 'acme' && keyId === key.keyId ? keyPair.publicKey : null
        }
      )

    await expect(verification(body)).resolves.toEqual({
      publisherId: 'acme',
      keyId: key.keyId
    })
    const tamperedBody = encoder.encode(
      JSON.stringify({
        publisher: { id: 'acme', displayName: 'Tampered Plugins' },
        key
      })
    )
    const parsedTampered = parseMarketplacePublisherSignedEnvelope({
      ...envelope,
      body: Buffer.from(tamperedBody).toString('base64url')
    })
    expect(parsedTampered.body).toEqual(tamperedBody)
    await expect(verification(parsedTampered.body)).rejects.toThrow('signature')
  })

  test('registers a runnable request sign CLI without exposing publish or yank operations', () => {
    const request = marketplaceCommand.subCommands?.request
    expect(request?.subCommands?.sign.meta?.name).toBe('sign')
    expect(request?.subCommands?.sign.args?.operation).toMatchObject({ required: true })
  })

  test('CLI accepts a named local key reference without printing the key or exact request body', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-phase6-cli-'))
    temporaryDirectories.push(directory)
    const bodyPath = join(directory, 'body.json')
    const outputPath = join(directory, 'request.opm-request.json')
    const body = '{"pluginId":"acme.analytics","publisherId":"acme"}\n'
    await writeFile(bodyPath, body, { encoding: 'utf8', mode: 0o600 })
    const processResult = Bun.spawn(
      [
        process.execPath,
        join(process.cwd(), 'packages/marketplace/src/cli.ts'),
        'request',
        'sign',
        '--operation',
        'ownership.request',
        '--audience',
        MARKETPLACE_ID,
        '--publisher',
        'acme',
        '--key-id',
        'acme.release',
        '--body',
        bodyPath,
        '--output',
        outputPath,
        '--private-key-env',
        'PHASE6_LOCAL_PRIVATE_KEY'
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PHASE6_LOCAL_PRIVATE_KEY: await privateKeyPem(keyPair.privateKey)
        },
        stdout: 'pipe',
        stderr: 'pipe'
      }
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      processResult.exited,
      new Response(processResult.stdout).text(),
      new Response(processResult.stderr).text()
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
    expect(stdout).not.toContain('PRIVATE KEY')
    expect(stdout).not.toContain('acme.analytics')
    expect(stdout).not.toContain(body.trim())
    expect(Object.keys(JSON.parse(stdout)).sort()).toEqual([
      'bodyDigest',
      'operation',
      'output',
      'schemaVersion',
      'signedAt',
      'target'
    ])
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600)
    const parsed = parseMarketplacePublisherSignedEnvelope(
      JSON.parse(await readFile(outputPath, 'utf8'))
    )
    expect(new TextDecoder().decode(parsed.body)).toBe(body)
  })

  test('CLI signs a Publisher registration envelope without printing key material or body data', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-phase6-register-cli-'))
    temporaryDirectories.push(directory)
    const bodyPath = join(directory, 'publisher-registration.json')
    const outputPath = join(directory, 'publisher-registration.opm-request.json')
    const body = `${JSON.stringify({
      publisher: { id: 'acme', displayName: 'Acme Plugins' },
      key: {
        keyId: 'acme.release',
        publisherId: 'acme',
        publicKeyPem: await exportEd25519PublicKeyPem(keyPair.publicKey),
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2027-01-01T00:00:00.000Z',
        predecessorKeyId: null
      }
    })}\n`
    await writeFile(bodyPath, body, { encoding: 'utf8', mode: 0o600 })
    const processResult = Bun.spawn(
      [
        process.execPath,
        join(process.cwd(), 'packages/marketplace/src/cli.ts'),
        'request',
        'sign',
        '--operation',
        'publisher.register',
        '--audience',
        MARKETPLACE_ID,
        '--publisher',
        'acme',
        '--key-id',
        'acme.release',
        '--body',
        bodyPath,
        '--output',
        outputPath,
        '--private-key-env',
        'PHASE6_REGISTER_PRIVATE_KEY'
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PHASE6_REGISTER_PRIVATE_KEY: await privateKeyPem(keyPair.privateKey)
        },
        stdout: 'pipe',
        stderr: 'pipe'
      }
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      processResult.exited,
      new Response(processResult.stdout).text(),
      new Response(processResult.stderr).text()
    ])

    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
    expect(stdout).not.toContain('PRIVATE KEY')
    expect(stdout).not.toContain('PUBLIC KEY')
    expect(stdout).not.toContain('Acme Plugins')
    const parsed = parseMarketplacePublisherSignedEnvelope(
      JSON.parse(await readFile(outputPath, 'utf8'))
    )
    expect(parsed).toMatchObject({
      operation: 'publisher.register',
      method: 'POST',
      target: '/v1/publishers/register',
      headers: { publisherId: 'acme', keyId: 'acme.release' }
    })
    expect(new TextDecoder().decode(parsed.body)).toBe(body)
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600)
  })

  test('rejects a group/world-readable Publisher private-key file before signing', async () => {
    if (process.platform === 'win32') return
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-phase6-key-mode-'))
    temporaryDirectories.push(directory)
    const keyPath = join(directory, 'publisher-private.pem')
    const bodyPath = join(directory, 'body.json')
    const outputPath = join(directory, 'request.opm-request.json')
    await writeFile(keyPath, await privateKeyPem(keyPair.privateKey), { mode: 0o600 })
    await chmod(keyPath, 0o644)
    await writeFile(bodyPath, '{"pluginId":"acme.analytics","publisherId":"acme"}\n', {
      mode: 0o600
    })
    const command = [
      process.execPath,
      join(process.cwd(), 'packages/marketplace/src/cli.ts'),
      'request',
      'sign',
      '--operation',
      'ownership.request',
      '--audience',
      MARKETPLACE_ID,
      '--publisher',
      'acme',
      '--key-id',
      'acme.release',
      '--body',
      bodyPath,
      '--output',
      outputPath,
      '--private-key',
      keyPath
    ]
    const processResult = Bun.spawn(command, {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      processResult.exited,
      new Response(processResult.stdout).text(),
      new Response(processResult.stderr).text()
    ])
    expect(exitCode).not.toBe(0)
    expect(stdout).toBe('')
    expect(stderr).toContain('0600 owner-only')
    expect(stderr).not.toContain('PRIVATE KEY')
    await expect(stat(outputPath)).rejects.toThrow()

    await chmod(keyPath, 0o600)
    const secureProcess = Bun.spawn(command, {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const [secureExitCode, secureStdout, secureStderr] = await Promise.all([
      secureProcess.exited,
      new Response(secureProcess.stdout).text(),
      new Response(secureProcess.stderr).text()
    ])
    expect({ secureExitCode, secureStderr }).toEqual({ secureExitCode: 0, secureStderr: '' })
    expect(secureStdout).not.toContain('PRIVATE KEY')
    expect(secureStdout).not.toContain('acme.analytics')
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600)
  })
})

describe('Phase 6 Publisher-scoped audit', () => {
  test('includes operator effects on Publisher entities and excludes other tenants and global events', async () => {
    const fixture = await phase6Fixture()
    const response = await fixture.app.request(
      `http://localhost/admin/publishers/${fixture.acme.id}/audit?limit=100&sort=sequence`,
      { headers: adminHeaders() }
    )
    expect(response.status).toBe(200)
    const page = parseMarketplaceControlPublisherAuditPage(await response.json())
    expect(page.publisherId).toBe(fixture.acme.id)
    expect(page.items.some((event) => event.actor === 'admin:reviewer-one')).toBe(true)
    expect(
      page.items.some((event) => event.subject === `publisher-key:${fixture.acme.keyId}`)
    ).toBe(true)
    expect(page.items.some((event) => event.subject.includes(fixture.beta.id))).toBe(false)
    expect(page.items.some((event) => event.subject === 'publication:global')).toBe(false)
    expect(page.items.every((event) => event.actor !== `publisher:${fixture.beta.id}`)).toBe(true)
  })

  test('does not expand scope when a Publisher actor is attached to another tenant subject', async () => {
    const fixture = await phase6Fixture()
    const state = await fixture.service.snapshot()
    const contaminated = await appendMarketplaceAuditEvent(state.auditEvents, {
      time: NOW,
      actor: `publisher:${fixture.acme.id}`,
      action: 'ownership.status_changed',
      subject: `ownership:${fixture.beta.pluginId}`,
      payload: { status: 'active' }
    })
    const repository = {
      async snapshot() {
        return Object.freeze({ ...state, auditEvents: contaminated.events })
      },
      async transaction() {
        throw new Error('read-only test repository')
      }
    } as MarketplaceRepository
    const result = await createMarketplaceControlReader(repository).publisherAudit(
      fixture.acme.id,
      { limit: 100 }
    )
    expect(result.items.some(({ sequence }) => sequence === contaminated.event.sequence)).toBe(
      false
    )
  })

  test('binds audit pagination to the exact Publisher and rejects unknown scope/query values', async () => {
    const fixture = await phase6Fixture()
    const first = await fixture.app.request(
      `http://localhost/admin/publishers/${fixture.acme.id}/audit?limit=1`,
      { headers: adminHeaders() }
    )
    const page = parseMarketplaceControlPublisherAuditPage(await first.json())
    expect(page.nextCursor).not.toBeNull()
    const crossScope = await fixture.app.request(
      `http://localhost/admin/publishers/${fixture.beta.id}/audit?limit=1&cursor=${encodeURIComponent(page.nextCursor as string)}`,
      { headers: adminHeaders() }
    )
    expect(crossScope.status).toBe(400)
    const unknown = await fixture.app.request(
      `http://localhost/admin/publishers/${fixture.acme.id}/audit?publisherId=${fixture.beta.id}`,
      { headers: adminHeaders() }
    )
    expect(unknown.status).toBe(400)
  })
})

describe('Phase 6 verified Submission presentation', () => {
  test('re-verifies immutable artifacts and returns only a bounded declarative projection', async () => {
    const fixture = await phase6Fixture()
    const response = await fixture.app.request(
      `http://localhost/admin/publishers/${fixture.acme.id}/submissions/${fixture.submission.id}/presentation`,
      { headers: adminHeaders() }
    )
    if (response.status !== 200) throw new Error(await response.clone().text())
    expect(response.status).toBe(200)
    const source = await response.text()
    const wire = JSON.parse(source)
    const presentation = parseMarketplaceSubmissionPresentation(wire)
    expect(presentation.publisherId).toBe(fixture.acme.id)
    expect(presentation.manifest.permissions).toEqual([
      'document.read',
      'document.selection.read',
      'document.variables.read',
      'file.save'
    ])
    expect(presentation.manifest.connectors[0]).toMatchObject({
      connectorId: 'analytics.records',
      origins: ['https://api.example.com'],
      methods: ['GET'],
      credentialKinds: ['bearer-token'],
      operationIds: ['list-records']
    })
    expect(presentation.runtime).toMatchObject({
      kind: 'javascript',
      abi: PLUGIN_RUNTIME_COMPUTE_ABI,
      capabilities: [],
      limits: { timeoutMs: 2_000, maxInputBytes: 4_096, maxOutputBytes: 8_192 },
      asset: { mediaType: 'text/javascript' }
    })
    expect(source).not.toContain('publicKeyPem')
    expect(source).not.toContain('/v1/artifacts/')
    expect(source).not.toContain('export function compute')
    expect(source).not.toContain('PRIVATE KEY')

    const mismatchedRuntime = structuredClone(wire)
    mismatchedRuntime.runtime.asset.mediaType = 'application/wasm'
    expect(() => parseMarketplaceSubmissionPresentation(mismatchedRuntime)).toThrow(
      'runtime metadata'
    )
    expect(() =>
      parseMarketplaceSubmissionPresentation({ ...wire, artifactPath: '/private/artifact' })
    ).toThrow('unsupported fields')
  })

  test('fails closed for cross-Publisher scope and tampered immutable artifacts', async () => {
    const fixture = await phase6Fixture()
    const crossScope = await fixture.app.request(
      `http://localhost/admin/publishers/${fixture.beta.id}/submissions/${fixture.submission.id}/presentation`,
      { headers: adminHeaders() }
    )
    expect(crossScope.status).toBe(404)

    fixture.tamperArtifacts(true)
    const tampered = await fixture.app.request(
      `http://localhost/admin/publishers/${fixture.acme.id}/submissions/${fixture.submission.id}/presentation`,
      { headers: adminHeaders() }
    )
    expect(tampered.status).toBe(500)
    expect(await tampered.json()).toEqual({ error: 'Internal marketplace server error' })
  })
})
