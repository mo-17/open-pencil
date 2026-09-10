import { createMemoryBackendHostReleaseDispatchJournal } from '@/app/plugins/host/deployment/backend/release-journal'
import {
  captureSupabaseBackfillLockedHighWaterV1,
  createSupabaseBackfillLockedHighWaterCaptureReviewV1,
  SUPABASE_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_FORMAT,
  SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_VERSION,
  type SupabaseBackfillLockedHighWaterCaptureConfirmationV1,
  type SupabaseBackfillLockedHighWaterCaptureReviewEnvelopeV1,
  type SupabaseBackfillLockedHighWaterCaptureV1,
  type SupabaseBackfillLockedHighWaterWriteAuthorityV1
} from '@/app/plugins/host/deployment/supabase/backfill/locked-high-water-capture'
import {
  dispatchSupabaseBackfillWriteBarrierInstallV1,
  reconcileSupabaseBackfillWriteBarrierInstallV1,
  type SupabaseBackfillWriteBarrierInstallReconciliationResultV1
} from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/install-controller'
import type { SupabaseBackfillWriteBarrierVerificationV1 } from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/verifier'
import {
  createSupabaseManagementBackfillLockedHighWaterCaptureTransport,
  type SupabaseManagementBackfillLockedHighWaterCaptureFetch
} from '@/app/plugins/host/deployment/supabase/management/backfill/locked-high-water-capture-transport'
import {
  createSupabaseManagementBackfillWriteBarrierInstallTransport,
  type SupabaseManagementBackfillWriteBarrierInstallFetch
} from '@/app/plugins/host/deployment/supabase/management/backfill/write-barrier-install-transport'

import {
  BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
  BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
  BACKFILL_INSTALL_FIXTURE_READ_GRANT,
  BACKFILL_INSTALL_FIXTURE_WRITE_GRANT,
  createBackfillWriteBarrierInstallFixture,
  createBackfillWriteBarrierVerificationFixture,
  type BackfillWriteBarrierInstallFixture
} from '../write-barrier/helpers'

export const BACKFILL_CAPTURE_FIXTURE_GRANT = '323e4567-e89b-42d3-a456-426614174000'
export const BACKFILL_CAPTURE_FIXTURE_PAT = 'sbp_locked_high_water_capture_secret_canary_1234567890'

const INSTALL_PROJECT_URL =
  `https://api.supabase.com/v1/projects/${BACKFILL_INSTALL_FIXTURE_PROJECT_REF}` as const

function withURL(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function jsonResponse(value: unknown, status: number, url: string): Response {
  return withURL(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }),
    url
  )
}

function clock(start = Date.parse('2026-09-05T00:00:00.000Z')): () => string {
  let current = start
  return () => {
    const result = new Date(current).toISOString()
    current += 1_000
    return result
  }
}

export interface AppliedBackfillWriteBarrierFixture {
  readonly install: BackfillWriteBarrierInstallFixture
  readonly installed: SupabaseBackfillWriteBarrierVerificationV1
  readonly reconciliation: SupabaseBackfillWriteBarrierInstallReconciliationResultV1
}

export interface BackfillLockedHighWaterCaptureFixture extends AppliedBackfillWriteBarrierFixture {
  readonly captureReview: SupabaseBackfillLockedHighWaterCaptureReviewEnvelopeV1
  readonly writeAuthority: SupabaseBackfillLockedHighWaterWriteAuthorityV1
  readonly confirmation: SupabaseBackfillLockedHighWaterCaptureConfirmationV1
}

export async function createAppliedBackfillWriteBarrierFixture(
  batchSize = 250,
  requiredMatchedRowCount: number | null = 1
): Promise<AppliedBackfillWriteBarrierFixture> {
  const install = await createBackfillWriteBarrierInstallFixture({
    batchSize,
    requiredMatchedRowCount
  })
  const journal = createMemoryBackendHostReleaseDispatchJournal()
  const fetcher: SupabaseManagementBackfillWriteBarrierInstallFetch = async (input, init) => {
    const url = String(input)
    if (init?.method === 'GET') {
      return jsonResponse(
        {
          ref: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
          organization_id: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
          name: 'Backfill capture staging'
        },
        200,
        url
      )
    }
    return jsonResponse({}, 200, url)
  }
  const transport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
    personalAccessToken: BACKFILL_CAPTURE_FIXTURE_PAT,
    fetcher
  })
  const dispatched = await dispatchSupabaseBackfillWriteBarrierInstallV1({
    context: install.context,
    transport,
    journal,
    releaseId: 'locked-high-water-capture-fixture-release',
    ownerId: 'locked-high-water-capture-fixture-owner',
    now: clock()
  })
  if (dispatched.status !== 'verification-required') {
    throw new TypeError(`Unexpected barrier dispatch status: ${dispatched.status}`)
  }
  const installed = await createBackfillWriteBarrierVerificationFixture(install, 'installed')
  const reconciliation = await reconcileSupabaseBackfillWriteBarrierInstallV1({
    context: install.context,
    installedVerification: installed,
    journal,
    now: clock(Date.parse('2026-09-05T01:00:00.000Z'))
  })
  if (reconciliation.status !== 'applied') {
    throw new TypeError(`Unexpected barrier reconciliation status: ${reconciliation.status}`)
  }
  return Object.freeze({ install, installed, reconciliation })
}

export async function createBackfillLockedHighWaterCaptureFixture(
  batchSize = 250,
  requiredMatchedRowCount: number | null = 1
): Promise<BackfillLockedHighWaterCaptureFixture> {
  const applied = await createAppliedBackfillWriteBarrierFixture(batchSize, requiredMatchedRowCount)
  const captureReview = await createSupabaseBackfillLockedHighWaterCaptureReviewV1({
    context: applied.install.context,
    reconciliation: applied.reconciliation
  })
  const writeAuthority = Object.freeze({
    projectRef: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
    accountId: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
    grantGeneration: BACKFILL_CAPTURE_FIXTURE_GRANT,
    scope: 'database:write' as const,
    permission: 'database_write' as const
  })
  const confirmation = Object.freeze({
    reviewDigest: captureReview.reviewDigest,
    sourceReviewDigest: captureReview.review.bindings.sourceReviewDigest,
    installedVerificationDigest: captureReview.review.bindings.installedVerificationDigest,
    queryDigest: captureReview.review.query.digest,
    projectRefConfirmation: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
    accountIdConfirmation: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
    captureGrantGeneration: BACKFILL_CAPTURE_FIXTURE_GRANT,
    confirmedIndependentStaging: true as const,
    confirmedLockedHighWaterCapture: true as const
  })
  return Object.freeze({ ...applied, captureReview, writeAuthority, confirmation })
}

export function lockedHighWaterResponse(
  fixture: BackfillLockedHighWaterCaptureFixture,
  values: Readonly<{
    capturedHighWater?: string | null
    minimumCursor?: string | null
    totalRowCount?: string
    remainingNullTargetRowCount?: string
    unsafeCursorRowCount?: string
    requiredBatchReceiptCount?: string
    maximumBatchReceiptCount?: string
    withinReceiptCountLimit?: boolean
  }> = {}
): Readonly<Record<string, unknown>> {
  const review = fixture.captureReview.review
  return Object.freeze({
    format: SUPABASE_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_FORMAT,
    version: 1,
    subjectDigest: review.bindings.subjectDigest,
    sourceReviewDigest: review.bindings.sourceReviewDigest,
    appliedSingleFlightKey: review.bindings.appliedSingleFlightKey,
    installedVerificationDigest: review.bindings.installedVerificationDigest,
    projectRef: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
    accountId: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
    installGrantGeneration: BACKFILL_INSTALL_FIXTURE_WRITE_GRANT,
    queryVersion: SUPABASE_BACKFILL_LOCKED_HIGH_WATER_QUERY_VERSION,
    accessMode: 'read-write-locked-read',
    snapshotScope: 'explicit-serializable-transaction',
    lockMode: 'share-row-exclusive',
    serverVersionNum: fixture.installed.serverVersionNum,
    snapshotMarker: '300:400:',
    observedAt: '2026-09-05T02:00:00.000Z',
    roles: {
      currentOid: '10',
      currentName: 'postgres',
      currentSuperuser: true,
      currentBypassRls: true,
      sessionOid: '10',
      sessionName: 'postgres',
      sessionSuperuser: true,
      sessionBypassRls: true
    },
    settings: {
      transactionIsolation: 'serializable',
      transactionReadOnly: false,
      rowSecurity: false,
      searchPath: 'pg_catalog',
      databasePrimary: true
    },
    address: {
      schemaOid: review.address.schemaOid,
      tableOid: review.address.tableOid,
      cursorSubId: review.address.cursorSubId,
      cursorTypeOid: review.address.cursorTypeOid,
      targetSubId: review.address.targetSubId,
      targetTypeOid: review.address.targetTypeOid,
      primaryKeyOid: review.address.primaryKeyOid,
      sequenceOid: review.address.sequenceOid,
      barrierConstraintOid: review.address.barrierConstraintOid
    },
    highWater: {
      capturedHighWater: values.capturedHighWater === undefined ? '42' : values.capturedHighWater,
      minimumCursor: values.minimumCursor === undefined ? '1' : values.minimumCursor,
      totalRowCount: values.totalRowCount ?? '42',
      remainingNullTargetRowCount: values.remainingNullTargetRowCount ?? '17',
      unsafeCursorRowCount: values.unsafeCursorRowCount ?? '0',
      requiredBatchReceiptCount: values.requiredBatchReceiptCount ?? '1',
      maximumBatchReceiptCount: values.maximumBatchReceiptCount ?? '9999',
      withinReceiptCountLimit: values.withinReceiptCountLimit ?? true
    }
  })
}

export const BACKFILL_CAPTURE_READ_AUTHORITY = Object.freeze({
  projectRef: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
  accountId: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
  grantGeneration: BACKFILL_INSTALL_FIXTURE_READ_GRANT
})

export interface CapturedBackfillLockedHighWaterFixture {
  readonly fixture: BackfillLockedHighWaterCaptureFixture
  readonly capture: SupabaseBackfillLockedHighWaterCaptureV1
}

export async function createCapturedBackfillLockedHighWaterFixture(
  batchSize = 250,
  values: Parameters<typeof lockedHighWaterResponse>[1] = {},
  requiredMatchedRowCount: number | null = 1
): Promise<CapturedBackfillLockedHighWaterFixture> {
  const fixture = await createBackfillLockedHighWaterCaptureFixture(
    batchSize,
    requiredMatchedRowCount
  )
  const row = lockedHighWaterResponse(fixture, values)
  const fetcher: SupabaseManagementBackfillLockedHighWaterCaptureFetch = async (input, init) => {
    const url = String(input)
    if (init?.method === 'GET') {
      return jsonResponse(
        {
          ref: fixture.writeAuthority.projectRef,
          organization_id: fixture.writeAuthority.accountId,
          name: 'Receipt V2 review staging'
        },
        200,
        url
      )
    }
    return jsonResponse([row], 201, url)
  }
  const transport = createSupabaseManagementBackfillLockedHighWaterCaptureTransport({
    personalAccessToken: BACKFILL_CAPTURE_FIXTURE_PAT,
    authority: fixture.writeAuthority,
    fetcher
  })
  const capture = await captureSupabaseBackfillLockedHighWaterV1({
    captureReview: fixture.captureReview,
    stagingTargetBinding: fixture.install.stagingBinding,
    confirmation: fixture.confirmation,
    readCurrentCompilerInput: () => fixture.install.input,
    readCurrentReadAuthority: () => BACKFILL_CAPTURE_READ_AUTHORITY,
    readCurrentWriteAuthority: () => fixture.writeAuthority,
    readCurrentStagingTargetBinding: () => fixture.install.stagingBinding,
    transport
  })
  return Object.freeze({ fixture, capture })
}

export { INSTALL_PROJECT_URL }
