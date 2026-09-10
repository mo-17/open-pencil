import {
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2
} from '@open-pencil/compiler/backend'
import type { BackendApplicationSpecV2 } from '@open-pencil/lowcode/backend'

import {
  parseSupabaseStagingTargetBinding,
  type SupabaseStagingTargetBindingV1
} from '@/app/lowcode/supabase/staging-target'
import {
  type SupabaseBackfillLiveCatalogAuthorityV1,
  type SupabaseBackfillLiveCatalogCompilerInputV1,
  type SupabaseBackfillLiveCatalogHostTransportV1,
  type SupabaseBackfillLiveCatalogRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'
import {
  authorizeSupabaseBackfillWriteBarrierInstallV1,
  createSupabaseBackfillWriteBarrierInstallReviewV1,
  type SupabaseBackfillWriteBarrierInstallConfirmationV1,
  type SupabaseBackfillWriteBarrierInstallDispatchContextV1,
  type SupabaseBackfillWriteBarrierInstallReviewEnvelopeV1,
  type SupabaseBackfillWriteBarrierWriteAuthorityV1
} from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/install'
import {
  reviewSupabaseBackfillWriteBarrierV1,
  type SupabaseBackfillWriteBarrierReviewEnvelopeV1
} from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/review'
import {
  verifySupabaseBackfillWriteBarrierV1,
  type SupabaseBackfillWriteBarrierStateV1,
  type SupabaseBackfillWriteBarrierVerificationHostTransportV1,
  type SupabaseBackfillWriteBarrierVerificationRequestV1,
  type SupabaseBackfillWriteBarrierVerificationV1
} from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/verifier'

import {
  supabaseBackfillApplicationV2,
  supabasePrivateRealtimeSelectionV2
} from '#tests/engine/compiler/backend/supabase/v2/helpers'

export const BACKFILL_INSTALL_FIXTURE_PROJECT_REF = 'abcdefghijklmnopqrst'
export const BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID = 'organization-1'
export const BACKFILL_INSTALL_FIXTURE_READ_GRANT = '123e4567-e89b-42d3-a456-426614174000'
export const BACKFILL_INSTALL_FIXTURE_WRITE_GRANT = '223e4567-e89b-42d3-a456-426614174000'

const SNAPSHOT_MARKER = '100:200:'
const OBSERVED_AT = '2026-09-04T00:00:00.000Z'
const BOUND_AT = '2026-09-04T00:01:00.000Z'

type MutableRecord = Record<PropertyKey, unknown>

const AUTHORITY: SupabaseBackfillLiveCatalogAuthorityV1 = Object.freeze({
  projectRef: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
  accountId: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
  grantGeneration: BACKFILL_INSTALL_FIXTURE_READ_GRANT
})

function applicationWithFixtureOptions(
  batchSize: number,
  requiredMatchedRowCount: number | null
): BackendApplicationSpecV2 {
  const application = supabaseBackfillApplicationV2()
  const migration = application.dataMigrations.migrations[0]
  if (!migration) throw new Error('Missing backfill fixture migration')
  return {
    ...application,
    dataMigrations: {
      ...application.dataMigrations,
      migrations: [
        {
          ...migration,
          batchSize,
          postconditions: [
            ...migration.postconditions.filter(
              (postcondition) => postcondition.kind !== 'matched-row-count'
            ),
            ...(requiredMatchedRowCount === null
              ? []
              : [{ kind: 'matched-row-count' as const, minimum: requiredMatchedRowCount }])
          ]
        }
      ]
    }
  }
}

function compilerInput(
  batchSize: number,
  requiredMatchedRowCount: number | null
): SupabaseBackfillLiveCatalogCompilerInputV1 {
  const registry = createBackendProviderRegistryV2([SUPABASE_BACKEND_PROVIDER_BUNDLE_V2])
  const selection = supabasePrivateRealtimeSelectionV2(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2)
  const planned = createBackendProviderPlanV2(registry, {
    selection,
    application: applicationWithFixtureOptions(batchSize, requiredMatchedRowCount),
    target: 'react',
    mode: 'production'
  })
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
  return Object.freeze({ registry, selection, plan: planned.plan })
}

function zeroHazards(): MutableRecord {
  return {
    nonPrimaryUniqueOrExclusionConstraintCount: 0,
    nonPrimaryIndexCount: 0,
    partialOrExpressionIndexCount: 0,
    checkConstraintCount: 0,
    outboundForeignKeyConstraintCount: 0,
    inboundForeignKeyConstraintCount: 0,
    generatedColumnCount: 0,
    inheritanceRelationCount: 0,
    userTriggerCount: 0,
    userRuleCount: 0,
    policyCount: 0,
    publicationMembershipCount: 0,
    tableAclEntryCount: 0,
    columnAclCount: 0
  }
}

function catalogResponse(request: SupabaseBackfillLiveCatalogRequestV1): MutableRecord {
  const parameters = request.parameters
  return {
    subjectDigest: request.subjectDigest,
    projectRef: request.projectRef,
    accountId: request.accountId,
    grantGeneration: request.grantGeneration,
    queryVersion: request.queryVersion,
    queryDigest: request.queryDigest,
    accessMode: 'read-only',
    snapshotScope: 'single-statement',
    catalogOnly: true,
    snapshotMarker: SNAPSHOT_MARKER,
    observedAt: OBSERVED_AT,
    roles: {
      currentOid: '9000',
      currentName: 'supabase_read_only_user',
      currentSuperuser: false,
      currentBypassRls: true,
      sessionOid: '9000',
      sessionName: 'supabase_read_only_user',
      sessionSuperuser: false,
      sessionBypassRls: true
    },
    settings: {
      transactionReadOnly: true,
      rowSecurity: true,
      searchPath: 'pg_catalog, public',
      effectiveSearchPath: ['pg_catalog', 'public'],
      databasePrimary: true,
      rowSecurityActiveForTable: false
    },
    schema: { oid: '2200', name: 'public' },
    table: {
      classOid: '1259',
      oid: '50000',
      schemaOid: '2200',
      name: parameters.table,
      ownerOid: '10',
      ownerName: 'postgres',
      marker: parameters.entityMarker,
      rlsEnabled: true,
      rlsForced: true
    },
    cursor: {
      classOid: '1259',
      objectOid: '50000',
      subId: 1,
      name: parameters.cursorField,
      marker: parameters.cursorMarker,
      typeOid: '20',
      typeSchema: 'pg_catalog',
      typeName: 'int8',
      typeModifier: -1,
      notNull: true,
      identityKind: 'a',
      generatedKind: ''
    },
    target: {
      classOid: '1259',
      objectOid: '50000',
      subId: 2,
      name: parameters.targetField,
      marker: parameters.targetMarker,
      typeOid: '25',
      typeSchemaOid: '11',
      typeSchema: 'pg_catalog',
      typeName: 'text',
      typeKind: 'b',
      typeModifier: -1,
      notNull: false,
      identityKind: '',
      generatedKind: '',
      hasDefault: false,
      enumMarker: null,
      enumValues: []
    },
    primaryKey: {
      classOid: '2606',
      oid: '50001',
      tableOid: '50000',
      name: 'accounts_pkey',
      marker: parameters.primaryKeyMarker,
      fieldCount: 1,
      cursorSubId: 1
    },
    sequence: {
      classOid: '1259',
      oid: '50002',
      schemaOid: '2200',
      schema: 'public',
      name: 'accounts_id_seq',
      dependencyType: 'i',
      incrementBy: '1',
      minimumValue: '0',
      maximumValue: String(Number.MAX_SAFE_INTEGER),
      cacheSize: '1',
      cycle: false,
      ownedTableOid: '50000',
      ownedSubId: 1,
      liveValueObserved: false
    },
    hazards: zeroHazards()
  }
}

async function createReview(
  input: SupabaseBackfillLiveCatalogCompilerInputV1
): Promise<SupabaseBackfillWriteBarrierReviewEnvelopeV1> {
  const transport: SupabaseBackfillLiveCatalogHostTransportV1 = {
    async getProjectAuthority(request) {
      return {
        projectRef: request.projectRef,
        organizationId: request.accountId,
        grantGeneration: request.grantGeneration
      }
    },
    async runReadOnlyBackfillCatalogQuery(request) {
      return catalogResponse(request)
    }
  }
  return reviewSupabaseBackfillWriteBarrierV1({
    readCurrentCompilerInput: () => input,
    readCurrentAuthority: () => AUTHORITY,
    transport
  })
}

function verificationResponse(
  request: SupabaseBackfillWriteBarrierVerificationRequestV1,
  review: SupabaseBackfillWriteBarrierReviewEnvelopeV1,
  serverVersionNum: string,
  state: SupabaseBackfillWriteBarrierStateV1
): MutableRecord {
  const installed = state === 'installed'
  const mismatch = state === 'mismatch'
  return {
    subjectDigest: request.subjectDigest,
    reviewDigest: request.reviewDigest,
    projectRef: request.projectRef,
    accountId: request.accountId,
    grantGeneration: request.grantGeneration,
    queryVersion: request.queryVersion,
    queryDigest: request.queryDigest,
    accessMode: 'read-only',
    snapshotScope: 'single-statement',
    catalogOnly: true,
    serverVersionNum,
    snapshotMarker: SNAPSHOT_MARKER,
    observedAt: OBSERVED_AT,
    roles: {
      currentOid: '9000',
      currentName: 'supabase_read_only_user',
      currentSuperuser: false,
      sessionOid: '9000',
      sessionName: 'supabase_read_only_user',
      sessionSuperuser: false
    },
    settings: {
      databasePrimary: true,
      effectiveSearchPath: ['pg_catalog', 'public']
    },
    address: {
      schemaOid: review.review.address.schemaOid,
      tableOid: review.review.address.tableOid,
      tableOwnerOid: '10',
      tableOwnerName: 'postgres',
      tableRlsEnabled: true,
      tableRlsForced: true,
      tableCheckCount: installed || mismatch ? 1 : 0,
      targetSubId: review.review.address.targetSubId,
      targetTypeOid: review.review.address.targetTypeOid
    },
    barrier: {
      totalCheckConstraintCount: installed || mismatch ? 1 : 0,
      nameMatchCount: installed || mismatch ? 1 : 0,
      markerMatchCount: installed || mismatch ? 1 : 0,
      globalMarkerMatchCount: installed || mismatch ? 1 : 0,
      definitionMatchCount: installed ? 1 : 0,
      exactMatchCount: installed ? 1 : 0,
      constraintOid: installed ? '50003' : null
    }
  }
}

async function createAbsentVerification(
  input: SupabaseBackfillLiveCatalogCompilerInputV1,
  review: SupabaseBackfillWriteBarrierReviewEnvelopeV1,
  serverVersionNum: string
): Promise<SupabaseBackfillWriteBarrierVerificationV1> {
  const transport: SupabaseBackfillWriteBarrierVerificationHostTransportV1 = {
    async getProjectAuthority(request) {
      return {
        projectRef: request.projectRef,
        organizationId: request.accountId,
        grantGeneration: request.grantGeneration
      }
    },
    async runReadOnlyWriteBarrierVerificationQuery(request) {
      return verificationResponse(request, review, serverVersionNum, 'absent')
    }
  }
  return verifySupabaseBackfillWriteBarrierV1({
    review,
    readCurrentCompilerInput: () => input,
    readCurrentAuthority: () => AUTHORITY,
    transport
  })
}

export async function createBackfillWriteBarrierVerificationFixture(
  fixture: Pick<BackfillWriteBarrierInstallReviewFixture, 'input' | 'review'>,
  state: SupabaseBackfillWriteBarrierStateV1,
  serverVersionNum = '170006'
): Promise<SupabaseBackfillWriteBarrierVerificationV1> {
  const transport: SupabaseBackfillWriteBarrierVerificationHostTransportV1 = {
    async getProjectAuthority(request) {
      return {
        projectRef: request.projectRef,
        organizationId: request.accountId,
        grantGeneration: request.grantGeneration
      }
    },
    async runReadOnlyWriteBarrierVerificationQuery(request) {
      return verificationResponse(request, fixture.review, serverVersionNum, state)
    }
  }
  return verifySupabaseBackfillWriteBarrierV1({
    review: fixture.review,
    readCurrentCompilerInput: () => fixture.input,
    readCurrentAuthority: () => AUTHORITY,
    transport
  })
}

export interface BackfillWriteBarrierInstallReviewFixture {
  readonly input: SupabaseBackfillLiveCatalogCompilerInputV1
  readonly review: SupabaseBackfillWriteBarrierReviewEnvelopeV1
  readonly absent: SupabaseBackfillWriteBarrierVerificationV1
  readonly installReview: SupabaseBackfillWriteBarrierInstallReviewEnvelopeV1
  readonly stagingBinding: SupabaseStagingTargetBindingV1
  readonly writeAuthority: SupabaseBackfillWriteBarrierWriteAuthorityV1
  readonly confirmation: SupabaseBackfillWriteBarrierInstallConfirmationV1
}

export interface BackfillWriteBarrierInstallFixture extends BackfillWriteBarrierInstallReviewFixture {
  readonly context: SupabaseBackfillWriteBarrierInstallDispatchContextV1
}

export interface CreateBackfillWriteBarrierInstallFixtureOptions {
  readonly batchSize?: number
  readonly serverVersionNum?: string
  readonly boundAt?: string
  readonly requiredMatchedRowCount?: number | null
}

export async function createBackfillWriteBarrierInstallReviewFixture(
  options: CreateBackfillWriteBarrierInstallFixtureOptions = {}
): Promise<BackfillWriteBarrierInstallReviewFixture> {
  const input = compilerInput(
    options.batchSize ?? 250,
    options.requiredMatchedRowCount === undefined ? 1 : options.requiredMatchedRowCount
  )
  const review = await createReview(input)
  const absent = await createAbsentVerification(input, review, options.serverVersionNum ?? '170006')
  const installReview = await createSupabaseBackfillWriteBarrierInstallReviewV1({
    review,
    absentVerification: absent
  })
  const stagingBinding = parseSupabaseStagingTargetBinding({
    schemaVersion: 1,
    projectRef: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
    accountId: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
    boundAt: options.boundAt ?? BOUND_AT
  })
  const writeAuthority: SupabaseBackfillWriteBarrierWriteAuthorityV1 = Object.freeze({
    projectRef: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
    accountId: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
    grantGeneration: BACKFILL_INSTALL_FIXTURE_WRITE_GRANT,
    scope: 'database:write',
    permission: 'database_migrations_write'
  })
  const confirmation: SupabaseBackfillWriteBarrierInstallConfirmationV1 = Object.freeze({
    reviewDigest: review.reviewDigest,
    verificationDigest: absent.verificationDigest,
    installDigest: installReview.review.bindings.installDigest,
    projectRefConfirmation: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
    accountIdConfirmation: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
    writeGrantGeneration: BACKFILL_INSTALL_FIXTURE_WRITE_GRANT,
    confirmedIndependentStaging: true,
    confirmedMigrationApply: true
  })
  return Object.freeze({
    input,
    review,
    absent,
    installReview,
    stagingBinding,
    writeAuthority,
    confirmation
  })
}

export async function createBackfillWriteBarrierInstallFixture(
  options: CreateBackfillWriteBarrierInstallFixtureOptions = {}
): Promise<BackfillWriteBarrierInstallFixture> {
  const fixture = await createBackfillWriteBarrierInstallReviewFixture(options)
  const context = await authorizeSupabaseBackfillWriteBarrierInstallV1({
    installReview: fixture.installReview,
    stagingTargetBinding: fixture.stagingBinding,
    confirmation: fixture.confirmation,
    readCurrentCompilerInput: () => fixture.input,
    readCurrentWriteAuthority: () => fixture.writeAuthority,
    readCurrentStagingTargetBinding: () => fixture.stagingBinding
  })
  return Object.freeze({ ...fixture, context })
}
