import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import {
  canonicalBackendSourceLedgerSignedReceiptSigningV1Bytes,
  canonicalBackendSourceLedgerSignedReceiptV1Bytes,
  parseBackendSourceLedgerSignedReceiptV1,
  parseBackendSourceLedgerSignedReceiptV1Bytes,
  type BackendSourceLedgerSignedReceiptV1
} from '#lowcode/backend/release/source-ledger-signed-receipt'

import {
  createSignedManifestIntegrity,
  decodeBase64URL,
  digestCanonicalManifest,
  encodeBase64URL,
  verifyEd25519
} from '@open-pencil/scene-graph'

interface CrossLanguageFixtureV1 {
  readonly fixtureFormat: 'openpencil.test.source-ledger-signed-receipt-cross-language'
  readonly fixtureVersion: 1
  readonly evaluatedAt: string
  readonly publicKeyBase64url: string
  readonly payloadDigest: string
  readonly envelope: BackendSourceLedgerSignedReceiptV1
  readonly canonicalEnvelopeSha256: string
  readonly signingBytesSha256: string
}

const fixture = JSON.parse(
  readFileSync(
    new URL('../../fixtures/backend-source-ledger-signed-receipt-v1.json', import.meta.url),
    'utf8'
  )
) as CrossLanguageFixtureV1

async function bytesDigest(value: Uint8Array): Promise<string> {
  return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', value)))
}

describe('native source-ledger signed receipt interoperability fixture', () => {
  test('authenticates the exact canonical TypeScript bytes with the shared real Ed25519 vector', async () => {
    expect(fixture.fixtureFormat).toBe(
      'openpencil.test.source-ledger-signed-receipt-cross-language'
    )
    expect(fixture.fixtureVersion).toBe(1)
    const canonicalEnvelope = await canonicalBackendSourceLedgerSignedReceiptV1Bytes(
      fixture.envelope
    )
    const signingBytes = await canonicalBackendSourceLedgerSignedReceiptSigningV1Bytes(
      fixture.envelope
    )
    expect(await bytesDigest(canonicalEnvelope)).toBe(fixture.canonicalEnvelopeSha256)
    expect(await bytesDigest(signingBytes)).toBe(fixture.signingBytesSha256)
    expect(
      await digestCanonicalManifest({
        format: fixture.envelope.format,
        version: fixture.envelope.version,
        receipt: fixture.envelope.receipt
      })
    ).toBe(fixture.payloadDigest)

    const publicKey = await crypto.subtle.importKey(
      'raw',
      decodeBase64URL(fixture.publicKeyBase64url),
      'Ed25519',
      false,
      ['verify']
    )
    expect(
      await verifyEd25519(signingBytes, fixture.envelope.integrity.signature.value, publicKey)
    ).toBe(true)
    expect(
      (await parseBackendSourceLedgerSignedReceiptV1Bytes(canonicalEnvelope)).structurallyValid
    ).toBe(true)
  })

  test('round-trips a newly signed envelope and rejects alternate escapes and nested duplicates', async () => {
    const payload = {
      format: fixture.envelope.format,
      version: fixture.envelope.version,
      receipt: fixture.envelope.receipt
    }
    const keyPair = (await crypto.subtle.generateKey('Ed25519', false, [
      'sign',
      'verify'
    ])) as CryptoKeyPair
    const integrity = await createSignedManifestIntegrity(
      payload,
      'openpencil.source-ledger.ci-test-ephemeral',
      keyPair.privateKey
    )
    const envelope = { ...payload, integrity }
    const canonical = await canonicalBackendSourceLedgerSignedReceiptV1Bytes(envelope)
    const signingBytes = await canonicalBackendSourceLedgerSignedReceiptSigningV1Bytes(envelope)
    expect(await verifyEd25519(signingBytes, integrity.signature.value, keyPair.publicKey)).toBe(
      true
    )

    const json = new TextDecoder().decode(canonical)
    const alternateEscape = json.replace('雪', '\\u96ea')
    const nestedDuplicate = json.replace(
      '"runId":"run-1001"',
      '"runId":"run-1001","runId":"run-1001"'
    )
    await expect(
      parseBackendSourceLedgerSignedReceiptV1Bytes(new TextEncoder().encode(alternateEscape))
    ).rejects.toThrow('unique canonical JSON encoding')
    await expect(
      parseBackendSourceLedgerSignedReceiptV1Bytes(new TextEncoder().encode(nestedDuplicate))
    ).rejects.toThrow('unique canonical JSON encoding')
  })

  test('shares the release-text secret and ECMAScript trim reject vectors', async () => {
    for (const repository of [
      'Bearer Abcdefghijklmno1',
      'Bearer\ufeffAbcdefghijklmno1',
      'postgres://user:password@host',
      '-----BEGIN PRIVATE KEY-----',
      'api_key=Abcdef1234567890',
      'Abcdefghijklmnopqrstuvwxyz0123456789',
      'api_key : Abcdef1234567890',
      'token: +Abcdefghijklmno',
      'eyJabcdefgh.eyJabcdefgh.abcdefgh!',
      'https://example.com postgres://user:password@host',
      '\ufeffopen-pencil/repository',
      'open-pencil/repository\ufeff'
    ]) {
      await expect(
        parseBackendSourceLedgerSignedReceiptV1({
          ...fixture.envelope,
          receipt: {
            ...fixture.envelope.receipt,
            attestation: { ...fixture.envelope.receipt.attestation, repository }
          }
        })
      ).rejects.toThrow()
    }
  })
})
