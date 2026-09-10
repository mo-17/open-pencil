/* oxlint-disable eslint/max-lines -- One focused matrix covers deterministic SQL and capability consumption. */
import { describe, expect, test } from 'bun:test'

import {
  authorizeSupabaseBackfillWriteBarrierInstallV1,
  createSupabaseBackfillWriteBarrierInstallReviewV1,
  SUPABASE_BACKFILL_WRITE_BARRIER_INSTALL_ARTIFACT_PATH,
  SUPABASE_BACKFILL_WRITE_BARRIER_INSTALL_REVIEW_FORMAT,
  SupabaseBackfillWriteBarrierInstallError,
  type SupabaseBackfillWriteBarrierInstallConfirmationV1,
  type SupabaseBackfillWriteBarrierInstallErrorCode,
  type SupabaseBackfillWriteBarrierWriteAuthorityV1
} from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/install'

import {
  BACKFILL_INSTALL_FIXTURE_READ_GRANT,
  createBackfillWriteBarrierInstallFixture,
  createBackfillWriteBarrierInstallReviewFixture
} from './helpers'

async function installError(
  operation: Promise<unknown>,
  code: SupabaseBackfillWriteBarrierInstallErrorCode
): Promise<SupabaseBackfillWriteBarrierInstallError> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillWriteBarrierInstallError)
    const error = cause as SupabaseBackfillWriteBarrierInstallError
    expect(error.code).toBe(code)
    return error
  }
  throw new TypeError(`Expected install error ${code}`)
}

function authorize(
  fixture: Awaited<ReturnType<typeof createBackfillWriteBarrierInstallReviewFixture>>,
  overrides: Readonly<{
    confirmation?: SupabaseBackfillWriteBarrierInstallConfirmationV1
    input?: typeof fixture.input
    writeAuthority?: SupabaseBackfillWriteBarrierWriteAuthorityV1
    staging?: typeof fixture.stagingBinding | null
  }> = {}
) {
  return authorizeSupabaseBackfillWriteBarrierInstallV1({
    installReview: fixture.installReview,
    stagingTargetBinding: fixture.stagingBinding,
    confirmation: overrides.confirmation ?? fixture.confirmation,
    readCurrentCompilerInput: () => overrides.input ?? fixture.input,
    readCurrentWriteAuthority: () => overrides.writeAuthority ?? fixture.writeAuthority,
    readCurrentStagingTargetBinding: () =>
      overrides.staging === undefined ? fixture.stagingBinding : overrides.staging
  })
}

describe('Supabase backfill write-barrier endpoint installer', () => {
  test('emits deterministic lock-before-snapshot SQL and keeps every later authority blocked', async () => {
    const first = await createBackfillWriteBarrierInstallReviewFixture()
    const second = await createBackfillWriteBarrierInstallReviewFixture()
    const sql = first.installReview.installSql

    expect(second.installReview).toEqual(first.installReview)
    expect(first.installReview.review).toMatchObject({
      format: SUPABASE_BACKFILL_WRITE_BARRIER_INSTALL_REVIEW_FORMAT,
      version: 1,
      providerId: 'supabase',
      environmentIntent: 'staging',
      environmentVerified: false,
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      sourceLedgerBound: false,
      mutationAuthorityCreated: false,
      receiptAuthorityCreated: false,
      artifact: {
        path: SUPABASE_BACKFILL_WRITE_BARRIER_INSTALL_ARTIFACT_PATH,
        statementCount: 6,
        mutationStatementCount: 2,
        containsCatalogRead: true,
        containsManagedDataRead: false,
        containsDml: false,
        performsSchemaChange: true,
        mutationDispatched: false,
        hostDispatchAvailable: false
      },
      migration: {
        endpointKind: 'management-api-migration',
        transactionIsolation: 'serializable',
        lockMode: 'access-exclusive',
        reinspectionUnderLock: true,
        sourceLedgerBound: false
      }
    })
    expect(first.installReview.review.bindings.installDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first.installReview.review.artifact.digest).toBe(
      first.installReview.review.bindings.installDigest
    )
    expect(first.installReview.review.artifact.byteLength).toBe(
      new TextEncoder().encode(sql).byteLength
    )
    expect(first.installReview.review.migration.name).toMatch(/^[a-z][a-z0-9_]+$/u)
    expect(first.installReview.review.blockers).toEqual([
      'staging-target-not-confirmed',
      'database-write-authority-not-bound',
      'dispatch-not-journaled',
      'write-barrier-installed-proof-not-observed',
      'source-migration-ledger-not-bound',
      'locked-high-water-not-captured',
      'database-batch-ledger-not-bound',
      'execution-runner-unavailable'
    ])

    const isolation = sql.indexOf('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;')
    const searchPath = sql.indexOf('SET LOCAL search_path = pg_catalog;')
    const lockTimeout = sql.indexOf("SET LOCAL lock_timeout = '5s';")
    const statementTimeout = sql.indexOf("SET LOCAL statement_timeout = '15s';")
    const lock = sql.indexOf('LOCK TABLE ONLY "public"."accounts" IN ACCESS EXCLUSIVE MODE;')
    const catalogRead = sql.indexOf('SELECT\n')
    const addConstraint = sql.indexOf('ADD CONSTRAINT')
    const addMarker = sql.indexOf('COMMENT ON CONSTRAINT')
    expect(isolation).toBeGreaterThanOrEqual(0)
    expect(searchPath).toBeGreaterThan(isolation)
    expect(lockTimeout).toBeGreaterThan(searchPath)
    expect(statementTimeout).toBeGreaterThan(lockTimeout)
    expect(lock).toBeGreaterThan(statementTimeout)
    expect(catalogRead).toBeGreaterThan(lock)
    expect(addConstraint).toBeGreaterThan(catalogRead)
    expect(addMarker).toBeGreaterThan(addConstraint)
    expect(sql).toContain('"pg_catalog"."current_setting"(\'server_version_num\') = E\'170006\'')
    expect(sql).toContain('"pg_catalog"."current_setting"(\'search_path\') = \'pg_catalog\'')
    expect(sql).toContain('"pg_catalog"."pg_is_in_recovery"()')
    expect(sql).toContain('"pg_catalog"."pg_constraint"')
    expect(sql).toContain('"pg_catalog"."pg_index"')
    expect(sql).toContain('"pg_catalog"."pg_trigger"')
    expect(sql).toContain('"pg_catalog"."pg_policy"')
    expect(sql).toContain('"pg_catalog"."pg_publication_rel"')
    expect(sql).toContain('NO INHERIT NOT VALID')
    expect(sql).not.toContain('IF NOT EXISTS')
    expect(sql).not.toContain('SELECT * FROM "public"."accounts"')
    expect(sql).not.toContain(first.review.previewSql)
  })

  test('separates preview from one-shot joint review/proof consumption', async () => {
    const fixture = await createBackfillWriteBarrierInstallReviewFixture()
    const secondPreview = await createSupabaseBackfillWriteBarrierInstallReviewV1({
      review: fixture.review,
      absentVerification: fixture.absent
    })
    const clonedPreview = structuredClone(fixture.installReview)

    await installError(
      authorizeSupabaseBackfillWriteBarrierInstallV1({
        installReview: clonedPreview,
        stagingTargetBinding: fixture.stagingBinding,
        confirmation: fixture.confirmation,
        readCurrentCompilerInput: () => fixture.input,
        readCurrentWriteAuthority: () => fixture.writeAuthority,
        readCurrentStagingTargetBinding: () => fixture.stagingBinding
      }),
      'supabase-backfill-write-barrier-install-proof-invalid'
    )
    const context = await authorize(fixture)
    expect(context).toMatchObject({
      providerId: 'supabase',
      environment: 'staging',
      projectRef: fixture.writeAuthority.projectRef,
      accountId: fixture.writeAuthority.accountId,
      reviewDigest: fixture.review.reviewDigest,
      verificationDigest: fixture.absent.verificationDigest,
      installDigest: fixture.installReview.review.bindings.installDigest,
      migrationName: fixture.installReview.review.migration.name,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expect(Object.isFrozen(context)).toBe(true)
    await installError(
      authorizeSupabaseBackfillWriteBarrierInstallV1({
        installReview: secondPreview,
        stagingTargetBinding: fixture.stagingBinding,
        confirmation: fixture.confirmation,
        readCurrentCompilerInput: () => fixture.input,
        readCurrentWriteAuthority: () => fixture.writeAuthority,
        readCurrentStagingTargetBinding: () => fixture.stagingBinding
      }),
      'supabase-backfill-write-barrier-install-proof-invalid'
    )
  })

  test('does not burn genuine proof on a rejected explicit confirmation', async () => {
    const fixture = await createBackfillWriteBarrierInstallReviewFixture()
    await installError(
      authorize(fixture, {
        confirmation: {
          ...fixture.confirmation,
          installDigest: 'A'.repeat(43)
        }
      }),
      'supabase-backfill-write-barrier-install-confirmation-mismatch'
    )
    expect(await authorize(fixture)).toMatchObject({
      installDigest: fixture.installReview.review.bindings.installDigest
    })
  })

  test('burns the operation safely on compiler, staging, or dedicated write-grant drift', async () => {
    const changedInput = (await createBackfillWriteBarrierInstallReviewFixture({ batchSize: 251 }))
      .input
    const compilerDrift = await createBackfillWriteBarrierInstallReviewFixture()
    await installError(
      authorize(compilerDrift, { input: changedInput }),
      'supabase-backfill-write-barrier-install-input-changed'
    )

    const stagingDrift = await createBackfillWriteBarrierInstallReviewFixture()
    await installError(
      authorize(stagingDrift, { staging: null }),
      'supabase-backfill-write-barrier-install-staging-target-mismatch'
    )

    const sharedReadWriteGrant = await createBackfillWriteBarrierInstallReviewFixture()
    await installError(
      authorize(sharedReadWriteGrant, {
        confirmation: {
          ...sharedReadWriteGrant.confirmation,
          writeGrantGeneration: BACKFILL_INSTALL_FIXTURE_READ_GRANT
        },
        writeAuthority: {
          ...sharedReadWriteGrant.writeAuthority,
          grantGeneration: BACKFILL_INSTALL_FIXTURE_READ_GRANT
        }
      }),
      'supabase-backfill-write-barrier-install-write-authority-not-separated'
    )

    const wrongPermission = await createBackfillWriteBarrierInstallReviewFixture()
    await installError(
      authorize(wrongPermission, {
        writeAuthority: {
          ...wrongPermission.writeAuthority,
          permission: 'database_read'
        } as SupabaseBackfillWriteBarrierWriteAuthorityV1
      }),
      'supabase-backfill-write-barrier-install-write-authority-invalid'
    )
  })

  test('keeps the semantic constraint stable while exact plan/install bindings change', async () => {
    const first = await createBackfillWriteBarrierInstallReviewFixture({ batchSize: 250 })
    const changed = await createBackfillWriteBarrierInstallReviewFixture({ batchSize: 251 })

    expect(changed.review.review.barrier.constraintName).toBe(
      first.review.review.barrier.constraintName
    )
    expect(changed.review.review.bindings.subjectDigest).not.toBe(
      first.review.review.bindings.subjectDigest
    )
    expect(changed.installReview.review.bindings.installDigest).not.toBe(
      first.installReview.review.bindings.installDigest
    )
    expect((await createBackfillWriteBarrierInstallFixture()).context.releaseReady).toBe(false)
  })
})
