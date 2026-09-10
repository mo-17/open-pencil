/* oxlint-disable eslint/max-lines -- One focused authority matrix keeps opaque capabilities, durable settlement, and verifier epochs auditable together. */

import { describe, expect, test } from 'bun:test'

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
  SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
  SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL
} from '@/app/lowcode/supabase/credentials'
import {
  createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1,
  issueSupabaseManagementDatabaseWriteCredentialLeaseV1,
  type SupabaseManagementDatabaseWriteCredentialLeaseV1
} from '@/app/lowcode/supabase/management-database-write-credential-lease'
import {
  createIdbBackendHostReleaseDispatchJournal,
  createMemoryBackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchJournal
} from '@/app/plugins/host/deployment/backend/release-journal'
import {
  deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1,
  type SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install'
import {
  createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1,
  SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityError,
  trustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1,
  trustedSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
  trustedSupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1,
  type SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1,
  type SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityBundleV1,
  type SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityErrorCode,
  type SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1,
  type SupabaseBackfillDatabaseCASLedgerInstallTransportPermitV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install-durable-authority'
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX,
  rotateSupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1,
  verifySupabaseBackfillDatabaseCASLedgerV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationRequestV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verifier'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import { createCredentialServices } from '@/app/settings/credentials/services'

import {
  BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT,
  BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
  createBackfillDatabaseCASLedgerInstallFixtureV1,
  type BackfillDatabaseCASLedgerInstallFixtureV1
} from './helpers'

const WRITE_CREDENTIAL_INCARNATION = '623e4567-e89b-42d3-a456-426614174000'
const CLAIMED_AT = '2026-09-07T10:00:00.000Z'
const PROGRESS_RECORDED_AT = '2026-09-07T10:01:00.000Z'
const OUTCOME_UNKNOWN_AT = '2026-09-07T10:02:00.000Z'
const FINAL_RECORDED_AT = '2026-09-07T10:03:00.000Z'
const AFTER_CLAIM_RECORDED_AT = '2026-09-07T10:00:30.000Z'
const BEFORE_CLAIM_RECORDED_AT = '2026-09-07T09:59:59.000Z'
const EARLY_FINAL_RECORDED_AT = '2026-09-07T10:01:30.000Z'
const INSTALLED_OBSERVED_AT = '2026-09-07T10:02:30.000Z'
const INSTALLED_SNAPSHOT_MARKER = '902:903:'
const WRONG_INSTALL_MARKER =
  `${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX}${'B'.repeat(43)}` as const

type MutableRecord = Record<string, unknown>
type MutableTransportBinding = {
  -readonly [Key in keyof SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1]: SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1[Key]
}

interface CredentialHarness {
  readonly issuer: ReturnType<
    typeof createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1
  >
}

interface AuthorityHarness {
  readonly fixture: BackfillDatabaseCASLedgerInstallFixtureV1
  readonly journal: BackendHostReleaseDispatchJournal
  readonly durable: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityBundleV1
  readonly credentials: CredentialHarness
  readonly credentialLease: SupabaseManagementDatabaseWriteCredentialLeaseV1
}

async function credentialHarness(): Promise<CredentialHarness> {
  const services = createCredentialServices(new MemoryCredentialStore())
  await services.manager.set(
    SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
    BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT
  )
  await services.manager.set(
    SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
    WRITE_CREDENTIAL_INCARNATION
  )
  await services.manager.set(
    SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
    BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT
  )
  return Object.freeze({
    issuer: createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1(services)
  })
}

async function issueCredentialLease(
  context: SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1,
  credentials: CredentialHarness
): Promise<SupabaseManagementDatabaseWriteCredentialLeaseV1> {
  const binding = deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(context)
  if (!binding) throw new TypeError('Expected a genuine CAS-ledger install credential binding.')
  return issueSupabaseManagementDatabaseWriteCredentialLeaseV1({
    issuer: credentials.issuer,
    binding
  })
}

async function authorityHarness(
  journal = createMemoryBackendHostReleaseDispatchJournal()
): Promise<AuthorityHarness> {
  const fixture = await createBackfillDatabaseCASLedgerInstallFixtureV1()
  const durable = createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1({
    journal
  })
  const credentials = await credentialHarness()
  const credentialLease = await issueCredentialLease(fixture.context, credentials)
  return Object.freeze({ fixture, journal, durable, credentials, credentialLease })
}

async function claim(
  harness: AuthorityHarness,
  releaseId = 'cas-ledger-durable-authority-test'
): Promise<SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1> {
  const result = await harness.durable.authority.claim({
    context: harness.fixture.context,
    releaseId,
    ownerId: 'durable-authority-test-host',
    claimedAt: CLAIMED_AT
  })
  if (result.status !== 'claimed' || !result.attempt) {
    throw new TypeError(`Expected a claimed durable attempt, received ${result.status}.`)
  }
  return result.attempt
}

async function precommit(
  harness: AuthorityHarness,
  attempt: SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1,
  credentialLease = harness.credentialLease
): Promise<SupabaseBackfillDatabaseCASLedgerInstallTransportPermitV1> {
  const result = await harness.durable.authority.precommit({
    attempt,
    credentialIssuer: harness.credentials.issuer,
    credentialLease,
    progressRecordedAt: PROGRESS_RECORDED_AT,
    outcomeUnknownAt: OUTCOME_UNKNOWN_AT
  })
  return result.permit
}

function transportBinding(
  fixture: BackfillDatabaseCASLedgerInstallFixtureV1,
  credentialLease: SupabaseManagementDatabaseWriteCredentialLeaseV1
): SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1 {
  return Object.freeze({
    providerId: 'supabase' as const,
    projectRef: fixture.context.projectRef,
    accountId: fixture.context.accountId,
    readGrantGeneration: fixture.readAuthority.grantGeneration,
    writeGrantGeneration: fixture.writeAuthority.grantGeneration,
    migrationName: fixture.context.migrationName,
    installReviewDigest: fixture.context.installReviewDigest,
    sourceReviewDigest: fixture.context.sourceReviewDigest,
    verificationDigest: fixture.context.verificationDigest,
    ledgerShapeDigest: fixture.context.ledgerShapeDigest,
    baseSqlDigest: fixture.context.sqlDigest,
    marker: fixture.context.marker,
    markerBindingDigest: fixture.context.markerBindingDigest,
    installSqlDigest: fixture.context.installSqlDigest,
    verificationQueryDigest: fixture.context.verificationQueryDigest,
    credentialLeaseBindingDigest: credentialLease.bindingDigest,
    writeCredentialIncarnation: credentialLease.writeCredentialIncarnation,
    operationLeaseGeneration: credentialLease.operationLeaseGeneration
  })
}

function expectedPlanDigest(fixture: BackfillDatabaseCASLedgerInstallFixtureV1): Promise<string> {
  return digestCanonicalManifest({
    format: 'openpencil.supabase-backfill-database-cas-ledger-install-plan.v1',
    version: 1,
    providerId: 'supabase',
    environment: 'staging',
    projectRef: fixture.context.projectRef,
    accountId: fixture.context.accountId,
    readGrantGeneration: fixture.readAuthority.grantGeneration,
    writeGrantGeneration: fixture.writeAuthority.grantGeneration,
    migrationName: fixture.context.migrationName,
    installReviewDigest: fixture.context.installReviewDigest,
    sourceReviewDigest: fixture.context.sourceReviewDigest,
    verificationDigest: fixture.context.verificationDigest,
    ledgerShapeDigest: fixture.context.ledgerShapeDigest,
    baseSqlDigest: fixture.context.sqlDigest,
    marker: fixture.context.marker,
    markerBindingDigest: fixture.context.markerBindingDigest,
    installSqlDigest: fixture.context.installSqlDigest,
    verificationQueryDigest: fixture.context.verificationQueryDigest
  })
}

async function expectedSingleFlightKey(
  fixture: BackfillDatabaseCASLedgerInstallFixtureV1
): Promise<string> {
  return [
    'backend-release-v3',
    'supabase',
    fixture.context.projectRef,
    fixture.context.accountId,
    'backfill-database-cas-ledger-install',
    await expectedPlanDigest(fixture)
  ]
    .map((part) => encodeURIComponent(part))
    .join(':')
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

function installedResponse(
  request: SupabaseBackfillDatabaseCASLedgerVerificationRequestV1,
  marker: string
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
    snapshotMarker: INSTALLED_SNAPSHOT_MARKER,
    observedAt: INSTALLED_OBSERVED_AT,
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

function installedTransport(
  marker: string
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
      return installedResponse(request, marker)
    }
  }
}

function verifyInstalled(
  fixture: BackfillDatabaseCASLedgerInstallFixtureV1,
  marker = fixture.context.marker
): Promise<SupabaseBackfillDatabaseCASLedgerVerificationV1> {
  return verifySupabaseBackfillDatabaseCASLedgerV1({
    review: fixture.sourceReview,
    readCurrentAuthority: () => fixture.readAuthority,
    transport: installedTransport(marker)
  })
}

async function durableError(
  operation: Promise<unknown>,
  code: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityErrorCode
): Promise<SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityError> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityError)
    const error = cause as SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityError
    expect(error.code).toBe(code)
    return error
  }
  throw new TypeError(`Expected durable CAS-ledger authority error ${code}.`)
}

async function consumedPermitHarness(releaseId: string): Promise<
  AuthorityHarness & {
    readonly attempt: SupabaseBackfillDatabaseCASLedgerInstallDurableAttemptV1
    readonly permit: SupabaseBackfillDatabaseCASLedgerInstallTransportPermitV1
    readonly binding: SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1
  }
> {
  const harness = await authorityHarness()
  const attempt = await claim(harness, releaseId)
  const permit = await precommit(harness, attempt)
  const binding = transportBinding(harness.fixture, harness.credentialLease)
  expect(await harness.durable.permitConsumer.consume(permit, binding)).toBe(true)
  return Object.freeze({ ...harness, attempt, permit, binding })
}

describe('Supabase backfill database CAS ledger install durable authority', () => {
  test('accepts only an exact Host journal and unread accessor-free factory options', () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    expect(
      createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1({ journal })
        .authority.provenance
    ).toBe('testing')
    expect(() =>
      createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1({
        journal: { ...journal }
      } as never)
    ).toThrow(SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityError)

    let getterCalls = 0
    const accessor = Object.defineProperty({}, 'journal', {
      enumerable: true,
      get() {
        getterCalls += 1
        return journal
      }
    })
    expect(() =>
      createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1(accessor as never)
    ).toThrow(SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityError)
    expect(getterCalls).toBe(0)

    const { proxy, revoke } = Proxy.revocable({ journal }, {})
    revoke()
    expect(() =>
      createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1(proxy)
    ).toThrow(SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityError)
  })

  test('claims and precommits one genuine operation with secret-free durable evidence', async () => {
    const harness = await authorityHarness()
    const planDigest = await expectedPlanDigest(harness.fixture)
    const claimed = await harness.durable.authority.claim({
      context: harness.fixture.context,
      releaseId: 'genuine-claim',
      ownerId: 'durable-authority-test-host',
      claimedAt: CLAIMED_AT
    })
    expect(claimed).toMatchObject({
      status: 'claimed',
      planDigest,
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false,
      code: null
    })
    expect(claimed.singleFlightKey).toBe(await expectedSingleFlightKey(harness.fixture))
    expect(claimed.dispatchScopeKey).toBe(
      `backend-release-dispatch-scope-v1:supabase:${harness.fixture.context.projectRef}`
    )
    expect(claimed.attempt).not.toBeNull()
    expect(Object.keys(claimed.attempt ?? {})).toEqual([])
    expect(Object.isFrozen(claimed.attempt)).toBe(true)
    if (!claimed.attempt) throw new TypeError('Expected an opaque durable attempt.')

    const result = await harness.durable.authority.precommit({
      attempt: claimed.attempt,
      credentialIssuer: harness.credentials.issuer,
      credentialLease: harness.credentialLease,
      progressRecordedAt: PROGRESS_RECORDED_AT,
      outcomeUnknownAt: OUTCOME_UNKNOWN_AT
    })
    expect(result).toMatchObject({
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expect(Object.keys(result.permit)).toEqual([])
    expect(Object.isFrozen(result.permit)).toBe(true)

    const [durableClaim, evidence] = await Promise.all([
      harness.journal.read(claimed.singleFlightKey),
      harness.journal.readEvidence(claimed.singleFlightKey)
    ])
    expect(durableClaim).toMatchObject({
      outcome: 'outcome-unknown',
      code: 'supabase-backfill-database-cas-ledger-install-outcome-unknown',
      settledAt: OUTCOME_UNKNOWN_AT
    })
    expect(evidence).toMatchObject({
      phase: 'progress',
      planDigest,
      recordedAt: PROGRESS_RECORDED_AT
    })
    if (!evidence) throw new TypeError('Expected durable progress evidence.')
    const payload: unknown = JSON.parse(evidence.payload)
    expect(payload).toMatchObject({
      format: 'openpencil.supabase-backfill-database-cas-ledger-install-progress.v1',
      stage: 'outcome-unknown-precommitted',
      projectRef: harness.fixture.context.projectRef,
      marker: harness.fixture.context.marker,
      installSqlDigest: harness.fixture.context.installSqlDigest,
      credentialLease: {
        bindingDigest: harness.credentialLease.bindingDigest,
        writeCredentialIncarnation: harness.credentialLease.writeCredentialIncarnation,
        operationLeaseGeneration: harness.credentialLease.operationLeaseGeneration
      },
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    expect(JSON.stringify({ durableClaim, evidence, result })).not.toContain(
      BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT
    )
    expect(evidence.payload).not.toMatch(/personalAccessToken|authorization|bearer/iu)
  })

  test('rejects cloned, forged, and accessor-backed authority inputs without invoking getters', async () => {
    const clonedContextHarness = await authorityHarness()
    await durableError(
      clonedContextHarness.durable.authority.claim({
        context: structuredClone(clonedContextHarness.fixture.context),
        releaseId: 'cloned-context',
        ownerId: 'durable-authority-test-host',
        claimedAt: CLAIMED_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-context-invalid'
    )

    const harness = await authorityHarness()
    const attempt = await claim(harness, 'opaque-attempts')
    await durableError(
      harness.durable.authority.precommit({
        attempt: structuredClone(attempt),
        credentialIssuer: harness.credentials.issuer,
        credentialLease: harness.credentialLease,
        progressRecordedAt: PROGRESS_RECORDED_AT,
        outcomeUnknownAt: OUTCOME_UNKNOWN_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-state-invalid'
    )
    await durableError(
      harness.durable.authority.precommit({
        attempt: Object.freeze(Object.create(null)),
        credentialIssuer: harness.credentials.issuer,
        credentialLease: harness.credentialLease,
        progressRecordedAt: PROGRESS_RECORDED_AT,
        outcomeUnknownAt: OUTCOME_UNKNOWN_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-state-invalid'
    )

    let contextGetterCalls = 0
    const accessor = {
      releaseId: 'accessor-options',
      ownerId: 'durable-authority-test-host',
      claimedAt: CLAIMED_AT
    }
    Object.defineProperty(accessor, 'context', {
      enumerable: true,
      get() {
        contextGetterCalls += 1
        return harness.fixture.context
      }
    })
    await durableError(
      harness.durable.authority.claim(
        accessor as Parameters<typeof harness.durable.authority.claim>[0]
      ),
      'supabase-backfill-database-cas-ledger-durable-input-invalid'
    )
    expect(contextGetterCalls).toBe(0)

    const permit = await precommit(harness, attempt)
    expect(
      await harness.durable.permitConsumer.consume(
        structuredClone(permit),
        transportBinding(harness.fixture, harness.credentialLease)
      )
    ).toBe(false)
    expect(
      await harness.durable.permitConsumer.consume(
        Object.freeze(Object.create(null)),
        transportBinding(harness.fixture, harness.credentialLease)
      )
    ).toBe(false)
    expect(
      await harness.durable.permitConsumer.consume(
        permit,
        transportBinding(harness.fixture, harness.credentialLease)
      )
    ).toBe(true)
  })

  test('rejects a cloned credential lease before recording progress evidence', async () => {
    const harness = await authorityHarness()
    const attempt = await claim(harness, 'cloned-credential-lease')
    await durableError(
      harness.durable.authority.precommit({
        attempt,
        credentialIssuer: harness.credentials.issuer,
        credentialLease: structuredClone(harness.credentialLease),
        progressRecordedAt: PROGRESS_RECORDED_AT,
        outcomeUnknownAt: OUTCOME_UNKNOWN_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-input-invalid'
    )
    const key = await expectedSingleFlightKey(harness.fixture)
    expect(await harness.journal.read(key)).toMatchObject({ outcome: 'pending', code: null })
    expect(await harness.journal.readEvidence(key)).toBeNull()
    expect(
      await harness.durable.authority.precommit({
        attempt,
        credentialIssuer: harness.credentials.issuer,
        credentialLease: harness.credentialLease,
        progressRecordedAt: PROGRESS_RECORDED_AT,
        outcomeUnknownAt: OUTCOME_UNKNOWN_AT
      })
    ).toMatchObject({
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
  })

  test('allows only one concurrent claim, precommit, and permit consumption winner', async () => {
    const harness = await authorityHarness()
    const claimOptions = (releaseId: string) => ({
      context: harness.fixture.context,
      releaseId,
      ownerId: `${releaseId}-owner`,
      claimedAt: CLAIMED_AT
    })
    const claimResults = await Promise.all([
      harness.durable.authority.claim(claimOptions('concurrent-claim-a')),
      harness.durable.authority.claim(claimOptions('concurrent-claim-b'))
    ])
    expect(claimResults.map(({ status }) => status).sort()).toEqual([
      'claimed',
      'reconciliation-required'
    ])
    const winner = claimResults.find(
      (result) => result.status === 'claimed' && result.attempt !== null
    )
    if (!winner?.attempt) throw new TypeError('Expected one concurrent claim winner.')

    const precommitOptions = {
      attempt: winner.attempt,
      credentialIssuer: harness.credentials.issuer,
      credentialLease: harness.credentialLease,
      progressRecordedAt: PROGRESS_RECORDED_AT,
      outcomeUnknownAt: OUTCOME_UNKNOWN_AT
    }
    const precommitResults = await Promise.allSettled([
      harness.durable.authority.precommit(precommitOptions),
      harness.durable.authority.precommit(precommitOptions)
    ])
    expect(precommitResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(precommitResults.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    const fulfilled = precommitResults.find(
      (
        result
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof harness.durable.authority.precommit>>
      > => result.status === 'fulfilled'
    )
    const rejected = precommitResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (!fulfilled || !rejected) throw new TypeError('Expected one precommit winner and loser.')
    expect(rejected.reason).toBeInstanceOf(
      SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityError
    )
    expect(
      (rejected.reason as SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityError).code
    ).toBe('supabase-backfill-database-cas-ledger-durable-state-invalid')

    const binding = transportBinding(harness.fixture, harness.credentialLease)
    expect(
      (
        await Promise.all([
          harness.durable.permitConsumer.consume(fulfilled.value.permit, binding),
          harness.durable.permitConsumer.consume(fulfilled.value.permit, binding)
        ])
      ).sort()
    ).toEqual([false, true])
  })

  test('binds every transport field and burns an A permit cross-wired into B', async () => {
    const harnessA = await authorityHarness()
    const fixtureB = await createBackfillDatabaseCASLedgerInstallFixtureV1()
    const leaseB = await issueCredentialLease(fixtureB.context, harnessA.credentials)
    const attemptA = await claim(harnessA, 'full-binding-cross-wire-a')
    const permitA = await precommit(harnessA, attemptA)
    const bindingA = transportBinding(harnessA.fixture, harnessA.credentialLease)
    const bindingB = transportBinding(fixtureB, leaseB)

    expect(Object.keys(bindingA)).toEqual([
      'providerId',
      'projectRef',
      'accountId',
      'readGrantGeneration',
      'writeGrantGeneration',
      'migrationName',
      'installReviewDigest',
      'sourceReviewDigest',
      'verificationDigest',
      'ledgerShapeDigest',
      'baseSqlDigest',
      'marker',
      'markerBindingDigest',
      'installSqlDigest',
      'verificationQueryDigest',
      'credentialLeaseBindingDigest',
      'writeCredentialIncarnation',
      'operationLeaseGeneration'
    ])
    expect(bindingA.installSqlDigest).not.toBe(bindingB.installSqlDigest)
    expect(bindingA.marker).not.toBe(bindingB.marker)
    expect(await harnessA.durable.permitConsumer.consume(permitA, bindingB)).toBe(false)
    expect(await harnessA.durable.permitConsumer.consume(permitA, bindingA)).toBe(false)
  })

  test('keeps the permit consumer identity-strict and rejects accessor bindings unread', async () => {
    const cloneHarness = await authorityHarness()
    const cloneAttempt = await claim(cloneHarness, 'strict-consumer-clone')
    const clonePermit = await precommit(cloneHarness, cloneAttempt)
    const cloneBinding = transportBinding(cloneHarness.fixture, cloneHarness.credentialLease)
    const clonedConsumer = { ...cloneHarness.durable.permitConsumer }

    expect(
      trustedSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1(
        cloneHarness.durable.authority
      )
    ).toBe(true)
    expect(
      trustedSupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1(
        cloneHarness.durable.permitConsumer
      )
    ).toBe(true)
    expect(trustedSupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1(clonedConsumer)).toBe(
      false
    )
    expect(await clonedConsumer.consume(clonePermit, cloneBinding)).toBe(false)
    expect(await cloneHarness.durable.permitConsumer.consume(clonePermit, cloneBinding)).toBe(true)

    const accessorHarness = await authorityHarness()
    const accessorAttempt = await claim(accessorHarness, 'strict-consumer-accessor')
    const accessorPermit = await precommit(accessorHarness, accessorAttempt)
    const expected = transportBinding(accessorHarness.fixture, accessorHarness.credentialLease)
    const accessorBinding: MutableTransportBinding = { ...expected }
    let markerGetterCalls = 0
    Object.defineProperty(accessorBinding, 'marker', {
      enumerable: true,
      configurable: true,
      get() {
        markerGetterCalls += 1
        return expected.marker
      }
    })
    expect(
      await accessorHarness.durable.permitConsumer.consume(accessorPermit, accessorBinding)
    ).toBe(false)
    expect(markerGetterCalls).toBe(0)
  })

  test('settles known-not-dispatched only after transport consumption and before POST marking', async () => {
    const current = await consumedPermitHarness('known-not-dispatched-before-post')
    const proof = current.durable.permitConsumer.attestKnownNotDispatched(current.permit)
    expect(proof).not.toBeNull()
    expect(Object.keys(proof ?? {})).toEqual([])
    expect(Object.isFrozen(proof)).toBe(true)
    expect(current.durable.permitConsumer.attestKnownNotDispatched(current.permit)).toBeNull()
    expect(current.durable.permitConsumer.markPOSTStarted(current.permit)).toBe(false)
    if (!proof) throw new TypeError('Expected an opaque known-not-dispatched proof.')

    const settled = await current.durable.authority.settleKnownNotDispatched({
      attempt: current.attempt,
      proof,
      recordedAt: FINAL_RECORDED_AT
    })
    expect(settled).toMatchObject({
      status: 'not-dispatched',
      code: 'supabase-backfill-database-cas-ledger-install-not-dispatched',
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    const [claimRecord, evidence] = await Promise.all([
      current.journal.read(settled.singleFlightKey),
      current.journal.readEvidence(settled.singleFlightKey)
    ])
    expect(claimRecord).toMatchObject({
      outcome: 'failed',
      code: settled.code,
      settledAt: FINAL_RECORDED_AT
    })
    expect(evidence).toMatchObject({ phase: 'final', recordedAt: FINAL_RECORDED_AT })
    expect(JSON.parse(evidence?.payload ?? '{}')).toMatchObject({
      credentialLease: {
        bindingDigest: current.credentialLease.bindingDigest,
        writeCredentialIncarnation: current.credentialLease.writeCredentialIncarnation,
        operationLeaseGeneration: current.credentialLease.operationLeaseGeneration
      }
    })
    expect(JSON.stringify({ claimRecord, evidence })).not.toContain(
      BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT
    )
  })

  test('validates settleBeforePrecommit time and persists an exact failed final record', async () => {
    const harness = await authorityHarness()
    const attempt = await claim(harness, 'settlement-before-precommit')
    await durableError(
      harness.durable.authority.settleBeforePrecommit({
        attempt,
        recordedAt: BEFORE_CLAIM_RECORDED_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-input-invalid'
    )
    const settled = await harness.durable.authority.settleBeforePrecommit({
      attempt,
      recordedAt: AFTER_CLAIM_RECORDED_AT
    })
    expect(settled).toMatchObject({
      status: 'not-dispatched',
      code: 'supabase-backfill-database-cas-ledger-install-not-dispatched',
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    const [claimRecord, evidence] = await Promise.all([
      harness.journal.read(settled.singleFlightKey),
      harness.journal.readEvidence(settled.singleFlightKey)
    ])
    expect(claimRecord).toMatchObject({
      outcome: 'failed',
      code: settled.code,
      settledAt: AFTER_CLAIM_RECORDED_AT
    })
    expect(evidence).toMatchObject({
      phase: 'final',
      recordedAt: AFTER_CLAIM_RECORDED_AT
    })
  })

  test('makes settleBeforePrecommit and genuine precommit a single-winner race', async () => {
    for (const first of ['settle', 'precommit'] as const) {
      const harness = await authorityHarness()
      const attempt = await claim(harness, `settle-precommit-race-${first}`)
      const settleOperation = () =>
        harness.durable.authority.settleBeforePrecommit({
          attempt,
          recordedAt: AFTER_CLAIM_RECORDED_AT
        })
      const precommitOperation = () =>
        harness.durable.authority.precommit({
          attempt,
          credentialIssuer: harness.credentials.issuer,
          credentialLease: harness.credentialLease,
          progressRecordedAt: PROGRESS_RECORDED_AT,
          outcomeUnknownAt: OUTCOME_UNKNOWN_AT
        })
      const operations =
        first === 'settle'
          ? [settleOperation(), precommitOperation()]
          : [precommitOperation(), settleOperation()]
      const results = await Promise.allSettled(operations)
      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
      const winner = results.find(
        (result): result is PromiseFulfilledResult<unknown> => result.status === 'fulfilled'
      )
      if (!winner || winner.value === null || typeof winner.value !== 'object') {
        throw new TypeError('Expected one precommit or settleBeforePrecommit winner.')
      }
      const precommitWon = Object.hasOwn(winner.value, 'permit')
      const record = await harness.journal.read(await expectedSingleFlightKey(harness.fixture))
      expect(record?.outcome).toBe(precommitWon ? 'outcome-unknown' : 'failed')
      expect(record?.code).toBe(
        precommitWon
          ? 'supabase-backfill-database-cas-ledger-install-outcome-unknown'
          : 'supabase-backfill-database-cas-ledger-install-not-dispatched'
      )
    }
  })

  test('rejects cloned or forged known-not-dispatched proofs and makes concurrent settlement one-winner', async () => {
    for (const proofKind of ['clone', 'forge'] as const) {
      const invalid = await consumedPermitHarness(`invalid-known-proof-${proofKind}`)
      const proof = invalid.durable.permitConsumer.attestKnownNotDispatched(invalid.permit)
      if (!proof) throw new TypeError('Expected an opaque known-not-dispatched proof.')
      const supplied =
        proofKind === 'clone' ? structuredClone(proof) : Object.freeze(Object.create(null))
      await durableError(
        invalid.durable.authority.settleKnownNotDispatched({
          attempt: invalid.attempt,
          proof: supplied,
          recordedAt: FINAL_RECORDED_AT
        }),
        'supabase-backfill-database-cas-ledger-durable-state-invalid'
      )
      expect(
        await invalid.durable.authority.settleKnownNotDispatched({
          attempt: invalid.attempt,
          proof,
          recordedAt: FINAL_RECORDED_AT
        })
      ).toMatchObject({ status: 'not-dispatched' })
    }

    const crossA = await consumedPermitHarness('cross-attempt-known-proof-a')
    const crossB = await consumedPermitHarness('cross-attempt-known-proof-b')
    const proofA = crossA.durable.permitConsumer.attestKnownNotDispatched(crossA.permit)
    const proofB = crossB.durable.permitConsumer.attestKnownNotDispatched(crossB.permit)
    if (!proofA || !proofB) {
      throw new TypeError('Expected two opaque known-not-dispatched proofs.')
    }
    await durableError(
      crossA.durable.authority.settleKnownNotDispatched({
        attempt: crossA.attempt,
        proof: proofB,
        recordedAt: FINAL_RECORDED_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-state-invalid'
    )
    expect(
      await crossA.durable.authority.settleKnownNotDispatched({
        attempt: crossA.attempt,
        proof: proofA,
        recordedAt: FINAL_RECORDED_AT
      })
    ).toMatchObject({ status: 'not-dispatched' })
    expect(
      await crossB.durable.authority.settleKnownNotDispatched({
        attempt: crossB.attempt,
        proof: proofB,
        recordedAt: FINAL_RECORDED_AT
      })
    ).toMatchObject({ status: 'not-dispatched' })

    const current = await consumedPermitHarness('concurrent-known-settlement')
    const proof = current.durable.permitConsumer.attestKnownNotDispatched(current.permit)
    if (!proof) throw new TypeError('Expected an opaque known-not-dispatched proof.')
    const settlements = await Promise.allSettled([
      current.durable.authority.settleKnownNotDispatched({
        attempt: current.attempt,
        proof,
        recordedAt: FINAL_RECORDED_AT
      }),
      current.durable.authority.settleKnownNotDispatched({
        attempt: current.attempt,
        proof,
        recordedAt: FINAL_RECORDED_AT
      })
    ])
    expect(settlements.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(settlements.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    const settled = settlements.find(
      (result): result is PromiseFulfilledResult<unknown> => result.status === 'fulfilled'
    )
    expect(settled?.value).toMatchObject({ status: 'not-dispatched' })
    await durableError(
      current.durable.authority.settleKnownNotDispatched({
        attempt: current.attempt,
        proof,
        recordedAt: FINAL_RECORDED_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-state-invalid'
    )
  })

  test('rejects a final timestamp before precommit without overwriting progress evidence', async () => {
    const current = await consumedPermitHarness('early-known-settlement')
    const proof = current.durable.permitConsumer.attestKnownNotDispatched(current.permit)
    if (!proof) throw new TypeError('Expected an opaque known-not-dispatched proof.')
    await durableError(
      current.durable.authority.settleKnownNotDispatched({
        attempt: current.attempt,
        proof,
        recordedAt: EARLY_FINAL_RECORDED_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-input-invalid'
    )
    const evidence = await current.journal.readEvidence(
      await expectedSingleFlightKey(current.fixture)
    )
    expect(evidence).toMatchObject({
      phase: 'progress',
      recordedAt: PROGRESS_RECORDED_AT
    })
    expect(
      await current.durable.authority.settleKnownNotDispatched({
        attempt: current.attempt,
        proof,
        recordedAt: FINAL_RECORDED_AT
      })
    ).toMatchObject({ status: 'not-dispatched' })
  })

  test('forbids a known-not-dispatched attestation and settlement after POST marking', async () => {
    const current = await consumedPermitHarness('known-not-dispatched-after-post')
    expect(current.durable.permitConsumer.markPOSTStarted(current.permit)).toBe(true)
    expect(current.durable.permitConsumer.markPOSTStarted(current.permit)).toBe(false)
    expect(current.durable.permitConsumer.attestKnownNotDispatched(current.permit)).toBeNull()
    await durableError(
      current.durable.authority.settleKnownNotDispatched({
        attempt: current.attempt,
        proof: Object.freeze(Object.create(null)),
        recordedAt: FINAL_RECORDED_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-state-invalid'
    )
    expect(
      await current.journal.read(await expectedSingleFlightKey(current.fixture))
    ).toMatchObject({
      outcome: 'outcome-unknown',
      code: 'supabase-backfill-database-cas-ledger-install-outcome-unknown'
    })
  })

  test('rejects mismatched installed proofs without poisoning attempts or cross-burning proofs', async () => {
    const old = await authorityHarness()
    const oldAttempt = await claim(old, 'old-installed-proof')
    const oldPermit = await precommit(old, oldAttempt)
    const proofBeforePOST = await verifyInstalled(old.fixture)
    expect(
      await old.durable.permitConsumer.consume(
        oldPermit,
        transportBinding(old.fixture, old.credentialLease)
      )
    ).toBe(true)
    expect(old.durable.permitConsumer.markPOSTStarted(oldPermit)).toBe(true)
    await durableError(
      old.durable.authority.reconcileInstalled({
        attempt: oldAttempt,
        installedVerification: proofBeforePOST,
        recordedAt: FINAL_RECORDED_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-proof-invalid'
    )
    const freshAfterOld = await verifyInstalled(old.fixture)
    expect(
      await old.durable.authority.reconcileInstalled({
        attempt: oldAttempt,
        installedVerification: freshAfterOld,
        recordedAt: FINAL_RECORDED_AT
      })
    ).toMatchObject({ status: 'applied', databaseLedgerBound: true })

    const wrongMarker = await consumedPermitHarness('wrong-marker-proof')
    expect(wrongMarker.durable.permitConsumer.markPOSTStarted(wrongMarker.permit)).toBe(true)
    const wrongMarkerProof = await verifyInstalled(wrongMarker.fixture, WRONG_INSTALL_MARKER)
    await durableError(
      wrongMarker.durable.authority.reconcileInstalled({
        attempt: wrongMarker.attempt,
        installedVerification: wrongMarkerProof,
        recordedAt: FINAL_RECORDED_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-proof-invalid'
    )
    const freshAfterWrongMarker = await verifyInstalled(wrongMarker.fixture)
    expect(
      await wrongMarker.durable.authority.reconcileInstalled({
        attempt: wrongMarker.attempt,
        installedVerification: freshAfterWrongMarker,
        recordedAt: FINAL_RECORDED_AT
      })
    ).toMatchObject({ status: 'applied', databaseLedgerBound: true })

    for (const proofKind of ['clone', 'forge'] as const) {
      const invalid = await consumedPermitHarness(`invalid-installed-proof-${proofKind}`)
      expect(invalid.durable.permitConsumer.markPOSTStarted(invalid.permit)).toBe(true)
      const genuine = await verifyInstalled(invalid.fixture)
      const supplied =
        proofKind === 'clone' ? structuredClone(genuine) : Object.freeze(Object.create(null))
      await durableError(
        invalid.durable.authority.reconcileInstalled({
          attempt: invalid.attempt,
          installedVerification: supplied,
          recordedAt: FINAL_RECORDED_AT
        }),
        'supabase-backfill-database-cas-ledger-durable-proof-invalid'
      )
      expect(
        await invalid.durable.authority.reconcileInstalled({
          attempt: invalid.attempt,
          installedVerification: genuine,
          recordedAt: FINAL_RECORDED_AT
        })
      ).toMatchObject({ status: 'applied', databaseLedgerBound: true })
    }

    const crossA = await consumedPermitHarness('cross-attempt-installed-proof-a')
    const crossB = await consumedPermitHarness('cross-attempt-installed-proof-b')
    expect(crossA.durable.permitConsumer.markPOSTStarted(crossA.permit)).toBe(true)
    expect(crossB.durable.permitConsumer.markPOSTStarted(crossB.permit)).toBe(true)
    const [proofA, proofB] = await Promise.all([
      verifyInstalled(crossA.fixture),
      verifyInstalled(crossB.fixture)
    ])
    await durableError(
      crossA.durable.authority.reconcileInstalled({
        attempt: crossA.attempt,
        installedVerification: proofB,
        recordedAt: FINAL_RECORDED_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-proof-invalid'
    )
    expect(
      await crossA.durable.authority.reconcileInstalled({
        attempt: crossA.attempt,
        installedVerification: proofA,
        recordedAt: FINAL_RECORDED_AT
      })
    ).toMatchObject({ status: 'applied', databaseLedgerBound: true })
    expect(
      await crossB.durable.authority.reconcileInstalled({
        attempt: crossB.attempt,
        installedVerification: proofB,
        recordedAt: FINAL_RECORDED_AT
      })
    ).toMatchObject({ status: 'applied', databaseLedgerBound: true })

    const wrongEpoch = await consumedPermitHarness('wrong-epoch-proof')
    expect(wrongEpoch.durable.permitConsumer.markPOSTStarted(wrongEpoch.permit)).toBe(true)
    rotateSupabaseBackfillDatabaseCASLedgerInstalledVerificationEpochV1(
      wrongEpoch.fixture.sourceReview
    )
    const wrongEpochProof = await verifyInstalled(wrongEpoch.fixture)
    await durableError(
      wrongEpoch.durable.authority.reconcileInstalled({
        attempt: wrongEpoch.attempt,
        installedVerification: wrongEpochProof,
        recordedAt: FINAL_RECORDED_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-proof-invalid'
    )
    expect(
      await wrongEpoch.journal.readEvidence(await expectedSingleFlightKey(wrongEpoch.fixture))
    ).toMatchObject({ phase: 'progress', recordedAt: PROGRESS_RECORDED_AT })
  })

  test('settles applied only from a fresh exact proof and durable readback', async () => {
    const current = await consumedPermitHarness('fresh-installed-proof')
    const planDigest = await expectedPlanDigest(current.fixture)
    expect(current.durable.permitConsumer.markPOSTStarted(current.permit)).toBe(true)
    const installed = await verifyInstalled(current.fixture)
    const applied = await current.durable.authority.reconcileInstalled({
      attempt: current.attempt,
      installedVerification: installed,
      recordedAt: FINAL_RECORDED_AT
    })
    expect(applied).toMatchObject({
      format: 'openpencil.supabase-backfill-database-cas-ledger-install-applied.v1',
      provenance: 'testing',
      status: 'applied',
      projectRef: current.fixture.context.projectRef,
      accountId: current.fixture.context.accountId,
      planDigest,
      installReviewDigest: current.fixture.context.installReviewDigest,
      sourceReviewDigest: current.fixture.context.sourceReviewDigest,
      installedVerificationDigest: installed.verificationDigest,
      credentialLeaseBindingDigest: current.credentialLease.bindingDigest,
      writeCredentialIncarnation: current.credentialLease.writeCredentialIncarnation,
      operationLeaseGeneration: current.credentialLease.operationLeaseGeneration,
      marker: current.fixture.context.marker,
      observedAt: INSTALLED_OBSERVED_AT,
      snapshotMarker: INSTALLED_SNAPSHOT_MARKER,
      serverVersionNum: '170000',
      automaticRetryAllowed: false,
      databaseLedgerBound: true,
      sourceLedgerBound: false,
      releaseReady: false
    })
    if (applied.status !== 'applied') throw new TypeError('Expected a durable applied result.')
    expect(trustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1(applied)).toMatchObject({
      result: applied,
      provenance: 'testing',
      dispatchContext: current.fixture.context,
      credentialLease: {
        bindingDigest: current.credentialLease.bindingDigest,
        writeCredentialIncarnation: current.credentialLease.writeCredentialIncarnation,
        operationLeaseGeneration: current.credentialLease.operationLeaseGeneration
      }
    })
    expect(
      trustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1(structuredClone(applied))
    ).toBeNull()

    const [claimRecord, evidence] = await Promise.all([
      current.journal.read(applied.singleFlightKey),
      current.journal.readEvidence(applied.singleFlightKey)
    ])
    expect(claimRecord).toMatchObject({
      outcome: 'applied',
      code: null,
      settledAt: FINAL_RECORDED_AT,
      remoteOperationIds: []
    })
    expect(evidence).toMatchObject({
      phase: 'final',
      planDigest,
      recordedAt: FINAL_RECORDED_AT
    })
    if (!evidence) throw new TypeError('Expected durable applied evidence.')
    expect(JSON.parse(evidence.payload)).toMatchObject({
      stage: 'installed-proof-observed',
      databaseLedgerBound: true,
      credentialLease: {
        bindingDigest: current.credentialLease.bindingDigest,
        writeCredentialIncarnation: current.credentialLease.writeCredentialIncarnation,
        operationLeaseGeneration: current.credentialLease.operationLeaseGeneration
      },
      installedVerificationDigest: installed.verificationDigest,
      installedSnapshotMarker: INSTALLED_SNAPSHOT_MARKER
    })
    expect(JSON.stringify({ claimRecord, evidence, applied })).not.toContain(
      BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT
    )

    await durableError(
      current.durable.authority.reconcileInstalled({
        attempt: current.attempt,
        installedVerification: installed,
        recordedAt: FINAL_RECORDED_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-state-invalid'
    )
  })

  test('makes concurrent reconciliation and installed-proof consumption one-winner', async () => {
    const current = await consumedPermitHarness('concurrent-installed-reconciliation')
    expect(current.durable.permitConsumer.markPOSTStarted(current.permit)).toBe(true)
    const installed = await verifyInstalled(current.fixture)
    const reconciliations = await Promise.allSettled([
      current.durable.authority.reconcileInstalled({
        attempt: current.attempt,
        installedVerification: installed,
        recordedAt: FINAL_RECORDED_AT
      }),
      current.durable.authority.reconcileInstalled({
        attempt: current.attempt,
        installedVerification: installed,
        recordedAt: FINAL_RECORDED_AT
      })
    ])
    expect(reconciliations.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(reconciliations.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    const applied = reconciliations.find(
      (result): result is PromiseFulfilledResult<unknown> => result.status === 'fulfilled'
    )
    expect(applied?.value).toMatchObject({ status: 'applied', databaseLedgerBound: true })
  })

  test('rejects an early reconciliation timestamp before consuming the installed proof', async () => {
    const current = await consumedPermitHarness('early-installed-reconciliation')
    expect(current.durable.permitConsumer.markPOSTStarted(current.permit)).toBe(true)
    const installed = await verifyInstalled(current.fixture)
    await durableError(
      current.durable.authority.reconcileInstalled({
        attempt: current.attempt,
        installedVerification: installed,
        recordedAt: EARLY_FINAL_RECORDED_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-input-invalid'
    )
    expect(
      await current.durable.authority.reconcileInstalled({
        attempt: current.attempt,
        installedVerification: installed,
        recordedAt: FINAL_RECORDED_AT
      })
    ).toMatchObject({ status: 'applied', databaseLedgerBound: true })
  })

  test('keeps failed final settlement active but accepts an exact committed readback', async () => {
    let beforeSettleCalls = 0
    const beforeSettleJournal = createMemoryBackendHostReleaseDispatchJournal({
      beforeSettle() {
        beforeSettleCalls += 1
        if (beforeSettleCalls === 2) throw new Error('transient final settlement failure')
      }
    })
    const beforeSettle = await authorityHarness(beforeSettleJournal)
    const beforeAttempt = await claim(beforeSettle, 'recover-before-settle')
    const beforePermit = await precommit(beforeSettle, beforeAttempt)
    expect(
      await beforeSettle.durable.permitConsumer.consume(
        beforePermit,
        transportBinding(beforeSettle.fixture, beforeSettle.credentialLease)
      )
    ).toBe(true)
    const beforeProof = beforeSettle.durable.permitConsumer.attestKnownNotDispatched(beforePermit)
    if (!beforeProof) throw new TypeError('Expected an opaque known-not-dispatched proof.')
    const unresolved = await beforeSettle.durable.authority.settleKnownNotDispatched({
      attempt: beforeAttempt,
      proof: beforeProof,
      recordedAt: FINAL_RECORDED_AT
    })
    expect(unresolved).toMatchObject({ status: 'reconciliation-required' })
    expect(beforeSettleCalls).toBe(2)
    expect(
      await beforeSettle.durable.authority.recoverSettlement({ attempt: beforeAttempt })
    ).toMatchObject({ status: 'reconciliation-required' })
    expect(beforeSettleCalls).toBe(2)
    expect(
      await beforeSettleJournal.read(await expectedSingleFlightKey(beforeSettle.fixture))
    ).toMatchObject({ outcome: 'outcome-unknown' })

    let afterSettleCalls = 0
    const afterSettleJournal = createMemoryBackendHostReleaseDispatchJournal({
      afterSettle() {
        afterSettleCalls += 1
        if (afterSettleCalls === 2) throw new Error('committed final settlement readback')
      }
    })
    const afterSettle = await authorityHarness(afterSettleJournal)
    const afterAttempt = await claim(afterSettle, 'recover-after-settle')
    const afterPermit = await precommit(afterSettle, afterAttempt)
    expect(
      await afterSettle.durable.permitConsumer.consume(
        afterPermit,
        transportBinding(afterSettle.fixture, afterSettle.credentialLease)
      )
    ).toBe(true)
    const afterProof = afterSettle.durable.permitConsumer.attestKnownNotDispatched(afterPermit)
    if (!afterProof) throw new TypeError('Expected an opaque known-not-dispatched proof.')
    expect(
      await afterSettle.durable.authority.settleKnownNotDispatched({
        attempt: afterAttempt,
        proof: afterProof,
        recordedAt: FINAL_RECORDED_AT
      })
    ).toMatchObject({ status: 'not-dispatched' })
    expect(afterSettleCalls).toBe(2)
    expect(
      await afterSettleJournal.read(await expectedSingleFlightKey(afterSettle.fixture))
    ).toMatchObject({ outcome: 'failed', settledAt: FINAL_RECORDED_AT })
  })

  test('does not recreate attempts or permits across restart and rejects cross-factory capabilities', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    const original = await authorityHarness(journal)
    const originalAttempt = await claim(original, 'restart-original')
    const originalPermit = await precommit(original, originalAttempt)
    const binding = transportBinding(original.fixture, original.credentialLease)

    const restarted = createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1({
      journal
    })
    const resumed = await restarted.authority.claim({
      context: original.fixture.context,
      releaseId: 'restart-new-release',
      ownerId: 'restart-new-owner',
      claimedAt: FINAL_RECORDED_AT
    })
    expect(resumed).toMatchObject({
      status: 'reconciliation-required',
      attempt: null,
      code: 'supabase-backfill-database-cas-ledger-install-existing-claim',
      automaticRetryAllowed: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false
    })
    await durableError(
      restarted.authority.precommit({
        attempt: originalAttempt,
        credentialIssuer: original.credentials.issuer,
        credentialLease: original.credentialLease,
        progressRecordedAt: PROGRESS_RECORDED_AT,
        outcomeUnknownAt: OUTCOME_UNKNOWN_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-state-invalid'
    )
    expect(await restarted.permitConsumer.consume(originalPermit, binding)).toBe(false)

    const unrelated = createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1({
      journal: createMemoryBackendHostReleaseDispatchJournal()
    })
    await durableError(
      unrelated.authority.precommit({
        attempt: originalAttempt,
        credentialIssuer: original.credentials.issuer,
        credentialLease: original.credentialLease,
        progressRecordedAt: PROGRESS_RECORDED_AT,
        outcomeUnknownAt: OUTCOME_UNKNOWN_AT
      }),
      'supabase-backfill-database-cas-ledger-durable-state-invalid'
    )
    expect(await unrelated.permitConsumer.consume(originalPermit, binding)).toBe(false)
  })

  test('reopens the same IndexedDB journal without reconstructing a lost mutation permit', async () => {
    const databaseName = `cas-ledger-durable-authority-${crypto.randomUUID()}`
    const firstJournal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const original = await authorityHarness(firstJournal)
    const attempt = await claim(original, 'idb-restart-original')
    const permit = await precommit(original, attempt)
    const binding = transportBinding(original.fixture, original.credentialLease)

    const reopenedJournal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const reopened = createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1({
      journal: reopenedJournal
    })
    const resumed = await reopened.authority.claim({
      context: original.fixture.context,
      releaseId: 'idb-restart-new-release',
      ownerId: 'idb-restart-new-owner',
      claimedAt: FINAL_RECORDED_AT
    })
    expect(resumed).toMatchObject({
      status: 'reconciliation-required',
      attempt: null,
      code: 'supabase-backfill-database-cas-ledger-install-existing-claim'
    })
    expect(await reopened.permitConsumer.consume(permit, binding)).toBe(false)
    expect(
      await reopenedJournal.read(await expectedSingleFlightKey(original.fixture))
    ).toMatchObject({
      outcome: 'outcome-unknown',
      code: 'supabase-backfill-database-cas-ledger-install-outcome-unknown'
    })
  })
})
