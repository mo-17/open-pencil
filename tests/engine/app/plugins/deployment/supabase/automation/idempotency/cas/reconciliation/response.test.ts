/* eslint-disable max-lines -- focused suite covers six-state truth table and strict native boundary */
import { describe, expect, test } from 'bun:test'

import {
  BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
  createBackendAutomationIdempotencyCASProposal,
  digestBackendAutomationIdempotencyRecord,
  type BackendAutomationIdempotencyRecordV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_OBSERVATION_FORMAT,
  SupabaseAutomationIdempotencyCASReconciliationResponseError,
  parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1,
  trustedSupabaseAutomationIdempotencyCASReconciliationObservationContextV1,
  type SupabaseAutomationIdempotencyCASReconciliationFactsV1,
  type SupabaseAutomationIdempotencyCASReconciliationResponseErrorCode
} from '@/app/plugins/host/deployment/supabase/automation/idempotency/cas/reconciliation/response'
import {
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_VERSION,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_MAX_BYTES,
  createSupabaseAutomationIdempotencyCASReconciliationReviewForTestingV1,
  type SupabaseAutomationIdempotencyCASReconciliationReviewEnvelopeV1,
  type SupabaseAutomationIdempotencyCASReconciliationStateV1
} from '@/app/plugins/host/deployment/supabase/automation/idempotency/cas/reconciliation/review'
import { createSupabaseAutomationIdempotencyCASReviewForTestingV1 } from '@/app/plugins/host/deployment/supabase/automation/idempotency/cas/review'

const KEY = 'abcde12345abcde12345'
const OBSERVED_AT = '2026-09-09T00:00:02.000Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function initialRecord(): Promise<BackendAutomationIdempotencyRecordV1> {
  return {
    format: BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
    version: 1,
    automationId: 'automation-send-receipt',
    eventId: 'event-001',
    operationId: 'operation-001',
    idempotencyKeyDigest: await digest('idempotency-key'),
    causationId: 'causation-001',
    causationHop: 0,
    retentionHours: 24,
    createdAt: '2026-09-09T00:00:00.000Z',
    expiresAt: '2026-09-10T00:00:00.000Z',
    recordedAt: '2026-09-09T00:00:00.000Z',
    revision: 0,
    previousRecordDigest: null,
    attemptIds: ['attempt-001'],
    currentAttemptId: 'attempt-001',
    state: 'reserved',
    completionEvidenceDigest: null,
    knownNotDispatchedEvidenceDigest: null,
    reconciliationEvidenceDigest: null,
    hostEvidenceAuthenticated: false,
    persistenceAuthorityGranted: false,
    dispatchAuthorityGranted: false
  }
}

async function reconciliationReview(
  record: BackendAutomationIdempotencyRecordV1,
  currentRecord: BackendAutomationIdempotencyRecordV1 | null
): Promise<SupabaseAutomationIdempotencyCASReconciliationReviewEnvelopeV1> {
  const casReview = await createSupabaseAutomationIdempotencyCASReviewForTestingV1({
    applicationObjectKey: KEY,
    candidate: await createBackendAutomationIdempotencyCASProposal(currentRecord, record),
    currentRecord
  })
  return createSupabaseAutomationIdempotencyCASReconciliationReviewForTestingV1({ casReview })
}

async function createReview(): Promise<SupabaseAutomationIdempotencyCASReconciliationReviewEnvelopeV1> {
  return reconciliationReview(await initialRecord(), null)
}

async function createSuccessorReview(): Promise<SupabaseAutomationIdempotencyCASReconciliationReviewEnvelopeV1> {
  const initial = await initialRecord()
  const successor: BackendAutomationIdempotencyRecordV1 = {
    ...initial,
    recordedAt: '2026-09-09T00:00:01.000Z',
    revision: 1,
    previousRecordDigest: await digestBackendAutomationIdempotencyRecord(initial),
    state: 'dispatch-started'
  }
  return reconciliationReview(successor, initial)
}

type PayloadFacts = SupabaseAutomationIdempotencyCASReconciliationFactsV1

const EMPTY_FACTS: PayloadFacts = {
  inputValid: true,
  runtimeReady: true,
  fullLedgerShapeVerified: true,
  headCount: 0,
  headRevision: null,
  revisionCount: 0,
  revisionMinimum: null,
  revisionMaximum: null,
  exactInitialRevisionCount: 0,
  exactPredecessorLinkCount: 0,
  exactHeadTipCount: 0,
  candidateCount: 0,
  candidateDigestMatchCount: 0,
  candidateExactCount: 0,
  expectedHeadMatchCount: 0
}

const EXACT_FACTS: PayloadFacts = {
  ...EMPTY_FACTS,
  headCount: 1,
  headRevision: 0,
  revisionCount: 1,
  revisionMinimum: 0,
  revisionMaximum: 0,
  exactInitialRevisionCount: 1,
  exactHeadTipCount: 1,
  candidateCount: 1,
  candidateDigestMatchCount: 1,
  candidateExactCount: 1
}

async function payload(
  review: SupabaseAutomationIdempotencyCASReconciliationReviewEnvelopeV1,
  reportedStatus: SupabaseAutomationIdempotencyCASReconciliationStateV1,
  facts: PayloadFacts,
  overrides: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  return {
    queryVersion: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_VERSION,
    proposalDigest: review.review.bindings.proposalDigest,
    recordDigest: review.review.bindings.recordDigest,
    reportedStatus,
    ...facts,
    transactionReadOnly: true,
    databasePrimary: true,
    sessionReplicationRoleOrigin: true,
    schemaMarkerDigest: facts.fullLedgerShapeVerified
      ? review.review.bindings.schemaMarkerDigest
      : null,
    serverVersionNum: '160013',
    snapshotDigest: await digest('snapshot'),
    observedAt: OBSERVED_AT,
    ...overrides
  }
}

function native(text: string): {
  columns: { name: string; pgType: string; nullable: boolean }[]
  rows: string[][]
} {
  return {
    columns: [{ ...SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN }],
    rows: [[text]]
  }
}

async function response(
  review: SupabaseAutomationIdempotencyCASReconciliationReviewEnvelopeV1,
  status: SupabaseAutomationIdempotencyCASReconciliationStateV1,
  facts: PayloadFacts,
  overrides: Record<string, unknown> = {}
) {
  return native(JSON.stringify(await payload(review, status, facts, overrides)))
}

async function expectError(
  operation: Promise<unknown>,
  code: SupabaseAutomationIdempotencyCASReconciliationResponseErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseAutomationIdempotencyCASReconciliationResponseError)
    expect((cause as SupabaseAutomationIdempotencyCASReconciliationResponseError).code).toBe(code)
    return
  }
  throw new TypeError('Expected ' + code)
}

describe('Automation idempotency CAS reconciliation response', () => {
  test('Host recomputes all six states and every result remains authority-free', async () => {
    const review = await createReview()
    const cases: [SupabaseAutomationIdempotencyCASReconciliationStateV1, PayloadFacts][] = [
      ['absent', { ...EMPTY_FACTS }],
      ['exact-replay', { ...EXACT_FACTS }],
      [
        'advanced-head',
        {
          ...EXACT_FACTS,
          headRevision: 1,
          revisionCount: 2,
          revisionMaximum: 1,
          exactPredecessorLinkCount: 1
        }
      ],
      [
        'cas-conflict',
        {
          ...EXACT_FACTS,
          candidateDigestMatchCount: 0,
          candidateExactCount: 0
        }
      ],
      ['corruption', { ...EXACT_FACTS, exactHeadTipCount: 0 }],
      ['precondition-failed', { ...EMPTY_FACTS, inputValid: false }]
    ]

    for (const [status, facts] of cases) {
      const observation =
        await parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
          reconciliationReview: review,
          response: await response(review, status, facts)
        })
      expect(observation).toMatchObject({
        format: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_OBSERVATION_FORMAT,
        version: 1,
        providerId: 'supabase',
        environment: 'staging',
        testingOnly: true,
        reportedStatus: status,
        status,
        reportedStatusMatchesRecomputedFacts: true,
        statusRecomputedByHost: true,
        advancedHeadClassificationIsRelationalOnly: true,
        absentProvesPriorMutationStopped: false,
        reportedStatusAuthenticated: false,
        statusProvesDatabaseState: false,
        specificInstallationAuthenticated: false,
        productionTransportAuthenticated: false,
        readOnlyReconciliationCompleted: false,
        commitOutcomeResolved: false,
        databaseCASCommitted: false,
        automaticRetryAllowed: false,
        captureConsumed: false,
        operationAuthorityAuthenticated: false,
        credentialAuthorityCreated: false,
        transportAuthorityCreated: false,
        databaseAuthorityCreated: false,
        mutationAuthorityCreated: false,
        executionAuthorityCreated: false,
        receiptAuthorityCreated: false,
        releaseAuthorityCreated: false,
        persistenceAuthorityGranted: false,
        dispatchAuthorityGranted: false,
        releaseReady: false
      })
      expect(Object.isFrozen(observation)).toBe(true)
      expect(Object.isFrozen(observation.facts)).toBe(true)
      expect(Object.isFrozen(observation.snapshot)).toBe(true)
      const trusted =
        trustedSupabaseAutomationIdempotencyCASReconciliationObservationContextV1(observation)
      expect(trusted?.observation).toBe(observation)
      expect(
        trustedSupabaseAutomationIdempotencyCASReconciliationObservationContextV1({
          ...observation
        })
      ).toBeNull()
    }
  })

  test('reported status is only a cross-check of Host-recomputed facts', async () => {
    const review = await createReview()
    await expectError(
      parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
        reconciliationReview: review,
        response: await response(review, 'advanced-head', { ...EXACT_FACTS })
      }),
      'supabase-automation-idempotency-cas-reconciliation-response-status-mismatch'
    )
  })

  test('successor exact-replay binds the candidate at nextRevision and not the predecessor head', async () => {
    const review = await createSuccessorReview()
    const successorExact: PayloadFacts = {
      ...EXACT_FACTS,
      headRevision: 1,
      revisionCount: 2,
      revisionMaximum: 1,
      exactPredecessorLinkCount: 1,
      expectedHeadMatchCount: 0
    }
    const observation =
      await parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
        reconciliationReview: review,
        response: await response(review, 'exact-replay', successorExact)
      })
    expect(observation.status).toBe('exact-replay')

    await expectError(
      parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
        reconciliationReview: review,
        response: await response(review, 'exact-replay', {
          ...successorExact,
          expectedHeadMatchCount: 1
        })
      }),
      'supabase-automation-idempotency-cas-reconciliation-response-invalid'
    )
  })

  test('accepts overflow sentinels only through the corruption truth-table branch', async () => {
    const review = await createReview()
    const sentinels: PayloadFacts[] = [
      { ...EMPTY_FACTS, headCount: 2 },
      {
        ...EXACT_FACTS,
        revisionCount: 1026,
        revisionMaximum: 1024,
        exactPredecessorLinkCount: 1025
      },
      {
        ...EXACT_FACTS,
        headRevision: 1,
        revisionCount: 2,
        revisionMaximum: 1,
        exactPredecessorLinkCount: 1,
        candidateCount: 2,
        candidateDigestMatchCount: 2,
        candidateExactCount: 2
      }
    ]
    for (const facts of sentinels) {
      const observation =
        await parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
          reconciliationReview: review,
          response: await response(review, 'corruption', facts)
        })
      expect(observation.status).toBe('corruption')
    }
  })

  test('gate-false rows require every managed-data fact to be zero or null', async () => {
    const review = await createReview()
    for (const facts of [
      { ...EMPTY_FACTS, inputValid: false },
      { ...EMPTY_FACTS, runtimeReady: false },
      { ...EMPTY_FACTS, fullLedgerShapeVerified: false }
    ]) {
      const observation =
        await parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
          reconciliationReview: review,
          response: await response(review, 'precondition-failed', facts)
        })
      expect(observation.status).toBe('precondition-failed')
    }
    await expectError(
      parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
        reconciliationReview: review,
        response: await response(review, 'precondition-failed', {
          ...EXACT_FACTS,
          runtimeReady: false
        })
      }),
      'supabase-automation-idempotency-cas-reconciliation-response-invalid'
    )
  })

  test('rejects native row/column metadata, cardinality, nulls, and size violations', async () => {
    const review = await createReview()
    const valid = await response(review, 'absent', { ...EMPTY_FACTS })
    const variants: unknown[] = [
      { columns: [], rows: valid.rows },
      { columns: [{ name: 'status', pgType: 'text', nullable: false }], rows: valid.rows },
      { columns: [{ name: 'observation', pgType: 'jsonb', nullable: false }], rows: valid.rows },
      { columns: [{ name: 'observation', pgType: 'text', nullable: true }], rows: valid.rows },
      { columns: valid.columns, rows: [] },
      { columns: valid.columns, rows: [valid.rows[0], valid.rows[0]] },
      { columns: valid.columns, rows: [[null]] },
      { columns: valid.columns, rows: [[valid.rows[0][0], valid.rows[0][0]]] },
      { columns: [...valid.columns, valid.columns[0]], rows: valid.rows },
      { columns: valid.columns, rows: valid.rows, extra: true }
    ]
    for (const variant of variants) {
      await expectError(
        parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
          reconciliationReview: review,
          response: variant
        }),
        variant === variants[6]
          ? 'supabase-automation-idempotency-cas-reconciliation-response-json-invalid'
          : 'supabase-automation-idempotency-cas-reconciliation-response-metadata-invalid'
      )
    }
    await expectError(
      parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
        reconciliationReview: review,
        response: native(
          'x'.repeat(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_MAX_BYTES + 1)
        )
      }),
      'supabase-automation-idempotency-cas-reconciliation-response-size-invalid'
    )
  })

  test('uses strict flat JSON with exact keys and rejects duplicates or malformed primitives', async () => {
    const review = await createReview()
    const validPayload = await payload(review, 'absent', { ...EMPTY_FACTS })
    const validText = JSON.stringify(validPayload)
    const duplicate = validText.replace('"headCount":0', '"headCount":0,"headCount":0')
    const nested = validText.replace('"headCount":0', '"headCount":[]')
    const fractional = validText.replace('"headCount":0', '"headCount":0.5')
    const exponent = validText.replace('"headCount":0', '"headCount":0e0')
    const unknown = JSON.stringify({ ...validPayload, unknown: false })
    const missing = JSON.stringify(
      Object.fromEntries(Object.entries(validPayload).filter(([key]) => key !== 'headCount'))
    )
    for (const text of ['{', '[]', duplicate, nested, fractional, exponent, unknown, missing]) {
      await expectError(
        parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
          reconciliationReview: review,
          response: native(text)
        }),
        'supabase-automation-idempotency-cas-reconciliation-response-json-invalid'
      )
    }
  })

  test('rejects binding tamper, impossible facts, and runtime contradictions', async () => {
    const review = await createReview()
    const cases: [
      Record<string, unknown>,
      SupabaseAutomationIdempotencyCASReconciliationResponseErrorCode
    ][] = [
      [
        { proposalDigest: await digest('wrong') },
        'supabase-automation-idempotency-cas-reconciliation-response-binding-mismatch'
      ],
      [
        { schemaMarkerDigest: await digest('wrong-marker') },
        'supabase-automation-idempotency-cas-reconciliation-response-binding-mismatch'
      ],
      [
        { candidateDigestMatchCount: 0, candidateExactCount: 1 },
        'supabase-automation-idempotency-cas-reconciliation-response-invalid'
      ],
      [
        { headRevision: null },
        'supabase-automation-idempotency-cas-reconciliation-response-invalid'
      ],
      [
        { transactionReadOnly: false },
        'supabase-automation-idempotency-cas-reconciliation-response-invalid'
      ],
      [
        { databasePrimary: false },
        'supabase-automation-idempotency-cas-reconciliation-response-invalid'
      ],
      [
        { sessionReplicationRoleOrigin: false },
        'supabase-automation-idempotency-cas-reconciliation-response-invalid'
      ]
    ]
    for (const [overrides, code] of cases) {
      await expectError(
        parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
          reconciliationReview: review,
          response: await response(review, 'exact-replay', { ...EXACT_FACTS }, overrides)
        }),
        code
      )
    }
  })

  test('maps malformed or year-zero observedAt values to the domain response error', async () => {
    const review = await createReview()
    for (const observedAt of [
      '0000-01-01T00:00:00.000Z',
      '2026-99-09T00:00:02.000Z',
      '2026-02-31T00:00:02.000Z'
    ]) {
      await expectError(
        parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
          reconciliationReview: review,
          response: await response(review, 'absent', { ...EMPTY_FACTS }, { observedAt })
        }),
        'supabase-automation-idempotency-cas-reconciliation-response-invalid'
      )
    }
  })

  test('rejects accessors and transparent proxies without invoking getters', async () => {
    const review = await createReview()
    const valid = await response(review, 'absent', { ...EMPTY_FACTS })
    let calls = 0
    const accessorInput = { reconciliationReview: review, response: null as unknown }
    Object.defineProperty(accessorInput, 'response', {
      enumerable: true,
      get() {
        calls += 1
        return valid
      }
    })
    await expectError(
      parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1(accessorInput),
      'supabase-automation-idempotency-cas-reconciliation-response-input-invalid'
    )
    expect(calls).toBe(0)

    const accessorColumns = { rows: valid.rows }
    Object.defineProperty(accessorColumns, 'columns', {
      enumerable: true,
      get() {
        calls += 1
        return valid.columns
      }
    })
    await expectError(
      parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
        reconciliationReview: review,
        response: accessorColumns
      }),
      'supabase-automation-idempotency-cas-reconciliation-response-metadata-invalid'
    )
    expect(calls).toBe(0)

    await expectError(
      parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1(
        new Proxy({ reconciliationReview: review, response: valid }, {})
      ),
      'supabase-automation-idempotency-cas-reconciliation-response-input-invalid'
    )
    await expectError(
      parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
        reconciliationReview: review,
        response: new Proxy(valid, {})
      }),
      'supabase-automation-idempotency-cas-reconciliation-response-metadata-invalid'
    )
  })

  test('snapshots the native response before the first await and rejects copied reviews', async () => {
    const review = await createReview()
    const original = await response(review, 'absent', { ...EMPTY_FACTS })
    const input = { reconciliationReview: review, response: original }
    const pending = parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1(input)
    original.rows[0][0] = JSON.stringify(await payload(review, 'corruption', { ...EMPTY_FACTS }))
    input.response = await response(review, 'exact-replay', { ...EXACT_FACTS })
    expect((await pending).status).toBe('absent')

    for (const forged of [structuredClone(review), { ...review }]) {
      await expectError(
        parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1({
          reconciliationReview: forged,
          response: await response(review, 'absent', { ...EMPTY_FACTS })
        }),
        'supabase-automation-idempotency-cas-reconciliation-response-proof-invalid'
      )
    }
  })
})
