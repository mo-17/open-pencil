import { describe, expect, test } from 'bun:test'

import {
  BACKEND_SOURCE_LEDGER_BINDING_RECEIPT_FORMAT,
  BACKEND_SOURCE_LEDGER_BINDING_SUBJECT_FORMAT,
  BACKEND_SOURCE_LEDGER_BINDING_VERSION,
  BACKEND_SOURCE_LEDGER_CI_ATTESTATION_FORMAT,
  canonicalBackendSourceLedgerBindingReceiptV1Bytes,
  digestBackendSourceLedgerAppliedPrefixV1,
  digestBackendSourceLedgerBindingReceiptV1,
  digestBackendSourceLedgerBindingSubjectV1,
  digestBackendSourceLedgerCIAttestationV1,
  parseBackendSourceLedgerBindingReceiptV1,
  parseBackendSourceLedgerBindingSubjectV1,
  verifyBackendSourceLedgerBindingReceiptV1,
  type BackendSourceLedgerBindingReceiptV1,
  type BackendSourceLedgerBindingSubjectV1,
  type BackendSourceLedgerCIAttestationV1
} from '#lowcode/backend/release/source-ledger-binding'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { stripeSecretCanary } from '../fixture'

const ATTESTED_AT = '2026-09-07T10:00:00.000Z'
const RECORDED_AT = '2026-09-07T10:00:01.000Z'
const EVALUATED_AT = '2026-09-07T10:00:02.000Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function subjectFixture(
  overrides: Partial<BackendSourceLedgerBindingSubjectV1> = {}
): Promise<BackendSourceLedgerBindingSubjectV1> {
  const appliedMigrationIds = overrides.staging?.appliedMigrationIds ?? [
    'p1-managed-schema',
    'p1-owner-rls'
  ]
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
      path: 'supabase/migrations/20260907090000_p1-owner-rls.sql',
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
    },
    ...overrides
  })
}

async function receiptFixture(
  subjectInput?: BackendSourceLedgerBindingSubjectV1
): Promise<BackendSourceLedgerBindingReceiptV1> {
  const subject = subjectInput ?? (await subjectFixture())
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

describe('provider-neutral source-ledger binding evidence', () => {
  test('verifies exact evidence while explicitly granting no CI or release authority', async () => {
    const receipt = await receiptFixture()
    const result = await verifyBackendSourceLedgerBindingReceiptV1(receipt, {
      expectedSubject: receipt.subject,
      evaluatedAt: EVALUATED_AT
    })

    expect(result).toMatchObject({
      ok: true,
      releaseReady: false,
      sourceLedgerAuthorityGranted: false,
      databaseAuthorityGranted: false,
      executionAuthorityGranted: false,
      ciAuthenticated: false
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.receiptDigest).toBe(await digestBackendSourceLedgerBindingReceiptV1(receipt))
    expect(canonicalBackendSourceLedgerBindingReceiptV1Bytes(receipt)).toEqual(
      canonicalBackendSourceLedgerBindingReceiptV1Bytes(structuredClone(receipt))
    )
    expect(Object.isFrozen(result.receipt)).toBe(true)
    expect(Object.isFrozen(result.receipt.subject.staging.appliedMigrationIds)).toBe(true)
  })

  test('keeps the strict promotion ledger digest distinct from inspected supporting evidence', async () => {
    const subject = await subjectFixture()
    expect(subject.sourceLedgerDigest).toBe(subject.promotionLedgerDigest)
    expect(subject.sourceLedgerDigest).not.toBe(subject.inspectedLedger.fileDigest)
    expect(subject.sourceLedgerDigest).not.toBe(subject.inspectedLedger.headDigest)
    expect(subject.sourceLedgerDigest).not.toBe(subject.inspectedLedger.selectedEntryDigest)

    expect(() =>
      parseBackendSourceLedgerBindingSubjectV1({
        ...subject,
        promotionLedgerDigest: subject.inspectedLedger.fileDigest
      })
    ).toThrow('must equal promotionLedgerDigest')
  })

  test('binds a P1 prerequisite prefix without pretending the pending backfill is applied', async () => {
    const subject = await subjectFixture()
    expect(subject.staging.appliedMigrationIds).not.toContain(subject.migrationId)
    expect(subject.sourceArtifact.migrationId).toBe(
      subject.staging.appliedMigrationIds.at(-1) as string
    )

    expect(() =>
      parseBackendSourceLedgerBindingSubjectV1({
        ...subject,
        sourceArtifact: { ...subject.sourceArtifact, migrationId: subject.migrationId }
      })
    ).toThrow('final applied prerequisite')
    const appliedPending = [...subject.staging.appliedMigrationIds, subject.migrationId]
    const appliedPendingDigest = await digestBackendSourceLedgerAppliedPrefixV1(appliedPending)
    expect(() =>
      parseBackendSourceLedgerBindingSubjectV1({
        ...subject,
        sourceArtifact: { ...subject.sourceArtifact, migrationId: subject.migrationId },
        staging: {
          ...subject.staging,
          appliedMigrationIds: appliedPending,
          appliedPrefixDigest: appliedPendingDigest
        }
      })
    ).toThrow('must remain outside the applied prerequisite prefix')
  })

  test('rejects canonical digest, expected-subject, attestation, and timestamp drift', async () => {
    const receipt = await receiptFixture()
    const otherDigest = await digest('other')
    const cases: Array<{
      value: unknown
      expectedSubject?: BackendSourceLedgerBindingSubjectV1
      evaluatedAt?: string
      code: string
    }> = [
      {
        value: { ...receipt, subjectDigest: otherDigest },
        code: 'source-ledger-binding-digest-mismatch'
      },
      {
        value: receipt,
        expectedSubject: await subjectFixture({ migrationDigest: otherDigest }),
        code: 'source-ledger-binding-subject-mismatch'
      },
      {
        value: {
          ...receipt,
          attestation: { ...receipt.attestation, sourceLedgerDigest: otherDigest },
          attestationDigest: await digestBackendSourceLedgerCIAttestationV1({
            ...receipt.attestation,
            sourceLedgerDigest: otherDigest
          })
        },
        code: 'source-ledger-binding-attestation-mismatch'
      },
      {
        value: receipt,
        evaluatedAt: '2026-09-07T09:59:59.000Z',
        code: 'source-ledger-binding-time-invalid'
      }
    ]
    for (const entry of cases) {
      const result = await verifyBackendSourceLedgerBindingReceiptV1(entry.value, {
        expectedSubject: entry.expectedSubject ?? receipt.subject,
        evaluatedAt: entry.evaluatedAt ?? EVALUATED_AT
      })
      expect(result).toMatchObject({ ok: false, code: entry.code, releaseReady: false })
    }
  })

  test('rejects reordered or duplicated applied prefixes even when caller rewrites outer fields', async () => {
    const receipt = await receiptFixture()
    const reorderedIds = [...receipt.subject.staging.appliedMigrationIds].reverse()
    const reorderedSubject = await subjectFixture({
      sourceArtifact: {
        ...receipt.subject.sourceArtifact,
        migrationId: reorderedIds.at(-1) as string
      },
      staging: {
        ...receipt.subject.staging,
        appliedMigrationIds: reorderedIds,
        appliedPrefixDigest: await digestBackendSourceLedgerAppliedPrefixV1(reorderedIds)
      }
    })
    const result = await verifyBackendSourceLedgerBindingReceiptV1(
      await receiptFixture(reorderedSubject),
      { expectedSubject: receipt.subject, evaluatedAt: EVALUATED_AT }
    )
    expect(result).toMatchObject({ ok: false, code: 'source-ledger-binding-subject-mismatch' })

    expect(() =>
      parseBackendSourceLedgerBindingSubjectV1({
        ...receipt.subject,
        staging: {
          ...receipt.subject.staging,
          appliedMigrationIds: ['p1-owner-rls', 'p1-owner-rls']
        }
      })
    ).toThrow('unique applied prefix')
  })

  test('rejects accessors, extension fields, custom prototypes, and secret-like CI data', async () => {
    const receipt = await receiptFixture()
    const accessor = { ...receipt }
    Object.defineProperty(accessor, 'subject', { enumerable: true, get: () => receipt.subject })
    expect(() => parseBackendSourceLedgerBindingReceiptV1(accessor)).toThrow()
    expect(() => parseBackendSourceLedgerBindingReceiptV1({ ...receipt, extra: true })).toThrow()
    expect(() =>
      parseBackendSourceLedgerBindingReceiptV1(
        Object.assign(Object.create({ inherited: true }), receipt)
      )
    ).toThrow()

    expect(() =>
      parseBackendSourceLedgerBindingReceiptV1({
        ...receipt,
        attestation: {
          ...receipt.attestation,
          repository: stripeSecretCanary
        }
      })
    ).toThrow()
  })
})
