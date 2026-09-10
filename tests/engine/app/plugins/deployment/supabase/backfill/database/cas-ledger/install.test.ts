/* oxlint-disable eslint(max-lines) -- One threat matrix keeps the CAS-ledger install preparation auditable. */

import { describe, expect, spyOn, test } from 'bun:test'

import {
  authorizeSupabaseBackfillDatabaseCASLedgerInstallV1,
  consumeTrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1,
  createSupabaseBackfillDatabaseCASLedgerInstallReviewV1,
  deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MIGRATION_NAME,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_REVIEW_FORMAT,
  SupabaseBackfillDatabaseCASLedgerInstallError,
  trustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1,
  trustedSupabaseBackfillDatabaseCASLedgerInstallReviewContextV1,
  type AuthorizeSupabaseBackfillDatabaseCASLedgerInstallOptionsV1,
  type SupabaseBackfillDatabaseCASLedgerInstallErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install'
import { consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1 } from '@/app/plugins/host/deployment/supabase/backfill/locked-high-water-capture'

import {
  BACKFILL_DATABASE_CAS_LEDGER_INSTALL_NON_UUID_READ_GRANT,
  BACKFILL_DATABASE_CAS_LEDGER_INSTALL_NON_UUID_WRITE_GRANT,
  BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT,
  BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
  createBackfillDatabaseCASLedgerAbsentVerificationFixtureV1,
  createBackfillDatabaseCASLedgerInstallReviewFixtureV1
} from './helpers'

interface MutableVerificationSettings {
  databasePrimary: boolean
}

interface MutableInstallInput {
  [key: string]: unknown
}

interface MutableDispatchContextInput {
  baseSqlDigest?: unknown
}

async function installError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillDatabaseCASLedgerInstallErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillDatabaseCASLedgerInstallError)
    expect((cause as SupabaseBackfillDatabaseCASLedgerInstallError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected CAS-ledger install error ${expected}`)
}

function authorize(
  fixture: Awaited<ReturnType<typeof createBackfillDatabaseCASLedgerInstallReviewFixtureV1>>,
  overrides: Partial<AuthorizeSupabaseBackfillDatabaseCASLedgerInstallOptionsV1> = {}
) {
  return authorizeSupabaseBackfillDatabaseCASLedgerInstallV1({
    installReview: fixture.installReview,
    stagingTargetBinding: fixture.stagingTarget,
    confirmation: fixture.confirmation,
    readCurrentReadAuthority: () => fixture.readAuthority,
    readCurrentWriteAuthority: () => fixture.writeAuthority,
    readCurrentStagingTargetBinding: () => fixture.stagingTarget,
    ...overrides
  })
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor && 'value' in descriptor) expectDeepFrozen(descriptor.value, seen)
  }
}

describe('Supabase backfill database CAS ledger install preparation', () => {
  test('binds the genuine absent snapshot and exact reviewed SQL without creating authority', async () => {
    const fixture = await createBackfillDatabaseCASLedgerInstallReviewFixtureV1()
    const install = fixture.installReview

    expect(install.review).toMatchObject({
      format: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_REVIEW_FORMAT,
      version: 1,
      providerId: 'supabase',
      environmentIntent: 'staging',
      reviewOnly: true,
      applyAvailable: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false,
      installAuthorityCreated: false,
      installedVerificationCreated: false,
      bindings: {
        sourceReviewDigest: fixture.sourceReview.reviewDigest,
        receiptReviewDigest: fixture.receiptReview.reviewDigest,
        verificationDigest: fixture.absentVerification.verificationDigest,
        scopeDraftDigest: fixture.sourceReview.review.bindings.scopeDraftDigest,
        captureDigest: fixture.sourceReview.review.bindings.captureDigest,
        providerAuthorityDigest: fixture.sourceReview.review.bindings.providerAuthorityDigest,
        applicationDigest: fixture.sourceReview.review.bindings.applicationDigest,
        migrationDigest: fixture.sourceReview.review.bindings.migrationDigest,
        ledgerShapeDigest: fixture.sourceReview.review.bindings.ledgerShapeDigest,
        sqlDigest: fixture.sourceReview.review.bindings.sqlDigest,
        markerBindingDigest: install.review.bindings.markerBindingDigest,
        installSqlDigest: install.review.bindings.installSqlDigest,
        verificationQueryDigest: fixture.absentVerification.query.digest
      },
      installationMarker: {
        constraintName: 'backfill_executions_v1_pkey',
        operationNonce: install.review.installationMarker.operationNonce,
        marker: install.review.installationMarker.marker
      },
      authority: {
        projectRef: fixture.readAuthority.projectRef,
        accountId: fixture.readAuthority.accountId,
        readGrantGeneration: fixture.readAuthority.grantGeneration,
        previousInstallWriteGrantGeneration:
          fixture.receiptReview.review.authority.installWriteGrantGeneration,
        captureWriteGrantGeneration:
          fixture.receiptReview.review.authority.captureWriteGrantGeneration
      },
      migration: {
        name: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MIGRATION_NAME,
        endpointKind: 'management-api-migration',
        sqlSource: 'exact-reviewed-base-sql-plus-operation-marker',
        verificationRequiredAfterAcceptance: true
      },
      artifact: {
        path: fixture.sourceReview.review.artifact.path,
        byteLength: new TextEncoder().encode(install.installSql).byteLength,
        digest: install.review.bindings.installSqlDigest,
        statementCount: 20,
        schemaMutationStatementCount: 14,
        exactReviewedBaseSqlPlusOperationMarker: true,
        mutationDispatched: false,
        hostDispatchAvailable: false
      }
    })
    expect(install.review.installationMarker.operationNonce).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
    expect(install.review.installationMarker.marker).toBe(
      `openpencil-install:v1:supabase-backfill-database-cas-ledger:${install.review.bindings.markerBindingDigest}`
    )
    expect(install.installSql).not.toBe(fixture.sourceReview.previewSql)
    expect(install.installSql).toContain(
      `COMMENT ON CONSTRAINT "backfill_executions_v1_pkey" ON "openpencil_release"."backfill_executions_v1"\n  IS '${install.review.installationMarker.marker}';\nCOMMIT;\n`
    )
    expect(install.installSql.match(/\bCOMMIT;/gu)).toHaveLength(1)
    expect(install.installReviewDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(install.review.blockers).toEqual(
      expect.arrayContaining([
        'operation-scoped-database-write-authority-not-bound',
        'dispatch-not-journaled',
        'database-ledger-installed-proof-not-observed',
        'source-migration-ledger-not-bound',
        'capture-receipt-not-persisted',
        'bounded-runner-unavailable'
      ])
    )
    expect(trustedSupabaseBackfillDatabaseCASLedgerInstallReviewContextV1(install)).toBe(install)
    expect(
      trustedSupabaseBackfillDatabaseCASLedgerInstallReviewContextV1(structuredClone(install))
    ).toBeNull()
    expectDeepFrozen(install)
  })

  test('rejects clones and genuine absent snapshots whose safety checks did not all pass', async () => {
    const fixture = await createBackfillDatabaseCASLedgerInstallReviewFixtureV1()
    await installError(
      createSupabaseBackfillDatabaseCASLedgerInstallReviewV1({
        review: fixture.sourceReview,
        absentVerification: structuredClone(fixture.absentVerification)
      }),
      'supabase-backfill-database-cas-ledger-install-proof-invalid'
    )

    const unsafe = await createBackfillDatabaseCASLedgerAbsentVerificationFixtureV1((value) => {
      const settings = value.settings as MutableVerificationSettings
      settings.databasePrimary = false
      return value
    })
    expect(unsafe.absentVerification.state).toBe('absent')
    expect(unsafe.absentVerification.checks.absentStateExact).toBe(true)
    expect(unsafe.absentVerification.checks.allVerificationChecksPassed).toBe(false)
    await installError(
      createSupabaseBackfillDatabaseCASLedgerInstallReviewV1({
        review: unsafe.sourceReview,
        absentVerification: unsafe.absentVerification
      }),
      'supabase-backfill-database-cas-ledger-install-absent-proof-required'
    )

    const accessorInput = Object.create(null) as MutableInstallInput
    Object.defineProperty(accessorInput, 'review', {
      enumerable: true,
      get: () => fixture.sourceReview
    })
    Object.defineProperty(accessorInput, 'absentVerification', {
      enumerable: true,
      value: fixture.absentVerification
    })
    await installError(
      createSupabaseBackfillDatabaseCASLedgerInstallReviewV1(accessorInput as never),
      'supabase-backfill-database-cas-ledger-install-input-invalid'
    )
  })

  test('mints one redacted capability after explicit staging and independent write-grant checks', async () => {
    const fixture = await createBackfillDatabaseCASLedgerInstallReviewFixtureV1()
    const secondPreview = await createSupabaseBackfillDatabaseCASLedgerInstallReviewV1({
      review: fixture.sourceReview,
      absentVerification: fixture.absentVerification
    })
    expect(secondPreview.review.installationMarker.operationNonce).not.toBe(
      fixture.installReview.review.installationMarker.operationNonce
    )
    expect(secondPreview.review.installationMarker.marker).not.toBe(
      fixture.installReview.review.installationMarker.marker
    )
    await installError(
      authorize(fixture, {
        confirmation: { ...fixture.confirmation, sqlDigest: 'A'.repeat(43) }
      }),
      'supabase-backfill-database-cas-ledger-install-confirmation-mismatch'
    )
    await installError(
      authorize(fixture, {
        confirmation: {
          ...fixture.confirmation,
          marker: `openpencil-install:v1:supabase-backfill-database-cas-ledger:${'A'.repeat(43)}`
        }
      }),
      'supabase-backfill-database-cas-ledger-install-confirmation-mismatch'
    )

    const context = await authorize(fixture)
    expect(context).toMatchObject({
      providerId: 'supabase',
      environment: 'staging',
      projectRef: fixture.readAuthority.projectRef,
      accountId: fixture.readAuthority.accountId,
      installReviewDigest: fixture.installReview.installReviewDigest,
      sourceReviewDigest: fixture.sourceReview.reviewDigest,
      verificationDigest: fixture.absentVerification.verificationDigest,
      ledgerShapeDigest: fixture.sourceReview.review.bindings.ledgerShapeDigest,
      sqlDigest: fixture.sourceReview.review.bindings.sqlDigest,
      marker: fixture.installReview.review.installationMarker.marker,
      markerBindingDigest: fixture.installReview.review.bindings.markerBindingDigest,
      installSqlDigest: fixture.installReview.review.bindings.installSqlDigest,
      verificationQueryDigest: fixture.absentVerification.query.digest,
      migrationName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MIGRATION_NAME,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      verificationRequired: true,
      releaseReady: false
    })
    expect(context).not.toHaveProperty('installSql')
    expect(context).not.toHaveProperty('writeGrantGeneration')
    expect(JSON.stringify(context)).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT)
    expect(Object.isFrozen(context)).toBe(true)

    const credentialLeaseBinding =
      deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(context)
    expect(credentialLeaseBinding).toEqual({
      purpose: 'backfill-database-cas-ledger-install',
      projectRef: fixture.readAuthority.projectRef,
      accountId: fixture.readAuthority.accountId,
      installReviewDigest: fixture.installReview.installReviewDigest,
      sourceReviewDigest: fixture.sourceReview.reviewDigest,
      verificationDigest: fixture.absentVerification.verificationDigest,
      ledgerShapeDigest: fixture.sourceReview.review.bindings.ledgerShapeDigest,
      baseSqlDigest: fixture.sourceReview.review.bindings.sqlDigest,
      marker: fixture.installReview.review.installationMarker.marker,
      markerBindingDigest: fixture.installReview.review.bindings.markerBindingDigest,
      installSqlDigest: fixture.installReview.review.bindings.installSqlDigest,
      verificationQueryDigest: fixture.absentVerification.query.digest,
      expectedSharedGrantGeneration: fixture.writeAuthority.grantGeneration
    })
    expect(Object.isFrozen(credentialLeaseBinding)).toBe(true)
    expect(credentialLeaseBinding).not.toHaveProperty('installSql')
    expect(credentialLeaseBinding).not.toHaveProperty('personalAccessToken')
    expect(JSON.stringify(credentialLeaseBinding)).not.toContain(
      BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT
    )

    const trustedEvidence =
      trustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1(context)
    expect(trustedEvidence?.installReview).toBe(fixture.installReview)
    expect(trustedEvidence?.sourceReview).toBe(fixture.sourceReview)
    expect(trustedEvidence?.absentVerification).toBe(fixture.absentVerification)
    expect(trustedEvidence?.readAuthority).toEqual(fixture.readAuthority)
    expect(trustedEvidence?.writeAuthority).toEqual(fixture.writeAuthority)
    expect(trustedEvidence?.stagingTarget).toEqual(fixture.stagingTarget)
    expect(Object.isFrozen(trustedEvidence)).toBe(true)
    expect(trustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1(context)).toBe(
      trustedEvidence
    )

    const clonedContext = structuredClone(context)
    expect(
      deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(clonedContext)
    ).toBeNull()
    expect(
      deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1({
        ...clonedContext,
        installSqlDigest: 'A'.repeat(43)
      })
    ).toBeNull()
    expect(
      trustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1(clonedContext)
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1(clonedContext)
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1({
        ...clonedContext,
        baseSqlDigest: clonedContext.installSqlDigest
      })
    ).toBeNull()
    let accessorReads = 0
    const accessorContext = Object.create(null) as MutableDispatchContextInput
    Object.defineProperty(accessorContext, 'baseSqlDigest', {
      enumerable: true,
      get: () => {
        accessorReads += 1
        return context.sqlDigest
      }
    })
    expect(
      deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(accessorContext)
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1(accessorContext)
    ).toBeNull()
    expect(accessorReads).toBe(0)
    expect(
      deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(
        new Proxy(context, {
          get() {
            throw new TypeError('Dispatch context proxy must remain unread')
          }
        })
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1(
        new Proxy(context, {
          get() {
            throw new TypeError('Dispatch context proxy must remain unread')
          }
        })
      )
    ).toBeNull()

    const trustedDispatch =
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1(context)
    expect(trustedDispatch).toEqual({
      projectRef: fixture.readAuthority.projectRef,
      accountId: fixture.readAuthority.accountId,
      readGrantGeneration: fixture.readAuthority.grantGeneration,
      writeGrantGeneration: fixture.writeAuthority.grantGeneration,
      migrationName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MIGRATION_NAME,
      installSql: fixture.installReview.installSql,
      installReviewDigest: fixture.installReview.installReviewDigest,
      sourceReviewDigest: fixture.sourceReview.reviewDigest,
      verificationDigest: fixture.absentVerification.verificationDigest,
      ledgerShapeDigest: fixture.sourceReview.review.bindings.ledgerShapeDigest,
      baseSqlDigest: fixture.sourceReview.review.bindings.sqlDigest,
      marker: fixture.installReview.review.installationMarker.marker,
      markerBindingDigest: fixture.installReview.review.bindings.markerBindingDigest,
      installSqlDigest: fixture.installReview.review.bindings.installSqlDigest,
      verificationQueryDigest: fixture.absentVerification.query.digest
    })
    expect(trustedDispatch).not.toHaveProperty('sqlDigest')
    expect(Object.isFrozen(trustedDispatch)).toBe(true)
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1(context)
    ).toBeNull()
    expect(
      deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(context)
    ).toBeNull()
    expect(trustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1(context)).toBe(
      trustedEvidence
    )

    const tampered = structuredClone(fixture.installReview)
    const tamperedEnvelope = {
      ...tampered,
      installSql: `${tampered.installSql}\n-- tampered`
    }
    await installError(
      authorize(fixture, { installReview: tamperedEnvelope }),
      'supabase-backfill-database-cas-ledger-install-proof-invalid'
    )
    await installError(
      authorize(fixture, { installReview: new Proxy(fixture.installReview, {}) }),
      'supabase-backfill-database-cas-ledger-install-proof-invalid'
    )

    await installError(
      authorizeSupabaseBackfillDatabaseCASLedgerInstallV1({
        installReview: secondPreview,
        stagingTargetBinding: fixture.stagingTarget,
        confirmation: {
          ...fixture.confirmation,
          installReviewDigest: secondPreview.installReviewDigest
        },
        readCurrentReadAuthority: () => fixture.readAuthority,
        readCurrentWriteAuthority: () => fixture.writeAuthority,
        readCurrentStagingTargetBinding: () => fixture.stagingTarget
      }),
      'supabase-backfill-database-cas-ledger-install-proof-invalid'
    )
  })

  test('burns a preparation when prior grants are reused, live staging drifts, or source proof disappears', async () => {
    const reused = await createBackfillDatabaseCASLedgerInstallReviewFixtureV1()
    const reusedAuthority = {
      ...reused.writeAuthority,
      grantGeneration: reused.readAuthority.grantGeneration
    }
    await installError(
      authorize(reused, {
        confirmation: {
          ...reused.confirmation,
          writeGrantGeneration: reused.readAuthority.grantGeneration
        },
        readCurrentWriteAuthority: () => reusedAuthority
      }),
      'supabase-backfill-database-cas-ledger-install-write-authority-not-separated'
    )

    const drifted = await createBackfillDatabaseCASLedgerInstallReviewFixtureV1()
    let stagingReads = 0
    await installError(
      authorize(drifted, {
        readCurrentStagingTargetBinding: () => {
          stagingReads += 1
          return stagingReads === 1 ? drifted.stagingTarget : null
        }
      }),
      'supabase-backfill-database-cas-ledger-install-staging-target-mismatch'
    )

    const stale = await createBackfillDatabaseCASLedgerInstallReviewFixtureV1()
    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(stale.captured.capture)
    ).not.toBeNull()
    await installError(
      authorize(stale),
      'supabase-backfill-database-cas-ledger-install-input-changed'
    )
  })

  test('rejects non-UUID read and database-write credential generations during authority snapshotting', async () => {
    const invalidRead = await createBackfillDatabaseCASLedgerInstallReviewFixtureV1()
    await installError(
      authorize(invalidRead, {
        readCurrentReadAuthority: () => ({
          ...invalidRead.readAuthority,
          grantGeneration: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_NON_UUID_READ_GRANT
        })
      }),
      'supabase-backfill-database-cas-ledger-install-read-authority-invalid'
    )

    const invalidWrite = await createBackfillDatabaseCASLedgerInstallReviewFixtureV1()
    await installError(
      authorize(invalidWrite, {
        confirmation: {
          ...invalidWrite.confirmation,
          writeGrantGeneration: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_NON_UUID_WRITE_GRANT
        },
        readCurrentWriteAuthority: () => ({
          ...invalidWrite.writeAuthority,
          grantGeneration: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_NON_UUID_WRITE_GRANT
        })
      }),
      'supabase-backfill-database-cas-ledger-install-write-authority-invalid'
    )
  })

  test('burns dispatch when upstream proof is revoked after authorization', async () => {
    const fixture = await createBackfillDatabaseCASLedgerInstallReviewFixtureV1()
    const context = await authorize(fixture)
    expect(
      deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(context)
    ).not.toBeNull()
    expect(
      trustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1(context)
    ).not.toBeNull()

    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(fixture.captured.capture)
    ).not.toBeNull()
    expect(
      deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(context)
    ).toBeNull()
    expect(trustedSupabaseBackfillDatabaseCASLedgerInstallDispatchEvidenceV1(context)).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1(context)
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1(context)
    ).toBeNull()
  })

  test('rechecks upstream provenance after asynchronous digest work and before minting', async () => {
    const fixture = await createBackfillDatabaseCASLedgerInstallReviewFixtureV1()
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle)
    let captureConsumedDuringDigest = false
    const digestSpy = spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
      if (!captureConsumedDuringDigest) {
        captureConsumedDuringDigest = true
        expect(
          consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(fixture.captured.capture)
        ).not.toBeNull()
      }
      return originalDigest(algorithm, data)
    })
    try {
      await installError(
        authorize(fixture),
        'supabase-backfill-database-cas-ledger-install-input-changed'
      )
    } finally {
      digestSpy.mockRestore()
    }
    expect(captureConsumedDuringDigest).toBe(true)
  })
})
