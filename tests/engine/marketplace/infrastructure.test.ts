import { afterEach, describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  canonicalMarketplaceRequest,
  createFileMarketplaceArtifactStore,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceNonceStore,
  digestMarketplaceArtifact,
  signMarketplaceRequest,
  verifyMarketplaceRequest
} from '@open-pencil/marketplace'

const temporaryDirectories: string[] = []
const encoder = new TextEncoder()
const AUDIENCE = 'openpencil-marketplace'

function legacyCanonicalMarketplaceRequest(input: {
  method: string
  url: string
  timestamp: string
  nonce: string
  body: Uint8Array
}): string {
  const url = new URL(input.url)
  return [
    'OPENPENCIL-MARKETPLACE-REQUEST-V1',
    input.method.toUpperCase(),
    `${url.pathname}${url.search}`,
    input.timestamp,
    input.nonce,
    createHash('sha256').update(input.body).digest('base64url')
  ].join('\n')
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('marketplace artifact storage', () => {
  test('deduplicates immutable content-addressed bytes in memory', async () => {
    const store = createMemoryMarketplaceArtifactStore()
    const bytes = new TextEncoder().encode('{"plugin":"map"}')
    const first = await store.put(bytes)
    bytes.fill(0)
    const second = await store.get(first.digest)

    expect(second).toEqual(first)
    expect(second?.digest).toBe(digestMarketplaceArtifact(first.bytes))
  })

  test('persists an atomically-addressed artifact and detects disk tampering', async () => {
    const directory = join(tmpdir(), `openpencil-marketplace-${randomUUID()}`)
    temporaryDirectories.push(directory)
    const store = createFileMarketplaceArtifactStore(directory)
    const artifact = await store.put(new TextEncoder().encode('signed artifact'))
    expect(await store.get(artifact.digest)).toEqual(artifact)

    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, `${artifact.digest}.blob`), 'tampered')
    await expect(store.get(artifact.digest)).rejects.toThrow('digest mismatch')
  })
})

describe('publisher request authentication', () => {
  test('verifies a signed request once and rejects replay', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const body = new TextEncoder().encode('{"submission":"one"}')
    const timestamp = '2026-08-05T12:00:00.000Z'
    const input = {
      audience: AUDIENCE,
      publisherId: 'publisher-one',
      keyId: 'publisher-one-2026',
      method: 'POST',
      url: 'https://plugins.example.com/v1/submissions',
      timestamp,
      nonce: 'abcdefghijklmnop',
      body
    }
    const headers = await signMarketplaceRequest(input, pair.privateKey)
    const nonces = createMemoryMarketplaceNonceStore(() => Date.parse(timestamp))
    const options = {
      audience: AUDIENCE,
      now: () => Date.parse(timestamp),
      nonces,
      resolvePublicKey: async () => pair.publicKey
    }

    await expect(verifyMarketplaceRequest({ ...input, headers }, options)).resolves.toEqual({
      publisherId: input.publisherId,
      keyId: input.keyId
    })
    await expect(verifyMarketplaceRequest({ ...input, headers }, options)).rejects.toThrow(
      'already been used'
    )
  })

  test('rejects a signature replayed into a different Marketplace audience', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const timestamp = '2026-08-05T12:00:00.000Z'
    const input = {
      audience: AUDIENCE,
      publisherId: 'publisher-one',
      keyId: 'publisher-one-2026',
      method: 'GET',
      url: 'https://plugins.example.com/v1/publishers/me',
      timestamp,
      nonce: 'audiencenonce001',
      body: new Uint8Array()
    }
    const headers = await signMarketplaceRequest(input, pair.privateKey)
    await expect(
      verifyMarketplaceRequest(
        { ...input, headers },
        {
          audience: 'different-marketplace',
          now: () => Date.parse(timestamp),
          nonces: createMemoryMarketplaceNonceStore(() => Date.parse(timestamp)),
          resolvePublicKey: async () => pair.publicKey
        }
      )
    ).rejects.toThrow('audience')
  })

  test('binds method, path, timestamp, nonce, and body digest', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const timestamp = '2026-08-05T12:00:00.000Z'
    const body = new TextEncoder().encode('{}')
    const base = {
      audience: AUDIENCE,
      publisherId: 'publisher-one',
      keyId: 'publisher-one-2026',
      method: 'POST',
      url: 'https://plugins.example.com/v1/submissions?channel=beta',
      timestamp,
      nonce: 'abcdefghijklmnop',
      body
    }
    const headers = await signMarketplaceRequest(base, pair.privateKey)
    const tampered = { ...base, body: new TextEncoder().encode('{"changed":true}'), headers }

    await expect(
      verifyMarketplaceRequest(tampered, {
        audience: AUDIENCE,
        now: () => Date.parse(timestamp),
        nonces: createMemoryMarketplaceNonceStore(() => Date.parse(timestamp)),
        resolvePublicKey: async () => pair.publicKey
      })
    ).rejects.toThrow('signature is invalid')
    expect(canonicalMarketplaceRequest(base)).toContain('/v1/submissions?channel=beta')
  })

  test('binds publisher and key identities even when two records reuse one public key', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const timestamp = '2026-08-05T12:00:00.000Z'
    const input = {
      audience: AUDIENCE,
      publisherId: 'publisher-one',
      keyId: 'publisher-one-2026',
      method: 'GET',
      url: 'https://plugins.example.com/v1/publishers/me',
      timestamp,
      nonce: 'identitynonce001',
      body: new Uint8Array()
    }
    const headers = await signMarketplaceRequest(input, pair.privateKey)

    await expect(
      verifyMarketplaceRequest(
        {
          method: input.method,
          url: input.url,
          body: input.body,
          headers: {
            ...headers,
            publisherId: 'publisher-two',
            keyId: 'publisher-two-2026'
          }
        },
        {
          audience: AUDIENCE,
          now: () => Date.parse(timestamp),
          nonces: createMemoryMarketplaceNonceStore(() => Date.parse(timestamp)),
          resolvePublicKey: async () => pair.publicKey
        }
      )
    ).rejects.toThrow('signature is invalid')
  })

  test('rejects legacy V1 signatures and a no-longer-active publisher key', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const timestamp = '2026-08-05T12:00:00.000Z'
    const input = {
      audience: AUDIENCE,
      publisherId: 'publisher-one',
      keyId: 'publisher-one-2026',
      method: 'GET',
      url: 'https://plugins.example.com/v1/publishers/me',
      timestamp,
      nonce: 'legacynonce000001',
      body: new Uint8Array()
    }
    const legacySignature = Buffer.from(
      await crypto.subtle.sign(
        'Ed25519',
        pair.privateKey,
        encoder.encode(legacyCanonicalMarketplaceRequest(input))
      )
    ).toString('base64url')
    const legacyHeaders = {
      audience: input.audience,
      publisherId: input.publisherId,
      keyId: input.keyId,
      timestamp: input.timestamp,
      nonce: input.nonce,
      signature: legacySignature
    }

    await expect(
      verifyMarketplaceRequest(
        { method: input.method, url: input.url, body: input.body, headers: legacyHeaders },
        {
          audience: AUDIENCE,
          now: () => Date.parse(timestamp),
          nonces: createMemoryMarketplaceNonceStore(() => Date.parse(timestamp)),
          resolvePublicKey: async () => pair.publicKey
        }
      )
    ).rejects.toThrow('signature is invalid')

    const currentHeaders = await signMarketplaceRequest(
      { ...input, nonce: 'revokednonce00001' },
      pair.privateKey
    )
    await expect(
      verifyMarketplaceRequest(
        { method: input.method, url: input.url, body: input.body, headers: currentHeaders },
        {
          audience: AUDIENCE,
          now: () => Date.parse(timestamp),
          nonces: createMemoryMarketplaceNonceStore(() => Date.parse(timestamp)),
          resolvePublicKey: async () => null
        }
      )
    ).rejects.toThrow('not active')
  })
})
