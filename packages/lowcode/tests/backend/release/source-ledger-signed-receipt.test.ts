import { describe, expect, test } from 'bun:test'

import {
  BACKEND_SOURCE_LEDGER_BINDING_RECEIPT_FORMAT,
  BACKEND_SOURCE_LEDGER_BINDING_SUBJECT_FORMAT,
  BACKEND_SOURCE_LEDGER_BINDING_VERSION,
  BACKEND_SOURCE_LEDGER_CI_ATTESTATION_FORMAT,
  digestBackendSourceLedgerAppliedPrefixV1,
  digestBackendSourceLedgerBindingSubjectV1,
  digestBackendSourceLedgerCIAttestationV1,
  parseBackendSourceLedgerBindingReceiptV1,
  parseBackendSourceLedgerBindingSubjectV1,
  type BackendSourceLedgerBindingReceiptV1,
  type BackendSourceLedgerBindingSubjectV1,
  type BackendSourceLedgerCIAttestationV1
} from '#lowcode/backend/release/source-ledger-binding'
import {
  BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_FORMAT,
  BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_LIMITS,
  BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_VERSION,
  canonicalBackendSourceLedgerSignedReceiptPayloadV1Bytes,
  canonicalBackendSourceLedgerSignedReceiptSigningV1Bytes,
  canonicalBackendSourceLedgerSignedReceiptV1Bytes,
  digestBackendSourceLedgerSignedReceiptPayloadV1,
  parseBackendSourceLedgerSignedReceiptV1,
  parseBackendSourceLedgerSignedReceiptV1Bytes,
  type BackendSourceLedgerSignedReceiptPayloadV1,
  type BackendSourceLedgerSignedReceiptV1
} from '#lowcode/backend/release/source-ledger-signed-receipt'

import {
  digestCanonicalManifest,
  encodeBase64URL,
  signedManifestBytes
} from '@open-pencil/scene-graph'

const ATTESTED_AT = '2026-09-08T10:00:00.000Z'
const RECORDED_AT = '2026-09-08T10:00:01.000Z'
const SIGNATURE = encodeBase64URL(new Uint8Array(64).fill(7))

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function subjectFixture(): Promise<BackendSourceLedgerBindingSubjectV1> {
  const appliedMigrationIds = ['p1-managed-schema', 'p1-owner-rls']
  const promotionLedgerDigest = await digest('promotion-ledger')
  return parseBackendSourceLedgerBindingSubjectV1({
    format: BACKEND_SOURCE_LEDGER_BINDING_SUBJECT_FORMAT,
    version: BACKEND_SOURCE_LEDGER_BINDING_VERSION,
    providerId: 'supabase',
    environment: 'staging',
    projectRef: 'enekobitnhobuiuamvqj',
    accountId: 'organization-1',
    providerAuthorityDigest: await digest('provider-authority'),
    applicationId: 'backend-application',
    applicationDigest: await digest('application'),
    migrationId: 'pending-receipt-v2-backfill',
    migrationDigest: await digest('pending-data-migration'),
    migrationPlanDigest: await digest('pending-data-migration-plan'),
    sourceLedgerDigest: promotionLedgerDigest,
    promotionLedgerDigest,
    sourceArtifact: {
      migrationId: appliedMigrationIds.at(-1),
      phase: 'expand',
      path: 'supabase/migrations/20260908090000_p1-owner-rls.sql',
      digest: await digest('p1-source-sql'),
      executionPlanDigest: await digest('p1-execution-plan'),
      migrationPlanDigest: await digest('p1-migration-plan')
    },
    inspectedLedger: {
      path: 'supabase/openpencil-inspected-source-ledger.json',
      fileDigest: await digest('inspected-ledger-file'),
      headDigest: await digest('inspected-ledger-head'),
      selectedEntryDigest: await digest('inspected-ledger-entry')
    },
    staging: {
      targetAuthority: {
        providerId: 'supabase',
        providerAuthorityDigest: await digest('provider-authority'),
        projectRef: 'enekobitnhobuiuamvqj',
        accountId: 'organization-1',
        grantGeneration: 'source-ledger-grant-1',
        environment: 'staging'
      },
      schemaDigest: await digest('staging-schema'),
      appliedMigrationIds,
      appliedPrefixDigest: await digestBackendSourceLedgerAppliedPrefixV1(appliedMigrationIds),
      lastReceiptDigest: await digest('last-promotion-receipt'),
      lastNoDriftReceiptDigest: await digest('last-no-drift-receipt'),
      drift: 'none'
    }
  })
}

async function receiptFixture(): Promise<BackendSourceLedgerBindingReceiptV1> {
  const subject = await subjectFixture()
  const subjectDigest = await digestBackendSourceLedgerBindingSubjectV1(subject)
  const attestation: BackendSourceLedgerCIAttestationV1 = {
    format: BACKEND_SOURCE_LEDGER_CI_ATTESTATION_FORMAT,
    version: BACKEND_SOURCE_LEDGER_BINDING_VERSION,
    subjectDigest,
    sourceLedgerDigest: subject.sourceLedgerDigest,
    stagingProjectRef: subject.projectRef,
    ciProvider: 'github-actions',
    repository: 'open-pencil/open-pencil',
    workflow: 'supabase-staging-migrations',
    runId: 'run-1001',
    runAttempt: 1,
    protectedRef: 'refs/heads/main',
    revision: '0123456789abcdef0123456789abcdef01234567',
    protectedRefVerified: true,
    dbPushCommandDigest: await digest('supabase-db-push-command'),
    dbPushReceiptDigest: await digest('supabase-db-push-receipt'),
    databaseHistoryDigest: await digest('database-migration-history'),
    succeeded: true,
    unresolvedMutation: false,
    attestedAt: ATTESTED_AT
  }
  return parseBackendSourceLedgerBindingReceiptV1({
    format: BACKEND_SOURCE_LEDGER_BINDING_RECEIPT_FORMAT,
    version: BACKEND_SOURCE_LEDGER_BINDING_VERSION,
    subject,
    subjectDigest,
    attestation,
    attestationDigest: await digestBackendSourceLedgerCIAttestationV1(attestation),
    recordedAt: RECORDED_AT
  })
}

function payload(
  receipt: BackendSourceLedgerBindingReceiptV1
): BackendSourceLedgerSignedReceiptPayloadV1 {
  return {
    format: BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_FORMAT,
    version: BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_VERSION,
    receipt
  }
}

async function signedReceipt(
  receipt: BackendSourceLedgerBindingReceiptV1,
  signature = SIGNATURE,
  keyId = 'openpencil.source-ledger.ci-2026-01'
): Promise<BackendSourceLedgerSignedReceiptV1> {
  const signedPayload = payload(receipt)
  return {
    ...signedPayload,
    integrity: {
      algorithm: 'SHA-256',
      digest: await digestBackendSourceLedgerSignedReceiptPayloadV1(signedPayload),
      signature: { algorithm: 'Ed25519', keyId, value: signature }
    }
  }
}

async function receiptWithAttestation(
  receipt: BackendSourceLedgerBindingReceiptV1,
  attestation: BackendSourceLedgerCIAttestationV1
): Promise<BackendSourceLedgerBindingReceiptV1> {
  return parseBackendSourceLedgerBindingReceiptV1({
    ...receipt,
    attestation,
    attestationDigest: await digestBackendSourceLedgerCIAttestationV1(attestation)
  })
}

async function receiptWithSubject(
  receipt: BackendSourceLedgerBindingReceiptV1,
  subject: BackendSourceLedgerBindingSubjectV1
): Promise<BackendSourceLedgerBindingReceiptV1> {
  const subjectDigest = await digestBackendSourceLedgerBindingSubjectV1(subject)
  const attestation: BackendSourceLedgerCIAttestationV1 = {
    ...receipt.attestation,
    subjectDigest,
    sourceLedgerDigest: subject.sourceLedgerDigest,
    stagingProjectRef: subject.projectRef
  }
  return parseBackendSourceLedgerBindingReceiptV1({
    ...receipt,
    subject,
    subjectDigest,
    attestation,
    attestationDigest: await digestBackendSourceLedgerCIAttestationV1(attestation)
  })
}

async function structurallySignedReceiptWithoutConsistencyCheck(
  receipt: BackendSourceLedgerBindingReceiptV1
): Promise<BackendSourceLedgerSignedReceiptV1> {
  const signedPayload = payload(receipt)
  return {
    ...signedPayload,
    integrity: {
      algorithm: 'SHA-256',
      digest: await digestCanonicalManifest(signedPayload),
      signature: {
        algorithm: 'Ed25519',
        keyId: 'openpencil.source-ledger.untrusted-test-key',
        value: SIGNATURE
      }
    }
  }
}

describe('provider-neutral source-ledger signed receipt structure', () => {
  test('binds the envelope version and complete receipt into canonical payload bytes', async () => {
    const receipt = await receiptFixture()
    const envelope = await signedReceipt(receipt)
    const parsed = await parseBackendSourceLedgerSignedReceiptV1(envelope)
    const signedPayload = payload(receipt)

    expect(parsed.structurallyValid).toBe(true)
    expect(parsed.payloadDigest).toBe(envelope.integrity.digest)
    expect(await canonicalBackendSourceLedgerSignedReceiptPayloadV1Bytes(signedPayload)).toEqual(
      await canonicalBackendSourceLedgerSignedReceiptPayloadV1Bytes(structuredClone(signedPayload))
    )
    expect(await canonicalBackendSourceLedgerSignedReceiptSigningV1Bytes(envelope)).toEqual(
      signedManifestBytes(signedPayload, envelope.integrity.digest)
    )
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.signedReceipt)).toBe(true)
    expect(Object.isFrozen(parsed.signedReceipt.integrity.signature)).toBe(true)
    expect(Object.keys(parsed).sort()).toEqual([
      'payloadDigest',
      'signedReceipt',
      'structurallyValid'
    ])
    for (const forbidden of [
      'trusted',
      'verified',
      'signatureVerified',
      'ciAuthenticated',
      'sourceLedgerAuthorityGranted',
      'releaseReady'
    ]) {
      expect(forbidden in parsed).toBe(false)
    }
  })

  test('binds CI revision, source ledger, db-push, and database-history facts', async () => {
    const receipt = await receiptFixture()
    const baseline = await digestBackendSourceLedgerSignedReceiptPayloadV1(payload(receipt))
    const otherDigest = await digest('other')
    const cases = await Promise.all([
      receiptWithAttestation(receipt, {
        ...receipt.attestation,
        repository: 'other/repository'
      }),
      receiptWithAttestation(receipt, {
        ...receipt.attestation,
        workflow: 'other-workflow'
      }),
      receiptWithAttestation(receipt, {
        ...receipt.attestation,
        protectedRef: 'refs/heads/release'
      }),
      receiptWithAttestation(receipt, {
        ...receipt.attestation,
        revision: 'fedcba9876543210fedcba9876543210fedcba98'
      }),
      receiptWithSubject(receipt, {
        ...receipt.subject,
        sourceLedgerDigest: otherDigest,
        promotionLedgerDigest: otherDigest
      }),
      receiptWithAttestation(receipt, {
        ...receipt.attestation,
        dbPushCommandDigest: otherDigest
      }),
      receiptWithAttestation(receipt, {
        ...receipt.attestation,
        dbPushReceiptDigest: otherDigest
      }),
      receiptWithAttestation(receipt, {
        ...receipt.attestation,
        databaseHistoryDigest: otherDigest
      })
    ])

    for (const candidate of cases) {
      expect(await digestBackendSourceLedgerSignedReceiptPayloadV1(payload(candidate))).not.toBe(
        baseline
      )
    }
  })

  test('checks canonical digest linkage and internal receipt consistency without verifying Ed25519', async () => {
    const receipt = await receiptFixture()
    const envelope = await signedReceipt(receipt)
    const otherSignature = encodeBase64URL(new Uint8Array(64).fill(9))
    const otherKeyEnvelope = await signedReceipt(
      receipt,
      otherSignature,
      'openpencil.source-ledger.untrusted-test-key'
    )
    expect(
      (await parseBackendSourceLedgerSignedReceiptV1(otherKeyEnvelope)).structurallyValid
    ).toBe(true)

    await expect(
      parseBackendSourceLedgerSignedReceiptV1({
        ...envelope,
        integrity: { ...envelope.integrity, digest: await digest('mismatched-envelope') }
      })
    ).rejects.toThrow('does not match the canonical payload')

    const inconsistentReceipt = {
      ...receipt,
      subjectDigest: await digest('mismatched-subject')
    }
    await expect(
      digestBackendSourceLedgerSignedReceiptPayloadV1(payload(inconsistentReceipt))
    ).rejects.toThrow('internal canonical digest mismatch')
    await expect(
      parseBackendSourceLedgerSignedReceiptV1(
        await structurallySignedReceiptWithoutConsistencyCheck(inconsistentReceipt)
      )
    ).rejects.toThrow('internal canonical digest mismatch')

    const lateAttestation = {
      ...receipt.attestation,
      attestedAt: '2026-09-08T10:00:02.000Z'
    }
    const lateReceipt = await receiptWithAttestation(receipt, lateAttestation)
    await expect(
      canonicalBackendSourceLedgerSignedReceiptPayloadV1Bytes(payload(lateReceipt))
    ).rejects.toThrow('must not postdate the receipt')
    await expect(
      parseBackendSourceLedgerSignedReceiptV1(
        await structurallySignedReceiptWithoutConsistencyCheck(lateReceipt)
      )
    ).rejects.toThrow('must not postdate the receipt')
  })

  test('denies extension properties, accessors, custom prototypes, and malformed integrity', async () => {
    const envelope = await signedReceipt(await receiptFixture())
    await expect(
      parseBackendSourceLedgerSignedReceiptV1({ ...envelope, trusted: true })
    ).rejects.toThrow('unsupported fields')
    await expect(
      parseBackendSourceLedgerSignedReceiptV1({
        ...envelope,
        receipt: { ...envelope.receipt, extra: true }
      })
    ).rejects.toThrow('unsupported fields')
    await expect(
      parseBackendSourceLedgerSignedReceiptV1({
        ...envelope,
        integrity: { ...envelope.integrity, extra: true }
      })
    ).rejects.toThrow('unsupported fields')
    await expect(
      parseBackendSourceLedgerSignedReceiptV1({
        ...envelope,
        integrity: {
          ...envelope.integrity,
          signature: { ...envelope.integrity.signature, value: SIGNATURE.slice(1) }
        }
      })
    ).rejects.toThrow('Ed25519 base64url signature')

    const accessor = { ...envelope }
    Object.defineProperty(accessor, 'receipt', {
      enumerable: true,
      get: () => envelope.receipt
    })
    await expect(parseBackendSourceLedgerSignedReceiptV1(accessor)).rejects.toThrow(
      'enumerable data property values only'
    )
    await expect(
      parseBackendSourceLedgerSignedReceiptV1(
        Object.assign(Object.create({ inherited: true }), envelope)
      )
    ).rejects.toThrow('plain data object')
  })

  test('enforces inherited string and array limits plus the raw byte bound', async () => {
    const envelope = await signedReceipt(await receiptFixture())
    await expect(
      parseBackendSourceLedgerSignedReceiptV1({
        ...envelope,
        receipt: {
          ...envelope.receipt,
          attestation: { ...envelope.receipt.attestation, repository: 'r'.repeat(1_025) }
        }
      })
    ).rejects.toThrow('at most 1024 characters')

    await expect(
      parseBackendSourceLedgerSignedReceiptV1({
        ...envelope,
        receipt: {
          ...envelope.receipt,
          attestation: { ...envelope.receipt.attestation, repository: 'open-pencil/\ud800' }
        }
      })
    ).rejects.toThrow('Unicode scalar values only')

    await expect(
      parseBackendSourceLedgerSignedReceiptV1({
        ...envelope,
        receipt: {
          ...envelope.receipt,
          subject: {
            ...envelope.receipt.subject,
            staging: {
              ...envelope.receipt.subject.staging,
              appliedMigrationIds: Array.from({ length: 257 }, (_, index) => `migration-${index}`)
            }
          }
        }
      })
    ).rejects.toThrow('maximum item count')

    await expect(
      parseBackendSourceLedgerSignedReceiptV1Bytes(
        new Uint8Array(BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_LIMITS.maxJsonBytes + 1)
      )
    ).rejects.toThrow('bounded canonical JSON size')
  })

  test('accepts only the unique canonical UTF-8 byte representation', async () => {
    const envelope = await signedReceipt(await receiptFixture())
    const canonical = await canonicalBackendSourceLedgerSignedReceiptV1Bytes(envelope)
    expect((await parseBackendSourceLedgerSignedReceiptV1Bytes(canonical)).structurallyValid).toBe(
      true
    )

    const json = new TextDecoder().decode(canonical)
    const duplicateFormat = json.replace(
      '"format":',
      `"format":"${BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_FORMAT}","format":`
    )
    await expect(
      parseBackendSourceLedgerSignedReceiptV1Bytes(new TextEncoder().encode(` ${json}`))
    ).rejects.toThrow('unique canonical JSON encoding')
    await expect(
      parseBackendSourceLedgerSignedReceiptV1Bytes(new TextEncoder().encode(duplicateFormat))
    ).rejects.toThrow('unique canonical JSON encoding')
    await expect(parseBackendSourceLedgerSignedReceiptV1Bytes(Uint8Array.of(0xff))).rejects.toThrow(
      'canonical UTF-8 JSON'
    )
  })
})
