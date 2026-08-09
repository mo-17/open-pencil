import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
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

  test('binds method, path, timestamp, nonce, and body digest', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const timestamp = '2026-08-05T12:00:00.000Z'
    const body = new TextEncoder().encode('{}')
    const base = {
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
        now: () => Date.parse(timestamp),
        nonces: createMemoryMarketplaceNonceStore(() => Date.parse(timestamp)),
        resolvePublicKey: async () => pair.publicKey
      })
    ).rejects.toThrow('signature is invalid')
    expect(canonicalMarketplaceRequest(base)).toContain('/v1/submissions?channel=beta')
  })
})
