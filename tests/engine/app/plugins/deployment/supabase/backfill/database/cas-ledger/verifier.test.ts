/* oxlint-disable eslint(max-lines) -- Catalog state and fail-closed cases share one auditable fixture. */

import { describe, expect, test } from 'bun:test'

import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import CAS_LEDGER_VERIFICATION_SQL_SOURCE from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verification-v1.sql?raw'

import {
  createSupabaseBackfillDatabaseCASLedgerReviewV1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
  type SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/review'
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FORMAT,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FIXED_QUERY,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_PARAMETER_ORDER,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_ID,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL,
  SupabaseBackfillDatabaseCASLedgerVerificationError,
  consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1,
  rotateSupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1,
  trustedSupabaseBackfillDatabaseCASLedgerInstallMarkerEvidenceV1,
  trustedSupabaseBackfillDatabaseCASLedgerVerificationV1,
  verifySupabaseBackfillDatabaseCASLedgerV1,
  type SupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1,
  type SupabaseBackfillDatabaseCASLedgerStateV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationErrorCode,
  type SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verifier'
import type {
  SupabaseBackfillLiveCatalogAuthorityV1,
  SupabaseBackfillLiveCatalogProjectAuthorityV1
} from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'
import { consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1 } from '@/app/plugins/host/deployment/supabase/backfill/locked-high-water-capture'
import { createSupabaseBackfillReceiptV2ReviewV1 } from '@/app/plugins/host/deployment/supabase/backfill/receipt/v2/review'

import { createCapturedBackfillLockedHighWaterFixture } from '#tests/engine/app/plugins/deployment/supabase/backfill/locked-high-water/helpers'

const OBSERVED_AT = '2026-09-07T08:00:00.000Z'
const SNAPSHOT_MARKER = '812:812:'
const INSTALL_MARKER = `${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX}${'A'.repeat(43)}`
const OTHER_INSTALL_MARKER = `${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX}${'B'.repeat(43)}`

type MutableRecord = Record<string, unknown>

async function digestBytes(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

function constraintFromResponse(value: MutableRecord, constraintName: string): MutableRecord {
  const inventory = value.catalog as MutableRecord
  const constraints = inventory.constraints as MutableRecord[]
  const constraint = constraints.find((entry) => entry.constraintName === constraintName)
  if (!constraint) throw new TypeError(`Missing fixture constraint ${constraintName}`)
  return constraint
}

function supportingIndexFromResponse(value: MutableRecord, constraintName: string): MutableRecord {
  const supportingIndex = constraintFromResponse(value, constraintName).supportingIndex
  if (supportingIndex === null || typeof supportingIndex !== 'object') {
    throw new TypeError(`Missing fixture supporting index for ${constraintName}`)
  }
  return supportingIndex as MutableRecord
}

function foreignKeyOperatorsFromResponse(
  value: MutableRecord,
  constraintName: string
): MutableRecord {
  const operators = constraintFromResponse(value, constraintName).foreignKeyOperators
  if (operators === null || typeof operators !== 'object') {
    throw new TypeError(`Missing fixture foreign-key operators for ${constraintName}`)
  }
  return operators as MutableRecord
}

async function reviewFixture() {
  const captured = await createCapturedBackfillLockedHighWaterFixture()
  const receiptReview = await createSupabaseBackfillReceiptV2ReviewV1({
    capture: captured.capture
  })
  const review = await createSupabaseBackfillDatabaseCASLedgerReviewV1({ receiptReview })
  const authority: SupabaseBackfillLiveCatalogAuthorityV1 = Object.freeze({
    projectRef: receiptReview.review.authority.projectRef,
    accountId: receiptReview.review.authority.accountId,
    grantGeneration: receiptReview.review.authority.readGrantGeneration
  })
  return Object.freeze({ ...captured, receiptReview, review, authority })
}

function tableRows(): MutableRecord[] {
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

function catalog(state: SupabaseBackfillDatabaseCASLedgerStateV1): MutableRecord {
  if (state === 'absent') {
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
  const installed = {
    schemaCount: 1,
    schemaOid: '70000',
    schemaOwnerOid: '10',
    schemaOwnerName: 'postgres',
    schemaComment: 'openpencil:release-ledger:v1',
    installMarkerConstraintComment: null,
    schemaInstallMarkerPrefixCount: 0,
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
    tables: tableRows(),
    columns: structuredClone(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1),
    constraints: structuredClone(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1)
  }
  if (state === 'mismatch') {
    const constraints = installed.constraints as MutableRecord[]
    const status = constraints.find(
      (entry) => entry.constraintName === 'backfill_executions_v1_status_check'
    )
    if (status) status.checkDefinition = "CHECK ((status = 'running'::text))"
  }
  return installed
}

function response(
  request: SupabaseBackfillDatabaseCASLedgerVerificationRequestV1,
  state: SupabaseBackfillDatabaseCASLedgerStateV1
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
    snapshotMarker: SNAPSHOT_MARKER,
    observedAt: OBSERVED_AT,
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
    catalog: catalog(state)
  }
}

interface TransportOptions {
  readonly state?: SupabaseBackfillDatabaseCASLedgerStateV1
  readonly authority?: unknown
  readonly transformResponse?: (value: MutableRecord) => unknown
  readonly onQuery?: (request: SupabaseBackfillDatabaseCASLedgerVerificationRequestV1) => void
  readonly onAuthority?: () => void
}

function transport(
  options: TransportOptions = {}
): SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1 {
  return {
    async getProjectAuthority(request) {
      options.onAuthority?.()
      return (options.authority ?? {
        projectRef: request.projectRef,
        organizationId: request.accountId,
        grantGeneration: request.grantGeneration
      }) as SupabaseBackfillLiveCatalogProjectAuthorityV1
    },
    async runReadOnlyDatabaseCASLedgerVerificationQuery(request) {
      options.onQuery?.(request)
      const value = response(request, options.state ?? 'installed')
      return options.transformResponse?.(value) ?? value
    }
  }
}

function verify(
  review: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1,
  authority: SupabaseBackfillLiveCatalogAuthorityV1,
  using: SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1
) {
  return verifySupabaseBackfillDatabaseCASLedgerV1({
    review,
    readCurrentAuthority: () => authority,
    transport: using
  })
}

async function expectError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillDatabaseCASLedgerVerificationErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillDatabaseCASLedgerVerificationError)
    expect((cause as SupabaseBackfillDatabaseCASLedgerVerificationError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected database CAS ledger verification error ${expected}`)
}

describe('Supabase backfill database CAS ledger verifier', () => {
  test('uses one fixed schema-qualified catalog query and retains no managed rows or authority', async () => {
    const fixture = await reviewFixture()
    let request!: SupabaseBackfillDatabaseCASLedgerVerificationRequestV1
    const result = await verify(
      fixture.review,
      fixture.authority,
      transport({ onQuery: (value) => (request = value) })
    )

    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_PARAMETER_ORDER).toEqual([
      'schemaName',
      'reviewDigest',
      'ledgerShapeDigest',
      'sqlDigest',
      'projectRef',
      'accountId',
      'grantGeneration',
      'queryVersion',
      'queryDigest'
    ])
    expect(new TextEncoder().encode(CAS_LEDGER_VERIFICATION_SQL_SOURCE).byteLength).toBe(31_244)
    expect(CAS_LEDGER_VERIFICATION_SQL_SOURCE.endsWith('\n')).toBe(true)
    expect(CAS_LEDGER_VERIFICATION_SQL_SOURCE.endsWith('\n\n')).toBe(false)
    expect(await digestBytes(CAS_LEDGER_VERIFICATION_SQL_SOURCE)).toBe(
      'zMfr0wQpYpXs8MF0cb05L9SUyePja_EdqXPKHCwd8tk'
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toBe(
      CAS_LEDGER_VERIFICATION_SQL_SOURCE.slice(0, -1)
    )
    expect(
      new TextEncoder().encode(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).byteLength
    ).toBe(31_243)
    expect(await digestBytes(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL)).toBe(
      'jBp_hzLNyeEUb-jQdctvOw5iSNYmDMduqskFu3Q-ph8'
    )
    expect(
      await digestCanonicalManifest(
        SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FIXED_QUERY
      )
    ).toBe('6FHGNIR1asygQOZJ47nQOISC3aB3RL0rDv5EioVhw4Q')
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toMatch(/^WITH\b/u)
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).not.toContain(';')
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COPY|ALTER|CREATE|DROP|TRUNCATE|LOCK)\b/iu
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      '"pg_catalog"."pg_constraint"'
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      '"pg_catalog"."pg_opclass"'
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      '"pg_catalog"."pg_operator"'
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      '"supporting_index"."indnullsnotdistinct"'
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      '"pg_catalog"."aclexplode"'
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      '"pg_catalog"."pg_auth_members"'
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      `"pg_catalog"."pg_has_role"(CURRENT_USER, 'pg_read_all_data', 'usage')`
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      `"pg_catalog"."pg_has_role"(SESSION_USER, 'pg_read_all_data', 'usage')`
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).not.toContain(
      `"pg_catalog"."pg_has_role"(CURRENT_USER, 'pg_read_all_data', 'member')`
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      '"pg_catalog"."pg_default_acl"'
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      '"pg_catalog"."pg_rewrite"'
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      '"pg_catalog"."pg_inherits"'
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      '"pg_catalog"."pg_publication_tables"'
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      '"pg_catalog"."pg_get_constraintdef"("constraint_entry"."oid", FALSE)'
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      `"constraint_entry"."conname" = '${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT}'`
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      `LIKE '${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX}%'`
    )
    expect(
      SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1.find(
        (entry) => entry.constraintName === 'backfill_receipts_v2_previous_head_fkey'
      )?.matchType
    ).toBe('s')
    expect(
      SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1.filter(
        (entry) => entry.constraintType === 'f'
      ).map((entry) => [
        entry.constraintName,
        entry.supportingIndex?.tableName,
        entry.supportingIndex?.indexName,
        entry.supportingIndex?.primary
      ])
    ).toEqual([
      [
        'backfill_receipts_v2_execution_fkey',
        'backfill_executions_v1',
        'backfill_executions_v1_pkey',
        true
      ],
      [
        'backfill_receipts_v2_previous_head_fkey',
        'backfill_receipts_v2',
        'backfill_receipts_v2_head_key',
        false
      ],
      [
        'backfill_heads_v1_receipt_fkey',
        'backfill_receipts_v2',
        'backfill_receipts_v2_head_key',
        false
      ]
    ])
    expect(
      SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1.every(
        (entry) =>
          (entry.constraintType === 'c') === (entry.supportingIndex === null) &&
          (entry.constraintType === 'f') === (entry.foreignKeyOperators !== null)
      )
    ).toBe(true)
    expect(
      JSON.stringify(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1)
    ).not.toMatch(/oid/iu)
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).not.toContain(
      "'parentConstraintOid'"
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).toContain(
      '"acl_entry"."grantee" <> "schema_entry"."owner_oid"'
    )
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).not.toMatch(
      /FROM\s+"openpencil_release"/iu
    )
    expect(request).toMatchObject({
      queryId: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_ID,
      queryVersion: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION,
      reviewDigest: fixture.review.reviewDigest,
      statementCount: 1,
      catalogOnly: true,
      managedDataRead: false,
      accessMode: 'read-only',
      snapshotScope: 'single-statement',
      parameters: { schemaName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA }
    })
    const [expectedColumnDigest, expectedConstraintDigest] = await Promise.all([
      digestCanonicalManifest(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1),
      digestCanonicalManifest(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1)
    ])
    expect(result).toMatchObject({
      format: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FORMAT,
      version: 1,
      providerId: 'supabase',
      reviewOnly: true,
      applyAvailable: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false,
      installAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      state: 'installed',
      verifiedInstalled: true,
      roles: {
        currentBypassRls: true,
        currentHasEffectivePgReadAllData: true,
        sessionBypassRls: true,
        sessionHasEffectivePgReadAllData: true
      },
      catalog: {
        schemaCount: 1,
        relationCount: 3,
        unexpectedIndexCount: 0,
        unexpectedTriggerCount: 0,
        unexpectedRuleCount: 0,
        unexpectedConstraintCount: 0,
        inheritanceRelationCount: 0,
        publicationExposureCount: 0,
        droppedColumnCount: 0,
        policyCount: 0,
        columnCount: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1.length,
        constraintCount: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1.length,
        installationMarker: {
          constraintName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT,
          constraintComment: null,
          schemaMarkerPrefixCount: 0,
          state: 'absent',
          exactSingleMarkerOnConstraint: false,
          rawArbitraryCommentsReturned: false
        },
        fingerprints: {
          observedColumnDigest: expectedColumnDigest,
          expectedColumnDigest,
          observedConstraintDigest: expectedConstraintDigest,
          expectedConstraintDigest
        },
        rawCheckDefinitionsReturned: false
      },
      checks: {
        queryRoleMatchesReadOnlyEndpoint: true,
        queryRoleIsNonSuperuser: true,
        queryRoleBypassesRls: true,
        queryRoleHasEffectivePgReadAllData: true,
        queryRoleIsNotLedgerOwner: true,
        currentAndSessionRoleMatch: true,
        searchPathIsBounded: true,
        schemaExact: true,
        tableShapeExact: true,
        columnShapeExact: true,
        constraintShapeExact: true,
        commentsExact: true,
        rowLevelSecurityExact: true,
        aclExact: true,
        zeroPolicies: true,
        noUnexpectedRelations: true,
        exactInstalledState: true,
        allVerificationChecksPassed: true
      }
    })
    expect(Object.isFrozen(result.catalog.fingerprints)).toBe(true)
    expect(Object.isFrozen(result.catalog.installationMarker)).toBe(true)
    expect(result.verificationDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(result).not.toHaveProperty('columns')
    expect(result).not.toHaveProperty('constraints')
    expect(trustedSupabaseBackfillDatabaseCASLedgerVerificationV1(result, fixture.review)).toBe(
      result
    )
    expect(
      trustedSupabaseBackfillDatabaseCASLedgerVerificationV1(
        structuredClone(result),
        fixture.review
      )
    ).toBeNull()
    expect(consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(fixture.capture)).not.toBeNull()
    expect(
      trustedSupabaseBackfillDatabaseCASLedgerVerificationV1(result, fixture.review)
    ).toBeNull()
  })

  test('exposes only strict frozen operation-marker evidence without upgrading structural verification', async () => {
    const exactFixture = await reviewFixture()
    const exact = await verify(
      exactFixture.review,
      exactFixture.authority,
      transport({
        transformResponse(value) {
          const inventory = value.catalog as MutableRecord
          inventory.installMarkerConstraintComment = INSTALL_MARKER
          inventory.schemaInstallMarkerPrefixCount = 1
          return value
        }
      })
    )
    expect(exact.state).toBe('installed')
    expect(exact.verifiedInstalled).toBe(true)
    expect(exact.catalog.installationMarker).toEqual({
      constraintName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT,
      constraintComment: INSTALL_MARKER,
      schemaMarkerPrefixCount: 1,
      state: 'exact-single',
      exactSingleMarkerOnConstraint: true,
      rawArbitraryCommentsReturned: false
    })
    expect(
      trustedSupabaseBackfillDatabaseCASLedgerInstallMarkerEvidenceV1(
        exact,
        exactFixture.review,
        INSTALL_MARKER
      )
    ).toBe(exact.catalog.installationMarker)
    expect(
      trustedSupabaseBackfillDatabaseCASLedgerInstallMarkerEvidenceV1(
        exact,
        exactFixture.review,
        OTHER_INSTALL_MARKER
      )
    ).toBeNull()
    expect(
      trustedSupabaseBackfillDatabaseCASLedgerInstallMarkerEvidenceV1(
        structuredClone(exact),
        exactFixture.review,
        INSTALL_MARKER
      )
    ).toBeNull()
    expect(
      trustedSupabaseBackfillDatabaseCASLedgerInstallMarkerEvidenceV1(
        new Proxy(exact, {}),
        exactFixture.review,
        INSTALL_MARKER
      )
    ).toBeNull()

    for (const markerCase of [
      {
        label: 'wrong operation marker',
        comment: OTHER_INSTALL_MARKER,
        count: 1,
        expectedState: 'exact-single'
      },
      {
        label: 'duplicate schema marker',
        comment: INSTALL_MARKER,
        count: 2,
        expectedState: 'mismatch'
      },
      {
        label: 'marker on the wrong constraint',
        comment: null,
        count: 1,
        expectedState: 'mismatch'
      }
    ] as const) {
      const fixture = await reviewFixture()
      const verification = await verify(
        fixture.review,
        fixture.authority,
        transport({
          transformResponse(value) {
            const inventory = value.catalog as MutableRecord
            inventory.installMarkerConstraintComment = markerCase.comment
            inventory.schemaInstallMarkerPrefixCount = markerCase.count
            return value
          }
        })
      )
      expect(verification.state, markerCase.label).toBe('installed')
      expect(verification.verifiedInstalled, markerCase.label).toBe(true)
      expect(verification.catalog.installationMarker.state, markerCase.label).toBe(
        markerCase.expectedState
      )
      expect(
        trustedSupabaseBackfillDatabaseCASLedgerInstallMarkerEvidenceV1(
          verification,
          fixture.review,
          INSTALL_MARKER
        ),
        markerCase.label
      ).toBeNull()
    }
  })

  test('consumes only an exact post-rotation installed proof for the bound operation marker', async () => {
    const fixture = await reviewFixture()
    const exactMarkerTransport = () =>
      transport({
        transformResponse(value) {
          const inventory = value.catalog as MutableRecord
          inventory.installMarkerConstraintComment = INSTALL_MARKER
          inventory.schemaInstallMarkerPrefixCount = 1
          return value
        }
      })
    const preDispatchProof = await verify(fixture.review, fixture.authority, exactMarkerTransport())
    let releaseInitialAuthority!: (value: SupabaseBackfillLiveCatalogAuthorityV1) => void
    const initialAuthority = new Promise<SupabaseBackfillLiveCatalogAuthorityV1>((resolve) => {
      releaseInitialAuthority = resolve
    })
    let authorityReadCount = 0
    const startedBeforeRotation = verifySupabaseBackfillDatabaseCASLedgerV1({
      review: fixture.review,
      readCurrentAuthority() {
        authorityReadCount += 1
        return authorityReadCount === 1 ? initialAuthority : fixture.authority
      },
      transport: exactMarkerTransport()
    })

    expect(() =>
      rotateSupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1(
        structuredClone(fixture.review)
      )
    ).toThrow(SupabaseBackfillDatabaseCASLedgerVerificationError)
    const staleEpoch = rotateSupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1(
      fixture.review
    )
    releaseInitialAuthority(fixture.authority)
    const proofStartedBeforeRotation = await startedBeforeRotation
    const staleEpochProof = await verify(fixture.review, fixture.authority, exactMarkerTransport())
    const requiredEpoch = rotateSupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1(
      fixture.review
    )
    const installed = await verify(fixture.review, fixture.authority, exactMarkerTransport())
    const wrongMarkerProof = await verify(
      fixture.review,
      fixture.authority,
      transport({
        transformResponse(value) {
          const inventory = value.catalog as MutableRecord
          inventory.installMarkerConstraintComment = OTHER_INSTALL_MARKER
          inventory.schemaInstallMarkerPrefixCount = 1
          return value
        }
      })
    )
    const duplicateMarkerProof = await verify(
      fixture.review,
      fixture.authority,
      transport({
        transformResponse(value) {
          const inventory = value.catalog as MutableRecord
          inventory.installMarkerConstraintComment = INSTALL_MARKER
          inventory.schemaInstallMarkerPrefixCount = 2
          return value
        }
      })
    )

    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
        preDispatchProof,
        fixture.review,
        INSTALL_MARKER,
        requiredEpoch
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
        proofStartedBeforeRotation,
        fixture.review,
        INSTALL_MARKER,
        requiredEpoch
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
        staleEpochProof,
        fixture.review,
        INSTALL_MARKER,
        staleEpoch
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
        staleEpochProof,
        fixture.review,
        INSTALL_MARKER,
        requiredEpoch
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
        structuredClone(installed),
        fixture.review,
        INSTALL_MARKER,
        requiredEpoch
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
        installed,
        structuredClone(fixture.review),
        INSTALL_MARKER,
        requiredEpoch
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
        installed,
        fixture.review,
        INSTALL_MARKER,
        structuredClone(
          requiredEpoch
        ) as SupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
        installed,
        fixture.review,
        OTHER_INSTALL_MARKER,
        requiredEpoch
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
        wrongMarkerProof,
        fixture.review,
        INSTALL_MARKER,
        requiredEpoch
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
        duplicateMarkerProof,
        fixture.review,
        INSTALL_MARKER,
        requiredEpoch
      )
    ).toBeNull()
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
        installed,
        fixture.review,
        INSTALL_MARKER,
        requiredEpoch
      )
    ).toBe(installed)
    expect(
      consumeTrustedSupabaseBackfillDatabaseCASLedgerInstalledVerificationV1(
        installed,
        fixture.review,
        INSTALL_MARKER,
        requiredEpoch
      )
    ).toBeNull()
    expect(
      trustedSupabaseBackfillDatabaseCASLedgerInstallMarkerEvidenceV1(
        installed,
        fixture.review,
        INSTALL_MARKER
      )
    ).toBe(installed.catalog.installationMarker)
  })

  test('rejects arbitrary or accessor-backed marker comments instead of returning raw catalog text', async () => {
    for (const transformResponse of [
      (value: MutableRecord) => {
        const inventory = value.catalog as MutableRecord
        inventory.installMarkerConstraintComment = 'operator supplied arbitrary comment'
        return value
      },
      (value: MutableRecord) => {
        const inventory = value.catalog as MutableRecord
        Object.defineProperty(inventory, 'installMarkerConstraintComment', {
          enumerable: true,
          get: () => INSTALL_MARKER
        })
        return value
      }
    ]) {
      const fixture = await reviewFixture()
      await expectError(
        verify(fixture.review, fixture.authority, transport({ transformResponse })),
        'supabase-backfill-database-cas-ledger-verification-response-invalid'
      )
    }
  })

  test('strictly rejects missing, malformed, or extended role capability evidence', async () => {
    for (const mutate of [
      (value: MutableRecord) => {
        const roles = value.roles as MutableRecord
        delete roles.sessionHasEffectivePgReadAllData
      },
      (value: MutableRecord) => {
        const roles = value.roles as MutableRecord
        roles.currentHasEffectivePgReadAllData = 'true'
      },
      (value: MutableRecord) => {
        const roles = value.roles as MutableRecord
        roles.currentBypassRls = 1
      },
      (value: MutableRecord) => {
        const roles = value.roles as MutableRecord
        roles.extension = true
      }
    ]) {
      const fixture = await reviewFixture()
      await expectError(
        verify(
          fixture.review,
          fixture.authority,
          transport({
            transformResponse(value) {
              mutate(value)
              return value
            }
          })
        ),
        'supabase-backfill-database-cas-ledger-verification-response-invalid'
      )
    }
  })

  test('distinguishes completely absent from exact installed and fails partial or drifted shape closed', async () => {
    const absentFixture = await reviewFixture()
    const absent = await verify(
      absentFixture.review,
      absentFixture.authority,
      transport({ state: 'absent' })
    )
    expect(absent.state).toBe('absent')
    expect(absent.verifiedInstalled).toBe(false)
    expect(absent.checks.absentStateExact).toBe(true)
    expect(absent.checks.allVerificationChecksPassed).toBe(true)
    expect(absent.blockers).toContain('database-ledger-not-installed')

    const mismatchFixture = await reviewFixture()
    const exactBeforeMismatch = await verify(
      mismatchFixture.review,
      mismatchFixture.authority,
      transport()
    )
    const mismatch = await verify(
      mismatchFixture.review,
      mismatchFixture.authority,
      transport({ state: 'mismatch' })
    )
    expect(mismatch.state).toBe('mismatch')
    expect(mismatch.verifiedInstalled).toBe(false)
    expect(mismatch.checks.constraintShapeExact).toBe(false)
    expect(mismatch.checks.allVerificationChecksPassed).toBe(false)
    expect(mismatch.catalog.fingerprints.observedColumnDigest).toBe(
      mismatch.catalog.fingerprints.expectedColumnDigest
    )
    expect(mismatch.catalog.fingerprints.observedConstraintDigest).not.toBe(
      mismatch.catalog.fingerprints.expectedConstraintDigest
    )
    expect(mismatch.verificationDigest).not.toBe(exactBeforeMismatch.verificationDigest)
    expect(mismatch.blockers).toContain('database-ledger-catalog-mismatch')

    const transactionSettingFixture = await reviewFixture()
    const transactionSetting = await verify(
      transactionSettingFixture.review,
      transactionSettingFixture.authority,
      transport({
        transformResponse(value) {
          const settings = value.settings as MutableRecord
          settings.transactionReadOnly = false
          return value
        }
      })
    )
    expect(transactionSetting.state).toBe('installed')
    expect(transactionSetting.verifiedInstalled).toBe(true)
    expect(transactionSetting.settings.transactionReadOnly).toBe(false)
    expect(transactionSetting.checks.allVerificationChecksPassed).toBe(true)
    expect(transactionSetting.blockers).not.toContain('database-ledger-query-not-read-only')

    const bypassObservationFixture = await reviewFixture()
    const exactBeforeBypassObservation = await verify(
      bypassObservationFixture.review,
      bypassObservationFixture.authority,
      transport()
    )
    const bypassObservation = await verify(
      bypassObservationFixture.review,
      bypassObservationFixture.authority,
      transport({
        transformResponse(value) {
          const roles = value.roles as MutableRecord
          roles.currentBypassRls = false
          roles.sessionBypassRls = false
          return value
        }
      })
    )
    expect(bypassObservation.state).toBe('installed')
    expect(bypassObservation.verifiedInstalled).toBe(false)
    expect(bypassObservation.roles.currentBypassRls).toBe(false)
    expect(bypassObservation.roles.sessionBypassRls).toBe(false)
    expect(bypassObservation.checks.queryRoleBypassesRls).toBe(false)
    expect(bypassObservation.checks.allVerificationChecksPassed).toBe(false)
    expect(bypassObservation.blockers).toContain('read-only-query-role-missing-bypassrls')
    expect(bypassObservation.verificationDigest).not.toBe(
      exactBeforeBypassObservation.verificationDigest
    )

    const memberOnlyRoleFixture = await reviewFixture()
    const exactBeforeMemberOnlyRole = await verify(
      memberOnlyRoleFixture.review,
      memberOnlyRoleFixture.authority,
      transport()
    )
    const memberOnlyRole = await verify(
      memberOnlyRoleFixture.review,
      memberOnlyRoleFixture.authority,
      transport({
        transformResponse(value) {
          const roles = value.roles as MutableRecord
          roles.currentHasEffectivePgReadAllData = false
          roles.sessionHasEffectivePgReadAllData = false
          return value
        }
      })
    )
    expect(memberOnlyRole.state).toBe('installed')
    expect(memberOnlyRole.verifiedInstalled).toBe(false)
    expect(memberOnlyRole.roles.currentHasEffectivePgReadAllData).toBe(false)
    expect(memberOnlyRole.roles.sessionHasEffectivePgReadAllData).toBe(false)
    expect(memberOnlyRole.checks.queryRoleHasEffectivePgReadAllData).toBe(false)
    expect(memberOnlyRole.checks.allVerificationChecksPassed).toBe(false)
    expect(memberOnlyRole.blockers).toContain(
      'read-only-query-role-missing-effective-pg-read-all-data'
    )
    expect(memberOnlyRole.verificationDigest).not.toBe(exactBeforeMemberOnlyRole.verificationDigest)

    for (const current of [
      {
        label: 'partial schema without its three tables',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          inventory.relationCount = 0
          inventory.tables = []
          inventory.columns = []
          inventory.constraints = []
        }
      },
      {
        label: 'forced RLS drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const tables = inventory.tables as MutableRecord[]
          if (tables[0]) tables[0].rlsForced = true
        }
      },
      {
        label: 'arbitrary non-owner schema ACL drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          inventory.schemaNonOwnerPrivilegeCount = 1
        }
      },
      {
        label: 'schema-owner default ACL drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          inventory.ownerDefaultNonOwnerPrivilegeCount = 1
        }
      },
      {
        label: 'arbitrary non-owner table ACL drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const tables = inventory.tables as MutableRecord[]
          if (tables[0]) tables[0].nonOwnerPrivilegeCount = 1
        }
      },
      {
        label: 'arbitrary non-owner column ACL drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const columns = inventory.columns as MutableRecord[]
          if (columns[0]) columns[0].nonOwnerColumnPrivilegeCount = 1
        }
      },
      {
        label: 'transitive schema-owner membership drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          inventory.ownerRoleMemberCount = 1
        }
      },
      {
        label: 'table owner differs from the schema owner',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const tables = inventory.tables as MutableRecord[]
          if (tables[0]) {
            tables[0].ownerOid = '11'
            tables[0].ownerName = 'other_owner'
          }
        }
      },
      {
        label: 'unlogged table drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const tables = inventory.tables as MutableRecord[]
          if (tables[0]) tables[0].persistence = 'u'
        }
      },
      {
        label: 'partitioned table drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const tables = inventory.tables as MutableRecord[]
          if (tables[0]) tables[0].isPartition = true
        }
      },
      {
        label: 'replica identity drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const tables = inventory.tables as MutableRecord[]
          if (tables[0]) tables[0].replicaIdentity = 'f'
        }
      },
      {
        label: 'column type modifier drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const columns = inventory.columns as MutableRecord[]
          if (columns[0]) columns[0].typeModifier = 32
        }
      },
      {
        label: 'column collation drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const columns = inventory.columns as MutableRecord[]
          if (columns[0]) columns[0].usesTypeDefaultCollation = false
        }
      },
      {
        label: 'policy drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          inventory.policyCount = 1
        }
      },
      {
        label: 'unexpected index drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          inventory.unexpectedIndexCount = 1
        }
      },
      {
        label: 'unexpected trigger drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          inventory.unexpectedTriggerCount = 1
        }
      },
      {
        label: 'rewrite rule drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          inventory.unexpectedRuleCount = 1
        }
      },
      {
        label: 'unsupported constraint drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          inventory.unexpectedConstraintCount = 1
        }
      },
      {
        label: 'inheritance relation drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          inventory.inheritanceRelationCount = 1
        }
      },
      {
        label: 'publication exposure drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          inventory.publicationExposureCount = 1
        }
      },
      {
        label: 'dropped column drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          inventory.droppedColumnCount = 1
        }
      },
      {
        label: 'disabled foreign-key constraint trigger drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const constraints = inventory.constraints as MutableRecord[]
          const foreignKey = constraints.find(
            (entry) => entry.constraintName === 'backfill_receipts_v2_execution_fkey'
          )
          if (foreignKey) foreignKey.enabledConstraintTriggerCount = 3
        }
      },
      {
        label: 'missing foreign-key constraint trigger drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const constraints = inventory.constraints as MutableRecord[]
          const foreignKey = constraints.find(
            (entry) => entry.constraintName === 'backfill_receipts_v2_execution_fkey'
          )
          if (foreignKey) foreignKey.constraintTriggerCount = 3
        }
      },
      {
        label: 'cross-schema foreign-key target drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const constraints = inventory.constraints as MutableRecord[]
          const foreignKey = constraints.find(
            (entry) => entry.constraintName === 'backfill_receipts_v2_execution_fkey'
          )
          if (foreignKey) foreignKey.targetSchemaName = 'shadow_release'
        }
      },
      {
        label: 'invalid constraint index drift',
        mutate(value: MutableRecord) {
          supportingIndexFromResponse(value, 'backfill_executions_v1_pkey').valid = false
        }
      },
      {
        label: 'constraint index namespace drift',
        mutate(value: MutableRecord) {
          supportingIndexFromResponse(value, 'backfill_executions_v1_pkey').indexSchemaName =
            'shadow_release'
        }
      },
      {
        label: 'foreign-key supporting index identity drift',
        mutate(value: MutableRecord) {
          supportingIndexFromResponse(value, 'backfill_receipts_v2_execution_fkey').indexName =
            'backfill_executions_v1_capture_key'
        }
      },
      {
        label: 'foreign-key supporting table identity drift',
        mutate(value: MutableRecord) {
          supportingIndexFromResponse(value, 'backfill_receipts_v2_previous_head_fkey').tableName =
            'backfill_executions_v1'
        }
      },
      {
        label: 'constraint index access method drift',
        mutate(value: MutableRecord) {
          supportingIndexFromResponse(value, 'backfill_executions_v1_pkey').accessMethodName =
            'hash'
        }
      },
      {
        label: 'constraint index key order drift',
        mutate(value: MutableRecord) {
          const index = supportingIndexFromResponse(value, 'backfill_receipts_v2_pkey')
          index.keyFields = ['revision', 'execution_id']
          index.keyOpclasses = [
            { schemaName: 'pg_catalog', opclassName: 'int8_ops' },
            { schemaName: 'pg_catalog', opclassName: 'text_ops' }
          ]
        }
      },
      {
        label: 'constraint index include column drift',
        mutate(value: MutableRecord) {
          const index = supportingIndexFromResponse(value, 'backfill_executions_v1_pkey')
          index.totalAttributeCount = 2
          index.includedFields = ['provider_id']
        }
      },
      {
        label: 'constraint index operator class drift',
        mutate(value: MutableRecord) {
          supportingIndexFromResponse(value, 'backfill_executions_v1_pkey').keyOpclasses = [
            { schemaName: 'custom_ops', opclassName: 'text_ops' }
          ]
        }
      },
      {
        label: 'constraint index option drift',
        mutate(value: MutableRecord) {
          supportingIndexFromResponse(value, 'backfill_executions_v1_pkey').keyOptions = [1]
        }
      },
      {
        label: 'constraint index key collation drift',
        mutate(value: MutableRecord) {
          supportingIndexFromResponse(
            value,
            'backfill_executions_v1_pkey'
          ).keyCollationsMatchColumns = false
        }
      },
      {
        label: 'constraint index primary marker drift',
        mutate(value: MutableRecord) {
          supportingIndexFromResponse(value, 'backfill_executions_v1_pkey').primary = false
        }
      },
      {
        label: 'foreign-key primary-foreign operator drift',
        mutate(value: MutableRecord) {
          const operators = foreignKeyOperatorsFromResponse(
            value,
            'backfill_receipts_v2_execution_fkey'
          ).primaryForeign as MutableRecord[]
          if (operators[0]) operators[0].schemaName = 'custom_ops'
        }
      },
      {
        label: 'foreign-key primary-primary operator type drift',
        mutate(value: MutableRecord) {
          const operators = foreignKeyOperatorsFromResponse(
            value,
            'backfill_receipts_v2_previous_head_fkey'
          ).primaryPrimary as MutableRecord[]
          if (operators[1]) operators[1].rightTypeName = 'int4'
        }
      },
      {
        label: 'foreign-key foreign-foreign operator order drift',
        mutate(value: MutableRecord) {
          const operators = foreignKeyOperatorsFromResponse(
            value,
            'backfill_receipts_v2_previous_head_fkey'
          ).foreignForeign as MutableRecord[]
          operators.reverse()
        }
      },
      {
        label: 'canonical bytes digest binding drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const constraints = inventory.constraints as MutableRecord[]
          const scopeBytes = constraints.find(
            (entry) => entry.constraintName === 'backfill_executions_v1_scope_bytes_check'
          )
          if (scopeBytes) {
            scopeBytes.checkDefinition =
              'CHECK ((canonical_scope_byte_length = octet_length(canonical_scope)))'
          }
        }
      },
      {
        label: 'previous-head foreign key match drift',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          const constraints = inventory.constraints as MutableRecord[]
          const previousHead = constraints.find(
            (entry) => entry.constraintName === 'backfill_receipts_v2_previous_head_fkey'
          )
          if (previousHead) previousHead.matchType = 'f'
        }
      }
    ]) {
      const fixture = await reviewFixture()
      const result = await verify(
        fixture.review,
        fixture.authority,
        transport({
          transformResponse(value) {
            current.mutate(value)
            return value
          }
        })
      )
      expect(result.state, current.label).toBe('mismatch')
      expect(result.verifiedInstalled, current.label).toBe(false)
      expect(result.checks.allVerificationChecksPassed, current.label).toBe(false)
    }

    for (const [field, driftedValue] of [
      ['ready', false],
      ['live', false],
      ['unique', false],
      ['immediate', false],
      ['hasPredicate', true],
      ['hasExpressions', true],
      ['nullsNotDistinct', true]
    ] as const) {
      const fixture = await reviewFixture()
      const result = await verify(
        fixture.review,
        fixture.authority,
        transport({
          transformResponse(value) {
            supportingIndexFromResponse(value, 'backfill_executions_v1_pkey')[field] = driftedValue
            return value
          }
        })
      )
      expect(result.state, `constraint index ${field} drift`).toBe('mismatch')
      expect(result.verifiedInstalled, `constraint index ${field} drift`).toBe(false)
    }

    for (const constraintName of [
      'backfill_receipts_v2_execution_fkey',
      'backfill_receipts_v2_previous_head_fkey',
      'backfill_heads_v1_receipt_fkey'
    ]) {
      const fixture = await reviewFixture()
      const result = await verify(
        fixture.review,
        fixture.authority,
        transport({
          transformResponse(value) {
            supportingIndexFromResponse(value, constraintName).indexName = 'wrong_supporting_index'
            return value
          }
        })
      )
      expect(result.state, `${constraintName} supporting index drift`).toBe('mismatch')
      expect(result.verifiedInstalled, `${constraintName} supporting index drift`).toBe(false)
    }

    for (const current of [
      {
        label: 'unexpected query role',
        blocker: 'unexpected-read-only-query-role',
        mutate(value: MutableRecord) {
          const roles = value.roles as MutableRecord
          roles.currentName = 'other_read_only_role'
          roles.sessionName = 'other_read_only_role'
        }
      },
      {
        label: 'superuser query role',
        blocker: 'privileged-query-role',
        mutate(value: MutableRecord) {
          const roles = value.roles as MutableRecord
          roles.currentSuperuser = true
          roles.sessionSuperuser = true
        }
      },
      {
        label: 'ledger-owner query role',
        blocker: 'ledger-owner-query-role',
        mutate(value: MutableRecord) {
          const inventory = value.catalog as MutableRecord
          inventory.schemaOwnerOid = '9000'
          inventory.schemaOwnerName = 'supabase_read_only_user'
          const tables = inventory.tables as MutableRecord[]
          for (const table of tables) {
            table.ownerOid = '9000'
            table.ownerName = 'supabase_read_only_user'
          }
        }
      },
      {
        label: 'current and session role drift',
        blocker: 'database-ledger-query-role-changed',
        mutate(value: MutableRecord) {
          const roles = value.roles as MutableRecord
          roles.sessionOid = '9001'
        }
      },
      {
        label: 'current and session BYPASSRLS evidence drift',
        blocker: 'database-ledger-query-role-changed',
        mutate(value: MutableRecord) {
          const roles = value.roles as MutableRecord
          roles.sessionBypassRls = false
        }
      },
      {
        label: 'current and session effective pg_read_all_data evidence drift',
        blocker: 'database-ledger-query-role-changed',
        mutate(value: MutableRecord) {
          const roles = value.roles as MutableRecord
          roles.sessionHasEffectivePgReadAllData = false
        }
      },
      {
        label: 'database is not primary',
        blocker: 'database-not-primary',
        mutate(value: MutableRecord) {
          const settings = value.settings as MutableRecord
          settings.databasePrimary = false
        }
      },
      {
        label: 'unbounded search path',
        blocker: 'search-path-not-bounded',
        mutate(value: MutableRecord) {
          const settings = value.settings as MutableRecord
          settings.effectiveSearchPath = ['pg_catalog', 'public', 'extensions']
        }
      }
    ]) {
      const fixture = await reviewFixture()
      const result = await verify(
        fixture.review,
        fixture.authority,
        transport({
          transformResponse(value) {
            current.mutate(value)
            return value
          }
        })
      )
      expect(result.state, current.label).toBe('installed')
      expect(result.verifiedInstalled, current.label).toBe(false)
      expect(result.checks.allVerificationChecksPassed, current.label).toBe(false)
      expect(result.blockers, current.label).toContain(current.blocker)
    }
  }, 20_000)

  test('accepts only PostgreSQL 15 through 17 catalog contracts', async () => {
    for (const serverVersionNum of ['150016', '160012', '170006']) {
      const fixture = await reviewFixture()
      const result = await verify(
        fixture.review,
        fixture.authority,
        transport({
          transformResponse(value) {
            value.serverVersionNum = serverVersionNum
            return value
          }
        })
      )
      expect(result.serverVersionNum).toBe(serverVersionNum)
      expect(result.verifiedInstalled).toBe(true)
    }

    for (const serverVersionNum of ['140019', '180000']) {
      const fixture = await reviewFixture()
      await expectError(
        verify(
          fixture.review,
          fixture.authority,
          transport({
            transformResponse(value) {
              value.serverVersionNum = serverVersionNum
              return value
            }
          })
        ),
        'supabase-backfill-database-cas-ledger-verification-response-invalid'
      )
    }
  })

  test('strictly rejects malformed nested index and foreign-key operator fingerprints', async () => {
    for (const current of [
      {
        label: 'supporting index extension',
        mutate(value: MutableRecord) {
          supportingIndexFromResponse(value, 'backfill_executions_v1_pkey').extension = true
        }
      },
      {
        label: 'supporting index accessor',
        mutate(value: MutableRecord) {
          Object.defineProperty(
            supportingIndexFromResponse(value, 'backfill_executions_v1_pkey'),
            'valid',
            { enumerable: true, configurable: true, get: () => true }
          )
        }
      },
      {
        label: 'operator custom prototype',
        mutate(value: MutableRecord) {
          const operators = foreignKeyOperatorsFromResponse(
            value,
            'backfill_receipts_v2_execution_fkey'
          ).primaryForeign as MutableRecord[]
          if (operators[0]) {
            operators[0] = Object.assign(Object.create({ inherited: true }), operators[0])
          }
        }
      },
      {
        label: 'operator symbol extension',
        mutate(value: MutableRecord) {
          const operators = foreignKeyOperatorsFromResponse(
            value,
            'backfill_receipts_v2_execution_fkey'
          ).primaryForeign as MutableRecord[]
          if (operators[0]) Reflect.set(operators[0], Symbol('extension'), true)
        }
      },
      {
        label: 'indexed constraint without supporting index',
        mutate(value: MutableRecord) {
          constraintFromResponse(value, 'backfill_executions_v1_pkey').supportingIndex = null
        }
      },
      {
        label: 'check constraint with supporting index',
        mutate(value: MutableRecord) {
          constraintFromResponse(value, 'backfill_executions_v1_status_check').supportingIndex =
            structuredClone(supportingIndexFromResponse(value, 'backfill_executions_v1_pkey'))
        }
      },
      {
        label: 'foreign key without operator arrays',
        mutate(value: MutableRecord) {
          constraintFromResponse(value, 'backfill_receipts_v2_execution_fkey').foreignKeyOperators =
            null
        }
      },
      {
        label: 'non-foreign constraint with operator arrays',
        mutate(value: MutableRecord) {
          constraintFromResponse(value, 'backfill_executions_v1_pkey').foreignKeyOperators =
            structuredClone(
              foreignKeyOperatorsFromResponse(value, 'backfill_receipts_v2_execution_fkey')
            )
        }
      },
      {
        label: 'missing foreign-key operator family',
        mutate(value: MutableRecord) {
          const operators = foreignKeyOperatorsFromResponse(
            value,
            'backfill_receipts_v2_execution_fkey'
          )
          delete operators.primaryPrimary
        }
      },
      {
        label: 'foreign-key operator count mismatch',
        mutate(value: MutableRecord) {
          foreignKeyOperatorsFromResponse(
            value,
            'backfill_receipts_v2_execution_fkey'
          ).primaryForeign = []
        }
      },
      {
        label: 'sparse index option array',
        mutate(value: MutableRecord) {
          const sparse: unknown[] = []
          sparse.length = 1
          supportingIndexFromResponse(value, 'backfill_executions_v1_pkey').keyOptions = sparse
        }
      }
    ]) {
      const fixture = await reviewFixture()
      await expectError(
        verify(
          fixture.review,
          fixture.authority,
          transport({
            transformResponse(value) {
              current.mutate(value)
              return value
            }
          })
        ),
        'supabase-backfill-database-cas-ledger-verification-response-invalid'
      )
      expect(current.label.length).toBeGreaterThan(0)
    }
  })

  test('rejects cloned or consumed review provenance and authority drift before catalog dispatch', async () => {
    const cloneFixture = await reviewFixture()
    let cloneCalls = 0
    await expectError(
      verifySupabaseBackfillDatabaseCASLedgerV1({
        review: structuredClone(cloneFixture.review),
        readCurrentAuthority: () => cloneFixture.authority,
        transport: transport({ onAuthority: () => (cloneCalls += 1) })
      }),
      'supabase-backfill-database-cas-ledger-verification-input-invalid'
    )
    expect(cloneCalls).toBe(0)

    const consumedFixture = await reviewFixture()
    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(consumedFixture.capture)
    ).not.toBeNull()
    let consumedCalls = 0
    await expectError(
      verify(
        consumedFixture.review,
        consumedFixture.authority,
        transport({ onAuthority: () => (consumedCalls += 1) })
      ),
      'supabase-backfill-database-cas-ledger-verification-input-invalid'
    )
    expect(consumedCalls).toBe(0)

    const driftFixture = await reviewFixture()
    let driftCalls = 0
    await expectError(
      verify(
        driftFixture.review,
        { ...driftFixture.authority, grantGeneration: 'different-grant' },
        transport({ onAuthority: () => (driftCalls += 1) })
      ),
      'supabase-backfill-database-cas-ledger-verification-input-changed'
    )
    expect(driftCalls).toBe(0)
  })

  test('strictly rejects binding, response, project, and mid-flight provenance changes', async () => {
    for (const current of [
      {
        label: 'review binding',
        expected: 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const,
        transformResponse: (value: MutableRecord): unknown => ({
          ...value,
          reviewDigest: 'Z'.repeat(43)
        })
      },
      {
        label: 'managed row assertion',
        expected:
          'supabase-backfill-database-cas-ledger-verification-query-binding-mismatch' as const,
        transformResponse: (value: MutableRecord): unknown => ({ ...value, managedDataRead: true })
      },
      {
        label: 'top-level extension',
        expected: 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const,
        transformResponse: (value: MutableRecord): unknown => ({ ...value, extension: true })
      },
      {
        label: 'catalog extension',
        expected: 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const,
        transformResponse(value: MutableRecord): unknown {
          const catalogValue = value.catalog as MutableRecord
          return { ...value, catalog: { ...catalogValue, extension: true } }
        }
      },
      {
        label: 'over-limit column inventory',
        expected: 'supabase-backfill-database-cas-ledger-verification-response-invalid' as const,
        transformResponse(value: MutableRecord): unknown {
          const catalogValue = value.catalog as MutableRecord
          return {
            ...value,
            catalog: { ...catalogValue, columns: Array.from({ length: 65 }, () => ({})) }
          }
        }
      }
    ]) {
      const fixture = await reviewFixture()
      await expectError(
        verify(
          fixture.review,
          fixture.authority,
          transport({ transformResponse: current.transformResponse })
        ),
        current.expected
      )
      expect(current.label.length).toBeGreaterThan(0)
    }

    const authorityFixture = await reviewFixture()
    await expectError(
      verify(
        authorityFixture.review,
        authorityFixture.authority,
        transport({
          authority: {
            projectRef: authorityFixture.authority.projectRef,
            organizationId: 'foreign-account',
            grantGeneration: authorityFixture.authority.grantGeneration
          }
        })
      ),
      'supabase-backfill-database-cas-ledger-verification-project-authority-mismatch'
    )

    const changedFixture = await reviewFixture()
    let reads = 0
    await expectError(
      verifySupabaseBackfillDatabaseCASLedgerV1({
        review: changedFixture.review,
        readCurrentAuthority() {
          reads += 1
          return reads < 2
            ? changedFixture.authority
            : { ...changedFixture.authority, grantGeneration: 'rotated-grant' }
        },
        transport: transport()
      }),
      'supabase-backfill-database-cas-ledger-verification-input-changed'
    )
  })
})
