import {
  parseSupabaseStagingTargetBinding,
  type SupabaseStagingTargetBindingV1
} from '@/app/lowcode/supabase/staging-target'
import {
  authorizeSupabaseBackfillDatabaseCASLedgerInstallV1,
  createSupabaseBackfillDatabaseCASLedgerInstallReviewV1,
  type SupabaseBackfillDatabaseCASLedgerInstallConfirmationV1,
  type SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1,
  type SupabaseBackfillDatabaseCASLedgerInstallReviewEnvelopeV1,
  type SupabaseBackfillDatabaseCASLedgerInstallWriteAuthorityV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install'
import {
  createSupabaseBackfillDatabaseCASLedgerReviewV1,
  type SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/review'
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1,
  verifySupabaseBackfillDatabaseCASLedgerV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationRequestV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verifier'
import type { SupabaseBackfillLiveCatalogAuthorityV1 } from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'
import {
  createSupabaseBackfillReceiptV2ReviewV1,
  type SupabaseBackfillReceiptV2ReviewEnvelopeV1
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/v2/review'

import {
  createCapturedBackfillLockedHighWaterFixture,
  type CapturedBackfillLockedHighWaterFixture
} from '#tests/engine/app/plugins/deployment/supabase/backfill/locked-high-water/helpers'
import {
  BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
  BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
  BACKFILL_INSTALL_FIXTURE_READ_GRANT
} from '#tests/engine/app/plugins/deployment/supabase/backfill/write-barrier/helpers'

export const BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT =
  '423e4567-e89b-42d3-a456-426614174000'
export const BACKFILL_DATABASE_CAS_LEDGER_INSTALL_NON_UUID_READ_GRANT = 'read-grant-generation'
export const BACKFILL_DATABASE_CAS_LEDGER_INSTALL_NON_UUID_WRITE_GRANT = 'write-grant-generation'
export const BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT =
  'sbp_backfill_database_cas_ledger_install_secret_canary_1234567890'
export const BACKFILL_DATABASE_CAS_LEDGER_INSTALL_BOUND_AT = '2026-09-07T09:00:00.000Z'
export const BACKFILL_DATABASE_CAS_LEDGER_INSTALLED_OBSERVED_AT = '2026-09-07T10:02:30.000Z'
export const BACKFILL_DATABASE_CAS_LEDGER_INSTALLED_SNAPSHOT_MARKER = '902:903:'

type MutableRecord = Record<string, unknown>

export type BackfillDatabaseCASLedgerAbsentResponseTransformV1 = (value: MutableRecord) => unknown

/**
 * Reusable process-local capture/review identities for tests that must bind several downstream
 * proofs to one genuine locked-high-water capture. Production helpers remain responsible for
 * validating their exact trusted identities.
 */
export interface BackfillDatabaseCASLedgerCaptureReviewFixtureV1 {
  readonly captured: CapturedBackfillLockedHighWaterFixture
  readonly receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1
}

export interface BackfillDatabaseCASLedgerAbsentVerificationFixtureOptionsV1 extends BackfillDatabaseCASLedgerCaptureReviewFixtureV1 {
  readonly transformResponse?: BackfillDatabaseCASLedgerAbsentResponseTransformV1
}

export interface BackfillDatabaseCASLedgerInstalledVerificationFixtureOptionsV1 {
  readonly observedAt?: string
  readonly snapshotMarker?: string
}

function absentCatalog(): MutableRecord {
  return {
    schemaCount: 0,
    schemaOid: null,
    schemaOwnerOid: null,
    schemaOwnerName: null,
    schemaComment: null,
    installMarkerConstraintComment: null,
    schemaInstallMarkerPrefixCount: 0,
    ownerRoleMemberCount: 0,
    ownerDefaultNonOwnerPrivilegeCount: 0,
    schemaNonOwnerPrivilegeCount: 0,
    relationCount: 0,
    unexpectedIndexCount: 0,
    unexpectedTriggerCount: 0,
    unexpectedRuleCount: 0,
    unexpectedConstraintCount: 0,
    inheritanceRelationCount: 0,
    publicationExposureCount: 0,
    droppedColumnCount: 0,
    policyCount: 0,
    tables: [],
    columns: [],
    constraints: []
  }
}

function absentResponse(
  request: SupabaseBackfillDatabaseCASLedgerVerificationRequestV1
): MutableRecord {
  return {
    reviewDigest: request.reviewDigest,
    ledgerShapeDigest: request.ledgerShapeDigest,
    sqlDigest: request.sqlDigest,
    projectRef: request.projectRef,
    accountId: request.accountId,
    grantGeneration: request.grantGeneration,
    queryVersion: request.queryVersion,
    queryDigest: request.queryDigest,
    accessMode: 'read-only',
    snapshotScope: 'single-statement',
    catalogOnly: true,
    managedDataRead: false,
    serverVersionNum: '170000',
    snapshotMarker: '900:901:',
    observedAt: '2026-09-07T09:01:00.000Z',
    roles: {
      currentOid: '9000',
      currentName: 'supabase_read_only_user',
      currentSuperuser: false,
      currentBypassRls: true,
      currentHasEffectivePgReadAllData: true,
      sessionOid: '9000',
      sessionName: 'supabase_read_only_user',
      sessionSuperuser: false,
      sessionBypassRls: true,
      sessionHasEffectivePgReadAllData: true
    },
    settings: {
      databasePrimary: true,
      transactionReadOnly: true,
      effectiveSearchPath: ['pg_catalog', 'public']
    },
    catalog: absentCatalog()
  }
}

function absentTransport(
  transformResponse?: BackfillDatabaseCASLedgerAbsentResponseTransformV1
): SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1 {
  return {
    async getProjectAuthority(request) {
      return {
        projectRef: request.projectRef,
        organizationId: request.accountId,
        grantGeneration: request.grantGeneration
      }
    },
    async runReadOnlyDatabaseCASLedgerVerificationQuery(request) {
      const response = absentResponse(request)
      return transformResponse?.(response) ?? response
    }
  }
}

function installedTables(): MutableRecord[] {
  return [
    {
      tableName: 'backfill_executions_v1',
      tableOid: '70001',
      ownerOid: '10',
      ownerName: 'postgres',
      relationKind: 'r',
      persistence: 'p',
      isPartition: false,
      replicaIdentity: 'd',
      rlsEnabled: true,
      rlsForced: false,
      comment: 'openpencil:release-ledger:backfill-executions:v1',
      nonOwnerPrivilegeCount: 0,
      policyCount: 0
    },
    {
      tableName: 'backfill_receipts_v2',
      tableOid: '70002',
      ownerOid: '10',
      ownerName: 'postgres',
      relationKind: 'r',
      persistence: 'p',
      isPartition: false,
      replicaIdentity: 'd',
      rlsEnabled: true,
      rlsForced: false,
      comment: 'openpencil:release-ledger:backfill-receipts:v2',
      nonOwnerPrivilegeCount: 0,
      policyCount: 0
    },
    {
      tableName: 'backfill_heads_v1',
      tableOid: '70003',
      ownerOid: '10',
      ownerName: 'postgres',
      relationKind: 'r',
      persistence: 'p',
      isPartition: false,
      replicaIdentity: 'd',
      rlsEnabled: true,
      rlsForced: false,
      comment: 'openpencil:release-ledger:backfill-heads:v1',
      nonOwnerPrivilegeCount: 0,
      policyCount: 0
    }
  ]
}

function installedCatalog(marker: string): MutableRecord {
  return {
    schemaCount: 1,
    schemaOid: '70000',
    schemaOwnerOid: '10',
    schemaOwnerName: 'postgres',
    schemaComment: 'openpencil:release-ledger:v1',
    installMarkerConstraintComment: marker,
    schemaInstallMarkerPrefixCount: 1,
    ownerRoleMemberCount: 0,
    ownerDefaultNonOwnerPrivilegeCount: 0,
    schemaNonOwnerPrivilegeCount: 0,
    relationCount: 3,
    unexpectedIndexCount: 0,
    unexpectedTriggerCount: 0,
    unexpectedRuleCount: 0,
    unexpectedConstraintCount: 0,
    inheritanceRelationCount: 0,
    publicationExposureCount: 0,
    droppedColumnCount: 0,
    policyCount: 0,
    tables: installedTables(),
    columns: structuredClone(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1),
    constraints: structuredClone(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1)
  }
}

function installedTransport(
  marker: string,
  observedAt: string,
  snapshotMarker: string
): SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1 {
  return {
    async getProjectAuthority(request) {
      return {
        projectRef: request.projectRef,
        organizationId: request.accountId,
        grantGeneration: request.grantGeneration
      }
    },
    async runReadOnlyDatabaseCASLedgerVerificationQuery(request) {
      return {
        reviewDigest: request.reviewDigest,
        ledgerShapeDigest: request.ledgerShapeDigest,
        sqlDigest: request.sqlDigest,
        projectRef: request.projectRef,
        accountId: request.accountId,
        grantGeneration: request.grantGeneration,
        queryVersion: request.queryVersion,
        queryDigest: request.queryDigest,
        accessMode: 'read-only',
        snapshotScope: 'single-statement',
        catalogOnly: true,
        managedDataRead: false,
        serverVersionNum: '170000',
        snapshotMarker,
        observedAt,
        roles: {
          currentOid: '9000',
          currentName: 'supabase_read_only_user',
          currentSuperuser: false,
          currentBypassRls: true,
          currentHasEffectivePgReadAllData: true,
          sessionOid: '9000',
          sessionName: 'supabase_read_only_user',
          sessionSuperuser: false,
          sessionBypassRls: true,
          sessionHasEffectivePgReadAllData: true
        },
        settings: {
          databasePrimary: true,
          transactionReadOnly: true,
          effectiveSearchPath: ['pg_catalog', 'public']
        },
        catalog: installedCatalog(marker)
      }
    }
  }
}

export interface BackfillDatabaseCASLedgerInstallReviewFixtureV1 {
  readonly captured: CapturedBackfillLockedHighWaterFixture
  readonly receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1
  readonly sourceReview: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1
  readonly readAuthority: SupabaseBackfillLiveCatalogAuthorityV1
  readonly absentVerification: SupabaseBackfillDatabaseCASLedgerVerificationV1
  readonly installReview: SupabaseBackfillDatabaseCASLedgerInstallReviewEnvelopeV1
  readonly stagingTarget: SupabaseStagingTargetBindingV1
  readonly writeAuthority: SupabaseBackfillDatabaseCASLedgerInstallWriteAuthorityV1
  readonly confirmation: SupabaseBackfillDatabaseCASLedgerInstallConfirmationV1
}

export type BackfillDatabaseCASLedgerVerificationFixtureV1 = Omit<
  BackfillDatabaseCASLedgerInstallReviewFixtureV1,
  'installReview' | 'stagingTarget' | 'writeAuthority' | 'confirmation'
>

async function captureReviewFixture(
  reuse?: BackfillDatabaseCASLedgerCaptureReviewFixtureV1
): Promise<BackfillDatabaseCASLedgerCaptureReviewFixtureV1> {
  if (reuse) return reuse
  const captured = await createCapturedBackfillLockedHighWaterFixture()
  const receiptReview = await createSupabaseBackfillReceiptV2ReviewV1({
    capture: captured.capture
  })
  return Object.freeze({ captured, receiptReview })
}

export async function createBackfillDatabaseCASLedgerAbsentVerificationFixtureV1(
  transformResponseOrOptions?:
    | BackfillDatabaseCASLedgerAbsentResponseTransformV1
    | BackfillDatabaseCASLedgerAbsentVerificationFixtureOptionsV1
): Promise<BackfillDatabaseCASLedgerVerificationFixtureV1> {
  const transformResponse =
    typeof transformResponseOrOptions === 'function'
      ? transformResponseOrOptions
      : transformResponseOrOptions?.transformResponse
  const { captured, receiptReview } = await captureReviewFixture(
    typeof transformResponseOrOptions === 'function' ? undefined : transformResponseOrOptions
  )
  const sourceReview = await createSupabaseBackfillDatabaseCASLedgerReviewV1({ receiptReview })
  const readAuthority = Object.freeze({
    projectRef: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
    accountId: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
    grantGeneration: BACKFILL_INSTALL_FIXTURE_READ_GRANT
  })
  const absentVerification = await verifySupabaseBackfillDatabaseCASLedgerV1({
    review: sourceReview,
    readCurrentAuthority: () => readAuthority,
    transport: absentTransport(transformResponse)
  })
  return Object.freeze({
    captured,
    receiptReview,
    sourceReview,
    readAuthority,
    absentVerification
  })
}

export async function createBackfillDatabaseCASLedgerInstallReviewFixtureV1(
  reuse?: BackfillDatabaseCASLedgerCaptureReviewFixtureV1
): Promise<BackfillDatabaseCASLedgerInstallReviewFixtureV1> {
  const verified = await createBackfillDatabaseCASLedgerAbsentVerificationFixtureV1(reuse)
  const { captured, receiptReview, sourceReview, readAuthority, absentVerification } = verified
  const installReview = await createSupabaseBackfillDatabaseCASLedgerInstallReviewV1({
    review: sourceReview,
    absentVerification
  })
  const stagingTarget = parseSupabaseStagingTargetBinding({
    schemaVersion: 1,
    projectRef: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
    accountId: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
    boundAt: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_BOUND_AT
  })
  const writeAuthority = Object.freeze({
    projectRef: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
    accountId: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
    grantGeneration: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
    scope: 'database:write' as const,
    permission: 'database_migrations_write' as const,
    operation: 'backfill-database-cas-ledger-install' as const,
    lifetime: 'single-operation' as const
  })
  const confirmation = Object.freeze({
    installReviewDigest: installReview.installReviewDigest,
    sourceReviewDigest: sourceReview.reviewDigest,
    verificationDigest: absentVerification.verificationDigest,
    ledgerShapeDigest: sourceReview.review.bindings.ledgerShapeDigest,
    sqlDigest: sourceReview.review.bindings.sqlDigest,
    marker: installReview.review.installationMarker.marker,
    markerBindingDigest: installReview.review.bindings.markerBindingDigest,
    installSqlDigest: installReview.review.bindings.installSqlDigest,
    verificationQueryDigest: absentVerification.query.digest,
    projectRefConfirmation: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
    accountIdConfirmation: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
    readGrantGeneration: BACKFILL_INSTALL_FIXTURE_READ_GRANT,
    writeGrantGeneration: BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
    confirmedIndependentStaging: true as const,
    confirmedMigrationApply: true as const
  })
  return Object.freeze({
    captured,
    receiptReview,
    sourceReview,
    readAuthority,
    absentVerification,
    installReview,
    stagingTarget,
    writeAuthority,
    confirmation
  })
}

export interface BackfillDatabaseCASLedgerInstallFixtureV1 extends BackfillDatabaseCASLedgerInstallReviewFixtureV1 {
  readonly context: SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
}

export async function createBackfillDatabaseCASLedgerInstallFixtureV1(
  reuse?: BackfillDatabaseCASLedgerCaptureReviewFixtureV1
): Promise<BackfillDatabaseCASLedgerInstallFixtureV1> {
  const fixture = await createBackfillDatabaseCASLedgerInstallReviewFixtureV1(reuse)
  const context = await authorizeSupabaseBackfillDatabaseCASLedgerInstallV1({
    installReview: fixture.installReview,
    stagingTargetBinding: fixture.stagingTarget,
    confirmation: fixture.confirmation,
    readCurrentReadAuthority: () => fixture.readAuthority,
    readCurrentWriteAuthority: () => fixture.writeAuthority,
    readCurrentStagingTargetBinding: () => fixture.stagingTarget
  })
  return Object.freeze({ ...fixture, context })
}

/** Create a genuine installed verification bound to this fixture's exact operation marker. */
export function createBackfillDatabaseCASLedgerInstalledVerificationFixtureV1(
  fixture: BackfillDatabaseCASLedgerInstallFixtureV1,
  options: BackfillDatabaseCASLedgerInstalledVerificationFixtureOptionsV1 = {}
): Promise<SupabaseBackfillDatabaseCASLedgerVerificationV1> {
  return verifySupabaseBackfillDatabaseCASLedgerV1({
    review: fixture.sourceReview,
    readCurrentAuthority: () => fixture.readAuthority,
    transport: installedTransport(
      fixture.context.marker,
      options.observedAt ?? BACKFILL_DATABASE_CAS_LEDGER_INSTALLED_OBSERVED_AT,
      options.snapshotMarker ?? BACKFILL_DATABASE_CAS_LEDGER_INSTALLED_SNAPSHOT_MARKER
    )
  })
}
